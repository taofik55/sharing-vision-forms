import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { InterviewRunner } from "@/components/interviews/interview-runner";
import { ClosedState } from "@/components/public/closed-state";
import { requireUser } from "@/lib/auth/session";
import {
  interviewDefinition,
  interviewer,
  loadInterviewForm,
} from "@/lib/forms/interview-server";
import { isPastDeadline } from "@/lib/forms/public";
import type { Locale } from "@/lib/i18n/routing";

export default async function InterviewPage({
  params,
}: PageProps<"/[locale]/interviews/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale as Locale);
  const user = await requireUser();
  if (!(await interviewer(id))) notFound();
  const form = await loadInterviewForm(id);
  if (!form || !form.settings.enabled || !form.versionId) notFound();
  if (form.status !== "published" || isPastDeadline(form.deadlineAt))
    return <ClosedState title={form.title} />;
  const definition = await interviewDefinition(form, form.versionId);
  if (!definition) notFound();

  return (
    <InterviewRunner
      form={{
        id: form.id,
        title: form.title,
        description: form.description,
        versionId: form.versionId,
        definition,
        thankYouMessage: form.thankYouMessage,
        notes: form.settings.notes,
        quota: form.settings.quota,
      }}
      surveyorName={user.fullName ?? user.email}
    />
  );
}
