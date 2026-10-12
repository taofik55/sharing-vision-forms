"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck, CircleX, LoaderCircle, WandSparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { checkSlugAction, updateSettingsAction } from "@/lib/forms/actions";
import {
  IDENTIFIER_MODES,
  formSettingsSchema,
  type FormSettingsInput,
  type FormSettingsValues,
} from "@/lib/forms/settings";
import { isValidSlug, slugify } from "@/lib/forms/slug";
import { useRouter } from "@/lib/i18n/navigation";

export function SettingsForm({
  formId,
  defaultValues,
}: {
  formId: string;
  defaultValues: FormSettingsInput;
}) {
  const t = useTranslations("formSettings");
  const te = useTranslations("formErrors");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [slugCheck, setSlugCheck] = useState<{
    slug: string;
    available: boolean;
  } | null>(null);
  const form = useForm<FormSettingsInput, unknown, FormSettingsValues>({
    resolver: zodResolver(formSettingsSchema),
    defaultValues,
  });
  const { errors } = form.formState;
  const slug = useWatch({ control: form.control, name: "slug" });

  const needsCheck =
    Boolean(slug) && slug !== defaultValues.slug && isValidSlug(slug);
  const slugState: "idle" | "checking" | "available" | "taken" = !needsCheck
    ? "idle"
    : slugCheck?.slug !== slug
      ? "checking"
      : slugCheck.available
        ? "available"
        : "taken";

  // Debounced uniqueness check while typing.
  useEffect(() => {
    if (!needsCheck) return;
    const timer = setTimeout(async () => {
      const available = await checkSlugAction({ slug, formId });
      setSlugCheck({ slug, available });
    }, 400);
    return () => clearTimeout(timer);
  }, [needsCheck, slug, formId]);

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await updateSettingsAction({ formId, values });
      if (result.ok) {
        toast.success(t("saved"));
        form.reset(values);
        router.refresh();
      } else {
        if (result.error === "slugTaken")
          form.setError("slug", { message: "taken" });
        toast.error(te(result.error));
      }
    });
  });

  const fieldError = (
    name: keyof FormSettingsInput,
    key: "title" | "description" | "slug" | "deadline" | "message",
  ) =>
    errors[name] && (
      <p className="text-sm text-destructive" role="alert">
        {errors[name]?.message === "taken"
          ? t("slugTaken")
          : t(`validation.${key}`)}
      </p>
    );

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4"
      noValidate
      data-testid="settings-form"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="s-title">{t("formTitle")}</Label>
        <Input
          id="s-title"
          aria-invalid={!!errors.title}
          {...form.register("title")}
        />
        {fieldError("title", "title")}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="s-description">{t("description")}</Label>
        <Textarea
          id="s-description"
          rows={3}
          aria-invalid={!!errors.description}
          {...form.register("description")}
        />
        {fieldError("description", "description")}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="s-slug">{t("slug")}</Label>
        <div className="flex gap-2">
          <div className="flex min-w-0 flex-1 items-center rounded-md border">
            <span className="border-r px-2 text-sm whitespace-nowrap text-muted-foreground">
              /f/
            </span>
            <input
              id="s-slug"
              className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm outline-none"
              aria-invalid={!!errors.slug || slugState === "taken"}
              aria-describedby="s-slug-hint"
              {...form.register("slug")}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              form.setValue("slug", slugify(form.getValues("title")), {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          >
            <WandSparkles aria-hidden />
            <span className="hidden sm:inline">{t("slugFromTitle")}</span>
          </Button>
        </div>
        <p
          id="s-slug-hint"
          className="flex items-center gap-1 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {slugState === "checking" && (
            <LoaderCircle className="size-3 animate-spin" aria-hidden />
          )}
          {slugState === "available" && (
            <>
              <CircleCheck className="size-3 text-emerald-600" aria-hidden />
              {t("slugAvailable")}
            </>
          )}
          {slugState === "taken" && (
            <>
              <CircleX className="size-3 text-destructive" aria-hidden />
              {t("slugTaken")}
            </>
          )}
          {(slugState === "idle" || slugState === "checking") && t("slugHint")}
        </p>
        {fieldError("slug", "slug")}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="s-identifier">{t("identifierMode")}</Label>
          <Controller
            control={form.control}
            name="identifierMode"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="s-identifier" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IDENTIFIER_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {t(`identifier.${mode}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <p className="text-xs text-muted-foreground">{t("identifierHint")}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="s-deadline">{t("deadline")}</Label>
          <Input
            id="s-deadline"
            type="datetime-local"
            aria-invalid={!!errors.deadlineLocal}
            {...form.register("deadlineLocal")}
          />
          <p className="text-xs text-muted-foreground">{t("deadlineHint")}</p>
          {fieldError("deadlineLocal", "deadline")}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="s-closed">{t("closedMessage")}</Label>
        <Textarea id="s-closed" rows={2} {...form.register("closedMessage")} />
        {fieldError("closedMessage", "message")}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="s-thanks">{t("thankYouMessage")}</Label>
        <Textarea
          id="s-thanks"
          rows={2}
          {...form.register("thankYouMessage")}
        />
        {fieldError("thankYouMessage", "message")}
      </div>
      <Button
        type="submit"
        className="self-start"
        disabled={isPending || slugState === "taken"}
      >
        {isPending ? t("saving") : t("save")}
      </Button>
    </form>
  );
}
