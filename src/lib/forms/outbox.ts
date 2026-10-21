"use client";

/**
 * Interview storage on the device (IndexedDB): the interview in progress per
 * form (with photos) and an outbox of finished interviews that are sent when
 * the connection allows. Nothing is lost when the network drops mid-fieldwork.
 */
import type { Notes } from "./capi";
import type {
  InterviewErrorCode,
  InterviewPayload,
  InterviewResult,
} from "./interview";
import type { Answers } from "./logic";

const DB_NAME = "sv-interviews";
const DB_VERSION = 1;
const OUTBOX = "outbox";
const CURRENT = "current";

export type OutboxItem = {
  token: string;
  formId: string;
  payload: InterviewPayload;
  createdAt: number;
  attempts: number;
  /** Last non-retryable error (needs the interviewer's attention). */
  error?: InterviewErrorCode;
};

export type CurrentInterview = {
  formId: string;
  versionId: string;
  answers: Answers;
  notes: Notes;
  sectionId: string | null;
  startedAt: number;
  token: string;
  seed: string;
  updatedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX))
        db.createObjectStore(OUTBOX, { keyPath: "token" });
      if (!db.objectStoreNames.contains(CURRENT))
        db.createObjectStore(CURRENT, { keyPath: "formId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = action(tx.objectStore(store));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function saveCurrent(interview: CurrentInterview): Promise<IDBValidKey> {
  return run(CURRENT, "readwrite", (s) => s.put(interview));
}

export async function loadCurrent(
  formId: string,
): Promise<CurrentInterview | null> {
  const value = await run<CurrentInterview | undefined>(
    CURRENT,
    "readonly",
    (s) => s.get(formId),
  );
  return value ?? null;
}

export function clearCurrent(formId: string): Promise<undefined> {
  return run(CURRENT, "readwrite", (s) => s.delete(formId));
}

export function putOutbox(item: OutboxItem): Promise<IDBValidKey> {
  return run(OUTBOX, "readwrite", (s) => s.put(item));
}

export function removeOutbox(token: string): Promise<undefined> {
  return run(OUTBOX, "readwrite", (s) => s.delete(token));
}

export async function listOutbox(formId?: string): Promise<OutboxItem[]> {
  const all = await run<OutboxItem[]>(OUTBOX, "readonly", (s) => s.getAll());
  return all
    .filter((item) => !formId || item.formId === formId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** POST one interview. Network failures come back as code "NETWORK". */
export async function sendInterview(
  formId: string,
  payload: InterviewPayload,
): Promise<InterviewResult | { ok: false; code: "NETWORK" }> {
  try {
    const response = await fetch(`/api/interviews/${formId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response
      .json()
      .catch(() => null)) as InterviewResult | null;
    return body ?? { ok: false, code: "NETWORK" };
  } catch {
    return { ok: false, code: "NETWORK" };
  }
}

const RETRY: ReadonlySet<string> = new Set([
  "NETWORK",
  "SERVER_ERROR",
  "UNAUTHORIZED",
]);

/**
 * Sends every queued interview (optionally of one form). Sent ones leave the
 * outbox; retryable failures stay; others are kept with their error.
 */
export async function syncOutbox(formId?: string): Promise<{
  sent: number;
  pending: number;
  failed: number;
}> {
  let sent = 0;
  for (const item of await listOutbox(formId)) {
    if (item.error && !RETRY.has(item.error)) continue;
    const result = await sendInterview(item.formId, item.payload);
    if (result.ok) {
      await removeOutbox(item.token);
      sent++;
      continue;
    }
    await putOutbox({
      ...item,
      attempts: item.attempts + 1,
      error: result.code === "NETWORK" ? undefined : result.code,
    });
    // Offline or signed out: stop for now, try again later.
    if (result.code === "NETWORK" || result.code === "UNAUTHORIZED") break;
  }
  const left = await listOutbox(formId);
  return {
    sent,
    pending: left.filter((i) => !i.error || RETRY.has(i.error)).length,
    failed: left.filter((i) => i.error && !RETRY.has(i.error)).length,
  };
}
