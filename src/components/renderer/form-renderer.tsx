"use client";

import { CircleCheck, LoaderCircle, OctagonX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { missingNotes, type Notes } from "@/lib/forms/capi";
import {
  computeFlow,
  logicContext,
  pipeText,
  type AnswerValue,
  type Answers,
  type Termination,
} from "@/lib/forms/logic";
import type { FormDefinition } from "@/lib/forms/schema";
import { validateAnswers, type AnswerErrors } from "@/lib/forms/validation";
import { QuestionField } from "./question-field";

export type FormPagesProps = {
  definition: FormDefinition;
  title: string;
  description?: string | null;
  answers: Answers;
  onAnswersChange: (answers: Answers) => void;
  /** Current page (section id); null = first visible section. */
  sectionId: string | null;
  onSectionChange: (sectionId: string | null) => void;
  /**
   * Called with validated answers (hidden questions removed). Return answer
   * errors to show them (e.g. from the server), or null when done.
   */
  onComplete: (
    answers: Answers,
  ) => Promise<AnswerErrors | null> | AnswerErrors | null;
  /** A screening rule ended the form: answers so far + the reason. */
  onScreenOut?: (answers: Answers, termination: Termination) => void;
  /**
   * Before leaving a page (interviews: live quota check). Return a
   * termination to end the interview instead of moving on.
   */
  beforeNext?: (
    sectionId: string,
    answers: Answers,
  ) => Promise<Termination | null>;
  submitting?: boolean;
  /** Rendered between the header and the questions (notices, banners). */
  banner?: ReactNode;
  /** Extra line in the header (e.g. "Responding as ..."). */
  headerExtra?: ReactNode;
  /** Anti-spam field, invisible to people. */
  honeypot?: {
    value: string;
    onChange: (value: string) => void;
    label: string;
  };
  /** Random order of options / rows for this interview. */
  seed?: string;
  /** Interviews: question and option codes. */
  showCodes?: boolean;
  /** Interviews: a note per question (required where the question says so). */
  notes?: { value: Notes; onChange: (notes: Notes) => void };
  /** Interviews: capture GPS automatically. */
  autoLocate?: boolean;
  /** Label of the final button (default "Submit"). */
  submitLabel?: string;
};

/**
 * One section per page, live conditional logic (show-if, jumps, screen-outs),
 * per-page validation with the shared answer schema. Controlled: the parent
 * owns answers and page.
 */
export function FormPages({
  definition,
  title,
  description,
  answers,
  onAnswersChange,
  sectionId,
  onSectionChange,
  onComplete,
  onScreenOut,
  beforeNext,
  submitting = false,
  banner,
  headerExtra,
  honeypot,
  seed,
  showCodes = false,
  notes,
  autoLocate = false,
  submitLabel,
}: FormPagesProps) {
  const t = useTranslations("renderer");
  const tp = useTranslations("publicForm");
  const [errors, setErrors] = useState<AnswerErrors>({});
  const [noteErrors, setNoteErrors] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [blocked, setBlocked] = useState<Termination | null>(null);
  const topRef = useRef<HTMLFormElement>(null);

  const flow = useMemo(
    () => computeFlow(definition, answers),
    [definition, answers],
  );
  const visibleKeys = useMemo(
    () => new Set(flow.visible.map((q) => q.key)),
    [flow],
  );
  const visibleSections = useMemo(
    () =>
      definition.sections.filter((s) =>
        s.questions.some((q) => visibleKeys.has(q.key)),
      ),
    [definition, visibleKeys],
  );
  const logic = useMemo(
    () => logicContext(definition, answers),
    [definition, answers],
  );
  const termination = blocked ?? flow.terminated ?? null;

  // Track the page by section id so logic changes do not jump pages.
  let index = visibleSections.findIndex((s) => s.id === sectionId);
  if (index < 0) index = 0;
  const section = visibleSections[index];
  const total = visibleSections.length;
  const isLast = index >= total - 1;
  // The page that holds the terminating question ends the form.
  const endsHere =
    termination !== null &&
    (blocked !== null ||
      section?.questions.some((q) => q.key === termination.questionKey));

  function setAnswer(key: string, value: AnswerValue | undefined) {
    const next = { ...answers };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onAnswersChange(next);
    setBlocked(null);
    if (errors[key]) {
      const rest = { ...errors };
      delete rest[key];
      setErrors(rest);
    }
  }

  function setNote(key: string, value: string) {
    if (!notes) return;
    const next = { ...notes.value };
    if (value) next[key] = value;
    else delete next[key];
    notes.onChange(next);
    if (noteErrors.includes(key))
      setNoteErrors(noteErrors.filter((k) => k !== key));
  }

  function goTo(id: string | null) {
    onSectionChange(id);
    topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function focusFirstError(keys: string[]) {
    requestAnimationFrame(() => {
      const key = keys[0];
      document
        .querySelector<HTMLElement>(
          `[data-question-key="${key}"] input, [data-question-key="${key}"] textarea, [data-question-key="${key}"] button`,
        )
        ?.focus();
    });
  }

  function showErrors(errs: AnswerErrors, missing: string[] = []) {
    setErrors(errs);
    setNoteErrors(missing);
    const keys = [...Object.keys(errs), ...missing];
    // Jump to the first page that has an error.
    const target = visibleSections.find((s) =>
      s.questions.some((q) => keys.includes(q.key)),
    );
    if (target && target.id !== section?.id) goTo(target.id);
    focusFirstError(keys);
  }

  function validateKeys(keys: string[]): boolean {
    const result = validateAnswers(definition, answers, keys);
    const missing = notes
      ? missingNotes(
          definition,
          keys.filter((k) => visibleKeys.has(k)),
          notes.value,
        )
      : [];
    if (result.ok && !missing.length) {
      setErrors({});
      setNoteErrors([]);
      return true;
    }
    showErrors(result.ok ? {} : result.errors, missing);
    return false;
  }

  function validatePage(): boolean {
    if (!section) return true;
    return validateKeys(section.questions.map((q) => q.key));
  }

  async function next() {
    if (!section || !validatePage()) return;
    if (beforeNext) {
      setChecking(true);
      try {
        const stop = await beforeNext(section.id, answers);
        if (stop) {
          setBlocked(stop);
          return;
        }
      } finally {
        setChecking(false);
      }
    }
    goTo(visibleSections[index + 1]?.id ?? null);
  }

  async function submit() {
    if (!validatePage()) return;
    const all = validateAnswers(definition, answers);
    const missing = notes
      ? missingNotes(definition, visibleKeys, notes.value)
      : [];
    if (!all.ok || missing.length) {
      showErrors(all.ok ? {} : all.errors, missing);
      return;
    }
    const serverErrors = await onComplete(all.data);
    if (serverErrors && Object.keys(serverErrors).length)
      showErrors(serverErrors);
  }

  function screenOut() {
    if (!termination) return;
    // Questions on the screening page up to the reason must be valid.
    const keys = flow.visible.map((q) => q.key);
    if (
      !validateKeys(
        section
          ? section.questions.map((q) => q.key).filter((k) => keys.includes(k))
          : [],
      )
    )
      return;
    const kept = Object.fromEntries(
      Object.entries(answers).filter(([k]) => keys.includes(k)),
    );
    onScreenOut?.(kept, termination);
  }

  return (
    <form
      ref={topRef}
      className="mx-auto flex w-full max-w-2xl scroll-mt-4 flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (submitting || checking) return;
        if (endsHere) screenOut();
        else if (isLast) void submit();
        else void next();
      }}
      data-testid="form-renderer"
    >
      <header className="flex flex-col gap-2 rounded-lg border border-t-8 border-t-primary bg-card p-4 sm:p-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="whitespace-pre-line text-muted-foreground">
            {description}
          </p>
        )}
        {headerExtra}
        <p className="text-sm text-destructive">{t("requiredLegend")}</p>
      </header>

      {total > 1 && (
        <div className="flex flex-col gap-1.5 px-1">
          <span className="text-xs text-muted-foreground">
            {t("page", { current: index + 1, total })}
          </span>
          <div
            role="progressbar"
            aria-label={tp("progress")}
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={index + 1}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${((index + 1) / total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {banner}

      {section && (
        <section
          aria-labelledby={`section-${section.id}`}
          className="flex flex-col gap-4"
          data-testid="form-page"
        >
          {total > 1 && (
            <div className="flex flex-col gap-1 px-1">
              <h2
                id={`section-${section.id}`}
                className="text-lg font-semibold"
              >
                {section.title}
              </h2>
              {section.description && (
                <p className="text-sm whitespace-pre-line text-muted-foreground">
                  {pipeText(section.description, definition, answers)}
                </p>
              )}
            </div>
          )}
          {section.questions
            .filter((q) => visibleKeys.has(q.key))
            .map((q) => (
              <QuestionField
                key={q.key}
                question={q}
                value={answers[q.key]}
                error={errors[q.key]}
                onChange={(value) => setAnswer(q.key, value)}
                logic={logic}
                seed={seed}
                title={pipeText(q.title, definition, answers)}
                description={
                  q.description
                    ? pipeText(q.description, definition, answers)
                    : undefined
                }
                showCodes={showCodes}
                autoLocate={autoLocate}
                note={
                  notes
                    ? {
                        value: notes.value[q.key] ?? "",
                        onChange: (v) => setNote(q.key, v),
                        required: q.noteRequired ?? false,
                        missing: noteErrors.includes(q.key),
                      }
                    : undefined
                }
              />
            ))}
        </section>
      )}

      {endsHere && termination && (
        <Alert variant="destructive" data-testid="screen-out">
          <OctagonX aria-hidden />
          <AlertTitle>{t("screenOutTitle")}</AlertTitle>
          <AlertDescription>
            {termination.reason ||
              (termination.code
                ? t("screenOutCode", { code: termination.code })
                : t("screenOutDefault"))}
          </AlertDescription>
        </Alert>
      )}

      {honeypot && (
        // Off-screen (not display:none, which some bots skip). People never see or reach it.
        <div
          aria-hidden
          className="absolute -left-[10000px] h-px w-px overflow-hidden"
        >
          <label>
            {honeypot.label}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot.value}
              onChange={(e) => honeypot.onChange(e.target.value)}
            />
          </label>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pb-6">
        {index > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={submitting}
            onClick={() => {
              setErrors({});
              setNoteErrors([]);
              setBlocked(null);
              goTo(visibleSections[index - 1]?.id ?? null);
            }}
          >
            {t("back")}
          </Button>
        ) : (
          <span />
        )}
        <Button
          type="submit"
          size="lg"
          variant={endsHere ? "destructive" : "default"}
          disabled={submitting || checking}
          data-testid={
            endsHere
              ? "screen-out-submit"
              : isLast
                ? "submit-form"
                : "next-page"
          }
        >
          {(submitting || checking) && (
            <LoaderCircle className="animate-spin" aria-hidden />
          )}
          {submitting
            ? tp("submitting")
            : endsHere
              ? t("screenOutSubmit")
              : isLast
                ? (submitLabel ?? t("submit"))
                : t("next")}
        </Button>
      </div>
    </form>
  );
}

export type FormRendererProps = {
  definition: FormDefinition;
  title: string;
  description?: string | null;
  thankYouMessage?: string | null;
  /** Builder preview: nothing is sent or stored. Live forms use PublicForm. */
  mode: "preview";
};

/** Self-contained preview (builder). */
export function FormRenderer({
  definition,
  title,
  description,
  thankYouMessage,
}: FormRendererProps) {
  const t = useTranslations("renderer");
  const [answers, setAnswers] = useState<Answers>({});
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [done, setDone] = useState<"complete" | "screened" | false>(false);
  const [run, setRun] = useState(0);

  if (done) {
    return (
      <div
        className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 rounded-lg border p-8 text-center"
        data-testid="renderer-done"
      >
        <CircleCheck className="size-10 text-primary" aria-hidden />
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="whitespace-pre-line">
          {done === "screened"
            ? t("screenOutDone")
            : thankYouMessage || t("thankYouDefault")}
        </p>
        <p className="text-sm text-muted-foreground">{t("previewSubmitted")}</p>
        <Button
          variant="outline"
          onClick={() => {
            setAnswers({});
            setSectionId(null);
            setDone(false);
            setRun((n) => n + 1);
          }}
        >
          {t("startOver")}
        </Button>
      </div>
    );
  }

  return (
    <FormPages
      key={run}
      definition={definition}
      title={title}
      description={description}
      answers={answers}
      onAnswersChange={setAnswers}
      sectionId={sectionId}
      onSectionChange={setSectionId}
      onComplete={() => {
        setDone("complete");
        return null;
      }}
      onScreenOut={() => setDone("screened")}
      seed={"preview-" + run}
      showCodes
    />
  );
}
