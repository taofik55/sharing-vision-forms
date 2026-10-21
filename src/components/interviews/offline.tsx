"use client";

import { CloudOff, CloudUpload, LoaderCircle, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { listOutbox, syncOutbox, type OutboxItem } from "@/lib/forms/outbox";
import { cn } from "@/lib/utils";

/** Registers the service worker that keeps interview pages usable offline. */
export function useServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

const SYNC_EVERY_MS = 30_000;

/**
 * Finished interviews waiting on this device. Sends them automatically when
 * online (on reconnect and every 30 s) and on demand.
 */
export function useOutbox(formId?: string) {
  const online = useOnline();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setItems(await listOutbox(formId));
    } catch {
      setItems([]);
    }
  }, [formId]);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      await syncOutbox(formId);
    } catch {
      // IndexedDB unavailable (private mode): nothing queued.
    } finally {
      await refresh();
      setSyncing(false);
    }
  }, [formId, refresh]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser storage once
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!online) return;
    // Syncing writes state after async storage / network work (an external system).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void sync();
    const timer = setInterval(() => void sync(), SYNC_EVERY_MS);
    return () => clearInterval(timer);
  }, [online, sync]);

  return { items, online, syncing, sync, refresh };
}

export function OutboxBar({
  outbox,
  className,
}: {
  outbox: ReturnType<typeof useOutbox>;
  className?: string;
}) {
  const t = useTranslations("interviews");
  const pending = outbox.items.filter((i) => !i.error).length;
  const failed = outbox.items.length - pending;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm",
        !outbox.online && "border-amber-500/60",
        className,
      )}
      data-testid="outbox"
      data-pending={pending}
    >
      {outbox.online ? (
        <CloudUpload className="size-4 text-muted-foreground" aria-hidden />
      ) : (
        <CloudOff className="size-4 text-amber-600" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        {!outbox.online && <strong className="mr-1">{t("offline")}</strong>}
        {pending > 0
          ? t("outboxPending", { count: pending })
          : t("outboxEmpty")}
        {failed > 0 && (
          <span className="ml-1 text-destructive">
            {t("outboxFailed", { count: failed })}
          </span>
        )}
      </span>
      {pending > 0 && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!outbox.online || outbox.syncing}
          onClick={() => void outbox.sync()}
          data-testid="outbox-sync"
        >
          {outbox.syncing ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            <RefreshCw aria-hidden />
          )}
          {t("syncNow")}
        </Button>
      )}
    </div>
  );
}

/** Outbox status for the interviews list (all forms). */
export function OutboxPanel() {
  useServiceWorker();
  const outbox = useOutbox();
  return <OutboxBar outbox={outbox} />;
}
