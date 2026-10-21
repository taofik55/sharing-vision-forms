"use client";

import {
  CircleAlert,
  CircleCheck,
  Clock,
  Info,
  RotateCw,
  Save,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { FormPages } from "@/components/renderer/form-renderer";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  hasDraftContent,
  migrateDraftAnswers,
  readLocalDraft,
  writeLocalDraft,
  type LocalDraft,
} from "@/lib/forms/drafts";
import { buildIdentifier, type IdentifierError } from "@/lib/forms/identifier";
import type { Answers } from "@/lib/forms/logic";
import type { PublicFormDto } from "@/lib/forms/public";
import type { SubmitResponse } from "@/lib/forms/submission";
import type { AnswerErrors } from "@/lib/forms/validation";
import { ClosedState } from "./closed-state";

type Phase = "init" | "resume" | "identifier" | "form" | "done" | "closed";

const LOCAL_SAVE_MS = 500;
const SERVER_SYNC_MS = 5000;
const SUBMIT_TIMEOUT_MS = 30_000;
const RETRYABLE = new Set([
  "SERVER_ERROR",
  "RATE_LIMITED",
  "TOO_FAST",
  "NETWORK",
]);

/**
 * Respondent flow: resume prompt -> identifier step -> pages -> thank you.
 * Answers are mirrored to localStorage (500 ms debounce) and to the server
 * draft (every ~5 s while changing, and on page change).
 */
export function PublicForm({ form }: { form: PublicFormDto }) {
  const t = useTranslations("publicForm");
  const tr = useTranslations("renderer");
  const format = useFormatter();
  const locale = useLocale();
  const needsIdentifier = form.identifierMode !== "none";

  const [phase, setPhase] = useState<Phase>("init");
  const [answers, setAnswers] = useState<Answers>({});
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState({ email: "", phone: "" });
  const [identifierErrors, setIdentifierErrors] = useState<
    Partial<Record<"email" | "phone", IdentifierError>>
  >({});
  const [startedAt, setStartedAt] = useState(0);
  const [draftToken, setDraftToken] = useState("");
  const [submissionToken, setSubmissionToken] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{
    message: string;
    retryable: boolean;
  } | null>(null);
  const [resumeDraft, setResumeDraft] = useState<LocalDraft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [screenedOut, setScreenedOut] = useState(false);

  // ---------------------------------------------------------------------------
  // Start / resume
  // ---------------------------------------------------------------------------
  const startFresh = useCallback(() => {
    setAnswers({});
    setSectionId(null);
    setIdentifier({ email: "", phone: "" });
    setIdentifierErrors({});
    setStartedAt(Date.now());
    setDraftToken(crypto.randomUUID());
    setSubmissionToken(crypto.randomUUID());
    setSubmitError(null);
    setNotice(null);
    setPhase(needsIdentifier ? "identifier" : "form");
  }, [needsIdentifier]);

  useEffect(() => {
    // Runs once on mount: localStorage only exists in the browser.
    const draft = readLocalDraft(form.formId);
    if (draft && hasDraftContent(draft)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only storage, read once
      setResumeDraft(draft);
      setPhase("resume");
    } else startFresh();
  }, [form.formId, startFresh]);

  function continueDraft(draft: LocalDraft) {
    let restored = draft.answers;
    if (draft.versionId !== form.versionId) {
      const migrated = migrateDraftAnswers(draft.answers, form.definition);
      restored = migrated.answers;
      setNotice(t("resume.versionChanged", { count: migrated.dropped.length }));
    }
    setAnswers(restored);
    setSectionId(
      form.definition.sections.some((s) => s.id === draft.sectionId)
        ? draft.sectionId
        : null,
    );
    setIdentifier(draft.identifier ?? { email: "", phone: "" });
    setStartedAt(draft.startedAt || Date.now());
    setDraftToken(draft.draftToken);
    setSubmissionToken(draft.submissionToken || crypto.randomUUID());
    const identifierOk = buildIdentifier(
      form.identifierMode,
      draft.identifier ?? {},
    ).ok;
    setPhase(
      needsIdentifier && (draft.step === "identifier" || !identifierOk)
        ? "identifier"
        : "form",
    );
    setResumeDraft(null);
  }

  function startOver(draft: LocalDraft) {
    void fetch(`/api/f/${form.slug}/draft?token=${draft.draftToken}`, {
      method: "DELETE",
    }).catch(() => {});
    writeLocalDraft(form.formId, null);
    setResumeDraft(null);
    startFresh();
  }

  // ---------------------------------------------------------------------------
  // Drafts: localStorage (debounced) + server (throttled)
  // ---------------------------------------------------------------------------
  const active = phase === "identifier" || phase === "form";
  const snapshot = useRef<LocalDraft | null>(null);
  const serverDirty = useRef(false);

  useEffect(() => {
    if (!active || !draftToken) return;
    snapshot.current = {
      versionId: form.versionId,
      answers,
      sectionId,
      identifier,
      step: phase === "form" ? "form" : "identifier",
      startedAt,
      draftToken,
      submissionToken,
      updatedAt: Date.now(),
    };
    serverDirty.current = true;
    const timer = setTimeout(
      () => writeLocalDraft(form.formId, snapshot.current),
      LOCAL_SAVE_MS,
    );
    return () => clearTimeout(timer);
  }, [
    active,
    answers,
    sectionId,
    identifier,
    phase,
    startedAt,
    draftToken,
    submissionToken,
    form.formId,
    form.versionId,
  ]);

  const syncServer = useCallback(
    (keepalive = false) => {
      const draft = snapshot.current;
      if (!draft || !serverDirty.current) return;
      serverDirty.current = false;
      // No identifier in server drafts (no PII).
      const body = JSON.stringify({
        draftToken: draft.draftToken,
        versionId: draft.versionId,
        data: {
          answers: draft.answers,
          sectionId: draft.sectionId,
          startedAt: draft.startedAt,
        },
      });
      void fetch(`/api/f/${form.slug}/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: keepalive && body.length < 60_000,
      }).catch(() => {
        serverDirty.current = true; // retry on the next tick
      });
    },
    [form.slug],
  );

  useEffect(() => {
    if (phase !== "form") return;
    const interval = setInterval(() => syncServer(), SERVER_SYNC_MS);
    // Tab close / app switch: write everything now.
    const flush = () => {
      if (snapshot.current) writeLocalDraft(form.formId, snapshot.current);
      syncServer(true);
    };
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [phase, syncServer, form.formId]);

  function changeSection(id: string | null) {
    setSectionId(id);
    // Save on every page change (after state settles).
    setTimeout(() => {
      serverDirty.current = true;
      syncServer();
    }, 0);
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  async function submit(valid: Answers): Promise<AnswerErrors | null> {
    setSubmitting(true);
    setSubmitError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/f/${form.slug}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          versionId: form.versionId,
          answers: valid,
          identifier: needsIdentifier ? identifier : null,
          draftToken,
          submissionToken,
          startedAt,
          honeypot,
          locale,
        }),
      });
      const body = (await res
        .json()
        .catch(() => null)) as SubmitResponse | null;
      if (!body) throw new Error("bad response");
      if (body.ok) {
        setScreenedOut(body.screenedOut === true);
        writeLocalDraft(form.formId, null);
        snapshot.current = null;
        setPhase("done");
        window.scrollTo({ top: 0 });
        return null;
      }
      switch (body.code) {
        case "FORM_CLOSED":
        case "NOT_FOUND":
          setPhase("closed");
          return null;
        case "IDENTIFIER_INVALID":
          setIdentifierErrors(
            (body.identifierErrors ?? {}) as typeof identifierErrors,
          );
          setPhase("identifier");
          return null;
        case "VALIDATION_ERROR":
          setSubmitError({ message: body.message, retryable: false });
          return body.errors ?? null;
        default:
          setSubmitError({
            message: body.message,
            retryable: RETRYABLE.has(body.code),
          });
          return null;
      }
    } catch {
      // Offline, timeout or a broken proxy: everything stays on the device.
      setSubmitError({ message: t("networkError"), retryable: true });
      return null;
    } finally {
      clearTimeout(timeout);
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (phase === "init") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4" aria-busy>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (phase === "closed") return <ClosedState title={form.title} />;

  if (phase === "resume" && resumeDraft) {
    return (
      <Card
        className="mx-auto h-fit w-full max-w-lg"
        data-testid="resume-prompt"
      >
        <CardHeader>
          <p className="text-sm text-muted-foreground">{form.title}</p>
          <CardTitle>{t("resume.title")}</CardTitle>
          <CardDescription>{t("resume.description")}</CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            size="lg"
            className="w-full sm:w-auto"
            onClick={() => startOver(resumeDraft)}
          >
            {t("resume.startOver")}
          </Button>
          <Button
            size="lg"
            className="w-full sm:w-auto"
            onClick={() => continueDraft(resumeDraft)}
            data-testid="resume-continue"
          >
            {t("resume.continue")}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (phase === "done") {
    return (
      <Card
        className="mx-auto h-fit w-full max-w-2xl text-center"
        data-testid="thank-you"
      >
        <CardHeader className="items-center">
          <CircleCheck className="mx-auto size-12 text-primary" aria-hidden />
          <CardTitle className="text-2xl">{t("thankYouTitle")}</CardTitle>
          <CardDescription>{form.title}</CardDescription>
        </CardHeader>
        <CardContent>
          <p
            className="whitespace-pre-line"
            data-testid={screenedOut ? "screened-out" : undefined}
          >
            {screenedOut
              ? tr("screenOutDone")
              : form.thankYouMessage || tr("thankYouDefault")}
          </p>
        </CardContent>
        {!needsIdentifier && (
          <CardFooter className="justify-center">
            <Button variant="outline" size="lg" onClick={startFresh}>
              {t("submitAnother")}
            </Button>
          </CardFooter>
        )}
      </Card>
    );
  }

  if (phase === "identifier") {
    return (
      <IdentifierStep
        form={form}
        value={identifier}
        errors={identifierErrors}
        onChange={(next) => {
          setIdentifier(next);
          setIdentifierErrors({});
        }}
        onContinue={() => {
          const result = buildIdentifier(form.identifierMode, identifier);
          if (!result.ok) {
            setIdentifierErrors(result.errors);
            return;
          }
          setPhase("form");
        }}
      />
    );
  }

  const shownIdentifier = identifier.email || identifier.phone;
  return (
    <div className="flex w-full flex-col gap-3">
      <FormPages
        definition={form.definition}
        title={form.title}
        description={form.description}
        answers={answers}
        onAnswersChange={setAnswers}
        sectionId={sectionId}
        onSectionChange={changeSection}
        onComplete={submit}
        onScreenOut={(kept) => void submit(kept)}
        seed={submissionToken}
        submitting={submitting}
        honeypot={{
          value: honeypot,
          onChange: setHoneypot,
          label: t("honeypot"),
        }}
        headerExtra={
          needsIdentifier && shownIdentifier ? (
            <p className="text-sm text-muted-foreground">
              {t("identifier.respondingAs", { value: shownIdentifier })}{" "}
              <button
                type="button"
                className="text-primary underline underline-offset-2"
                onClick={() => setPhase("identifier")}
              >
                {t("identifier.change")}
              </button>
            </p>
          ) : null
        }
        banner={
          <>
            {form.closesSoon && form.deadlineAt && (
              <Alert data-testid="closes-soon">
                <Clock aria-hidden />
                <AlertDescription>
                  {t("closesSoon", {
                    time: format.dateTime(new Date(form.deadlineAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  })}
                </AlertDescription>
              </Alert>
            )}
            {notice && (
              <Alert data-testid="version-notice">
                <Info aria-hidden />
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            )}
          </>
        }
      />
      {submitError && (
        <Alert
          variant="destructive"
          role="alert"
          className="mx-auto w-full max-w-2xl"
          data-testid="submit-error"
        >
          <CircleAlert aria-hidden />
          <AlertDescription className="flex flex-col items-start gap-2">
            {submitError.message}
            {submitError.retryable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={() =>
                  document
                    .querySelector<HTMLFormElement>(
                      '[data-testid="form-renderer"]',
                    )
                    ?.requestSubmit()
                }
              >
                <RotateCw aria-hidden />
                {t("retry")}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      <p className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground">
        <Save className="size-3.5" aria-hidden />
        {t("savedOnDevice")}
      </p>
    </div>
  );
}

function IdentifierStep({
  form,
  value,
  errors,
  onChange,
  onContinue,
}: {
  form: PublicFormDto;
  value: { email: string; phone: string };
  errors: Partial<Record<"email" | "phone", IdentifierError>>;
  onChange: (value: { email: string; phone: string }) => void;
  onContinue: () => void;
}) {
  const t = useTranslations("publicForm.identifier");
  const mode = form.identifierMode;
  if (mode === "none") return null;
  const showEmail = mode === "email" || mode === "email_or_phone";
  const showPhone = mode === "phone" || mode === "email_or_phone";

  return (
    <Card
      className="mx-auto h-fit w-full max-w-lg"
      data-testid="identifier-step"
    >
      <CardHeader>
        <p className="text-sm text-muted-foreground">{form.title}</p>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t(`description.${mode}`)}</CardDescription>
      </CardHeader>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onContinue();
        }}
      >
        <CardContent className="flex flex-col gap-4">
          {showEmail && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="identifier-email">{t("email")}</Label>
              <Input
                id="identifier-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                className="h-11 text-base md:text-sm"
                value={value.email}
                aria-invalid={!!errors.email}
                aria-describedby={
                  errors.email ? "identifier-email-error" : undefined
                }
                onChange={(e) => onChange({ ...value, email: e.target.value })}
              />
              {errors.email && (
                <p
                  id="identifier-email-error"
                  className="text-sm text-destructive"
                  role="alert"
                >
                  {t(`errors.${errors.email}`)}
                </p>
              )}
            </div>
          )}
          {showPhone && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="identifier-phone">{t("phone")}</Label>
              <Input
                id="identifier-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                className="h-11 text-base md:text-sm"
                placeholder={t("phoneHint")}
                value={value.phone}
                aria-invalid={!!errors.phone}
                aria-describedby={
                  errors.phone ? "identifier-phone-error" : undefined
                }
                onChange={(e) => onChange({ ...value, phone: e.target.value })}
              />
              {errors.phone && errors.phone !== errors.email && (
                <p
                  id="identifier-phone-error"
                  className="text-sm text-destructive"
                  role="alert"
                >
                  {t(`errors.${errors.phone}`)}
                </p>
              )}
            </div>
          )}
          <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            {t("privacy")}
          </p>
        </CardContent>
        <CardFooter className="pt-4">
          <Button
            type="submit"
            size="lg"
            className="w-full"
            data-testid="identifier-continue"
          >
            {t("continue")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
