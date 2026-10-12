"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  Expand,
  Info,
  LoaderCircle,
  Minimize,
  Pause,
  PencilRuler,
  Play,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layout } from "react-grid-layout";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { saveDashboardAction } from "@/lib/analytics/actions";
import { bottomOf, buildAutoDashboard } from "@/lib/analytics/auto";
import type { DashboardConfig, Widget } from "@/lib/analytics/config";
import {
  isWithinDateWindow,
  serializeFilters,
  toRpcFilters,
  type DashboardFilters,
  type RpcFilters,
} from "@/lib/analytics/filters";
import type { DashboardBundle } from "@/lib/analytics/types";
import type { FormDefinition, Question } from "@/lib/forms/schema";
import { usePathname, useRouter } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils";
import { AddWidgetDialog } from "./add-widget-dialog";
import {
  DashboardContext,
  useLabels,
  type DashboardContextValue,
} from "./dashboard-context";
import { DashboardGrid } from "./dashboard-grid";
import { FilterBar } from "./filter-bar";
import {
  bundleKey,
  useDashboardBundle,
  useInvalidateDashboard,
  useLiveResponses,
  useNow,
  useStable,
  type LiveStatus,
} from "./use-dashboard-data";
import {
  CrossWidget,
  HeadingWidget,
  KpiWidget,
  OverviewHeatmap,
  OverviewKpis,
  OverviewSplit,
  OverviewTimeline,
  QuestionWidget,
  SuggestionsWidget,
  TextWidget,
} from "./widgets";

export type DashboardViewProps = {
  formId: string;
  canEdit: boolean;
  definition: FormDefinition;
  questions: Record<string, Question>;
  versions: { id: string; number: number }[];
  initialConfig: DashboardConfig;
  initialFilters: DashboardFilters;
  initialRpcFilters: RpcFilters;
  initialBundle: DashboardBundle;
  isDemo: boolean;
};

type SaveState = "idle" | "saving" | "saved" | "error";

export function DashboardView(props: DashboardViewProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [filters, setFiltersState] = useState(props.initialFilters);
  const [config, setConfigState] = useState(props.initialConfig);
  const [editMode, setEditMode] = useState(false);
  const [paused, setPaused] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [confirmReset, setConfirmReset] = useState(false);
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const presentRef = useRef<HTMLDivElement>(null);

  const rpcFilters = useStable(toRpcFilters(filters));
  const live = useLiveResponses({
    formId: props.formId,
    paused,
    onInsert: (row) => {
      setLastEventAt(Date.now());
      // Instant counter: bump the cached totals; the debounced refetch corrects them.
      if (isWithinDateWindow(filters, row.submitted_at)) {
        queryClient.setQueryData<DashboardBundle>(
          bundleKey(props.formId, rpcFilters),
          (old) =>
            old
              ? {
                  ...old,
                  overview: {
                    ...old.overview,
                    total: old.overview.total + 1,
                    today: old.overview.today + 1,
                    last7: old.overview.last7 + 1,
                  },
                }
              : old,
        );
      }
    },
    onRefetch: useInvalidateDashboard(props.formId),
  });
  const bundleQuery = useDashboardBundle(
    props.formId,
    rpcFilters,
    { filters: props.initialRpcFilters, data: props.initialBundle },
    live.polling || presenting,
  );
  const bundle = bundleQuery.data;

  // Dependent queries (cross-tabs, text answers) refetch when new data arrives.
  const dataVersion = bundleQuery.dataUpdatedAt;

  // Briefly highlight widgets whose numbers changed.
  const previous = useRef<DashboardBundle | undefined>(bundle);
  useEffect(() => {
    const prev = previous.current;
    previous.current = bundle;
    if (!prev || !bundle || prev === bundle) return;
    const changed = new Set<string>();
    if (prev.overview.total !== bundle.overview.total) {
      changed.add("overview:kpis");
      changed.add("overview:timeline");
    }
    for (const w of config.widgets) {
      if (
        w.questionKey &&
        prev.questions[w.questionKey]?.n !== bundle.questions[w.questionKey]?.n
      )
        changed.add(w.id);
    }
    if (!changed.size) return;
    const frame = requestAnimationFrame(() => setFlashing(changed));
    const timer = setTimeout(() => setFlashing(new Set()), 1300);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [bundle, config.widgets]);

  // URL state for filters (shareable links).
  const setFilters = useCallback(
    (next: DashboardFilters) => {
      setFiltersState(next);
      const qs = serializeFilters(next).toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  // Debounced persistence of the config (editors only, after a user change).
  // The status shows "Saving…" as soon as a change is pending; results of
  // older saves are ignored if a newer change was made meanwhile.
  const userChanged = useRef(false);
  const saveSeq = useRef(0);
  const setConfig = useCallback(
    (updater: (c: DashboardConfig) => DashboardConfig) => {
      if (!props.canEdit) return;
      userChanged.current = true;
      saveSeq.current += 1;
      setSaveState("saving");
      setConfigState(updater);
    },
    [props.canEdit],
  );
  useEffect(() => {
    if (!userChanged.current) return;
    const seq = saveSeq.current;
    const timer = setTimeout(async () => {
      const result = await saveDashboardAction({
        formId: props.formId,
        config,
      });
      if (seq === saveSeq.current) setSaveState(result.ok ? "saved" : "error");
    }, 800);
    return () => clearTimeout(timer);
  }, [config, props.formId]);

  const updateWidget = useCallback(
    (id: string, patch: Partial<Widget>) =>
      setConfig((c) => ({
        ...c,
        widgets: c.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)),
      })),
    [setConfig],
  );
  const removeWidget = useCallback(
    (id: string) =>
      setConfig((c) => ({
        ...c,
        widgets: c.widgets.filter((w) => w.id !== id),
      })),
    [setConfig],
  );
  const addWidget = useCallback<DashboardContextValue["addWidget"]>(
    (widget) =>
      setConfig((c) => {
        const id = c.widgets.some((w) => w.id === widget.id)
          ? `${widget.id}:${Date.now()}`
          : widget.id;
        const layout = widget.layout ?? { x: 0, y: 0, w: 6, h: 10 };
        return {
          ...c,
          widgets: [
            ...c.widgets,
            {
              ...widget,
              id,
              layout: { ...layout, x: 0, y: bottomOf(c.widgets) },
            } as Widget,
          ],
        };
      }),
    [setConfig],
  );

  const onLayoutChange = useCallback(
    (layout: Layout) => {
      if (!editMode) return;
      setConfig((c) => {
        let changed = false;
        const widgets = c.widgets.map((w) => {
          const item = layout.find((l) => l.i === w.id);
          if (!item) return w;
          if (
            item.x === w.layout.x &&
            item.y === w.layout.y &&
            item.w === w.layout.w &&
            item.h === w.layout.h
          )
            return w;
          changed = true;
          return {
            ...w,
            layout: { x: item.x, y: item.y, w: item.w, h: item.h },
          };
        });
        return changed ? { ...c, widgets } : c;
      });
    },
    [editMode, setConfig],
  );

  // Presentation (TV) mode: full screen, larger type, periodic refresh.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  async function togglePresent() {
    if (presenting) {
      if (document.fullscreenElement)
        await document.exitFullscreen().catch(() => {});
      setPresenting(false);
      return;
    }
    setEditMode(false);
    setPresenting(true);
    await presentRef.current?.requestFullscreen?.().catch(() => {});
  }

  const currentKeys = useMemo(
    () =>
      new Set(
        props.definition.sections.flatMap((s) => s.questions.map((q) => q.key)),
      ),
    [props.definition],
  );
  const sectionTitles = useMemo(
    () =>
      Object.fromEntries(props.definition.sections.map((s) => [s.id, s.title])),
    [props.definition],
  );

  const ctx: DashboardContextValue = {
    formId: props.formId,
    bundle,
    questions: props.questions,
    currentKeys,
    versionCount: props.versions.length,
    filters,
    rpcFilters,
    setFilters,
    editMode,
    canEdit: props.canEdit,
    updateWidget,
    removeWidget,
    addWidget,
    flashing,
    dataVersion,
    presenting,
  };

  const visible = config.widgets.filter((w) => editMode || !w.hidden);

  function render(widget: Widget) {
    switch (widget.kind) {
      case "overview_kpis":
        return <OverviewKpis widget={widget} />;
      case "overview_timeline":
        return <OverviewTimeline widget={widget} />;
      case "overview_heatmap":
        return <OverviewHeatmap widget={widget} />;
      case "overview_devices":
      case "overview_locales":
        return <OverviewSplit widget={widget} />;
      case "suggestions":
        return <SuggestionsWidget widget={widget} />;
      case "heading":
        return (
          <HeadingWidget
            widget={widget}
            sectionTitle={
              widget.sectionId ? sectionTitles[widget.sectionId] : undefined
            }
          />
        );
      case "question":
        return <QuestionWidget widget={widget} />;
      case "cross":
        return <CrossWidget widget={widget} />;
      case "kpi":
        return <KpiWidget widget={widget} />;
      case "text":
        return <TextWidget widget={widget} />;
    }
  }

  return (
    <DashboardContext value={ctx}>
      <div
        ref={presentRef}
        className={cn(
          "flex flex-col gap-4",
          presenting &&
            "fixed inset-0 z-50 overflow-auto bg-background p-6 text-lg",
        )}
        data-testid="dashboard"
      >
        <DashboardHeader
          config={config}
          formTitle={bundle?.form.title ?? ""}
          bundle={bundle}
          isDemo={props.isDemo}
          versions={props.versions}
          editMode={editMode}
          onConfig={setConfig}
          live={live.status}
          pending={live.pending}
          onApplyPending={live.applyPending}
          paused={paused}
          onTogglePause={() => setPaused((p) => !p)}
          lastEventAt={lastEventAt}
          fetching={bundleQuery.isFetching}
          presenting={presenting}
        >
          {!presenting && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void bundleQuery.refetch()}
              aria-label={t("dashboard.refresh")}
            >
              <RefreshCw
                className={cn(bundleQuery.isFetching && "animate-spin")}
                aria-hidden
              />
            </Button>
          )}
          {props.canEdit && !presenting && (
            <>
              {editMode && (
                <>
                  <AddWidgetDialog
                    questions={Object.values(props.questions)}
                    onAdd={addWidget}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmReset(true)}
                  >
                    <RotateCcw aria-hidden />
                    {t("dashboard.reset")}
                  </Button>
                </>
              )}
              <SaveIndicator state={saveState} />
              <Button
                variant={editMode ? "default" : "outline"}
                size="sm"
                onClick={() => setEditMode((e) => !e)}
                data-testid="edit-dashboard"
              >
                <PencilRuler aria-hidden />
                {editMode ? t("dashboard.done") : t("dashboard.edit")}
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void togglePresent()}
            data-testid="present"
          >
            {presenting ? <Minimize aria-hidden /> : <Expand aria-hidden />}
            {presenting ? t("dashboard.exitPresent") : t("dashboard.present")}
          </Button>
        </DashboardHeader>

        {!presenting && (
          <FilterBarWithLabels
            filters={filters}
            setFilters={setFilters}
            questions={props.questions}
            versions={props.versions}
          />
        )}
        {!props.canEdit && !presenting && (
          <p className="text-xs text-muted-foreground">
            {t("dashboard.viewerHint")}
          </p>
        )}

        <DashboardGrid
          widgets={visible}
          editMode={editMode}
          onLayoutChange={onLayoutChange}
          render={render}
        />

        <ConfirmDialog
          open={confirmReset}
          onOpenChange={setConfirmReset}
          title={t("dashboard.resetTitle")}
          description={t("dashboard.resetDescription")}
          confirmLabel={t("dashboard.reset")}
          destructive
          onConfirm={() => {
            setConfig(() => buildAutoDashboard(props.definition));
            setConfirmReset(false);
          }}
        />
      </div>
    </DashboardContext>
  );
}

function FilterBarWithLabels({
  filters,
  setFilters,
  questions,
  versions,
}: {
  filters: DashboardFilters;
  setFilters: (f: DashboardFilters) => void;
  questions: Record<string, Question>;
  versions: { id: string; number: number }[];
}) {
  const labels = useLabels();
  return (
    <FilterBar
      filters={filters}
      onChange={setFilters}
      questions={questions}
      versions={versions}
      optionLabel={labels.optionLabel}
      deviceLabel={labels.deviceLabel}
      languageLabel={labels.languageLabel}
    />
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const t = useTranslations("dashboard");
  if (state === "idle") return null;
  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs text-muted-foreground",
        state === "error" && "text-destructive",
      )}
      role="status"
      data-testid="dashboard-save"
      data-state={state}
    >
      {state === "saving" && (
        <LoaderCircle className="size-3 animate-spin" aria-hidden />
      )}
      {state === "saving"
        ? t("saving")
        : state === "saved"
          ? t("saved")
          : t("saveError")}
    </span>
  );
}

function LiveBadge({
  status,
  onToggle,
  lastAt,
}: {
  status: LiveStatus;
  onToggle: () => void;
  lastAt: number | null;
}) {
  const t = useTranslations("live");
  const { format } = useLabels();
  const now = useNow();
  const tone =
    status === "live"
      ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400"
      : status === "reconnecting"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  const seconds =
    lastAt && now ? Math.max(0, Math.round((now - lastAt) / 1000)) : null;
  return (
    <div className="flex items-center gap-2">
      <Badge
        variant="outline"
        className={cn("gap-1.5 border-transparent", tone)}
        data-testid="live-badge"
        data-status={status}
      >
        <span
          className={cn(
            "size-2 rounded-full bg-current",
            status === "live" && "animate-pulse",
          )}
          aria-hidden
        />
        {t(status)}
      </Badge>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={onToggle}
        aria-label={status === "paused" ? t("resume") : t("pause")}
        data-testid="live-toggle"
      >
        {status === "paused" ? (
          <Play className="size-4" aria-hidden />
        ) : (
          <Pause className="size-4" aria-hidden />
        )}
      </Button>
      <span
        className="text-xs text-muted-foreground"
        data-testid="last-response"
      >
        {seconds === null || !lastAt || !now
          ? null
          : t("lastResponse", {
              time:
                seconds < 60
                  ? t("secondsAgo", { seconds })
                  : format.relativeTime(new Date(lastAt), new Date(now)),
            })}
      </span>
    </div>
  );
}

function DashboardHeader({
  config,
  formTitle,
  bundle,
  isDemo,
  versions,
  editMode,
  onConfig,
  live,
  pending,
  onApplyPending,
  onTogglePause,
  lastEventAt,
  presenting,
  children,
}: {
  config: DashboardConfig;
  formTitle: string;
  bundle: DashboardBundle | undefined;
  isDemo: boolean;
  versions: { id: string; number: number }[];
  editMode: boolean;
  onConfig: (updater: (c: DashboardConfig) => DashboardConfig) => void;
  live: LiveStatus;
  pending: number;
  onApplyPending: () => void;
  paused: boolean;
  onTogglePause: () => void;
  lastEventAt: number | null;
  fetching: boolean;
  presenting: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations();
  const { format } = useLabels();
  const title = config.title ?? formTitle;
  const o = bundle?.overview;
  const lastAt = lastEventAt ?? (o?.last_at ? Date.parse(o.last_at) : null);
  const included = (o?.versions ?? [])
    .filter((v) => v.count > 0)
    .map((v) => `v${v.number}`);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editMode ? (
            <div className="flex max-w-2xl flex-col gap-2">
              <Input
                value={config.title ?? ""}
                placeholder={formTitle || t("dashboard.titlePlaceholder")}
                aria-label={t("dashboard.titlePlaceholder")}
                maxLength={300}
                onChange={(e) =>
                  onConfig((c) => ({
                    ...c,
                    title: e.target.value || undefined,
                  }))
                }
              />
              <Textarea
                rows={2}
                value={config.description ?? ""}
                placeholder={t("dashboard.descriptionPlaceholder")}
                aria-label={t("dashboard.descriptionPlaceholder")}
                maxLength={2000}
                onChange={(e) =>
                  onConfig((c) => ({
                    ...c,
                    description: e.target.value || undefined,
                  }))
                }
              />
            </div>
          ) : (
            <>
              <h2
                className={cn(
                  "font-semibold tracking-tight",
                  presenting ? "text-3xl" : "text-xl",
                )}
              >
                {title}
              </h2>
              {config.description && (
                <p className="mt-1 max-w-3xl whitespace-pre-line text-muted-foreground">
                  {config.description}
                </p>
              )}
            </>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <LiveBadge status={live} onToggle={onTogglePause} lastAt={lastAt} />
            {pending > 0 && (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 rounded-full"
                onClick={onApplyPending}
                data-testid="pending-pill"
              >
                {t("live.newResponses", { count: pending })}
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" data-testid="about-data">
                <Info aria-hidden />
                {t("dashboard.about.title")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 text-sm">
              <dl className="flex flex-col gap-2">
                {bundle?.form.description && (
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("dashboard.about.formDescription")}
                    </dt>
                    <dd>{bundle.form.description}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("dashboard.about.versions")}
                  </dt>
                  <dd>
                    {included.length
                      ? included.join(", ")
                      : versions.map((v) => `v${v.number}`).join(", ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("dashboard.about.period")}
                  </dt>
                  <dd>
                    {o?.first_at && o.last_at
                      ? t("dashboard.about.periodValue", {
                          from: format.dateTime(new Date(o.first_at), {
                            dateStyle: "medium",
                          }),
                          to: format.dateTime(new Date(o.last_at), {
                            dateStyle: "medium",
                          }),
                        })
                      : t("dashboard.about.noResponses")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("dashboard.about.total")}
                  </dt>
                  <dd>{format.number(o?.total ?? 0)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("dashboard.about.creator")}
                  </dt>
                  <dd>{bundle?.form.creator}</dd>
                </div>
                {bundle && (
                  <p className="text-xs text-muted-foreground">
                    {t("dashboard.generatedAt", {
                      time: format.dateTime(new Date(bundle.generated_at), {
                        timeStyle: "medium",
                      }),
                    })}
                  </p>
                )}
                {isDemo && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {t("dashboard.about.demo")}
                  </p>
                )}
              </dl>
            </PopoverContent>
          </Popover>
          {children}
        </div>
      </div>
    </div>
  );
}
