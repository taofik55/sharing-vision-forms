"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  CircleAlert,
  CircleCheck,
  Eye,
  Info,
  Link2,
  LoaderCircle,
  Redo2,
  RotateCw,
  Send,
  Undo2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { PublicLink } from "@/components/forms/public-link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { loadDraftAction, publishFormAction } from "@/lib/forms/actions";
import { hashDefinition } from "@/lib/forms/hash";
import {
  addQuestion,
  createQuestion,
  findQuestion,
  moveQuestion,
  type NewQuestionLabels,
} from "@/lib/forms/operations";
import {
  LIMITS,
  flattenQuestions,
  formDefinitionSchema,
  validateDefinition,
  type DefinitionProblem,
  type FormDefinition,
  type QuestionType,
} from "@/lib/forms/schema";
import {
  BuilderContext,
  revealItem,
  type BuilderContextValue,
  type Selection,
} from "./builder-context";
import { Canvas, QuestionCard, SECTION_DROP_PREFIX } from "./canvas";
import { historyReducer, initHistory } from "./history";
import { Inspector } from "./inspector";
import { PALETTE_PREFIX, Palette } from "./palette";
import { PreviewDialog } from "./preview-dialog";
import { ProblemsPanel } from "./problems-panel";
import { QuestionTypeIcon } from "./question-type-icon";
import { readLocalDraft, useAutosave, type SaveStatus } from "./use-autosave";

type FormStatus = "draft" | "published" | "closed" | "archived";

export type BuilderProps = {
  formId: string;
  formTitle: string;
  formDescription: string | null;
  thankYouMessage: string | null;
  initialDefinition: FormDefinition;
  initialUpdatedAt: string;
  publishedHash: string | null;
  currentVersionNumber: number | null;
  status: FormStatus;
  responseCount: number;
  publicUrl: string;
  qrSvg: string;
};

// Sortable lists work best with closestCenter (the dragged rect, not the pointer,
// decides the target). Non-empty sections are disabled droppables, so the
// target is always a question, or an empty section.
const collisionDetection: CollisionDetection = closestCenter;

type ActiveDrag =
  | { kind: "palette"; type: QuestionType }
  | { kind: "question"; id: string }
  | null;

export function Builder(props: BuilderProps) {
  const t = useTranslations();
  const router = useRouter();
  const [history, dispatch] = useReducer(
    historyReducer,
    props.initialDefinition,
    initHistory,
  );
  const definition = history.present;
  const [selection, setSelection] = useState<Selection>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [serverProblems, setServerProblems] = useState<
    DefinitionProblem[] | null
  >(null);
  const [publishedHash, setPublishedHash] = useState(props.publishedHash);
  const [versionNumber, setVersionNumber] = useState(
    props.currentVersionNumber,
  );
  const [status, setStatus] = useState<FormStatus>(props.status);
  const [isPublishing, startPublishing] = useTransition();
  const autosave = useAutosave(
    props.formId,
    definition,
    props.initialUpdatedAt,
  );

  const labels: NewQuestionLabels = useMemo(
    () => ({
      title: t("builder.untitledQuestion"),
      option: (n) => t("builder.option", { number: n }),
    }),
    [t],
  );
  const problems = useMemo(() => validateDefinition(definition), [definition]);
  const currentHash = useMemo(() => hashDefinition(definition), [definition]);
  const hasUnpublishedChanges =
    publishedHash !== null && currentHash !== publishedHash;

  const apply = useCallback((next: FormDefinition, coalesceKey?: string) => {
    // The builder must never produce a structurally invalid draft.
    if (!formDefinitionSchema.safeParse(next).success) return;
    setServerProblems(null);
    dispatch({ type: "apply", definition: next, coalesceKey });
  }, []);

  const addQuestionOfType = useCallback(
    (type: QuestionType, target?: { sectionId: string; index: number }) => {
      if (flattenQuestions(definition).length >= LIMITS.questions) return;
      const question = createQuestion(type, labels);
      let where = target;
      if (!where) {
        const selected =
          selection?.kind === "question"
            ? findQuestion(definition, selection.id)
            : null;
        if (selected)
          where = { sectionId: selected.section.id, index: selected.index + 1 };
        else {
          const section =
            (selection?.kind === "section" &&
              definition.sections.find((s) => s.id === selection.id)) ||
            definition.sections[definition.sections.length - 1];
          where = { sectionId: section.id, index: section.questions.length };
        }
      }
      apply(addQuestion(definition, where.sectionId, question, where.index));
      setSelection({ kind: "question", id: question.id });
      // Edit right in the new card: the title is focused and selected.
      revealItem(question.id, "select");
    },
    [apply, definition, labels, selection],
  );

  // Restore edits mirrored to localStorage that never reached the server.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const local = readLocalDraft(props.formId);
    if (!local || local.baseUpdatedAt !== props.initialUpdatedAt) return;
    const parsed = formDefinitionSchema.safeParse(local.definition);
    if (
      !parsed.success ||
      hashDefinition(parsed.data) === hashDefinition(props.initialDefinition)
    )
      return;
    dispatch({ type: "reset", definition: parsed.data, keepHistory: true });
    toast.info(t("builder.restoredLocal"));
  }, [props.formId, props.initialUpdatedAt, props.initialDefinition, t]);

  // Undo / redo shortcuts.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if (key === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function onDragStart({ active }: DragStartEvent) {
    const id = String(active.id);
    if (id.startsWith(PALETTE_PREFIX))
      setActiveDrag({
        kind: "palette",
        type: id.slice(PALETTE_PREFIX.length) as QuestionType,
      });
    else setActiveDrag({ kind: "question", id });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveDrag(null);
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    let sectionId: string;
    let index: number;
    if (overId.startsWith(SECTION_DROP_PREFIX)) {
      sectionId = overId.slice(SECTION_DROP_PREFIX.length);
      const section = definition.sections.find((s) => s.id === sectionId);
      if (!section) return;
      index = section.questions.length;
    } else {
      const target = findQuestion(definition, overId);
      if (!target) return;
      sectionId = target.section.id;
      index = target.index;
    }

    if (activeId.startsWith(PALETTE_PREFIX)) {
      const type = activeId.slice(PALETTE_PREFIX.length) as QuestionType;
      // Dropping onto a question inserts after it.
      addQuestionOfType(type, {
        sectionId,
        index: overId.startsWith(SECTION_DROP_PREFIX) ? index : index + 1,
      });
      return;
    }
    if (activeId === overId) return;
    apply(moveQuestion(definition, activeId, sectionId, index));
  }

  function publish() {
    if (problems.length) {
      setProblemsOpen(true);
      toast.error(t("builder.publishFirstFix"));
      return;
    }
    startPublishing(async () => {
      const saved = await autosave.flush();
      if (!saved) return;
      const result = await publishFormAction({
        formId: props.formId,
        expectedUpdatedAt: autosave.getUpdatedAt(),
      });
      if (result.ok) {
        autosave.setUpdatedAt(result.updatedAt);
        setPublishedHash(result.hash);
        setVersionNumber(result.versionNumber);
        setStatus("published");
        toast.success(
          t("builder.publishedToast", { number: result.versionNumber }),
        );
        router.refresh();
        return;
      }
      if (result.error === "invalidDefinition" && "problems" in result) {
        setServerProblems(result.problems);
        setProblemsOpen(true);
        toast.error(t("formErrors.invalidDefinition"));
      } else if (result.error === "conflict") {
        autosave.markConflict();
      } else {
        toast.error(t(`formErrors.${result.error}`));
      }
    });
  }

  async function loadLatest() {
    const result = await loadDraftAction(props.formId);
    if (!result.ok) {
      toast.error(t(`formErrors.${result.error}`));
      return;
    }
    autosave.acceptServerState(result.definition, result.updatedAt);
    dispatch({ type: "reset", definition: result.definition });
    setSelection(null);
  }

  const contextValue: BuilderContextValue = {
    definition,
    apply,
    selection,
    select: setSelection,
    problems: serverProblems ?? problems,
    labels,
    sectionTitle: (n) => t("builder.sectionTitle", { number: n }),
    addQuestionOfType,
  };

  const draggedQuestion =
    activeDrag?.kind === "question"
      ? findQuestion(definition, activeDrag.id)?.question
      : null;
  const isLive = status === "published" || status === "closed";

  return (
    <BuilderContext value={contextValue}>
      <div className="flex flex-col gap-4">
        {/* Toolbar */}
        <div className="sticky top-14 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <SaveIndicator
            status={autosave.status}
            onRetry={() => void autosave.retry()}
          />
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${t("builder.undo")} (Ctrl+Z)`}
              title={`${t("builder.undo")} (Ctrl+Z)`}
              disabled={!history.past.length}
              onClick={() => dispatch({ type: "undo" })}
              data-testid="undo"
            >
              <Undo2 aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${t("builder.redo")} (Ctrl+Shift+Z)`}
              title={`${t("builder.redo")} (Ctrl+Shift+Z)`}
              disabled={!history.future.length}
              onClick={() => dispatch({ type: "redo" })}
              data-testid="redo"
            >
              <Redo2 aria-hidden />
            </Button>
          </div>
          {versionNumber !== null && (
            <Badge variant="outline" data-testid="version-badge">
              {t("forms.version", { number: versionNumber })}
            </Badge>
          )}
          {hasUnpublishedChanges && (
            <Badge variant="secondary" data-testid="unpublished-badge">
              {t("forms.unpublishedChanges")}
            </Badge>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <ProblemsPanel open={problemsOpen} onOpenChange={setProblemsOpen} />
            {isLive && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="public-link-button"
                  >
                    <Link2 aria-hidden />
                    <span className="hidden sm:inline">
                      {t("builder.publicLink")}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-[min(32rem,calc(100vw-2rem))]"
                >
                  <PublicLink
                    url={props.publicUrl}
                    qrSvg={props.qrSvg}
                    closed={status === "closed"}
                  />
                </PopoverContent>
              </Popover>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPreviewOpen(true)}
              data-testid="preview-button"
            >
              <Eye aria-hidden />
              {t("builder.preview")}
            </Button>
            <Button
              size="sm"
              onClick={publish}
              disabled={isPublishing}
              data-testid="publish-button"
            >
              {isPublishing ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : (
                <Send aria-hidden />
              )}
              {isPublishing ? t("builder.publishing") : t("builder.publish")}
            </Button>
          </div>
        </div>

        {props.responseCount > 0 && (
          <Alert data-testid="responses-banner">
            <Info aria-hidden />
            <AlertTitle>
              {t("builder.responsesBanner.title", {
                count: props.responseCount,
              })}
            </AlertTitle>
            <AlertDescription>
              {t("builder.responsesBanner.body")}
            </AlertDescription>
          </Alert>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveDrag(null)}
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[13rem_minmax(0,1fr)_20rem] xl:grid-cols-[14rem_minmax(0,1fr)_24rem]">
            <aside className="lg:sticky lg:top-32 lg:max-h-[calc(100svh-9rem)] lg:self-start lg:overflow-y-auto">
              <Palette />
            </aside>
            <div className="min-w-0">
              <Canvas />
            </div>
            <aside
              className="rounded-lg border bg-card p-4 lg:sticky lg:top-32 lg:max-h-[calc(100svh-9rem)] lg:self-start lg:overflow-y-auto"
              aria-label={t("builder.inspector.title")}
            >
              <Inspector />
            </aside>
          </div>
          <DragOverlay>
            {activeDrag?.kind === "palette" && (
              <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm shadow-lg">
                <QuestionTypeIcon type={activeDrag.type} />
                {t(`questionTypes.${activeDrag.type}`)}
              </div>
            )}
            {draggedQuestion && (
              <div className="shadow-lg">
                <QuestionCard question={draggedQuestion} overlay />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      <PreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        definition={definition}
        title={props.formTitle}
        description={props.formDescription}
        thankYouMessage={props.thankYouMessage}
      />

      <AlertDialog open={autosave.status === "conflict"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("builder.conflict.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("builder.conflict.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => void loadLatest()}>
              {t("builder.conflict.loadLatest")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void autosave.overwrite()}
              data-testid="conflict-overwrite"
            >
              {t("builder.conflict.overwrite")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BuilderContext>
  );
}

function SaveIndicator({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry: () => void;
}) {
  const t = useTranslations("builder.save");
  return (
    <div
      className="flex items-center gap-2 px-1 text-sm"
      role="status"
      aria-live="polite"
      data-testid="save-status"
      data-status={status}
    >
      {status === "saving" && (
        <>
          <LoaderCircle
            className="size-4 animate-spin text-muted-foreground"
            aria-hidden
          />
          <span className="text-muted-foreground">{t("saving")}</span>
        </>
      )}
      {status === "saved" && (
        <>
          <CircleCheck className="size-4 text-emerald-600" aria-hidden />
          <span className="text-muted-foreground">{t("saved")}</span>
        </>
      )}
      {(status === "dirty" || status === "conflict") && (
        <span className="text-muted-foreground">{t("unsaved")}</span>
      )}
      {status === "error" && (
        <>
          <CircleAlert className="size-4 text-destructive" aria-hidden />
          <span className="text-destructive">{t("error")}</span>
          <Button variant="outline" size="sm" className="h-7" onClick={onRetry}>
            <RotateCw aria-hidden />
            {t("retry")}
          </Button>
        </>
      )}
    </div>
  );
}
