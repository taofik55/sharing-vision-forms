"use client";

import {
  Archive,
  ArchiveRestore,
  CirclePause,
  CirclePlay,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { deleteFormAction, setFormStatusAction } from "@/lib/forms/actions";
import type { StatusAction } from "@/lib/forms/settings";
import { useRouter } from "@/lib/i18n/navigation";

type Status = "draft" | "published" | "closed" | "archived";

function useStatusAction(formId: string) {
  const te = useTranslations("formErrors");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const run = (action: StatusAction, success: string) =>
    startTransition(async () => {
      const result = await setFormStatusAction({ formId, action });
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else toast.error(te(result.error));
    });
  return { run, isPending };
}

/** Close / reopen a published form. */
export function PublishControls({
  formId,
  status,
}: {
  formId: string;
  status: Status;
}) {
  const t = useTranslations();
  const { run, isPending } = useStatusAction(formId);
  if (status === "published") {
    return (
      <Button
        variant="outline"
        disabled={isPending}
        onClick={() => run("close", t("forms.toast.closed"))}
        data-testid="close-form"
      >
        <CirclePause aria-hidden />
        {t("formSettings.close")}
      </Button>
    );
  }
  if (status === "closed") {
    return (
      <Button
        variant="outline"
        disabled={isPending}
        onClick={() => run("reopen", t("forms.toast.reopened"))}
        data-testid="reopen-form"
      >
        <CirclePlay aria-hidden />
        {t("formSettings.reopen")}
      </Button>
    );
  }
  return null;
}

/** Archive / restore and delete (delete: admin or owner only). */
export function DangerZone({
  formId,
  title,
  status,
  responseCount,
  canManage,
}: {
  formId: string;
  title: string;
  status: Status;
  responseCount: number;
  canManage: boolean;
}) {
  const t = useTranslations();
  const te = useTranslations("formErrors");
  const router = useRouter();
  const { run, isPending } = useStatusAction(formId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();
  const archived = status === "archived";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {t("formSettings.archiveDescription")}
        </p>
        <Button
          variant="outline"
          disabled={isPending}
          onClick={() =>
            run(
              archived ? "restore" : "archive",
              archived ? t("forms.toast.restored") : t("forms.toast.archived"),
            )
          }
        >
          {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
          {archived ? t("formSettings.restore") : t("formSettings.archive")}
        </Button>
      </div>
      {canManage && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {t("formSettings.deleteDescription")}
          </p>
          <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden />
            {t("formSettings.delete")}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("forms.deleteTitle", { title })}
        description={t("forms.deleteDescription", { count: responseCount })}
        confirmLabel={t("forms.confirmDelete")}
        destructive
        pending={deleting}
        onConfirm={() =>
          startDelete(async () => {
            const result = await deleteFormAction(formId);
            if (result.ok) {
              toast.success(t("forms.toast.deleted"));
              router.push("/forms");
            } else toast.error(te(result.error));
          })
        }
      />
    </div>
  );
}
