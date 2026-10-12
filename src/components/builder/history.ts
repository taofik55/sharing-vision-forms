import type { FormDefinition } from "@/lib/forms/schema";

/** Undo/redo history for the builder. Pure reducer, unit-tested. */
export type HistoryState = {
  past: FormDefinition[];
  present: FormDefinition;
  future: FormDefinition[];
  /** Consecutive edits with the same key (e.g. typing in one field) merge into one step. */
  coalesceKey: string | null;
  coalesceAt: number;
};

export type HistoryAction =
  | {
      type: "apply";
      definition: FormDefinition;
      coalesceKey?: string;
      now?: number;
    }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; definition: FormDefinition; keepHistory?: boolean };

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 1000;

export function initHistory(definition: FormDefinition): HistoryState {
  return {
    past: [],
    present: definition,
    future: [],
    coalesceKey: null,
    coalesceAt: 0,
  };
}

export function historyReducer(
  state: HistoryState,
  action: HistoryAction,
): HistoryState {
  switch (action.type) {
    case "apply": {
      if (action.definition === state.present) return state;
      const now = action.now ?? Date.now();
      const coalesce =
        action.coalesceKey !== undefined &&
        action.coalesceKey === state.coalesceKey &&
        now - state.coalesceAt < COALESCE_MS &&
        state.past.length > 0;
      return {
        past: coalesce
          ? state.past
          : [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: action.definition,
        future: [],
        coalesceKey: action.coalesceKey ?? null,
        coalesceAt: now,
      };
    }
    case "undo": {
      if (!state.past.length) return state;
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
        coalesceKey: null,
        coalesceAt: 0,
      };
    }
    case "redo": {
      if (!state.future.length) return state;
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1),
        coalesceKey: null,
        coalesceAt: 0,
      };
    }
    case "reset":
      return action.keepHistory
        ? {
            ...state,
            past: [...state.past, state.present].slice(-HISTORY_LIMIT),
            present: action.definition,
            future: [],
            coalesceKey: null,
          }
        : initHistory(action.definition);
  }
}
