"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ClipboardCheck,
  Flag,
  LoaderCircle,
  PhoneCall,
  RotateCcw,
  Shuffle,
  X,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { CapiSettings, OtherShare } from "@/lib/forms/capi";
import { useRouter } from "@/lib/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type QcOverview = {
  cells: { cell: string; count: number; reserve: number }[];
  total: number;
  statuses: Record<string, number>;
  flagged: number;
  flags: Record<string, number>;
  rejected: number;
  screenouts: {
    kind: "rule" | "quota";
    code: string | null;
    key: string | null;
    count: number;
  }[];
  surveyors: {
    id: string | null;
    name: string;
    complete: number;
    screenouts: number;
    rejected: number;
    avg_minutes: number | null;
    flagged: number;
    backcheck: number;
    backcheck_done: number;
  }[];
};

type Row = {
  id: string;
  respondent_code: string | null;
  quota_cell: string | null;
  is_reserve?: boolean;
  submitted_at: string;
  duration_seconds: number | null;
  surveyor: string | null;
  qc_status: "pending" | "approved" | "backcheck" | "rejected";
  qc_flags: string[];
  qc_note?: string | null;
  backcheck_at?: string | null;
  phone?: string | null;
  reason?: string | null;
};

const VIEWS = ["all", "flagged", "backcheck", "approved", "rejected"] as const;
type View = (typeof VIEWS)[number];
const PAGE = 50;

let client: ReturnType<typeof createClient> | null = null;
const supabase = () => (client ??= createClient());

export function QcView({
  formId,
  settings,
  cells,
  overview,
  others,
}: {
  formId: string;
  settings: CapiSettings;
  cells: string[];
  overview: QcOverview | null;
  others: OtherShare[];
}) {
  const t = useTranslations("qc");
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>("all");
  const [surveyor, setSurveyor] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [reject, setReject] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const list = useQuery({
    queryKey: ["qc-list", formId, view, surveyor, page],
    queryFn: async () => {
      const { data, error } = await supabase().rpc("qc_list", {
        p_form_id: formId,
        p_view: view,
        p_surveyor_id: surveyor === "all" ? undefined : surveyor,
        p_offset: page * PAGE,
        p_limit: PAGE,
      });
      if (error) throw error;
      return data as unknown as { total: number; rows: Row[] };
    },
    placeholderData: (previous) => previous,
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["qc-list", formId] });
    router.refresh();
  }

  function act(action: () => PromiseLike<{ error: unknown }>, message: string) {
    startTransition(async () => {
      const { error } = await action();
      if (error) toast.error(t("actionError"));
      else {
        toast.success(message);
        refresh();
      }
    });
  }

  const target = settings.quota.enabled ? settings.quota.target : null;
  const countByCell = new Map((overview?.cells ?? []).map((c) => [c.cell, c]));
  const screenouts = (overview?.screenouts ?? []).reduce(
    (n, s) => n + s.count,
    0,
  );
  const backcheckSelected = (overview?.surveyors ?? []).reduce(
    (n, s) => n + s.backcheck,
    0,
  );
  const backcheckDone = (overview?.surveyors ?? []).reduce(
    (n, s) => n + s.backcheck_done,
    0,
  );
  const duration = (s: number | null) =>
    s === null ? "—" : t("minutes", { value: Math.round(s / 6) / 10 });

  // Quota matrix: first dimension = rows, the other dimensions = columns.
  const [first, ...rest] = settings.dimensions;
  const columns = rest
    .reduce<string[]>(
      (acc, d) =>
        acc.flatMap((p) =>
          d.groups.map((g) => (p ? `${p}-${g.code}` : g.code)),
        ),
      [""],
    )
    .filter(Boolean);

  return (
    <div className="flex flex-col gap-6" data-testid="qc-view">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          [t("complete"), overview?.total ?? 0, "qc-total"],
          [t("screenouts"), screenouts, "qc-screenouts"],
          [t("flagged"), overview?.flagged ?? 0, "qc-flagged"],
          [t("rejected"), overview?.rejected ?? 0, "qc-rejected"],
          [
            t("backcheck"),
            `${backcheckDone}/${backcheckSelected}`,
            "qc-backcheck",
          ],
        ].map(([label, value, id]) => (
          <div key={String(id)} className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p
              className="text-2xl font-semibold tabular-nums"
              data-testid={String(id)}
            >
              {typeof value === "number" ? format.number(value) : value}
            </p>
          </div>
        ))}
      </div>

      {first && (
        <Card>
          <CardHeader>
            <CardTitle>{t("quotaTitle")}</CardTitle>
            <CardDescription>
              {target
                ? t("quotaDescription", {
                    target,
                    reserve: settings.quota.reserve,
                    cells: cells.length,
                  })
                : t("quotaNoTarget")}
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table
              className="w-full min-w-[32rem] text-sm"
              data-testid="quota-matrix"
            >
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-2 py-1 font-medium">{first.label}</th>
                  {(columns.length ? columns : [""]).map((c) => (
                    <th key={c} className="px-2 py-1 text-center font-medium">
                      {c || t("count")}
                    </th>
                  ))}
                  <th className="px-2 py-1 text-right font-medium">
                    {t("total")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {first.groups.map((g) => {
                  let rowTotal = 0;
                  return (
                    <tr key={g.code} className="border-t">
                      <th
                        scope="row"
                        className="px-2 py-1.5 text-left font-medium"
                      >
                        {g.label}
                      </th>
                      {(columns.length ? columns : [""]).map((c) => {
                        const cell = c ? `${g.code}-${c}` : g.code;
                        const n = countByCell.get(cell)?.count ?? 0;
                        rowTotal += n;
                        const ratio = target ? Math.min(1, n / target) : 0;
                        return (
                          <td key={c} className="px-2 py-1.5" data-cell={cell}>
                            <div className="flex flex-col items-center gap-1">
                              <span
                                className={cn(
                                  "tabular-nums",
                                  target &&
                                    n >= target &&
                                    "font-semibold text-emerald-700 dark:text-emerald-400",
                                )}
                              >
                                {n}
                                {target ? `/${target}` : ""}
                              </span>
                              {target && (
                                <span className="h-1.5 w-full max-w-16 overflow-hidden rounded-full bg-muted">
                                  <span
                                    className="block h-full rounded-full bg-primary"
                                    style={{ width: `${ratio * 100}%` }}
                                  />
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                        {rowTotal}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 2xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("surveyorsTitle")}</CardTitle>
            <CardDescription>
              {t("surveyorsDescription", {
                percent: settings.qc.backcheckPercent,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 overflow-x-auto">
            <table
              className="w-full min-w-[34rem] text-sm"
              data-testid="surveyor-table"
            >
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-2 py-1 font-medium">{t("surveyor")}</th>
                  <th className="px-2 py-1 text-right font-medium">
                    {t("complete")}
                  </th>
                  <th className="px-2 py-1 text-right font-medium">
                    {t("screenouts")}
                  </th>
                  <th className="px-2 py-1 text-right font-medium">
                    {t("avgDuration")}
                  </th>
                  <th className="px-2 py-1 text-right font-medium">
                    {t("flagged")}
                  </th>
                  <th className="px-2 py-1 text-right font-medium">
                    {t("rejected")}
                  </th>
                  <th className="px-2 py-1 text-right font-medium">
                    {t("backcheck")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(overview?.surveyors ?? []).map((s) => (
                  <tr key={s.id ?? "none"} className="border-t">
                    <td className="px-2 py-1.5">
                      {s.id ? s.name : t("noSurveyor")}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {s.complete}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {s.screenouts}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {s.avg_minutes === null
                        ? "—"
                        : t("minutes", { value: s.avg_minutes })}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {s.flagged}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {s.rejected}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {s.backcheck_done}/{s.backcheck}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button
              type="button"
              variant="outline"
              className="self-start"
              disabled={isPending}
              onClick={() =>
                act(
                  () =>
                    supabase().rpc("qc_select_backcheck", {
                      p_form_id: formId,
                      p_percent: settings.qc.backcheckPercent,
                    }),
                  t("backcheckSelected"),
                )
              }
              data-testid="select-backcheck"
            >
              <Shuffle aria-hidden />
              {t("selectBackcheck", { percent: settings.qc.backcheckPercent })}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("checksTitle")}</CardTitle>
            <CardDescription>{t("checksDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <section className="flex flex-col gap-1.5">
              <h3 className="font-medium">{t("screenoutsByCode")}</h3>
              {(overview?.screenouts ?? []).length ? (
                <ul
                  className="flex flex-wrap gap-1.5"
                  data-testid="screenout-codes"
                >
                  {overview!.screenouts.map((s) => (
                    <li key={`${s.kind}:${s.code}:${s.key}`}>
                      <Badge variant="outline" className="font-mono">
                        {s.kind === "quota"
                          ? t("quotaFull")
                          : (s.code ?? s.key ?? "—")}{" "}
                        · {s.count}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t("none")}</p>
              )}
            </section>
            <section className="flex flex-col gap-1.5">
              <h3 className="font-medium">{t("flagsTitle")}</h3>
              {Object.keys(overview?.flags ?? {}).length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {Object.entries(overview!.flags).map(([flag, n]) => (
                    <li key={flag}>
                      <Badge variant="secondary">
                        {flagLabel(t, flag)} · {n}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t("none")}</p>
              )}
            </section>
            <section className="flex flex-col gap-1.5">
              <h3 className="font-medium">
                {t("otherTitle", { percent: settings.qc.otherPercent })}
              </h3>
              {others.length ? (
                <ul className="flex flex-col gap-1" data-testid="other-shares">
                  {others.map((o) => (
                    <li key={o.key} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {o.code && (
                          <span className="mr-1 font-mono text-muted-foreground">
                            {o.code}
                          </span>
                        )}
                        {o.title}
                      </span>
                      <span className="text-amber-700 tabular-nums dark:text-amber-400">
                        {format.number(o.share, { maximumFractionDigits: 1 })}%
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t("none")}</p>
              )}
            </section>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle>{t("interviewsTitle")}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs
              value={view}
              onValueChange={(v) => {
                setView(v as View);
                setPage(0);
              }}
            >
              <TabsList>
                {VIEWS.map((v) => (
                  <TabsTrigger key={v} value={v} data-testid={`qc-view-${v}`}>
                    {t(`views.${v}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Select
              value={surveyor}
              onValueChange={(v) => {
                setSurveyor(v);
                setPage(0);
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-48"
                aria-label={t("surveyor")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allSurveyors")}</SelectItem>
                {(overview?.surveyors ?? [])
                  .filter((s) => s.id)
                  .map((s) => (
                    <SelectItem key={s.id!} value={s.id!}>
                      {s.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {list.isFetching && (
              <LoaderCircle
                className="size-4 animate-spin text-muted-foreground"
                aria-hidden
              />
            )}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm" data-testid="qc-list">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-2 py-1 font-medium">{t("respondentId")}</th>
                <th className="px-2 py-1 font-medium">{t("surveyor")}</th>
                <th className="px-2 py-1 font-medium">{t("submitted")}</th>
                <th className="px-2 py-1 font-medium">{t("duration")}</th>
                <th className="px-2 py-1 font-medium">{t("flagsTitle")}</th>
                <th className="px-2 py-1 font-medium">{t("status")}</th>
                <th className="px-2 py-1 text-right font-medium">
                  {t("actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {(list.data?.rows ?? []).map((r) => (
                <tr
                  key={r.id}
                  className="border-t align-top"
                  data-testid="qc-row"
                >
                  <td className="px-2 py-1.5 font-mono">
                    {r.respondent_code ?? "—"}
                    {r.is_reserve && (
                      <Badge variant="outline" className="ml-1">
                        {t("reserve")}
                      </Badge>
                    )}
                  </td>
                  <td className="px-2 py-1.5">{r.surveyor ?? "—"}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {format.dateTime(new Date(r.submitted_at), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">
                    {duration(r.duration_seconds)}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {r.qc_flags.map((f) => (
                        <Badge key={f} variant="secondary" className="gap-1">
                          <Flag className="size-3" aria-hidden />
                          {flagLabel(t, f)}
                        </Badge>
                      ))}
                    </div>
                    {r.reason && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {r.reason}
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <Badge
                      variant={
                        r.qc_status === "approved" ? "default" : "outline"
                      }
                      data-testid="qc-status"
                    >
                      {t(`statuses.${r.qc_status}`)}
                    </Badge>
                    {r.qc_status === "backcheck" && r.phone && (
                      <p className="mt-1 flex items-center gap-1 text-xs">
                        <PhoneCall className="size-3" aria-hidden />
                        {r.phone}
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex justify-end gap-1">
                      {r.qc_status === "rejected" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() =>
                            act(
                              () =>
                                supabase().rpc("qc_restore", {
                                  p_archive_id: r.id,
                                }),
                              t("restored"),
                            )
                          }
                        >
                          <RotateCcw aria-hidden />
                          {t("restore")}
                        </Button>
                      ) : (
                        <>
                          {r.qc_status !== "approved" && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isPending}
                              onClick={() =>
                                act(
                                  () =>
                                    supabase().rpc("qc_set_status", {
                                      p_response_id: r.id,
                                      p_status: "approved",
                                    }),
                                  t("approved"),
                                )
                              }
                              data-testid="qc-approve"
                            >
                              <Check aria-hidden />
                              {t("approve")}
                            </Button>
                          )}
                          {r.qc_status === "pending" && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={isPending}
                              onClick={() =>
                                act(
                                  () =>
                                    supabase().rpc("qc_set_status", {
                                      p_response_id: r.id,
                                      p_status: "backcheck",
                                    }),
                                  t("markedBackcheck"),
                                )
                              }
                            >
                              <ClipboardCheck aria-hidden />
                              {t("toBackcheck")}
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={isPending}
                            onClick={() => {
                              setReason("");
                              setReject(r);
                            }}
                            data-testid="qc-reject"
                          >
                            <X aria-hidden />
                            {t("reject")}
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {list.data && list.data.rows.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-2 py-6 text-center text-muted-foreground"
                  >
                    {t("empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {list.data && list.data.total > PAGE && (
            <div className="mt-3 flex items-center justify-end gap-2 text-sm">
              <span className="text-muted-foreground">
                {t("page", {
                  from: page * PAGE + 1,
                  to: Math.min((page + 1) * PAGE, list.data.total),
                  total: list.data.total,
                })}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                {t("previous")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * PAGE >= list.data.total}
                onClick={() => setPage(page + 1)}
              >
                {t("next")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={reject !== null}
        onOpenChange={(open) => !open && setReject(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("rejectTitle", { code: reject?.respondent_code ?? "" })}
            </DialogTitle>
            <DialogDescription>{t("rejectDescription")}</DialogDescription>
          </DialogHeader>
          <Label htmlFor="reject-reason">{t("reason")}</Label>
          <Textarea
            id="reject-reason"
            rows={3}
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReject(null)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                const row = reject;
                setReject(null);
                if (row)
                  act(
                    () =>
                      supabase().rpc("qc_reject", {
                        p_response_id: row.id,
                        p_reason: reason,
                      }),
                    t("rejectedToast"),
                  );
              }}
              data-testid="qc-reject-confirm"
            >
              {t("reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function flagLabel(
  t: ReturnType<typeof useTranslations<"qc">>,
  flag: string,
): string {
  if (flag === "duration_short") return t("flags.duration_short");
  if (flag === "duration_long") return t("flags.duration_long");
  if (flag.startsWith("straightline:"))
    return t("flags.straightline", {
      code: flag.slice("straightline:".length),
    });
  return flag;
}
