"use client";

import { FilePlus2, FileText, LoaderCircle, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createFormAction } from "@/lib/forms/actions";
import {
  TEMPLATE_IDS,
  templateQuestionCount,
  type TemplateId,
} from "@/lib/forms/templates";
import { useRouter } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils";

/** "New form" dialog: blank or one of the built-in templates (localized by the current locale). */
export function NewFormDialog() {
  const t = useTranslations("forms");
  const tc = useTranslations("common");
  const te = useTranslations("formErrors");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState<TemplateId>("blank");
  const [isPending, startTransition] = useTransition();

  function create() {
    startTransition(async () => {
      const result = await createFormAction({ templateId });
      if (!result.ok) {
        toast.error(te(result.error));
        return;
      }
      setOpen(false);
      router.push(`/forms/${result.id}/builder`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="create-form">
          <Plus aria-hidden />
          {t("newForm")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("newFormDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("newFormDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <div
          role="radiogroup"
          aria-label={t("newFormDialog.title")}
          className="grid gap-3 sm:grid-cols-2"
        >
          {TEMPLATE_IDS.map((id) => {
            const selected = id === templateId;
            const Icon = id === "blank" ? FilePlus2 : FileText;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTemplateId(id)}
                onDoubleClick={create}
                data-testid={`template-${id}`}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors hover:bg-accent/50",
                  selected && "border-primary bg-primary/5 ring-1 ring-primary",
                )}
              >
                <Icon
                  className="mb-1 size-5 text-muted-foreground"
                  aria-hidden
                />
                <span className="font-medium">{t(`templates.${id}.name`)}</span>
                <span className="text-sm text-muted-foreground">
                  {t(`templates.${id}.description`)}
                </span>
                <span className="mt-1 text-xs text-muted-foreground">
                  {t("newFormDialog.questions", {
                    count: templateQuestionCount(id),
                  })}
                </span>
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button
            onClick={create}
            disabled={isPending}
            data-testid="create-form-confirm"
          >
            {isPending && <LoaderCircle className="animate-spin" aria-hidden />}
            {isPending
              ? t("newFormDialog.creating")
              : t("newFormDialog.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
