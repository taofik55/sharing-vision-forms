"use client";

import {
  ArrowUp,
  Camera,
  Lock,
  LocateFixed,
  LoaderCircle,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { Combobox } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  displayOptions,
  displayRows,
  effectiveOptions,
  effectiveRows,
  isChoiceAnswer,
  isGridAnswer,
  isLocationAnswer,
  isPhotoAnswer,
  lockedOptionIds,
  type AnswerValue,
  type ChoiceAnswer,
  type GridAnswer,
  type LogicContext,
} from "@/lib/forms/logic";
import {
  OTHER_OPTION_ID,
  type Option,
  type Question,
} from "@/lib/forms/schema";
import type { AnswerErrorCode } from "@/lib/forms/validation";
import { cn } from "@/lib/utils";

export type NoteProps = {
  value: string;
  onChange: (value: string) => void;
  required: boolean;
  missing: boolean;
};

type QuestionFieldProps = {
  question: Question;
  value: AnswerValue | undefined;
  error?: AnswerErrorCode;
  onChange: (value: AnswerValue | undefined) => void;
  /** Other answers: carried-over options and rows, locked options. */
  logic?: LogicContext;
  /** Interview seed for random option / row order. */
  seed?: string;
  /** Title / description after piping ("[S5]" -> the answer). */
  title?: string;
  description?: string;
  /** Interviews: question and option codes. */
  showCodes?: boolean;
  /** Interviews: the surveyor's note for this question. */
  note?: NoteProps;
  /** Interviews: capture the GPS position as soon as the question shows. */
  autoLocate?: boolean;
};

const EMPTY_LOGIC: LogicContext = { answers: {}, byKey: new Map() };

/** One question, rendered for respondents. Fully controlled. */
export function QuestionField({
  question,
  value,
  error,
  onChange,
  logic = EMPTY_LOGIC,
  seed,
  title,
  description,
  showCodes = false,
  note,
  autoLocate = false,
}: QuestionFieldProps) {
  const t = useTranslations("renderer");
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const shownDescription = description ?? question.description;
  const descriptionId = shownDescription ? `${baseId}-desc` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;
  const describedBy =
    [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  const isGroup = [
    "multiple_choice",
    "checkboxes",
    "rating",
    "linear_scale",
    "ranking",
    "grid",
  ].includes(question.type);

  const titleNode = (
    <>
      {showCodes && question.code && (
        <span className="mr-1.5 font-mono text-sm text-muted-foreground">
          {question.code}
        </span>
      )}
      {title ?? question.title}
      {question.required && (
        <span className="ml-1 text-destructive" aria-hidden>
          *
        </span>
      )}
      {question.required && <span className="sr-only"> ({t("required")})</span>}
    </>
  );

  const control = (
    <Control
      question={question}
      value={value}
      onChange={onChange}
      inputId={inputId}
      describedBy={describedBy}
      invalid={!!error}
      logic={logic}
      seed={seed}
      showCodes={showCodes}
      autoLocate={autoLocate}
    />
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4 sm:p-6",
        (error || note?.missing) && "border-destructive",
      )}
      data-question-key={question.key}
      data-question-code={question.code}
    >
      {isGroup ? (
        <fieldset
          aria-describedby={describedBy}
          aria-invalid={!!error || undefined}
          className="flex min-w-0 flex-col gap-3"
        >
          <legend className="mb-1 font-medium">{titleNode}</legend>
          {shownDescription && (
            <p
              id={descriptionId}
              className="text-sm whitespace-pre-line text-muted-foreground"
            >
              {shownDescription}
            </p>
          )}
          {control}
        </fieldset>
      ) : (
        <>
          <Label
            htmlFor={inputId}
            className="text-base leading-snug font-medium"
          >
            <span>{titleNode}</span>
          </Label>
          {shownDescription && (
            <p
              id={descriptionId}
              className="-mt-1 text-sm whitespace-pre-line text-muted-foreground"
            >
              {shownDescription}
            </p>
          )}
          {control}
        </>
      )}
      {error && (
        <p id={errorId} className="text-sm text-destructive" role="alert">
          {t(`errors.${error}`)}
        </p>
      )}
      {note && (
        <div className="flex flex-col gap-1.5 border-t pt-3">
          <Label
            htmlFor={`${baseId}-note`}
            className="text-xs font-medium text-muted-foreground"
          >
            {t("surveyorNote")}
            {note.required && (
              <span className="ml-1 text-destructive" aria-hidden>
                *
              </span>
            )}
          </Label>
          <Textarea
            id={`${baseId}-note`}
            rows={2}
            maxLength={2000}
            value={note.value}
            placeholder={t("surveyorNotePlaceholder")}
            aria-invalid={note.missing || undefined}
            className="text-base md:text-sm"
            onChange={(e) => note.onChange(e.target.value)}
            data-testid="surveyor-note"
          />
          {note.missing && (
            <p className="text-sm text-destructive" role="alert">
              {t("errors.noteRequired")}
            </p>
          )}
        </div>
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
  logic: LogicContext;
  seed?: string;
  showCodes: boolean;
  autoLocate: boolean;
};

function Control(props: ControlProps) {
  const { question: q, value, onChange, inputId, describedBy, invalid } = props;
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
          {...props}
          value={isChoiceAnswer(value) ? value : undefined}
        />
      );
    case "ranking":
      return (
        <RankingControl
          {...props}
          value={isChoiceAnswer(value) ? value : undefined}
        />
      );
    case "grid":
      return (
        <GridControl
          {...props}
          value={isGridAnswer(value) ? value : undefined}
        />
      );
    case "location":
      return (
        <LocationControl
          value={isLocationAnswer(value) ? value : undefined}
          onChange={onChange}
          auto={props.autoLocate}
        />
      );
    case "photo":
      return (
        <PhotoControl
          value={isPhotoAnswer(value) ? value.photo : undefined}
          onChange={(photo) => onChange(photo ? { photo } : undefined)}
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

function OptionText({
  option,
  showCodes,
}: {
  option: Option;
  showCodes: boolean;
}) {
  return (
    <span className="min-w-0">
      {showCodes && option.code && (
        <span className="mr-1.5 font-mono text-xs text-muted-foreground">
          {option.code}
        </span>
      )}
      {option.label}
    </span>
  );
}

/** Next selection for a multi-select after toggling one option. */
function toggleMulti(
  selected: string[],
  id: string,
  checked: boolean,
  exclusive: Set<string>,
  locked: string[],
): string[] {
  if (!checked) return selected.filter((x) => x !== id || locked.includes(x));
  if (exclusive.has(id)) return [id];
  return [...selected.filter((x) => !exclusive.has(x)), id];
}

function ChoiceControl({
  question: q,
  value,
  onChange,
  inputId,
  describedBy,
  invalid,
  logic,
  seed,
  showCodes,
}: Omit<ControlProps, "value"> & { value: ChoiceAnswer | undefined }) {
  const t = useTranslations("renderer");
  const tb = useTranslations("builder");
  const selected = value?.selected ?? [];
  const otherText = value?.otherText ?? "";
  const options = displayOptions(q, effectiveOptions(q, logic), seed);
  const locked = q.type === "checkboxes" ? lockedOptionIds(q, logic) : [];
  const exclusive = new Set(
    options.filter((o) => o.exclusive).map((o) => o.id),
  );
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

  // Carried-over options are ticked as soon as they are known.
  useEffect(() => {
    const missing = locked.filter((id) => !selected.includes(id));
    if (missing.length)
      set([...selected.filter((id) => !exclusive.has(id)), ...missing]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked.join(",")]);

  const all: Option[] = [
    ...options,
    ...(q.allowOther ? [{ id: OTHER_OPTION_ID, label: tb("other") }] : []),
  ];

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

  if (!options.length && !q.allowOther)
    return <p className="text-sm text-muted-foreground">{t("noOptionsYet")}</p>;

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
          options={all.map((o) => ({
            value: o.id,
            label: showCodes && o.code ? `${o.code} · ${o.label}` : o.label,
          }))}
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
          {all.map((o) => (
            <Label
              key={o.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-base font-normal hover:bg-muted/50 md:text-sm"
            >
              <RadioGroupItem value={o.id} className="size-5" />
              <OptionText option={o} showCodes={showCodes} />
            </Label>
          ))}
        </RadioGroup>
        {otherInput}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {all.map((o) => {
        const isLocked = locked.includes(o.id);
        return (
          <Label
            key={o.id}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-base font-normal hover:bg-muted/50 md:text-sm",
              isLocked && "cursor-default",
            )}
          >
            <Checkbox
              className="size-5"
              checked={selected.includes(o.id)}
              disabled={isLocked}
              onCheckedChange={(checked) =>
                set(
                  toggleMulti(
                    selected,
                    o.id,
                    checked === true,
                    exclusive,
                    locked,
                  ),
                )
              }
            />
            <OptionText option={o} showCodes={showCodes} />
            {isLocked && (
              <Lock
                className="size-3.5 text-muted-foreground"
                aria-label={t("lockedOption")}
              />
            )}
          </Label>
        );
      })}
      {otherInput}
    </div>
  );
}

/** Pick up to N options in order: tap to add, tap the number to remove. */
function RankingControl({
  question: q,
  value,
  onChange,
  logic,
  seed,
  showCodes,
}: Omit<ControlProps, "value"> & { value: ChoiceAnswer | undefined }) {
  const t = useTranslations("renderer");
  const tb = useTranslations("builder");
  const max = q.ranking?.max ?? 3;
  const ranked = value?.selected ?? [];
  const otherText = value?.otherText ?? "";
  const options: Option[] = [
    ...displayOptions(q, effectiveOptions(q, logic), seed),
    ...(q.allowOther ? [{ id: OTHER_OPTION_ID, label: tb("other") }] : []),
  ];
  const byId = new Map(options.map((o) => [o.id, o]));
  const set = (next: string[], other = otherText) =>
    onChange(
      next.length
        ? {
            selected: next,
            ...(next.includes(OTHER_OPTION_ID) ? { otherText: other } : {}),
          }
        : undefined,
    );
  const move = (index: number) => {
    const next = [...ranked];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    set(next);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="ranking">
      <p className="text-sm text-muted-foreground">
        {t("rankingHint", { max })}
      </p>
      {ranked.length > 0 && (
        <ol className="flex flex-col gap-1.5" aria-label={t("rankingChosen")}>
          {ranked.map((id, i) => (
            <li
              key={id}
              className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-2 py-1.5 text-base md:text-sm"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                {byId.get(id) ? (
                  <OptionText option={byId.get(id)!} showCodes={showCodes} />
                ) : (
                  id
                )}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                disabled={i === 0}
                onClick={() => move(i)}
                aria-label={t("rankingUp")}
              >
                <ArrowUp className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => set(ranked.filter((x) => x !== id))}
                aria-label={t("rankingRemove")}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
      )}
      {ranked.includes(OTHER_OPTION_ID) && (
        <Input
          aria-label={tb("other")}
          placeholder={t("otherPlaceholder")}
          value={otherText}
          className="h-11 max-w-sm text-base md:text-sm"
          onChange={(e) => set(ranked, e.target.value)}
        />
      )}
      <div className="flex flex-col gap-1.5">
        {options
          .filter((o) => !ranked.includes(o.id))
          .map((o) => (
            <button
              key={o.id}
              type="button"
              disabled={ranked.length >= max}
              onClick={() => set([...ranked, o.id])}
              className="flex min-h-11 items-center gap-3 rounded-md border border-dashed px-3 py-2 text-left text-base hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
              data-testid="ranking-option"
            >
              <Plus
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <OptionText option={o} showCodes={showCodes} />
            </button>
          ))}
      </div>
    </div>
  );
}

/**
 * Rows x columns. Column headers on wide screens; on phones every row lists
 * its column labels. One control per cell, so it is one set of inputs.
 */
function GridControl({
  question: q,
  value,
  onChange,
  logic,
  seed,
  showCodes,
}: Omit<ControlProps, "value"> & { value: GridAnswer | undefined }) {
  const t = useTranslations("renderer");
  const rows = displayRows(q, effectiveRows(q, logic), seed);
  const columns = q.options ?? [];
  const multiple = q.grid?.multiple ?? false;
  const exclusive = new Set(
    columns.filter((c) => c.exclusive).map((c) => c.id),
  );
  const answered = value?.rows ?? {};
  const template = {
    gridTemplateColumns: `minmax(9rem, 1.4fr) repeat(${columns.length}, minmax(3.5rem, 1fr))`,
  };

  const setRow = (rowId: string, cols: string[]) => {
    const next = { ...answered };
    if (cols.length) next[rowId] = cols;
    else delete next[rowId];
    onChange(Object.keys(next).length ? { rows: next } : undefined);
  };

  if (!rows.length)
    return <p className="text-sm text-muted-foreground">{t("noRowsYet")}</p>;

  return (
    <div className="flex flex-col gap-2" data-testid="grid">
      <div
        className="hidden items-end gap-1 px-2 text-center text-xs text-muted-foreground sm:grid"
        style={template}
        aria-hidden
      >
        <span />
        {columns.map((c) => (
          <span key={c.id} className="px-1">
            {showCodes && c.code ? `${c.code} · ` : ""}
            {c.label}
          </span>
        ))}
      </div>
      {rows.map((row, i) => {
        const cols = answered[row.id] ?? [];
        return (
          <fieldset
            key={row.id}
            className={cn(
              "flex flex-col gap-2 rounded-md px-2 py-2 sm:grid sm:items-center sm:gap-1",
              i % 2 === 0 && "bg-muted/40",
            )}
            style={template}
            data-grid-row={row.id}
          >
            <legend className="sr-only">{row.label}</legend>
            <span className="text-sm font-medium sm:font-normal" aria-hidden>
              {showCodes && row.code && (
                <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                  {row.code}
                </span>
              )}
              {row.label}
            </span>
            {multiple ? (
              <div className="flex flex-wrap gap-2 sm:contents">
                {columns.map((c) => (
                  <label
                    key={c.id}
                    className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-2 text-sm sm:justify-center sm:border-0"
                  >
                    <Checkbox
                      className="size-5"
                      checked={cols.includes(c.id)}
                      aria-label={`${row.label}: ${c.label}`}
                      onCheckedChange={(checked) =>
                        setRow(
                          row.id,
                          toggleMulti(
                            cols,
                            c.id,
                            checked === true,
                            exclusive,
                            [],
                          ),
                        )
                      }
                    />
                    <span className="sm:sr-only">{c.label}</span>
                  </label>
                ))}
              </div>
            ) : (
              <RadioGroup
                value={cols[0] ?? ""}
                onValueChange={(v) => setRow(row.id, [v])}
                className="flex flex-wrap gap-2 sm:contents"
                aria-label={row.label}
              >
                {columns.map((c) => (
                  <label
                    key={c.id}
                    className={cn(
                      "flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-2 text-sm sm:justify-center sm:border-0",
                      cols[0] === c.id &&
                        "border-primary bg-primary/5 sm:bg-transparent",
                    )}
                  >
                    <RadioGroupItem
                      value={c.id}
                      className="size-5"
                      aria-label={`${row.label}: ${c.label}`}
                    />
                    <span className="sm:sr-only">{c.label}</span>
                  </label>
                ))}
              </RadioGroup>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}

function LocationControl({
  value,
  onChange,
  auto,
}: {
  value: { lat: number; lng: number; accuracy?: number } | undefined;
  onChange: (value: AnswerValue | undefined) => void;
  auto: boolean;
}) {
  const t = useTranslations("renderer");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const tried = useRef(false);

  function locate() {
    if (!("geolocation" in navigator)) {
      setProblem(t("locationUnavailable"));
      return;
    }
    setBusy(true);
    setProblem(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        onChange({
          lat: Math.round(pos.coords.latitude * 1e6) / 1e6,
          lng: Math.round(pos.coords.longitude * 1e6) / 1e6,
          accuracy: Math.round(pos.coords.accuracy),
        });
      },
      (err) => {
        setBusy(false);
        setProblem(
          err.code === err.PERMISSION_DENIED
            ? t("locationDenied")
            : t("locationUnavailable"),
        );
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  }

  useEffect(() => {
    if (auto && !value && !tried.current) {
      tried.current = true;
      locate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, value]);

  return (
    <div className="flex flex-col gap-2" data-testid="location">
      {value ? (
        <p className="text-sm">
          <a
            className="font-mono text-primary underline underline-offset-2"
            href={`https://www.google.com/maps?q=${value.lat},${value.lng}`}
            target="_blank"
            rel="noreferrer"
          >
            {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
          </a>
          {value.accuracy !== undefined && (
            <span className="ml-2 text-muted-foreground">
              {t("locationAccuracy", { meters: value.accuracy })}
            </span>
          )}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{t("locationEmpty")}</p>
      )}
      {problem && (
        <p className="text-sm text-destructive" role="alert">
          {problem}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        onClick={locate}
        disabled={busy}
        data-testid="locate"
      >
        {busy ? (
          <LoaderCircle className="animate-spin" aria-hidden />
        ) : (
          <LocateFixed aria-hidden />
        )}
        {value ? t("locationRetry") : t("locationCapture")}
      </Button>
    </div>
  );
}

/** Longest side in pixels and JPEG quality of stored photos. */
const PHOTO_MAX_SIDE = 1280;
const PHOTO_QUALITY = 0.72;

async function resizePhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(
    1,
    PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
}

function PhotoControl({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const t = useTranslations("renderer");
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const src = value?.startsWith("id:")
    ? `/api/photos/${value.slice(3)}`
    : value;

  return (
    <div className="flex flex-col gap-2" data-testid="photo">
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- data URL preview
        <img
          src={src}
          alt={t("photoPreview")}
          className="max-h-64 w-fit rounded-md border object-contain"
        />
      )}
      {problem && (
        <p className="text-sm text-destructive" role="alert">
          {problem}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label={t("photoTake")}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          setProblem(null);
          try {
            onChange(await resizePhoto(file));
          } catch {
            setProblem(t("photoFailed"));
          } finally {
            setBusy(false);
          }
        }}
        data-testid="photo-input"
      />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            <Camera aria-hidden />
          )}
          {value ? t("photoRetake") : t("photoTake")}
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange(undefined)}
          >
            <Trash2 aria-hidden />
            {t("photoRemove")}
          </Button>
        )}
      </div>
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
