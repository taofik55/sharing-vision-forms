"use client";

import {
  Archive,
  ArchiveRestore,
  ChartColumn,
  Copy,
  EllipsisVertical,
  PencilRuler,
  Settings,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteFormAction,
  duplicateFormAction,
  setFormStatusAction,
} from "@/lib/forms/actions";
import { Link, useRouter } from "@/lib/i18n/navigation";

export type FormActionsTarget = {
  id: string;
  title: string;
  status: "draft" | "published" | "closed" | "archived";
  responseCount: number;
  canEdit: boolean;
  /** Admin or owner. */
  canManage: boolean;
};

type FormActionsMenuProps = {
  form: FormActionsTarget;
  canCreate: boolean;
  /** Where to go after deleting (e.g. the forms list from a form page). */
  afterDeleteHref?: string;
};

export function FormActionsMenu({
  form,
  canCreate,
  afterDeleteHref,
}: FormActionsMenuProps) {
  const t = useTranslations("forms");
  const te = useTranslations("formErrors");
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  function run<T extends { ok: boolean; error?: string }>(
    action: () => Promise<T>,
    onSuccess: (result: T) => void,
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) onSuccess(result);
      else
        toast.error(
          te((result.error ?? "generic") as Parameters<typeof te>[0]),
        );
    });
  }

  const archived = form.status === "archived";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("actions.menu", { title: form.title })}
            disabled={isPending}
            data-testid="form-actions"
          >
            <EllipsisVertical aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {form.canEdit && (
            <DropdownMenuItem asChild>
              <Link href={`/forms/${form.id}/builder`}>
                <PencilRuler aria-hidden />
                {t("actions.openBuilder")}
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link href={`/forms/${form.id}/dashboard`}>
              <ChartColumn aria-hidden />
              {t("actions.dashboard")}
            </Link>
          </DropdownMenuItem>
          {form.canEdit && (
            <DropdownMenuItem asChild>
              <Link href={`/forms/${form.id}/settings`}>
                <Settings aria-hidden />
                {t("actions.settings")}
              </Link>
            </DropdownMenuItem>
          )}
          {(canCreate || form.canEdit || form.canManage) && (
            <DropdownMenuSeparator />
          )}
          {canCreate && (
            <DropdownMenuItem
              onSelect={() =>
                run(
                  () => duplicateFormAction(form.id),
                  (r) => {
                    toast.success(t("toast.duplicated"));
                    if ("id" in r)
                      router.push(`/forms/${r.id as string}/builder`);
                  },
                )
              }
            >
              <Copy aria-hidden />
              {t("actions.duplicate")}
            </DropdownMenuItem>
          )}
          {form.canEdit && (
            <DropdownMenuItem
              onSelect={() =>
                run(
                  () =>
                    setFormStatusAction({
                      formId: form.id,
                      action: archived ? "restore" : "archive",
                    }),
                  () =>
                    toast.success(
                      archived ? t("toast.restored") : t("toast.archived"),
                    ),
                )
              }
            >
              {archived ? (
                <ArchiveRestore aria-hidden />
              ) : (
                <Archive aria-hidden />
              )}
              {archived ? t("actions.restore") : t("actions.archive")}
            </DropdownMenuItem>
          )}
          {form.canManage && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setConfirmDelete(true)}
            >
              <Trash2 aria-hidden />
              {t("actions.delete")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("deleteTitle", { title: form.title })}
        description={t("deleteDescription", { count: form.responseCount })}
        confirmLabel={t("confirmDelete")}
        destructive
        pending={isPending}
        onConfirm={() =>
          run(
            () => deleteFormAction(form.id),
            () => {
              setConfirmDelete(false);
              toast.success(t("toast.deleted"));
              if (afterDeleteHref) router.push(afterDeleteHref);
            },
          )
        }
      />
    </>
  );
}
