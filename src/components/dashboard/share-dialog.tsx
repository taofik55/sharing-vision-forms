"use client";

import {
  Copy,
  ExternalLink,
  Link2,
  LoaderCircle,
  RefreshCcw,
  Share2,
  Trash2,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  createShareAction,
  listSharesAction,
  revokeShareAction,
  updateShareAction,
  type ShareLink,
} from "@/lib/shares/actions";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;
const WIB_MS = 7 * 3_600_000;

/** "Valid until" date (inclusive, WIB) -> exclusive expiry instant. */
function expiryFromDate(date: string): string | null {
  if (!date) return null;
  return new Date(Date.parse(`${date}T00:00:00+07:00`) + DAY_MS).toISOString();
}

/** Exclusive expiry instant -> last valid WIB date (YYYY-MM-DD). */
function dateFromExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "";
  return new Date(Date.parse(expiresAt) - 1 + WIB_MS)
    .toISOString()
    .slice(0, 10);
}

type Status = "active" | "inactive" | "expired";

function statusOf(link: ShareLink, now: number): Status {
  if (!link.isActive) return "inactive";
  if (link.expiresAt && Date.parse(link.expiresAt) <= now) return "expired";
  return "active";
}

/** Public, read-only dashboard links (editors and admins). */
export function ShareDialog({ formId }: { formId: string }) {
  const t = useTranslations("share");
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [until, setUntil] = useState("");
  const [includeText, setIncludeText] = useState(false);
  const [pending, startTransition] = useTransition();
  // Earliest "valid until" date (today in WIB), fixed when the dialog mounts.
  const [openedAt] = useState(() => Date.now());
  const [confirm, setConfirm] = useState<{
    id: string;
    kind: "revoke" | "regenerate";
  } | null>(null);

  const load = useCallback(() => {
    startTransition(async () => {
      const result = await listSharesAction(formId);
      if (result.ok) setLinks(result.data);
      else toast.error(t("errors.generic"));
    });
  }, [formId, t]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) load();
  }

  function replace(link: ShareLink) {
    setLinks((current) =>
      (current ?? []).map((l) => (l.id === link.id ? link : l)),
    );
  }

  function create() {
    startTransition(async () => {
      const result = await createShareAction({
        formId,
        expiresAt: expiryFromDate(until),
        includeTextAnswers: includeText,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}`));
        return;
      }
      setLinks((current) => [result.data, ...(current ?? [])]);
      setUntil("");
      setIncludeText(false);
      toast.success(t("created"));
    });
  }

  function update(
    id: string,
    patch: Record<string, unknown>,
    message?: string,
  ) {
    startTransition(async () => {
      const result = await updateShareAction({ id, ...patch });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}`));
        return;
      }
      replace(result.data);
      if (message) toast.success(message);
    });
  }

  function revoke(id: string) {
    startTransition(async () => {
      const result = await revokeShareAction(id);
      if (!result.ok) {
        toast.error(t(`errors.${result.error}`));
        return;
      }
      setLinks((current) => (current ?? []).filter((l) => l.id !== id));
      toast.success(t("revoked"));
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="share-dashboard">
          <Share2 aria-hidden />
          {t("button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <section
          className="flex flex-col gap-3 rounded-lg border p-4"
          aria-label={t("newLink")}
        >
          <h3 className="text-sm font-medium">{t("newLink")}</h3>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-until">{t("validUntil")}</Label>
              <Input
                id="share-until"
                type="date"
                className="w-44"
                value={until}
                min={dateFromExpiry(new Date(openedAt + DAY_MS).toISOString())}
                onChange={(e) => setUntil(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm sm:pb-2">
              <Switch
                checked={includeText}
                onCheckedChange={setIncludeText}
                aria-label={t("includeText")}
              />
              {t("includeText")}
            </label>
            <Button
              className="sm:ml-auto"
              onClick={create}
              disabled={pending}
              data-testid="create-share"
            >
              {pending ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : (
                <Link2 aria-hidden />
              )}
              {t("create")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("privacy")}</p>
        </section>

        <section className="flex flex-col gap-3" aria-label={t("existing")}>
          <h3 className="text-sm font-medium">{t("existing")}</h3>
          {links === null ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : links.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {links.map((link) => (
                <ShareItem
                  key={link.id}
                  link={link}
                  disabled={pending}
                  onUpdate={update}
                  onConfirm={(kind) => setConfirm({ id: link.id, kind })}
                />
              ))}
            </ul>
          )}
        </section>

        <ConfirmDialog
          open={confirm !== null}
          onOpenChange={(next) => !next && setConfirm(null)}
          title={
            confirm?.kind === "revoke" ? t("revokeTitle") : t("regenerateTitle")
          }
          description={
            confirm?.kind === "revoke"
              ? t("revokeDescription")
              : t("regenerateDescription")
          }
          confirmLabel={
            confirm?.kind === "revoke" ? t("revoke") : t("regenerate")
          }
          destructive
          onConfirm={() => {
            if (!confirm) return;
            if (confirm.kind === "revoke") revoke(confirm.id);
            else update(confirm.id, { regenerate: true }, t("regenerated"));
            setConfirm(null);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ShareItem({
  link,
  disabled,
  onUpdate,
  onConfirm,
}: {
  link: ShareLink;
  disabled: boolean;
  onUpdate: (
    id: string,
    patch: Record<string, unknown>,
    message?: string,
  ) => void;
  onConfirm: (kind: "revoke" | "regenerate") => void;
}) {
  const t = useTranslations("share");
  const format = useFormatter();
  const [now] = useState(() => Date.now());
  const status = statusOf(link, now);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success(t("copied"));
    } catch {
      toast.error(link.url);
    }
  }

  return (
    <li
      className="flex flex-col gap-3 rounded-lg border p-3"
      data-testid="share-item"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={cn(
            "border-transparent",
            status === "active"
              ? "bg-emerald-600/15 text-emerald-800 dark:text-emerald-400"
              : status === "expired"
                ? "bg-amber-500/15 text-amber-800 dark:text-amber-400"
                : "bg-muted text-muted-foreground",
          )}
          data-testid="share-status"
        >
          {t(`status.${status}`)}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {t("createdAt", {
            date: format.dateTime(new Date(link.createdAt), {
              dateStyle: "medium",
            }),
          })}
        </span>
      </div>
      <div className="flex gap-2">
        <Input
          readOnly
          value={link.url}
          aria-label={t("url")}
          onFocus={(e) => e.currentTarget.select()}
          className="font-mono text-xs"
          data-testid="share-url"
        />
        <Button
          size="icon"
          variant="outline"
          onClick={copy}
          aria-label={t("copy")}
        >
          <Copy aria-hidden />
        </Button>
        <Button size="icon" variant="outline" asChild>
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            aria-label={t("open")}
          >
            <ExternalLink aria-hidden />
          </a>
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <Switch
            checked={link.isActive}
            disabled={disabled}
            onCheckedChange={(isActive) => onUpdate(link.id, { isActive })}
            aria-label={t("active")}
            data-testid="share-active"
          />
          {t("active")}
        </label>
        <label className="flex items-center gap-2">
          <Switch
            checked={link.includeTextAnswers}
            disabled={disabled}
            onCheckedChange={(includeTextAnswers) =>
              onUpdate(link.id, { includeTextAnswers })
            }
            aria-label={t("includeText")}
          />
          {t("includeText")}
        </label>
        <label className="flex items-center gap-2">
          <span>{t("validUntil")}</span>
          <Input
            type="date"
            className="h-8 w-40"
            value={dateFromExpiry(link.expiresAt)}
            disabled={disabled}
            onChange={(e) =>
              onUpdate(link.id, { expiresAt: expiryFromDate(e.target.value) })
            }
            aria-label={t("validUntil")}
          />
        </label>
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onConfirm("regenerate")}
          >
            <RefreshCcw aria-hidden />
            {t("regenerate")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={disabled}
            onClick={() => onConfirm("revoke")}
            data-testid="share-revoke"
          >
            <Trash2 aria-hidden />
            {t("revoke")}
          </Button>
        </div>
      </div>
    </li>
  );
}
