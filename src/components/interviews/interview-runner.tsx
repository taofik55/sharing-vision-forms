"use client";

import {
  CircleCheck,
  CloudOff,
  OctagonX,
  Play,
  RotateCcw,
  UserRound,
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
import { Skeleton } from "@/components/ui/skeleton";
import type { CapiSettings, Notes } from "@/lib/forms/capi";
import type { InterviewPayload, QuotaStatus } from "@/lib/forms/interview";
import type { Answers, Termination } from "@/lib/forms/logic";
import {
  clearCurrent,
  loadCurrent,
  putOutbox,
  removeOutbox,
  saveCurrent,
  sendInterview,
  type CurrentInterview,
} from "@/lib/forms/outbox";
import type { FormDefinition } from "@/lib/forms/schema";
import type { AnswerErrors } from "@/lib/forms/validation";
import { OutboxBar, useOutbox, useServiceWorker } from "./offline";

export type InterviewFormDto = {
  id: string;
  title: string;
  description: string | null;
  versionId: string;
  definition: FormDefinition;
  thankYouMessage: string | null;
  notes: boolean;
  quota: CapiSettings["quota"];
};

type Result =
  | { kind: "complete"; code: string | null }
  | { kind: "queued" }
  | { kind: "screened"; reason: string };

const QUOTA_CODE = "KUOTA";
const SAVE_MS = 400;

/**
 * Face-to-face interview runner: one interview after another on the same
 * device. The interview in progress lives in IndexedDB (photos included);
 * finished interviews go to the outbox first, then to the server.
 */
export function InterviewRunner({
  form,
  surveyorName,
}: {
  form: InterviewFormDto;
  surveyorName: string;
}) {
  const t = useTranslations("interviews");
  const format = useFormatter();
  const locale = useLocale();
  useServiceWorker();
  const outbox = useOutbox(form.id);

  const [phase, setPhase] = useState<
    "loading" | "start" | "interview" | "result"
  >("loading");
  const [current, setCurrent] = useState<CurrentInterview | null>(null);
  const [saved, setSaved] = useState<CurrentInterview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [quotaCell, setQuotaCell] = useState<string | null>(null);

  useEffect(() => {
    void loadCurrent(form.id)
      .then((draft) => {
        setSaved(draft && draft.versionId === form.versionId ? draft : null);
      })
      .catch(() => setSaved(null))
      .finally(() => setPhase("start"));
  }, [form.id, form.versionId]);

  // Keep the interview in progress on the device.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (phase !== "interview" || !current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () =>
        void saveCurrent({ ...current, updatedAt: Date.now() }).catch(() => {}),
      SAVE_MS,
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [phase, current]);

  function start(resume: CurrentInterview | null) {
    const token = crypto.randomUUID();
    setCurrent(
      resume ?? {
        formId: form.id,
        versionId: form.versionId,
        answers: {},
        notes: {},
        sectionId: null,
        startedAt: Date.now(),
        token,
        seed: token,
        updatedAt: Date.now(),
      },
    );
    setSaved(null);
    setResult(null);
    setError(null);
    setQuotaCell(null);
    setPhase("interview");
    window.scrollTo({ top: 0 });
  }

  const update = useCallback(
    (patch: Partial<CurrentInterview>) =>
      setCurrent((c) => (c ? { ...c, ...patch } : c)),
    [],
  );

  async function beforeNext(
    sectionId: string,
    answers: Answers,
  ): Promise<Termination | null> {
    const check = form.quota.enabled ? form.quota.checkAfter : undefined;
    if (!check) return null;
    const section = form.definition.sections.find((s) => s.id === sectionId);
    if (!section?.questions.some((q) => q.key === check)) return null;
    if (!navigator.onLine) return null; // The server checks again on sync.
    try {
      const res = await fetch(`/api/interviews/${form.id}/quota`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) return null;
      const status = (await res.json()) as QuotaStatus;
      setQuotaCell(status.cell);
      if (!status.full) return null;
      return {
        questionKey: check,
        code: QUOTA_CODE,
        reason: t("quotaFull", {
          cell: status.cell ?? "",
          count: status.count,
          target: status.target ?? 0,
        }),
      };
    } catch {
      return null;
    }
  }

  async function finish(
    answers: Answers,
    screenOut?: Termination,
  ): Promise<AnswerErrors | null> {
    if (!current) return null;
    setSubmitting(true);
    setError(null);
    const payload: InterviewPayload = {
      versionId: form.versionId,
      answers,
      notes: current.notes,
      submissionToken: current.token,
      startedAt: current.startedAt,
      finishedAt: Date.now(),
      seed: current.seed,
      locale: locale as InterviewPayload["locale"],
      ...(screenOut?.code === QUOTA_CODE
        ? { screenOut: "quota" as const }
        : {}),
    };
    // The outbox first: nothing is lost if the connection drops now.
    try {
      await putOutbox({
        token: current.token,
        formId: form.id,
        payload,
        createdAt: Date.now(),
        attempts: 0,
      });
    } catch {
      // IndexedDB unavailable: send directly.
    }
    const sent = await sendInterview(form.id, payload);
    setSubmitting(false);

    if (sent.ok) {
      await removeOutbox(current.token).catch(() => {});
      await clearCurrent(form.id).catch(() => {});
      setResult(
        sent.status === "complete"
          ? { kind: "complete", code: sent.respondentCode }
          : {
              kind: "screened",
              reason:
                sent.kind === "quota"
                  ? t("screenedQuota", { cell: sent.code ?? "" })
                  : t("screenedRule", { code: sent.code ?? "—" }),
            },
      );
      setPhase("result");
      await outbox.refresh();
      window.scrollTo({ top: 0 });
      return null;
    }

    if (
      sent.code === "NETWORK" ||
      sent.code === "SERVER_ERROR" ||
      sent.code === "UNAUTHORIZED"
    ) {
      // Queued: the outbox sends it later.
      await clearCurrent(form.id).catch(() => {});
      setResult({ kind: "queued" });
      setPhase("result");
      await outbox.refresh();
      window.scrollTo({ top: 0 });
      return null;
    }

    // The server refused it: stay in the interview and show what to fix.
    await removeOutbox(current.token).catch(() => {});
    await outbox.refresh();
    if (sent.code === "QUOTA_AVAILABLE") {
      setError(t("quotaAvailable"));
      return null;
    }
    setError(t(`errors.${sent.code}` as "errors.SERVER_ERROR"));
    if (sent.code === "NOTES_REQUIRED" && sent.notes?.length)
      return Object.fromEntries(
        sent.notes.map((k) => [k, "required" as const]),
      );
    return sent.errors ?? null;
  }

  if (phase === "loading") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4" aria-busy>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const bar = (
    <OutboxBar outbox={outbox} className="mx-auto w-full max-w-2xl" />
  );

  if (phase === "start") {
    return (
      <div className="flex flex-col gap-4">
        {bar}
        <Card
          className="mx-auto w-full max-w-2xl"
          data-testid="interview-start"
        >
          <CardHeader>
            <CardDescription className="flex items-center gap-1.5">
              <UserRound className="size-4" aria-hidden />
              {t("surveyor", { name: surveyorName })}
            </CardDescription>
            <CardTitle className="text-xl">{form.title}</CardTitle>
            {form.description && (
              <p className="text-sm whitespace-pre-line text-muted-foreground">
                {form.description}
              </p>
            )}
          </CardHeader>
          <CardFooter className="flex flex-col items-stretch gap-2 sm:flex-row sm:justify-end">
            {saved && (
              <Button
                variant="outline"
                size="lg"
                onClick={() => start(saved)}
                data-testid="interview-resume"
              >
                <RotateCcw aria-hidden />
                {t("resume", {
                  time: format.relativeTime(new Date(saved.updatedAt)),
                })}
              </Button>
            )}
            <Button
              size="lg"
              onClick={() => {
                if (saved) void clearCurrent(form.id).catch(() => {});
                start(null);
              }}
              data-testid="interview-new"
            >
              <Play aria-hidden />
              {t("startNew")}
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (phase === "result" && result) {
    return (
      <div className="flex flex-col gap-4">
        {bar}
        <Card
          className="mx-auto w-full max-w-2xl text-center"
          data-testid="interview-result"
          data-result={result.kind}
        >
          <CardHeader className="items-center">
            {result.kind === "complete" ? (
              <CircleCheck
                className="mx-auto size-12 text-primary"
                aria-hidden
              />
            ) : result.kind === "queued" ? (
              <CloudOff
                className="mx-auto size-12 text-amber-600"
                aria-hidden
              />
            ) : (
              <OctagonX
                className="mx-auto size-12 text-destructive"
                aria-hidden
              />
            )}
            <CardTitle className="text-2xl">
              {result.kind === "complete"
                ? t("doneTitle")
                : result.kind === "queued"
                  ? t("queuedTitle")
                  : t("screenedTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {result.kind === "complete" && result.code && (
              <p>
                {t("respondentId")}{" "}
                <strong
                  className="font-mono text-lg"
                  data-testid="respondent-code"
                >
                  {result.code}
                </strong>
              </p>
            )}
            {result.kind === "complete" && form.thankYouMessage && (
              <p className="text-sm whitespace-pre-line text-muted-foreground">
                {form.thankYouMessage}
              </p>
            )}
            {result.kind === "queued" && <p>{t("queuedDescription")}</p>}
            {result.kind === "screened" && <p>{result.reason}</p>}
          </CardContent>
          <CardFooter className="justify-center">
            <Button
              size="lg"
              onClick={() => start(null)}
              data-testid="interview-next"
            >
              <Play aria-hidden />
              {t("next")}
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (!current) return null;
  return (
    <div className="flex w-full flex-col gap-3">
      {bar}
      <FormPages
        audience="interviewer"
        definition={form.definition}
        title={form.title}
        description={null}
        answers={current.answers}
        onAnswersChange={(answers) => update({ answers })}
        sectionId={current.sectionId}
        onSectionChange={(sectionId) => update({ sectionId })}
        onComplete={(answers) => finish(answers)}
        onScreenOut={(answers, termination) =>
          void finish(answers, termination)
        }
        beforeNext={beforeNext}
        submitting={submitting}
        seed={current.seed}
        showCodes
        autoLocate
        notes={
          form.notes
            ? {
                value: current.notes,
                onChange: (notes: Notes) => update({ notes }),
              }
            : undefined
        }
        submitLabel={t("finish")}
        headerExtra={
          <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            <span>{t("surveyor", { name: surveyorName })}</span>
            <span>
              {t("startedAt", {
                time: format.dateTime(new Date(current.startedAt), {
                  timeStyle: "short",
                }),
              })}
            </span>
            {quotaCell && <span>{t("cell", { cell: quotaCell })}</span>}
          </p>
        }
      />
      {error && (
        <Alert
          variant="destructive"
          role="alert"
          className="mx-auto w-full max-w-2xl"
          data-testid="interview-error"
        >
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
