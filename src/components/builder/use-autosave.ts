"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveDraftAction } from "@/lib/forms/actions";
import { hashDefinition } from "@/lib/forms/hash";
import type { FormDefinition } from "@/lib/forms/schema";

export type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";

export const AUTOSAVE_DEBOUNCE_MS = 800;
/** Continuous typing still saves at least this often. */
export const AUTOSAVE_MAX_WAIT_MS = 1000;

type LocalDraft = {
  baseUpdatedAt: string;
  definition: FormDefinition;
  at: number;
};

export function localDraftKey(formId: string) {
  return `formpulse:draft:${formId}`;
}

export function readLocalDraft(formId: string): LocalDraft | null {
  try {
    const raw = window.localStorage.getItem(localDraftKey(formId));
    return raw ? (JSON.parse(raw) as LocalDraft) : null;
  } catch {
    return null;
  }
}

function writeLocalDraft(formId: string, draft: LocalDraft | null) {
  try {
    if (draft)
      window.localStorage.setItem(localDraftKey(formId), JSON.stringify(draft));
    else window.localStorage.removeItem(localDraftKey(formId));
  } catch {
    // Storage unavailable (private mode, quota): server autosave still runs.
  }
}

/**
 * Debounced autosave of the draft with optimistic concurrency on
 * forms.updated_at. Every unsaved change is mirrored to localStorage
 * synchronously, so a reload never loses edits even mid-save.
 */
export function useAutosave(
  formId: string,
  definition: FormDefinition,
  initialUpdatedAt: string,
) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const updatedAtRef = useRef(initialUpdatedAt);
  const savedHashRef = useRef(hashDefinition(definition));
  const latestRef = useRef(definition);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const saveRef = useRef<(force?: boolean) => Promise<boolean>>(
    async () => false,
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockedRef = useRef(false); // conflict: stop autosaving until resolved

  const clearTimers = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (maxWaitRef.current) clearTimeout(maxWaitRef.current);
    debounceRef.current = null;
    maxWaitRef.current = null;
  };

  const isDirty = useCallback(
    () => hashDefinition(latestRef.current) !== savedHashRef.current,
    [],
  );

  // Saves run strictly one after another, so two triggers never race with the
  // same expected updated_at (which would look like a conflict).
  const runSave = useCallback(
    async (force: boolean): Promise<boolean> => {
      if (blockedRef.current && !force) return false;
      if (!isDirty() && !force) {
        setStatus("saved");
        return true;
      }
      const snapshot = latestRef.current;
      setStatus("saving");
      try {
        const result = await saveDraftAction({
          formId,
          definition: snapshot,
          expectedUpdatedAt: updatedAtRef.current,
          force,
        });
        if (result.ok) {
          updatedAtRef.current = result.updatedAt;
          savedHashRef.current = hashDefinition(snapshot);
          blockedRef.current = false;
          if (isDirty()) {
            writeLocalDraft(formId, {
              baseUpdatedAt: result.updatedAt,
              definition: latestRef.current,
              at: Date.now(),
            });
            setStatus("dirty");
          } else {
            writeLocalDraft(formId, null);
            setStatus("saved");
          }
          return true;
        }
        if (result.error === "conflict") {
          blockedRef.current = true;
          setStatus("conflict");
          return false;
        }
        setStatus("error");
        return false;
      } catch {
        setStatus("error");
        return false;
      }
    },
    [formId, isDirty],
  );

  const save = useCallback(
    (force = false): Promise<boolean> => {
      clearTimers();
      const next = queueRef.current.then(() => runSave(force));
      queueRef.current = next.catch(() => false);
      return next.then((ok) => {
        // Edits made while the request was in flight get their own save.
        if (ok && isDirty() && !debounceRef.current) {
          debounceRef.current = setTimeout(
            () => void saveRef.current(),
            AUTOSAVE_DEBOUNCE_MS,
          );
        }
        return ok;
      });
    },
    [isDirty, runSave],
  );

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const schedule = useCallback(() => {
    if (blockedRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void save(), AUTOSAVE_DEBOUNCE_MS);
    maxWaitRef.current ??= setTimeout(() => void save(), AUTOSAVE_MAX_WAIT_MS);
  }, [save]);

  useEffect(() => {
    latestRef.current = definition;
    if (!isDirty()) return;
    writeLocalDraft(formId, {
      baseUpdatedAt: updatedAtRef.current,
      definition,
      at: Date.now(),
    });
    if (!blockedRef.current) {
      setStatus((s) => (s === "saving" ? s : "dirty"));
      schedule();
    }
  }, [definition, formId, isDirty, schedule]);

  // Best effort on tab hide / navigation (localStorage already has the edits).
  useEffect(() => {
    const flushOnHide = () => {
      if (document.visibilityState === "hidden" && isDirty()) void save();
    };
    document.addEventListener("visibilitychange", flushOnHide);
    window.addEventListener("pagehide", flushOnHide);
    return () => {
      document.removeEventListener("visibilitychange", flushOnHide);
      window.removeEventListener("pagehide", flushOnHide);
      clearTimers();
    };
  }, [isDirty, save]);

  /** After loading the server's latest draft (conflict resolution). */
  const acceptServerState = useCallback(
    (serverDefinition: FormDefinition, serverUpdatedAt: string) => {
      clearTimers();
      updatedAtRef.current = serverUpdatedAt;
      savedHashRef.current = hashDefinition(serverDefinition);
      latestRef.current = serverDefinition;
      blockedRef.current = false;
      writeLocalDraft(formId, null);
      setStatus("saved");
    },
    [formId],
  );

  const setUpdatedAt = useCallback((value: string) => {
    updatedAtRef.current = value;
  }, []);

  const markConflict = useCallback(() => {
    blockedRef.current = true;
    clearTimers();
    setStatus("conflict");
  }, []);

  return {
    status,
    /** Saves now; resolves true when the server has the latest edits. */
    flush: () => save(),
    retry: () => save(),
    overwrite: () => save(true),
    acceptServerState,
    setUpdatedAt,
    markConflict,
    getUpdatedAt: () => updatedAtRef.current,
  };
}
