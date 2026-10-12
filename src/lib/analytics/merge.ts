/**
 * Merges a saved dashboard config with the current form definition after a
 * new version is published:
 * - widgets are keyed by question_key;
 * - questions the config has never seen get auto widgets in a "New" group;
 * - widgets of removed questions stay (rendered as "Question removed");
 * - user changes (hidden, renamed, resized, notes, chart, palette) are never touched.
 */
import { flattenQuestions, type FormDefinition } from "@/lib/forms/schema";
import {
  bottomOf,
  buildAutoDashboard,
  packLayout,
  questionWidget,
} from "./auto";
import type { DashboardConfig, Widget } from "./config";

export function mergeDashboardConfig(
  saved: DashboardConfig | null,
  definition: FormDefinition,
): DashboardConfig {
  if (!saved) return buildAutoDashboard(definition);

  const currentKeys = flattenQuestions(definition).map((q) => q.key);
  const known = new Set(saved.knownKeys);
  const withWidget = new Set(
    saved.widgets
      .filter((w) => w.kind === "question" && w.questionKey)
      .map((w) => w.questionKey!),
  );

  const fresh = flattenQuestions(definition)
    .filter((q) => !known.has(q.key) && !withWidget.has(q.key))
    .map(questionWidget)
    .filter((w): w is Widget => w !== null);

  let widgets = saved.widgets;
  if (fresh.length) {
    const groupId = `heading:new:${fresh[0].questionKey}`;
    const heading: Widget = {
      id: groupId,
      kind: "heading",
      origin: "auto",
      newGroup: true,
      layout: { x: 0, y: 0, w: 12, h: 2 },
    };
    widgets = [
      ...saved.widgets,
      ...packLayout([heading, ...fresh], bottomOf(saved.widgets)),
    ];
  }

  return {
    ...saved,
    widgets,
    knownKeys: Array.from(new Set([...saved.knownKeys, ...currentKeys])),
  };
}

/** Question keys of the current definition (to mark removed-question widgets). */
export function currentQuestionKeys(definition: FormDefinition): Set<string> {
  return new Set(flattenQuestions(definition).map((q) => q.key));
}
