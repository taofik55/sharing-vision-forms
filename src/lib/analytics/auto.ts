/**
 * Rule-based auto dashboard: a pure function of the form definition.
 * Default chart per question type, allowed alternatives, 12-column layout
 * with widgets grouped under their section titles.
 */
import {
  flattenQuestions,
  type FormDefinition,
  type Question,
  type QuestionType,
} from "@/lib/forms/schema";
import {
  CONFIG_VERSION,
  type ChartType,
  type DashboardConfig,
  type Widget,
  type WidgetLayout,
} from "./config";

export const GRID_COLUMNS = 12;

/** Question types that get a widget (email/phone are only counted in the overview). */
export function hasWidget(type: QuestionType): boolean {
  return type !== "email" && type !== "phone";
}

export function defaultChart(question: Question): ChartType | null {
  switch (question.type) {
    case "multiple_choice":
    case "dropdown":
      return (question.options?.length ?? 0) <= 5 ? "donut" : "bar";
    case "checkboxes":
      return "bar";
    case "rating":
    case "linear_scale":
      return "column";
    case "number":
      return "histogram";
    case "date":
      return "area";
    case "short_text":
    case "paragraph":
      return "terms";
    default:
      return null;
  }
}

/** Charts an editor may switch to (the first is the default family). */
export function allowedCharts(type: QuestionType): ChartType[] {
  switch (type) {
    case "multiple_choice":
    case "dropdown":
      return ["donut", "bar", "table"];
    case "checkboxes":
      return ["bar", "column", "table"];
    case "rating":
      return ["column", "donut", "table"];
    case "linear_scale":
      return ["column", "line", "table"];
    case "number":
      return ["histogram", "stats"];
    case "date":
      return ["area", "line", "weekday"];
    case "short_text":
    case "paragraph":
      return ["terms"];
    default:
      return [];
  }
}

/** Default widget size (grid units, rowHeight ~32 px). */
export function defaultSize(type: QuestionType): { w: number; h: number } {
  switch (type) {
    case "short_text":
    case "paragraph":
      return { w: 12, h: 10 };
    case "checkboxes":
    case "number":
      return { w: 6, h: 11 };
    default:
      return { w: 6, h: 10 };
  }
}

/** Packs widgets left-to-right into rows of 12 columns starting at `startY`. */
export function packLayout<T extends { layout: WidgetLayout }>(
  widgets: T[],
  startY = 0,
): T[] {
  let x = 0;
  let y = startY;
  let rowHeight = 0;
  return widgets.map((widget) => {
    const { w, h } = widget.layout;
    if (x + w > GRID_COLUMNS) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    const placed = { ...widget, layout: { x, y, w, h } };
    x += w;
    rowHeight = Math.max(rowHeight, h);
    if (w === GRID_COLUMNS) {
      x = 0;
      y += h;
      rowHeight = 0;
    }
    return placed;
  });
}

export function bottomOf(widgets: { layout: WidgetLayout }[]): number {
  return widgets.reduce((max, w) => Math.max(max, w.layout.y + w.layout.h), 0);
}

export function questionWidget(question: Question): Widget | null {
  const chart = defaultChart(question);
  if (!chart || !hasWidget(question.type)) return null;
  const { w, h } = defaultSize(question.type);
  return {
    id: `q:${question.key}`,
    kind: "question",
    origin: "auto",
    questionKey: question.key,
    chart,
    layout: { x: 0, y: 0, w, h },
  };
}

function overviewWidgets(): Widget[] {
  return [
    {
      id: "overview:kpis",
      kind: "overview_kpis",
      origin: "auto",
      layout: { x: 0, y: 0, w: 12, h: 5 },
    },
    {
      id: "overview:timeline",
      kind: "overview_timeline",
      origin: "auto",
      layout: { x: 0, y: 0, w: 12, h: 8 },
    },
    {
      id: "overview:heatmap",
      kind: "overview_heatmap",
      origin: "auto",
      layout: { x: 0, y: 0, w: 8, h: 9 },
    },
    {
      id: "overview:devices",
      kind: "overview_devices",
      origin: "auto",
      layout: { x: 0, y: 0, w: 4, h: 9 },
    },
    {
      id: "overview:locales",
      kind: "overview_locales",
      origin: "auto",
      layout: { x: 0, y: 0, w: 4, h: 7 },
    },
    {
      id: "overview:suggestions",
      kind: "suggestions",
      origin: "auto",
      layout: { x: 0, y: 0, w: 8, h: 7 },
    },
  ];
}

/** Widgets for each section: a heading followed by its question widgets. */
export function sectionWidgets(definition: FormDefinition): Widget[] {
  const out: Widget[] = [];
  for (const section of definition.sections) {
    const questions = section.questions
      .map(questionWidget)
      .filter((w): w is Widget => w !== null);
    if (!questions.length) continue;
    out.push({
      id: `heading:${section.id}`,
      kind: "heading",
      origin: "auto",
      sectionId: section.id,
      layout: { x: 0, y: 0, w: 12, h: 2 },
    });
    out.push(...questions);
  }
  return out;
}

export function buildAutoDashboard(
  definition: FormDefinition,
): DashboardConfig {
  return {
    configVersion: CONFIG_VERSION,
    widgets: packLayout([...overviewWidgets(), ...sectionWidgets(definition)]),
    knownKeys: flattenQuestions(definition).map((q) => q.key),
  };
}
