import type { FormDefinition, Question } from "@/lib/forms/schema";

export function question(
  partial: Partial<Question> & Pick<Question, "key" | "type">,
): Question {
  return {
    id: `id_${partial.key}`,
    title: partial.key,
    required: false,
    ...partial,
  };
}

export function form(...questions: Question[]): FormDefinition {
  return {
    schemaVersion: 1,
    sections: [{ id: "s1", title: "Section", questions }],
  };
}

export function twoSectionForm(
  first: Question[],
  second: Question[],
): FormDefinition {
  return {
    schemaVersion: 1,
    sections: [
      { id: "s1", title: "One", questions: first },
      { id: "s2", title: "Two", questions: second },
    ],
  };
}

export const yesNo = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
];
