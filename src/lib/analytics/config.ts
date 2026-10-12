/** Persisted dashboard configuration (dashboards.config). */
import { z } from "zod";

export const CONFIG_VERSION = 1;

export const CHART_TYPES = [
  "donut",
  "bar",
  "column",
  "line",
  "area",
  "histogram",
  "stats",
  "weekday",
  "terms",
  "table",
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const PALETTES = ["categorical", "sequential", "mono"] as const;
export type PaletteId = (typeof PALETTES)[number];

export const WIDGET_KINDS = [
  "overview_kpis",
  "overview_timeline",
  "overview_heatmap",
  "overview_devices",
  "overview_locales",
  "suggestions",
  "heading",
  "question",
  "cross",
  "kpi",
  "text",
] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export const KPI_METRICS = ["count", "average", "nps"] as const;

const key = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const layoutSchema = z.object({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(10_000),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(40),
});
export type WidgetLayout = z.infer<typeof layoutSchema>;

export const widgetSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_:-]{1,100}$/),
  kind: z.enum(WIDGET_KINDS),
  /** Auto widgets are generated from the definition; user widgets are added by editors. */
  origin: z.enum(["auto", "user"]),
  questionKey: key.optional(),
  questionKeyB: key.optional(),
  /** Heading for a form section (title follows the section unless renamed). */
  sectionId: z.string().max(64).optional(),
  /** Heading for the group of questions added by a newer version. */
  newGroup: z.boolean().optional(),
  chart: z.enum(CHART_TYPES).optional(),
  title: z.string().max(300).optional(),
  note: z.string().max(1000).optional(),
  text: z.string().max(5000).optional(),
  hidden: z.boolean().optional(),
  palette: z.enum(PALETTES).optional(),
  kpi: z
    .object({ metric: z.enum(KPI_METRICS), questionKey: key.optional() })
    .optional(),
  layout: layoutSchema,
});
export type Widget = z.infer<typeof widgetSchema>;

export const dashboardConfigSchema = z.object({
  configVersion: z.literal(CONFIG_VERSION),
  title: z.string().max(300).optional(),
  description: z.string().max(2000).optional(),
  widgets: z.array(widgetSchema).max(300),
  /** Question keys the config already accounted for (to detect new questions). */
  knownKeys: z.array(key).max(1000),
});
export type DashboardConfig = z.infer<typeof dashboardConfigSchema>;

export function parseConfig(value: unknown): DashboardConfig | null {
  const parsed = dashboardConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
