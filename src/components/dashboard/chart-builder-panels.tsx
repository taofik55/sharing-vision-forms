"use client";

import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Calendar,
  ChartArea,
  ChartBarBig,
  ChartColumnBig,
  ChartColumnIncreasing,
  ChartLine,
  ChartPie,
  ChartScatter,
  CircleDot,
  Clock,
  Gauge,
  GitBranch,
  Grid3x3,
  GripVertical,
  Hash,
  Languages,
  LayoutGrid,
  Plus,
  Search,
  Settings2,
  Smartphone,
  SquareCheck,
  Table2,
  Timer,
  Type,
  X,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Combobox } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AGGREGATIONS,
  CHART_SHAPES,
  CUSTOM_CHARTS,
  fieldId,
  fieldType,
  filterReady,
  grainsFor,
  needsField,
  NUMBER_FORMATS,
  sameField,
  slotAccepts,
  slotsFor,
  type ChartFilter,
  type ChartSpec,
  type CustomChart,
  type Dimension,
  type DropTarget,
  type FieldRef,
  type FieldType,
  type FilterOp,
  type Metric,
  type SlotId,
  type TimeGrain,
} from "@/lib/analytics/chart-spec";
import { PALETTES } from "@/lib/analytics/config";
import { OTHER_OPTION_ID, type Question } from "@/lib/forms/schema";
import { cn } from "@/lib/utils";
import { useDashboard, useLabels } from "./dashboard-context";

// -----------------------------------------------------------------------------
// Column catalog
// -----------------------------------------------------------------------------

export type FieldEntry = {
  id: string;
  ref: FieldRef;
  label: string;
  type: FieldType;
  /** Question type or metadata description. */
  hint: string;
  group: "questions" | "removed" | "meta";
};

const META_ORDER = [
  "submitted_at",
  "device",
  "locale",
  "version",
  "duration",
] as const;

export function useFieldCatalog(): FieldEntry[] {
  const { questions, currentKeys } = useDashboard();
  const { t } = useLabels();
  return useMemo(() => {
    const entries: FieldEntry[] = [];
    const add = (q: Question, group: FieldEntry["group"]) => {
      const ref: FieldRef = { kind: "question", key: q.key };
      const type = fieldType(ref, questions);
      if (!type) return;
      entries.push({
        id: fieldId(ref),
        ref,
        label: q.title || q.key,
        type,
        hint: t(`questionTypes.${q.type}`),
        group,
      });
    };
    for (const key of currentKeys)
      if (questions[key]) add(questions[key], "questions");
    for (const q of Object.values(questions))
      if (!currentKeys.has(q.key)) add(q, "removed");
    for (const field of META_ORDER) {
      const ref: FieldRef = { kind: "meta", field };
      entries.push({
        id: fieldId(ref),
        ref,
        label: t(`chartBuilder.meta.${field}`),
        type: fieldType(ref, questions)!,
        hint: t(`chartBuilder.metaHint.${field}`),
        group: "meta",
      });
    }
    return entries;
  }, [questions, currentKeys, t]);
}

export function FieldIcon({
  entry,
  className,
}: {
  entry: Pick<FieldEntry, "ref" | "type">;
  className?: string;
}) {
  const cls = cn("size-4 shrink-0 text-muted-foreground", className);
  if (entry.ref.kind === "meta") {
    switch (entry.ref.field) {
      case "submitted_at":
        return <Clock className={cls} aria-hidden />;
      case "device":
        return <Smartphone className={cls} aria-hidden />;
      case "locale":
        return <Languages className={cls} aria-hidden />;
      case "version":
        return <GitBranch className={cls} aria-hidden />;
      case "duration":
        return <Timer className={cls} aria-hidden />;
    }
  }
  switch (entry.type) {
    case "category":
      return <CircleDot className={cls} aria-hidden />;
    case "multi":
      return <SquareCheck className={cls} aria-hidden />;
    case "number":
      return <Hash className={cls} aria-hidden />;
    case "date":
      return <Calendar className={cls} aria-hidden />;
    default:
      return <Type className={cls} aria-hidden />;
  }
}

export function useEntryLookup(entries: FieldEntry[]) {
  return useMemo(() => {
    const map = new Map(entries.map((e) => [e.id, e]));
    return (ref: FieldRef | undefined) =>
      ref ? map.get(fieldId(ref)) : undefined;
  }, [entries]);
}

// -----------------------------------------------------------------------------
// Slot naming
// -----------------------------------------------------------------------------

export function slotName(slot: SlotId, chart: CustomChart): string {
  if (slot === "x" || slot === "y") return slot;
  if (slot === "metrics")
    return chart === "kpi"
      ? "kpiValue"
      : chart === "table"
        ? "values"
        : "measure";
  if (slot === "dim0") {
    if (chart === "donut") return "slices";
    if (chart === "histogram") return "range";
    if (chart === "table" || chart === "pivot" || chart === "heatmap")
      return "rows";
    return "groupBy";
  }
  if (chart === "pivot" || chart === "heatmap") return "columns";
  if (chart === "table") return "subgroup";
  return "breakdown";
}

// -----------------------------------------------------------------------------
// Columns panel
// -----------------------------------------------------------------------------

export function ColumnsPanel({
  entries,
  chart,
  onPlace,
  onAuto,
}: {
  entries: FieldEntry[];
  chart: CustomChart;
  onPlace: (target: DropTarget, ref: FieldRef) => void;
  onAuto: (ref: FieldRef) => void;
}) {
  const { t } = useLabels();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = entries.filter(
    (e) =>
      !q ||
      e.label.toLowerCase().includes(q) ||
      e.hint.toLowerCase().includes(q),
  );
  const groups: FieldEntry["group"][] = ["questions", "meta", "removed"];
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3"
      data-testid="builder-columns"
    >
      <div>
        <h3 className="text-sm font-semibold">{t("chartBuilder.columns")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("chartBuilder.columnsHint")}
        </p>
      </div>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("chartBuilder.searchColumns")}
          aria-label={t("chartBuilder.searchColumns")}
          className="pl-8"
        />
      </div>
      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 pb-2">
        {groups.map((group) => {
          const items = shown.filter((e) => e.group === group);
          if (!items.length) return null;
          return (
            <section key={group} className="flex flex-col gap-1">
              <h4 className="px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {t(`chartBuilder.groups.${group}`)}
              </h4>
              <ul className="flex flex-col gap-1">
                {items.map((entry) => (
                  <ColumnItem
                    key={entry.id}
                    entry={entry}
                    chart={chart}
                    onPlace={onPlace}
                    onAuto={onAuto}
                  />
                ))}
              </ul>
            </section>
          );
        })}
        {!shown.length && (
          <p className="px-1 text-sm text-muted-foreground">
            {t("chartBuilder.noColumns")}
          </p>
        )}
      </div>
    </div>
  );
}

function ColumnItem({
  entry,
  chart,
  onPlace,
  onAuto,
}: {
  entry: FieldEntry;
  chart: CustomChart;
  onPlace: (target: DropTarget, ref: FieldRef) => void;
  onAuto: (ref: FieldRef) => void;
}) {
  const { t } = useLabels();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `col:${entry.id}`,
    data: { entry },
  });
  const targets: DropTarget[] = [...slotsFor(chart), "filters"].filter((s) =>
    slotAccepts(s as DropTarget, chart, entry.type),
  ) as DropTarget[];
  return (
    <li
      className={cn(
        "group flex items-center gap-1 rounded-md border bg-card pr-1 text-sm transition-colors hover:border-primary/50",
        isDragging && "opacity-40",
      )}
      data-testid="builder-column"
      data-field={entry.id}
    >
      <button
        ref={setNodeRef}
        type="button"
        className="flex min-w-0 flex-1 cursor-grab touch-none items-center gap-2 py-1.5 pl-2 text-left active:cursor-grabbing"
        title={t("chartBuilder.columnAction")}
        onClick={() => onAuto(entry.ref)}
        {...listeners}
        {...attributes}
        aria-roledescription={t("chartBuilder.draggable")}
      >
        <GripVertical
          className="size-3.5 shrink-0 text-muted-foreground/60 group-hover:text-muted-foreground"
          aria-hidden
        />
        <FieldIcon entry={entry} />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{entry.label}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {entry.hint}
          </span>
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={t("chartBuilder.addTo", { name: entry.label })}
            data-testid="column-add"
          >
            <Plus className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {t("chartBuilder.addToTitle")}
          </DropdownMenuLabel>
          {targets.map((target) => (
            <DropdownMenuItem
              key={target}
              onSelect={() => onPlace(target, entry.ref)}
              data-testid={`add-to-${target}`}
            >
              {target === "filters"
                ? t("chartBuilder.filters")
                : t(
                    `chartBuilder.slots.${slotName(target, chart)}` as "chartBuilder.slots.groupBy",
                  )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

// -----------------------------------------------------------------------------
// Chart gallery
// -----------------------------------------------------------------------------

const CHART_ICONS: Record<CustomChart, typeof ChartBarBig> = {
  bar: ChartBarBig,
  column: ChartColumnBig,
  line: ChartLine,
  area: ChartArea,
  donut: ChartPie,
  kpi: Gauge,
  table: Table2,
  pivot: Grid3x3,
  heatmap: LayoutGrid,
  scatter: ChartScatter,
  histogram: ChartColumnIncreasing,
};

export function ChartGallery({
  value,
  onChange,
}: {
  value: CustomChart;
  onChange: (chart: CustomChart) => void;
}) {
  const { t } = useLabels();
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{t("chartBuilder.chartType")}</h3>
      <div
        className="grid grid-cols-4 gap-1.5"
        role="radiogroup"
        aria-label={t("chartBuilder.chartType")}
      >
        {CUSTOM_CHARTS.map((chart) => {
          const Icon = CHART_ICONS[chart];
          const active = chart === value;
          return (
            <button
              key={chart}
              type="button"
              role="radio"
              aria-checked={active}
              title={t(`chartBuilder.chartHint.${chart}`)}
              onClick={() => onChange(chart)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[11px] leading-tight transition-colors hover:bg-muted",
                active &&
                  "border-primary bg-primary/10 text-foreground ring-1 ring-primary",
              )}
              data-testid={`chart-type-${chart}`}
            >
              <Icon
                className={cn(
                  "size-5",
                  active ? "text-primary" : "text-muted-foreground",
                )}
                aria-hidden
              />
              <span className="text-center">
                {t(`chartBuilder.charts.${chart}`)}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {t(`chartBuilder.chartHint.${value}`)}
      </p>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Slots
// -----------------------------------------------------------------------------

type SlotProps = {
  slot: SlotId;
  spec: ChartSpec;
  entries: FieldEntry[];
  questions: Record<string, Question>;
  onChange: (spec: ChartSpec) => void;
  onPlace: (target: DropTarget, ref: FieldRef) => void;
};

export function SlotBox(props: SlotProps) {
  const { slot, spec, entries, onPlace } = props;
  const { t } = useLabels();
  const { active } = useDndContext();
  const { setNodeRef, isOver } = useDroppable({ id: slot });
  const dragged = active?.data.current?.entry as FieldEntry | undefined;
  const fits = dragged ? slotAccepts(slot, spec.chart, dragged.type) : false;
  const name = slotName(slot, spec.chart);
  const shape = CHART_SHAPES[spec.chart];
  const optional =
    (slot === "dim1" && shape.dims.min < 2) ||
    (slot === "dim0" && shape.dims.min === 0);
  const candidates = entries.filter((e) =>
    slotAccepts(slot, spec.chart, e.type),
  );

  let chips: ReactNode = null;
  let empty = false;
  let canAdd = true;
  if (slot === "dim0" || slot === "dim1") {
    const index = slot === "dim0" ? 0 : 1;
    const dim = spec.dimensions[index];
    empty = !dim;
    canAdd = !dim && (index === 0 || spec.dimensions.length >= 1);
    if (dim) chips = <DimensionChip {...props} index={index} dim={dim} />;
  } else if (slot === "metrics") {
    chips = spec.metrics.map((m, i) => (
      <MetricChip key={i} {...props} index={i} metric={m} />
    ));
    empty = spec.metrics.length === 0;
    canAdd = spec.metrics.length < shape.metrics.max;
  } else {
    const ref = spec[slot];
    const entry = ref ? entries.find((e) => sameField(e.ref, ref)) : undefined;
    empty = !ref;
    canAdd = !ref;
    if (ref)
      chips = (
        <Chip
          entry={entry}
          label={entry?.label ?? "?"}
          onRemove={() => props.onChange({ ...spec, [slot]: undefined })}
        />
      );
  }

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border border-dashed p-2.5 transition-colors",
        dragged && fits && "border-primary/70 bg-primary/5",
        dragged && !fits && "opacity-50",
        isOver && fits && "border-solid border-primary bg-primary/10",
      )}
      data-testid={`slot-${slot}`}
      aria-label={t(
        `chartBuilder.slots.${name}` as "chartBuilder.slots.groupBy",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold">
          {t(`chartBuilder.slots.${name}` as "chartBuilder.slots.groupBy")}
          {optional && (
            <span className="ml-1 font-normal text-muted-foreground">
              ({t("chartBuilder.optional")})
            </span>
          )}
        </h4>
        {canAdd && (
          <FieldPicker
            entries={candidates}
            label={t("chartBuilder.addField")}
            extra={
              slot === "metrics"
                ? [
                    { value: "agg:count", label: t("chartBuilder.aggs.count") },
                    {
                      value: "agg:percent",
                      label: t("chartBuilder.aggs.percent"),
                    },
                  ]
                : undefined
            }
            onPick={(value) => {
              if (value.startsWith("agg:")) {
                const agg = value.slice(4) as Metric["agg"];
                props.onChange({
                  ...spec,
                  metrics: [...spec.metrics, { agg }],
                });
                return;
              }
              const entry = candidates.find((e) => e.id === value);
              if (entry) onPlace(slot, entry.ref);
            }}
            testId={`slot-add-${slot}`}
          />
        )}
      </div>
      {chips}
      {empty && (
        <p className="text-xs text-muted-foreground">
          {t(
            `chartBuilder.slotHints.${name}` as "chartBuilder.slotHints.groupBy",
          )}
        </p>
      )}
    </section>
  );
}

function FieldPicker({
  entries,
  label,
  extra,
  onPick,
  testId,
}: {
  entries: FieldEntry[];
  label: string;
  extra?: { value: string; label: string }[];
  onPick: (value: string) => void;
  testId: string;
}) {
  const { t } = useLabels();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const items = entries.filter((e) => !q || e.label.toLowerCase().includes(q));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs"
          data-testid={testId}
        >
          <Plus className="size-3.5" aria-hidden />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        {entries.length > 6 && (
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("chartBuilder.searchColumns")}
            aria-label={t("chartBuilder.searchColumns")}
            className="mb-2 h-8"
          />
        )}
        <ul className="flex max-h-72 flex-col overflow-y-auto" role="listbox">
          {extra?.map((x) => (
            <li key={x.value}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onPick(x.value);
                  setOpen(false);
                }}
              >
                <Hash className="size-4 text-muted-foreground" aria-hidden />
                {x.label}
              </button>
            </li>
          ))}
          {items.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onPick(entry.id);
                  setOpen(false);
                }}
              >
                <FieldIcon entry={entry} />
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              </button>
            </li>
          ))}
          {!items.length && !extra?.length && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">
              {t("chartBuilder.noFitting")}
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function Chip({
  entry,
  label,
  detail,
  onRemove,
  settings,
}: {
  entry?: FieldEntry;
  label: string;
  detail?: string;
  onRemove: () => void;
  settings?: ReactNode;
}) {
  const { t } = useLabels();
  return (
    <div
      className="flex items-center gap-1.5 rounded-md border bg-card py-1 pr-1 pl-2 text-sm shadow-xs"
      data-testid="slot-chip"
    >
      {entry ? (
        <FieldIcon entry={entry} />
      ) : (
        <Hash className="size-4 text-muted-foreground" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {detail && (
          <span className="block truncate text-[11px] text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
      {settings}
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        onClick={onRemove}
        aria-label={t("chartBuilder.remove", { name: label })}
      >
        <X className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}

function SettingsButton({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={label}
          data-testid="chip-settings"
        >
          <Settings2 className="size-3.5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-3 text-sm">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function DimensionChip({
  spec,
  entries,
  questions,
  onChange,
  index,
  dim,
}: SlotProps & { index: number; dim: Dimension }) {
  const { t } = useLabels();
  const entry = entries.find((e) => sameField(e.ref, dim.field));
  const type = fieldType(dim.field, questions);
  const grains = grainsFor(type);
  const update = (patch: Partial<Dimension>) => {
    const dims = [...spec.dimensions];
    dims[index] = { ...dim, ...patch };
    onChange({ ...spec, dimensions: dims });
  };
  const histogram = CHART_SHAPES[spec.chart].numericDim;
  const details: string[] = [];
  if (dim.grain && grains.length)
    details.push(t(`chartBuilder.grains.${dim.grain}`));
  if (dim.bins) details.push(t("chartBuilder.binsDetail", { n: dim.bins }));
  const label = dim.label?.trim() || entry?.label || "?";
  return (
    <Chip
      entry={entry}
      label={label}
      detail={details.join(" · ") || undefined}
      onRemove={() =>
        onChange({
          ...spec,
          dimensions: spec.dimensions.filter((_, i) => i !== index),
        })
      }
      settings={
        <SettingsButton label={t("chartBuilder.settingsFor", { name: label })}>
          {grains.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>{t("chartBuilder.grain")}</Label>
              <Select
                value={dim.grain ?? "day"}
                onValueChange={(v) => update({ grain: v as TimeGrain })}
              >
                <SelectTrigger className="w-full" data-testid="grain-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {grains.map((g) => (
                    <SelectItem key={g} value={g}>
                      {t(`chartBuilder.grains.${g}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {type === "number" && (
            <div className="flex flex-col gap-1.5">
              {!histogram && (
                <label className="flex items-center justify-between gap-2">
                  <span>{t("chartBuilder.useBins")}</span>
                  <Switch
                    checked={Boolean(dim.bins)}
                    onCheckedChange={(on) =>
                      update({ bins: on ? 10 : undefined })
                    }
                  />
                </label>
              )}
              {(dim.bins || histogram) && (
                <>
                  <Label htmlFor={`bins-${index}`}>
                    {t("chartBuilder.binCount")}
                  </Label>
                  <Input
                    id={`bins-${index}`}
                    type="number"
                    min={2}
                    max={50}
                    value={dim.bins ?? 10}
                    onChange={(e) =>
                      update({
                        bins: Math.min(
                          50,
                          Math.max(2, Number(e.target.value) || 10),
                        ),
                      })
                    }
                  />
                </>
              )}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`dim-label-${index}`}>
              {t("chartBuilder.customLabel")}
            </Label>
            <Input
              id={`dim-label-${index}`}
              value={dim.label ?? ""}
              maxLength={100}
              placeholder={entry?.label}
              onChange={(e) => update({ label: e.target.value || undefined })}
            />
          </div>
        </SettingsButton>
      }
    />
  );
}

function MetricChip({
  spec,
  entries,
  onChange,
  index,
  metric,
}: SlotProps & { index: number; metric: Metric }) {
  const { t } = useLabels();
  const numeric = entries.filter((e) => e.type === "number");
  const entry = metric.field
    ? entries.find((e) => sameField(e.ref, metric.field!))
    : undefined;
  const update = (next: Metric) => {
    const metrics = [...spec.metrics];
    metrics[index] = next;
    onChange({ ...spec, metrics });
  };
  const agg = t(`chartBuilder.aggs.${metric.agg}`);
  const label =
    metric.label?.trim() || (entry ? `${agg} · ${entry.label}` : agg);
  return (
    <Chip
      entry={entry}
      label={label}
      onRemove={() =>
        onChange({
          ...spec,
          metrics: spec.metrics.filter((_, i) => i !== index),
        })
      }
      settings={
        <SettingsButton label={t("chartBuilder.settingsFor", { name: label })}>
          <div className="flex flex-col gap-1.5">
            <Label>{t("chartBuilder.aggregation")}</Label>
            <Select
              value={metric.agg}
              onValueChange={(v) => {
                const nextAgg = v as Metric["agg"];
                if (!needsField(nextAgg))
                  update({ agg: nextAgg, label: metric.label });
                else
                  update({
                    agg: nextAgg,
                    field: metric.field ?? numeric[0]?.ref,
                    label: metric.label,
                  });
              }}
            >
              <SelectTrigger className="w-full" data-testid="agg-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGGREGATIONS.map((a) => (
                  <SelectItem
                    key={a}
                    value={a}
                    disabled={needsField(a) && !numeric.length}
                  >
                    {t(`chartBuilder.aggs.${a}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t(`chartBuilder.aggHints.${metric.agg}`)}
            </p>
          </div>
          {needsField(metric.agg) && (
            <div className="flex flex-col gap-1.5">
              <Label>{t("chartBuilder.ofField")}</Label>
              <Combobox
                options={numeric.map((e) => ({ value: e.id, label: e.label }))}
                value={entry?.id}
                onChange={(id) => {
                  const picked = numeric.find((e) => e.id === id);
                  if (picked) update({ ...metric, field: picked.ref });
                }}
                placeholder={t("chartBuilder.pickNumber")}
                searchPlaceholder={t("chartBuilder.searchColumns")}
                emptyText={t("chartBuilder.noFitting")}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`metric-label-${index}`}>
              {t("chartBuilder.customLabel")}
            </Label>
            <Input
              id={`metric-label-${index}`}
              value={metric.label ?? ""}
              maxLength={100}
              placeholder={entry ? `${agg} · ${entry.label}` : agg}
              onChange={(e) =>
                update({ ...metric, label: e.target.value || undefined })
              }
            />
          </div>
        </SettingsButton>
      }
    />
  );
}

// -----------------------------------------------------------------------------
// Filters
// -----------------------------------------------------------------------------

function opsFor(type: FieldType | null, ref: FieldRef): FilterOp[] {
  if (ref.kind === "meta" && (ref.field === "device" || ref.field === "locale"))
    return ["in", "not_in"];
  if (ref.kind === "meta" && ref.field === "version")
    return ["in", "not_in", "gt", "lt"];
  switch (type) {
    case "category":
    case "multi":
      return ["in", "not_in", "is_answered", "is_empty"];
    case "number":
      return ["gt", "lt", "in", "not_in", "is_answered", "is_empty"];
    case "date":
      return ["gt", "lt", "is_answered", "is_empty"];
    case "time":
      return ["gt", "lt"];
    case "text":
      return ["is_answered", "is_empty", "in", "not_in"];
    default:
      return ["in", "not_in"];
  }
}

export function FiltersEditor({
  spec,
  entries,
  questions,
  onChange,
}: {
  spec: ChartSpec;
  entries: FieldEntry[];
  questions: Record<string, Question>;
  onChange: (spec: ChartSpec) => void;
}) {
  const { t } = useLabels();
  const { setNodeRef, isOver } = useDroppable({ id: "filters" });
  const { active } = useDndContext();
  const update = (i: number, filter: ChartFilter | null) =>
    onChange({
      ...spec,
      filters: filter
        ? spec.filters.map((f, j) => (j === i ? filter : f))
        : spec.filters.filter((_, j) => j !== i),
    });
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-dashed p-2.5 transition-colors",
        active && "border-primary/70 bg-primary/5",
        isOver && "border-solid border-primary bg-primary/10",
      )}
      data-testid="slot-filters"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold">
          {t("chartBuilder.filters")}
          <span className="ml-1 font-normal text-muted-foreground">
            ({t("chartBuilder.optional")})
          </span>
        </h4>
        {spec.filters.length < 10 && (
          <FieldPicker
            entries={entries}
            label={t("chartBuilder.addFilter")}
            onPick={(id) => {
              const entry = entries.find((e) => e.id === id);
              if (!entry) return;
              const type = entry.type;
              const op = opsFor(type, entry.ref)[0];
              onChange({
                ...spec,
                filters: [
                  ...spec.filters,
                  op === "is_answered"
                    ? { field: entry.ref, op }
                    : { field: entry.ref, op, values: [] },
                ],
              });
            }}
            testId="add-filter"
          />
        )}
      </div>
      {spec.filters.map((filter, i) => (
        <FilterRow
          key={i}
          filter={filter}
          entry={entries.find((e) => sameField(e.ref, filter.field))}
          questions={questions}
          onChange={(f) => update(i, f)}
        />
      ))}
      {!spec.filters.length && (
        <p className="text-xs text-muted-foreground">
          {t("chartBuilder.filtersHint")}
        </p>
      )}
    </section>
  );
}

function FilterRow({
  filter,
  entry,
  questions,
  onChange,
}: {
  filter: ChartFilter;
  entry: FieldEntry | undefined;
  questions: Record<string, Question>;
  onChange: (filter: ChartFilter | null) => void;
}) {
  const { t, optionLabel, deviceLabel, languageLabel } = useLabels();
  const { versionCount } = useDashboard();
  const type = fieldType(filter.field, questions);
  const ops = opsFor(type, filter.field);
  const temporal = type === "date" || type === "time";
  const values = filter.values ?? [];
  const ready = filterReady(filter);

  let choices: { value: string; label: string }[] | null = null;
  if (filter.op === "in" || filter.op === "not_in") {
    if (
      filter.field.kind === "question" &&
      (type === "category" || type === "multi")
    ) {
      const q = questions[filter.field.key];
      const key = filter.field.key;
      choices = (q?.options ?? []).map((o) => ({
        value: o.id,
        label: optionLabel(key, o.id),
      }));
      if (q?.allowOther)
        choices.push({ value: OTHER_OPTION_ID, label: t("widgets.other") });
    } else if (filter.field.kind === "meta" && filter.field.field === "device")
      choices = ["mobile", "desktop", "tablet", "unknown"].map((v) => ({
        value: v,
        label: deviceLabel(v),
      }));
    else if (filter.field.kind === "meta" && filter.field.field === "locale")
      choices = ["id", "en", "unknown"].map((v) => ({
        value: v,
        label: languageLabel(v),
      }));
    else if (filter.field.kind === "meta" && filter.field.field === "version")
      choices = Array.from({ length: versionCount }, (_, i) => ({
        value: String(i + 1),
        label: `v${i + 1}`,
      }));
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md border bg-card p-2",
        !ready && "border-amber-500/60",
      )}
      data-testid="filter-row"
    >
      <div className="flex items-center gap-1.5 text-sm">
        {entry && <FieldIcon entry={entry} />}
        <span className="min-w-0 flex-1 truncate font-medium">
          {entry?.label ?? "?"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => onChange(null)}
          aria-label={t("chartBuilder.remove", { name: entry?.label ?? "" })}
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      </div>
      <Select
        value={filter.op}
        onValueChange={(op) => {
          const next = op as FilterOp;
          onChange(
            next === "is_answered" || next === "is_empty"
              ? { field: filter.field, op: next }
              : {
                  field: filter.field,
                  op: next,
                  values: next === filter.op ? values : [],
                },
          );
        }}
      >
        <SelectTrigger
          className="h-8 w-full"
          aria-label={t("chartBuilder.condition")}
          data-testid="filter-op"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ops.map((op) => (
            <SelectItem key={op} value={op}>
              {t(
                `chartBuilder.ops.${temporal && (op === "gt" || op === "lt") ? (op === "gt" ? "after" : "before") : op}`,
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {choices && (
        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {choices.map((c) => {
            const checked = values.map(String).includes(c.value);
            return (
              <li key={c.value}>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(on) =>
                      onChange({
                        ...filter,
                        values: on
                          ? [...values, c.value]
                          : values.filter((v) => String(v) !== c.value),
                      })
                    }
                  />
                  <span className="truncate">{c.label}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {!choices && filter.op !== "is_answered" && filter.op !== "is_empty" && (
        <FilterValueInput filter={filter} type={type} onChange={onChange} />
      )}
      {!ready && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          {t("chartBuilder.filterIncomplete")}
        </p>
      )}
    </div>
  );
}

function FilterValueInput({
  filter,
  type,
  onChange,
}: {
  filter: ChartFilter;
  type: FieldType | null;
  onChange: (filter: ChartFilter) => void;
}) {
  const { t } = useLabels();
  const values = filter.values ?? [];
  const list = filter.op === "in" || filter.op === "not_in";
  if (list)
    return (
      <Input
        className="h-8"
        defaultValue={values.join(", ")}
        placeholder={t("chartBuilder.listPlaceholder")}
        aria-label={t("chartBuilder.value")}
        onChange={(e) =>
          onChange({
            ...filter,
            values: e.target.value
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean)
              .slice(0, 50),
          })
        }
      />
    );
  if (type === "date")
    return (
      <Input
        type="date"
        className="h-8"
        value={String(values[0] ?? "")}
        aria-label={t("chartBuilder.value")}
        onChange={(e) =>
          onChange({
            ...filter,
            values: e.target.value ? [e.target.value] : [],
          })
        }
      />
    );
  if (type === "time")
    return (
      <Input
        type="datetime-local"
        className="h-8"
        value={String(values[0] ?? "").slice(0, 16)}
        aria-label={t("chartBuilder.value")}
        onChange={(e) =>
          // Wall time in Jakarta (the dashboard's reporting time zone).
          onChange({
            ...filter,
            values: e.target.value ? [`${e.target.value}:00+07:00`] : [],
          })
        }
      />
    );
  return (
    <Input
      type="number"
      className="h-8"
      value={values[0] === undefined ? "" : String(values[0])}
      aria-label={t("chartBuilder.value")}
      onChange={(e) =>
        onChange({
          ...filter,
          values: e.target.value === "" ? [] : [Number(e.target.value)],
        })
      }
      data-testid="filter-number"
    />
  );
}

// -----------------------------------------------------------------------------
// Sort & limit
// -----------------------------------------------------------------------------

export function SortLimit({
  spec,
  onChange,
}: {
  spec: ChartSpec;
  onChange: (spec: ChartSpec) => void;
}) {
  const { t } = useLabels();
  if (
    spec.chart === "kpi" ||
    spec.chart === "scatter" ||
    !spec.dimensions.length
  )
    return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{t("chartBuilder.sortTitle")}</h3>
      <div className="flex gap-2">
        <Select
          value={spec.sort.by}
          onValueChange={(by) =>
            onChange({
              ...spec,
              sort: { ...spec.sort, by: by as "metric" | "dimension" },
            })
          }
        >
          <SelectTrigger
            className="h-8 flex-1"
            aria-label={t("chartBuilder.sortBy")}
            data-testid="sort-by"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="metric">
              {t("chartBuilder.sortMetric")}
            </SelectItem>
            <SelectItem value="dimension">
              {t("chartBuilder.sortDimension")}
            </SelectItem>
          </SelectContent>
        </Select>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={spec.sort.dir}
          onValueChange={(dir) =>
            dir &&
            onChange({
              ...spec,
              sort: { ...spec.sort, dir: dir as "asc" | "desc" },
            })
          }
          aria-label={t("chartBuilder.sortDir")}
        >
          <ToggleGroupItem
            value="desc"
            aria-label={t("chartBuilder.desc")}
            title={t("chartBuilder.desc")}
          >
            <ArrowDownWideNarrow className="size-4" aria-hidden />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="asc"
            aria-label={t("chartBuilder.asc")}
            title={t("chartBuilder.asc")}
          >
            <ArrowUpNarrowWide className="size-4" aria-hidden />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <label className="flex items-center justify-between gap-2 text-sm">
        <span>{t("chartBuilder.limit")}</span>
        <Input
          type="number"
          min={1}
          max={500}
          className="h-8 w-24"
          value={spec.limit}
          onChange={(e) =>
            onChange({
              ...spec,
              limit: Math.min(500, Math.max(1, Number(e.target.value) || 1)),
            })
          }
          data-testid="limit-input"
        />
      </label>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Display options
// -----------------------------------------------------------------------------

export function DisplayOptions({
  spec,
  note,
  onChange,
  onNote,
}: {
  spec: ChartSpec;
  note: string;
  onChange: (spec: ChartSpec) => void;
  onNote: (note: string) => void;
}) {
  const { t } = useLabels();
  const shape = CHART_SHAPES[spec.chart];
  const o = spec.options;
  const set = (patch: Partial<ChartSpec["options"]>) =>
    onChange({ ...spec, options: { ...o, ...patch } });
  const twoDims = spec.dimensions.length === 2;
  const toggles: {
    key: keyof ChartSpec["options"];
    show: boolean;
    label: string;
    hint?: string;
  }[] = [
    {
      key: "stacked",
      show: Boolean(shape.stackable) && twoDims,
      label: t("chartBuilder.stacked"),
    },
    {
      key: "showValues",
      show: ["bar", "column", "histogram"].includes(spec.chart),
      label: t("chartBuilder.showValues"),
    },
    {
      key: "showLegend",
      show: twoDims && ["bar", "column", "line", "area"].includes(spec.chart),
      label: t("chartBuilder.showLegend"),
    },
    {
      key: "includeEmpty",
      show: spec.dimensions.length > 0,
      label: t("chartBuilder.includeEmpty"),
      hint: t("chartBuilder.includeEmptyHint"),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      {!["table", "pivot", "kpi", "scatter"].includes(spec.chart) && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t("widgets.palette")}</h3>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={
              o.palette ??
              (spec.chart === "donut" || twoDims ? "categorical" : "mono")
            }
            onValueChange={(v) =>
              v && set({ palette: v as ChartSpec["options"]["palette"] })
            }
            className="w-full"
          >
            {PALETTES.map((p) => (
              <ToggleGroupItem key={p} value={p} className="flex-1 text-xs">
                {t(`widgets.palettes.${p}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </section>
      )}
      {spec.chart !== "scatter" && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            {t("chartBuilder.numberFormat")}
          </h3>
          <Select
            value={o.format ?? "auto"}
            onValueChange={(v) =>
              set({ format: v as ChartSpec["options"]["format"] })
            }
          >
            <SelectTrigger className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NUMBER_FORMATS.map((f) => (
                <SelectItem key={f} value={f}>
                  {t(`chartBuilder.formats.${f}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>
      )}
      {toggles.some((x) => x.show) && (
        <section className="flex flex-col gap-2.5">
          {toggles
            .filter((x) => x.show)
            .map((x) => (
              <label
                key={x.key}
                className="flex items-start justify-between gap-3 text-sm"
              >
                <span>
                  {x.label}
                  {x.hint && (
                    <span className="block text-xs text-muted-foreground">
                      {x.hint}
                    </span>
                  )}
                </span>
                <Switch
                  checked={Boolean(
                    o[x.key] ??
                    (x.key === "showValues" || x.key === "showLegend"),
                  )}
                  onCheckedChange={(on) => set({ [x.key]: on })}
                  data-testid={`option-${x.key}`}
                />
              </label>
            ))}
        </section>
      )}
      <section className="flex flex-col gap-2">
        <Label htmlFor="chart-note" className="text-sm font-semibold">
          {t("widgets.note")}
        </Label>
        <Textarea
          id="chart-note"
          rows={3}
          maxLength={1000}
          value={note}
          placeholder={t("chartBuilder.notePlaceholder")}
          onChange={(e) => onNote(e.target.value)}
        />
      </section>
    </div>
  );
}
