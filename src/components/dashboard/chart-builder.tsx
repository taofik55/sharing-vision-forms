"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  AlertCircle,
  ChartColumnBig,
  Columns3,
  Eye,
  LoaderCircle,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DataTable } from "@/components/charts/charts";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildChartModel } from "@/lib/analytics/chart-result";
import {
  autoPlace,
  changeChart,
  cleanSpec,
  emptySpec,
  fieldType,
  placeField,
  slotsFor,
  specProblems,
  type ChartSpec,
  type DropTarget,
  type FieldRef,
  type SpecProblem,
} from "@/lib/analytics/chart-spec";
import type { Question } from "@/lib/forms/schema";
import { cn } from "@/lib/utils";
import {
  ChartGallery,
  ColumnsPanel,
  DisplayOptions,
  FieldIcon,
  FiltersEditor,
  SlotBox,
  SortLimit,
  useFieldCatalog,
  type FieldEntry,
} from "./chart-builder-panels";
import { ChartBody, useChartLabeler, useSpecTitle } from "./custom-chart";
import { useDashboard, useLabels } from "./dashboard-context";
import { useChartQuery } from "./use-dashboard-data";

export type BuilderDraft = {
  /** Widget being edited (absent: a new chart). */
  widgetId?: string;
  spec: ChartSpec;
  title?: string;
  note?: string;
};

type Pane = "columns" | "setup" | "preview";

/**
 * Full-screen chart builder (Looker / Superset style): pick a chart, drop
 * columns into its slots, tune aggregation, filters and display, and watch a
 * live preview aggregated in Postgres. Editors and admins only.
 */
export function ChartBuilder({
  draft,
  onClose,
  onSave,
}: {
  draft: BuilderDraft | null;
  onClose: () => void;
  onSave: (draft: BuilderDraft) => void;
}) {
  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      {draft && (
        <BuilderBody
          key={draft.widgetId ?? "new"}
          draft={draft}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </Dialog>
  );
}

function BuilderBody({
  draft,
  onClose,
  onSave,
}: {
  draft: BuilderDraft;
  onClose: () => void;
  onSave: (draft: BuilderDraft) => void;
}) {
  const ctx = useDashboard();
  const { t } = useLabels();
  const entries = useFieldCatalog();
  const specTitle = useSpecTitle();
  const [spec, setSpec] = useState<ChartSpec>(draft.spec);
  const [title, setTitle] = useState(draft.title ?? "");
  const [note, setNote] = useState(draft.note ?? "");
  const [pane, setPane] = useState<Pane>("setup");
  const [tab, setTab] = useState<"data" | "display">("data");
  const [dragging, setDragging] = useState<FieldEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const justDragged = useRef(false);

  const [initial] = useState(() =>
    JSON.stringify([draft.spec, draft.title ?? "", draft.note ?? ""]),
  );
  const dirty = JSON.stringify([spec, title, note]) !== initial;
  const problems = specProblems(spec, ctx.questions);
  const autoTitle = specTitle(spec);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  function place(target: DropTarget, ref: FieldRef) {
    const next = placeField(spec, target, ref, ctx.questions);
    if (next) {
      setSpec(next);
      setNotice(null);
    } else setNotice(t("chartBuilder.doesNotFit"));
  }

  function auto(ref: FieldRef) {
    if (justDragged.current) return;
    const placed = autoPlace(spec, ref, ctx.questions);
    if (placed) {
      setSpec(placed.spec);
      setNotice(null);
      setPane("setup");
    } else setNotice(t("chartBuilder.slotsFull"));
  }

  function onDragStart(event: DragStartEvent) {
    justDragged.current = true;
    setDragging((event.active.data.current?.entry as FieldEntry) ?? null);
  }
  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    setTimeout(() => (justDragged.current = false), 0);
    const entry = event.active.data.current?.entry as FieldEntry | undefined;
    const target = event.over?.id as DropTarget | undefined;
    if (entry && target) place(target, entry.ref);
  }

  function requestClose() {
    if (dirty) setConfirmClose(true);
    else onClose();
  }

  function save() {
    onSave({
      widgetId: draft.widgetId,
      spec: cleanSpec(spec),
      title: title.trim() || undefined,
      note: note.trim() || undefined,
    });
  }

  return (
    <DialogContent
      showCloseButton={false}
      className="top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 sm:max-w-none"
      onEscapeKeyDown={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onInteractOutside={(e) => e.preventDefault()}
      // Start on the selected chart type rather than the title field.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement)
          .querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
          ?.focus();
      }}
      data-testid="chart-builder"
    >
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <ChartColumnBig className="size-5 text-primary" aria-hidden />
        <div className="min-w-48 flex-1">
          <DialogTitle className="sr-only">
            {draft.widgetId
              ? t("chartBuilder.editTitle")
              : t("chartBuilder.newTitle")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("chartBuilder.description")}
          </DialogDescription>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={autoTitle}
            maxLength={300}
            aria-label={t("chartBuilder.chartTitle")}
            className="h-9 max-w-xl border-transparent bg-transparent text-base font-semibold shadow-none hover:border-input focus-visible:border-input"
            data-testid="builder-title"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={requestClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={save}
            disabled={problems.length > 0}
            data-testid="builder-save"
          >
            {draft.widgetId
              ? t("chartBuilder.saveChanges")
              : t("chartBuilder.addToDashboard")}
          </Button>
        </div>
      </header>

      {/* Narrow screens: one pane at a time. */}
      <div className="border-b px-4 py-2 lg:hidden">
        <Tabs value={pane} onValueChange={(v) => setPane(v as Pane)}>
          <TabsList className="w-full">
            <TabsTrigger value="columns" className="flex-1">
              <Columns3 aria-hidden />
              {t("chartBuilder.columns")}
            </TabsTrigger>
            <TabsTrigger value="setup" className="flex-1">
              <SlidersHorizontal aria-hidden />
              {t("chartBuilder.setup")}
            </TabsTrigger>
            <TabsTrigger value="preview" className="flex-1">
              <Eye aria-hidden />
              {t("chartBuilder.preview")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="grid min-h-0 flex-1 lg:grid-cols-[260px_360px_minmax(0,1fr)]">
          <aside
            className={cn(
              "min-h-0 flex-col border-r bg-muted/30 p-4 select-none lg:flex",
              pane === "columns" ? "flex" : "hidden",
            )}
          >
            <ColumnsPanel
              entries={entries}
              chart={spec.chart}
              onPlace={place}
              onAuto={auto}
            />
          </aside>

          <section
            className={cn(
              "min-h-0 flex-col overflow-y-auto border-r p-4 lg:flex",
              pane === "setup" ? "flex" : "hidden",
            )}
            aria-label={t("chartBuilder.setup")}
          >
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as "data" | "display")}
              className="gap-4"
            >
              <TabsList className="w-full">
                <TabsTrigger
                  value="data"
                  className="flex-1"
                  data-testid="builder-tab-data"
                >
                  {t("chartBuilder.tabData")}
                </TabsTrigger>
                <TabsTrigger
                  value="display"
                  className="flex-1"
                  data-testid="builder-tab-display"
                >
                  {t("chartBuilder.tabDisplay")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="data" className="flex flex-col gap-4">
                <ChartGallery
                  value={spec.chart}
                  onChange={(chart) =>
                    setSpec(changeChart(spec, chart, ctx.questions))
                  }
                />
                <div className="flex flex-col gap-2">
                  {slotsFor(spec.chart).map((slot) => (
                    <SlotBox
                      key={slot}
                      slot={slot}
                      spec={spec}
                      entries={entries}
                      questions={ctx.questions}
                      onChange={setSpec}
                      onPlace={place}
                    />
                  ))}
                  <FiltersEditor
                    spec={spec}
                    entries={entries}
                    questions={ctx.questions}
                    onChange={setSpec}
                  />
                </div>
                <SortLimit spec={spec} onChange={setSpec} />
              </TabsContent>
              <TabsContent value="display">
                <DisplayOptions
                  spec={spec}
                  note={note}
                  onChange={setSpec}
                  onNote={setNote}
                />
              </TabsContent>
            </Tabs>
          </section>

          <section
            className={cn(
              "min-h-0 flex-col gap-3 overflow-y-auto bg-muted/20 p-4 lg:flex",
              pane === "preview" ? "flex" : "hidden",
            )}
            aria-label={t("chartBuilder.preview")}
          >
            <Preview
              spec={spec}
              title={title.trim() || autoTitle}
              problems={problems}
              onPick={setSpec}
            />
          </section>
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging && (
            <div className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-sm shadow-lg">
              <FieldIcon entry={dragging} />
              {dragging.label}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {notice && (
        <p
          role="status"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-sm shadow-md"
          data-testid="builder-notice"
        >
          {notice}
        </p>
      )}

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={t("chartBuilder.discardTitle")}
        description={t("chartBuilder.discardDescription")}
        confirmLabel={t("chartBuilder.discard")}
        destructive
        onConfirm={() => {
          setConfirmClose(false);
          onClose();
        }}
      />
    </DialogContent>
  );
}

/** Debounced copy of a value (the preview queries after typing settles). */
function useDebounced<T>(value: T, ms: number): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setCurrent(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return current;
}

function Preview({
  spec,
  title,
  problems,
  onPick,
}: {
  spec: ChartSpec;
  title: string;
  problems: SpecProblem[];
  onPick: (spec: ChartSpec) => void;
}) {
  const ctx = useDashboard();
  const { t, fmt } = useLabels();
  const labeler = useChartLabeler();
  const query = useDebounced(cleanSpec(spec), 300);
  const ready = specProblems(query, ctx.questions).length === 0;
  const result = useChartQuery(
    ctx.formId,
    "builder-preview",
    query,
    ctx.rpcFilters,
    ctx.dataVersion,
    ready,
  );
  const model = useMemo(
    () => buildChartModel(query, result.data, ctx.questions, labeler),
    [query, result.data, ctx.questions, labeler],
  );
  const blank =
    spec.dimensions.length === 0 && !spec.x && !spec.y && spec.chart !== "kpi";

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("chartBuilder.preview")}</h3>
        <span
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          role="status"
        >
          {result.isFetching && (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          )}
          {result.data &&
            t("chartBuilder.subtitle", {
              total: fmt.number(result.data.total),
            })}
        </span>
      </div>

      <div
        className="flex h-[min(60vh,520px)] min-h-72 flex-col rounded-lg border bg-card p-4"
        data-testid="builder-preview"
      >
        <p className="mb-3 truncate font-semibold">{title}</p>
        <div className="min-h-0 flex-1">
          {problems.length > 0 ? (
            blank ? (
              <QuickStarts onPick={onPick} />
            ) : (
              <Problems problems={problems} spec={spec} />
            )
          ) : result.isError ? (
            <p className="flex h-full items-center justify-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-4" aria-hidden />
              {t("chartBuilder.queryError")}
            </p>
          ) : !result.data ? (
            <div className="flex h-full items-center justify-center">
              <LoaderCircle
                className="size-6 animate-spin text-muted-foreground"
                aria-hidden
              />
            </div>
          ) : (
            <ChartBody spec={query} model={model} title={title} />
          )}
        </div>
      </div>

      {problems.length === 0 &&
        model.kind !== "table" &&
        model.table.rows.length > 0 && (
          <details className="rounded-lg border bg-card">
            <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
              {t("chartBuilder.dataRows", { count: model.table.rows.length })}
            </summary>
            <div className="max-h-72 overflow-auto px-4 pb-4">
              <DataTable
                columns={model.table.columns}
                rows={model.table.rows.slice(0, 200)}
              />
            </div>
          </details>
        )}
    </>
  );
}

function Problems({
  problems,
  spec,
}: {
  problems: SpecProblem[];
  spec: ChartSpec;
}) {
  const { t } = useLabels();
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 text-center"
      data-testid="builder-problems"
    >
      <ChartColumnBig
        className="size-10 text-muted-foreground/50"
        aria-hidden
      />
      <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
        {problems.map((p) => (
          <li key={p}>
            {t(`chartBuilder.problems.${p}`, {
              chart: t(`chartBuilder.charts.${spec.chart}`),
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Starting points for an empty chart, built from this form's columns. */
function QuickStarts({ onPick }: { onPick: (spec: ChartSpec) => void }) {
  const { questions, currentKeys } = useDashboard();
  const { t, fmt } = useLabels();
  const ideas = useMemo(
    () => quickStarts(questions, currentKeys),
    [questions, currentKeys],
  );
  return (
    <div
      className="flex h-full flex-col justify-center gap-3"
      data-testid="quick-starts"
    >
      <div className="text-center">
        <Sparkles className="mx-auto mb-1 size-6 text-primary" aria-hidden />
        <p className="font-medium">{t("chartBuilder.quickTitle")}</p>
        <p className="text-sm text-muted-foreground">
          {t("chartBuilder.quickHint")}
        </p>
      </div>
      <div className="mx-auto grid w-full max-w-xl gap-2 sm:grid-cols-2">
        {ideas.map((idea) => (
          <button
            key={idea.id}
            type="button"
            onClick={() => onPick(idea.spec)}
            className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm hover:border-primary hover:bg-primary/5"
            data-testid="quick-start"
          >
            <FieldIcon entry={{ ref: idea.ref, type: idea.type }} />
            <span className="min-w-0 flex-1 truncate">
              {t(`chartBuilder.quick.${idea.kind}`, {
                a: idea.a ? fmt.questionTitle(idea.a) : "",
                b: idea.b ? fmt.questionTitle(idea.b) : "",
              })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

type Idea = {
  id: string;
  kind: "perDay" | "devices" | "countBy" | "avgBy" | "cross" | "distribution";
  a?: string;
  b?: string;
  ref: FieldRef;
  type: NonNullable<ReturnType<typeof fieldType>>;
  spec: ChartSpec;
};

function quickStarts(
  questions: Record<string, Question>,
  keys: Set<string>,
): Idea[] {
  const current = [...keys].map((k) => questions[k]).filter(Boolean);
  const cats = current.filter(
    (q) =>
      fieldType({ kind: "question", key: q.key }, questions) === "category",
  );
  const nums = current.filter(
    (q) => fieldType({ kind: "question", key: q.key }, questions) === "number",
  );
  const ideas: Idea[] = [];
  const time: FieldRef = { kind: "meta", field: "submitted_at" };
  ideas.push({
    id: "perDay",
    kind: "perDay",
    ref: time,
    type: "time",
    spec: {
      ...emptySpec("line"),
      dimensions: [{ field: time, grain: "day" }],
      sort: { by: "dimension", dir: "asc" },
      limit: 500,
    },
  });
  if (cats[0]) {
    const ref: FieldRef = { kind: "question", key: cats[0].key };
    ideas.push({
      id: "countBy",
      kind: "countBy",
      a: cats[0].key,
      ref,
      type: "category",
      spec: { ...emptySpec("bar"), dimensions: [{ field: ref }] },
    });
  }
  if (nums[0] && cats[0]) {
    const ref: FieldRef = { kind: "question", key: nums[0].key };
    const by: FieldRef = { kind: "question", key: cats[0].key };
    ideas.push({
      id: "avgBy",
      kind: "avgBy",
      a: nums[0].key,
      b: cats[0].key,
      ref,
      type: "number",
      spec: {
        ...emptySpec("column"),
        dimensions: [{ field: by }],
        metrics: [{ agg: "avg", field: ref }],
      },
    });
  } else if (nums[0]) {
    const ref: FieldRef = { kind: "question", key: nums[0].key };
    ideas.push({
      id: "distribution",
      kind: "distribution",
      a: nums[0].key,
      ref,
      type: "number",
      spec: {
        ...emptySpec("histogram"),
        dimensions: [{ field: ref, bins: 10 }],
        sort: { by: "dimension", dir: "asc" },
      },
    });
  }
  if (cats[0] && cats[1]) {
    const a: FieldRef = { kind: "question", key: cats[0].key };
    const b: FieldRef = { kind: "question", key: cats[1].key };
    ideas.push({
      id: "cross",
      kind: "cross",
      a: cats[0].key,
      b: cats[1].key,
      ref: a,
      type: "category",
      spec: {
        ...emptySpec("heatmap"),
        dimensions: [{ field: a }, { field: b }],
      },
    });
  }
  const device: FieldRef = { kind: "meta", field: "device" };
  ideas.push({
    id: "devices",
    kind: "devices",
    ref: device,
    type: "meta",
    spec: { ...emptySpec("donut"), dimensions: [{ field: device }] },
  });
  return ideas;
}
