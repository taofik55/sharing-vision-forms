"use client";

import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Combobox } from "@/components/combobox";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  isChoiceAnswer,
  type AnswerValue,
  type ChoiceAnswer,
} from "@/lib/forms/logic";
import { OTHER_OPTION_ID, type Question } from "@/lib/forms/schema";
import type { AnswerErrorCode } from "@/lib/forms/validation";
import { cn } from "@/lib/utils";

type QuestionFieldProps = {
  question: Question;
  value: AnswerValue | undefined;
  error?: AnswerErrorCode;
  onChange: (value: AnswerValue | undefined) => void;
};

/** One question, rendered for respondents. Fully controlled. */
export function QuestionField({
  question,
  value,
  error,
  onChange,
}: QuestionFieldProps) {
  const t = useTranslations("renderer");
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const descriptionId = question.description ? `${baseId}-desc` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;
  const describedBy =
    [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  const isGroup = [
    "multiple_choice",
    "checkboxes",
    "rating",
    "linear_scale",
  ].includes(question.type);

  const titleNode = (
    <>
      {question.title}
      {question.required && (
        <span className="ml-1 text-destructive" aria-hidden>
          *
        </span>
      )}
      {question.required && <span className="sr-only"> ({t("required")})</span>}
    </>
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4 sm:p-6",
        error && "border-destructive",
      )}
      data-question-key={question.key}
    >
      {isGroup ? (
        <fieldset
          aria-describedby={describedBy}
          aria-invalid={!!error || undefined}
          className="flex flex-col gap-3"
        >
          <legend className="mb-1 font-medium">{titleNode}</legend>
          {question.description && (
            <p
              id={descriptionId}
              className="text-sm whitespace-pre-line text-muted-foreground"
            >
              {question.description}
            </p>
          )}
          <Control
            question={question}
            value={value}
            onChange={onChange}
            inputId={inputId}
            describedBy={describedBy}
            invalid={!!error}
          />
        </fieldset>
      ) : (
        <>
          <Label
            htmlFor={inputId}
            className="text-base leading-snug font-medium"
          >
            <span>{titleNode}</span>
          </Label>
          {question.description && (
            <p
              id={descriptionId}
              className="-mt-1 text-sm whitespace-pre-line text-muted-foreground"
            >
              {question.description}
            </p>
          )}
          <Control
            question={question}
            value={value}
            onChange={onChange}
            inputId={inputId}
            describedBy={describedBy}
            invalid={!!error}
          />
        </>
      )}
      {error && (
        <p id={errorId} className="text-sm text-destructive" role="alert">
          {t(`errors.${error}`)}
        </p>
      )}
    </div>
  );
}

type ControlProps = {
  question: Question;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue | undefined) => void;
  inputId: string;
  describedBy?: string;
  invalid: boolean;
};

function Control({
  question: q,
  value,
  onChange,
  inputId,
  describedBy,
  invalid,
}: ControlProps) {
  const t = useTranslations("renderer");
  const common = {
    id: inputId,
    "aria-describedby": describedBy,
    "aria-invalid": invalid || undefined,
  };
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number"
        ? String(value)
        : "";

  // 44px targets and 16px text on phones (prevents iOS zoom on focus).
  const big = "h-11 text-base md:text-sm";
  // Custom hint from the builder, else "Your answer".
  const placeholder = q.placeholder?.trim() || t("textPlaceholder");

  switch (q.type) {
    case "short_text":
      return (
        <Input
          {...common}
          className={big}
          value={text}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "email":
      return (
        <Input
          {...common}
          className={big}
          type="email"
          autoComplete="email"
          value={text}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "phone":
      return (
        <Input
          {...common}
          className={big}
          type="tel"
          autoComplete="tel"
          value={text}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "paragraph":
      return (
        <Textarea
          {...common}
          className="text-base md:text-sm"
          rows={4}
          value={text}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <Input
          {...common}
          type="number"
          inputMode={q.validation?.integerOnly ? "numeric" : "decimal"}
          min={q.validation?.min}
          max={q.validation?.max}
          step={q.validation?.integerOnly ? 1 : "any"}
          value={text}
          placeholder={placeholder}
          className={cn(big, "max-w-xs")}
          onChange={(e) =>
            onChange(e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      );
    case "date":
      return (
        <Input
          {...common}
          type="date"
          min={q.validation?.minDate}
          max={q.validation?.maxDate}
          value={text}
          className={cn(big, "max-w-xs")}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    case "multiple_choice":
    case "checkboxes":
    case "dropdown":
      return (
        <ChoiceControl
          question={q}
          value={isChoiceAnswer(value) ? value : undefined}
          onChange={onChange}
          inputId={inputId}
          describedBy={describedBy}
          invalid={invalid}
        />
      );
    case "rating":
      return (
        <RatingControl
          max={q.rating?.max ?? 5}
          value={typeof value === "number" ? value : undefined}
          onChange={onChange}
        />
      );
    case "linear_scale":
      return (
        <ScaleControl
          min={q.scale?.min ?? 1}
          max={q.scale?.max ?? 5}
          minLabel={q.scale?.minLabel}
          maxLabel={q.scale?.maxLabel}
          value={typeof value === "number" ? value : undefined}
          onChange={onChange}
        />
      );
  }
}

function ChoiceControl({
  question: q,
  value,
  onChange,
  inputId,
  describedBy,
  invalid,
}: Omit<ControlProps, "value"> & { value: ChoiceAnswer | undefined }) {
  const t = useTranslations("renderer");
  const tb = useTranslations("builder");
  const selected = value?.selected ?? [];
  const otherText = value?.otherText ?? "";
  const options = q.options ?? [];
  const otherChosen = selected.includes(OTHER_OPTION_ID);
  const set = (next: string[], other = otherText) =>
    onChange(
      next.length
        ? {
            selected: next,
            ...(next.includes(OTHER_OPTION_ID) ? { otherText: other } : {}),
          }
        : undefined,
    );

  const otherInput = q.allowOther && otherChosen && (
    <Input
      aria-label={tb("other")}
      placeholder={t("otherPlaceholder")}
      value={otherText}
      className="mt-1 h-11 max-w-sm text-base md:text-sm"
      autoFocus
      onChange={(e) => set(selected, e.target.value)}
    />
  );

  if (q.type === "dropdown") {
    // Searchable when the list is long (type to filter).
    return (
      <div className="flex flex-col gap-2">
        <Combobox
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          value={selected[0]}
          onChange={(v) => set([v])}
          options={[
            ...options.map((o) => ({ value: o.id, label: o.label })),
            ...(q.allowOther
              ? [{ value: OTHER_OPTION_ID, label: tb("other") }]
              : []),
          ]}
          placeholder={q.placeholder?.trim() || t("chooseOption")}
          searchPlaceholder={t("searchOptions")}
          emptyText={t("noMatches")}
          searchable
          className="h-11 max-w-sm text-base md:text-sm"
        />
        {otherInput}
      </div>
    );
  }

  if (q.type === "multiple_choice") {
    return (
      <div className="flex flex-col gap-2">
        <RadioGroup
          value={selected[0] ?? ""}
          onValueChange={(v) => set([v])}
          className="gap-2"
        >
          {[
            ...options,
            ...(q.allowOther
              ? [{ id: OTHER_OPTION_ID, label: tb("other") }]
              : []),
          ].map((o) => (
            <Label
              key={o.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-base font-normal hover:bg-muted/50 md:text-sm"
            >
              <RadioGroupItem value={o.id} className="size-5" />
              {o.label}
            </Label>
          ))}
        </RadioGroup>
        {otherInput}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {[
        ...options,
        ...(q.allowOther ? [{ id: OTHER_OPTION_ID, label: tb("other") }] : []),
      ].map((o) => (
        <Label
          key={o.id}
          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-base font-normal hover:bg-muted/50 md:text-sm"
        >
          <Checkbox
            className="size-5"
            checked={selected.includes(o.id)}
            onCheckedChange={(checked) =>
              set(
                checked
                  ? [...selected, o.id]
                  : selected.filter((id) => id !== o.id),
              )
            }
          />
          {o.label}
        </Label>
      ))}
      {otherInput}
    </div>
  );
}

function RatingControl({
  max,
  value,
  onChange,
}: {
  max: number;
  value?: number;
  onChange: (v: number | undefined) => void;
}) {
  const t = useTranslations("renderer");
  return (
    <RadioGroup
      value={value ? String(value) : ""}
      onValueChange={(v) => onChange(Number(v))}
      className="flex flex-wrap gap-1"
      orientation="horizontal"
    >
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <Label
          key={n}
          className="cursor-pointer rounded-md p-1"
          title={t("rating", { value: n, max })}
        >
          <RadioGroupItem
            value={String(n)}
            className="sr-only"
            aria-label={t("rating", { value: n, max })}
          />
          <Star
            aria-hidden
            className={cn(
              "size-8 transition-colors",
              value && n <= value
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground",
            )}
          />
        </Label>
      ))}
    </RadioGroup>
  );
}

function ScaleControl({
  min,
  max,
  minLabel,
  maxLabel,
  value,
  onChange,
}: {
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
  value?: number;
  onChange: (v: number | undefined) => void;
}) {
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <div className="flex flex-col gap-2">
      <RadioGroup
        value={value !== undefined ? String(value) : ""}
        onValueChange={(v) => onChange(Number(v))}
        orientation="horizontal"
        className="flex flex-wrap gap-2"
      >
        {values.map((n) => (
          <Label
            key={n}
            className={cn(
              "flex min-h-11 min-w-11 cursor-pointer flex-col items-center gap-1 rounded-md border px-2 py-2 font-normal",
              value === n && "border-primary bg-primary/5",
            )}
          >
            <span className="text-sm">{n}</span>
            <RadioGroupItem value={String(n)} />
          </Label>
        ))}
      </RadioGroup>
      {(minLabel || maxLabel) && (
        <div className="flex justify-between gap-4 text-xs text-muted-foreground">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      )}
    </div>
  );
}
