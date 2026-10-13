import { newId } from "@/lib/forms/operations";
import type { FormDefinition, Question } from "@/lib/forms/schema";
import { instantiateTemplate } from "@/lib/forms/templates";

/**
 * Demo form definition: the customer satisfaction template plus a
 * waiting-time and an age question, so cross-question insights have
 * something to find (generate_demo_responses correlates them).
 */
export function demoDefinition(): FormDefinition {
  const definition = instantiateTemplate(
    "customer_satisfaction",
    "en",
  ).definition;
  const extra: Question[] = [
    {
      id: newId(),
      key: newId(),
      type: "number",
      title: "How long did you wait to be served? (minutes)",
      required: true,
      validation: { min: 0, max: 120, integerOnly: true },
    },
    {
      id: newId(),
      key: newId(),
      type: "number",
      title: "Your age",
      required: true,
      validation: { min: 16, max: 90, integerOnly: true },
    },
  ];
  // Insert before "How many times did you visit…" so the generator treats
  // waiting time as number #1 (lowers ratings) and age as number #2 (by channel).
  const about = definition.sections[0];
  const visitsIndex = about.questions.findIndex((q) => q.type === "number");
  about.questions.splice(visitsIndex, 0, ...extra);
  return definition;
}
