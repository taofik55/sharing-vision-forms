"use client";

import {
  ChartColumn,
  Download,
  EllipsisVertical,
  Eye,
  EyeOff,
  GripVertical,
  Info,
  Lightbulb,
  PencilLine,
  Table2,
  WandSparkles,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type ReactNode } from "react";
import { DataTable } from "@/components/charts/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { specFromQuestion } from "@/lib/analytics/chart-spec";
import { PALETTES, type ChartType, type Widget } from "@/lib/analytics/config";
import { cn } from "@/lib/utils";
import { useDashboard } from "./dashboard-context";

export type CardBadge = {
  label: string;
  tone?: "default" | "warning" | "muted";
};

type WidgetCardProps = {
  widget: Widget;
  title: string;
  subtitle?: ReactNode;
  badges?: CardBadge[];
  insight?: string | null;
  help?: string;
  table?: { columns: string[]; rows: (string | number)[][] } | null;
  charts?: ChartType[];
  children: ReactNode;
  /** Widgets without a chart (headings, text) skip the chrome. */
  bare?: boolean;
};

const SIZES = { small: 4, medium: 6, large: 12 } as const;

/**
 * Card chrome for every widget: title, "n of N" subtitle, context badges,
 * chart / data table toggle, key insight, help popover, PNG download and
 * (in edit mode) the widget menu.
 */
export function WidgetCard({
  widget,
  title,
  subtitle,
  badges = [],
  insight,
  help,
  table,
  charts = [],
  children,
  bare,
}: WidgetCardProps) {
  const t = useTranslations("widgets");
  const {
    editMode,
    updateWidget,
    removeWidget,
    flashing,
    presenting,
    openBuilder,
  } = useDashboard();
  const [showTable, setShowTable] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function downloadPng() {
    if (!ref.current) return;
    const { toPng } = await import("html-to-image");
    const dataUrl = await toPng(ref.current, {
      pixelRatio: 2,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      filter: (node) =>
        !(node instanceof HTMLElement && node.dataset.noExport === "true"),
    });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 60) || "chart"}.png`;
    a.click();
  }

  return (
    <div
      ref={ref}
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-lg border bg-card text-card-foreground",
        !bare && "p-4",
        widget.hidden && "opacity-50",
        flashing.has(widget.id) && "fp-flash",
      )}
      data-testid={`widget-${widget.kind}`}
      data-widget-id={widget.id}
    >
      {!bare && (
        <div className="flex items-start gap-2">
          {editMode && (
            <span
              className="widget-drag -ml-1 cursor-grab pt-0.5 text-muted-foreground"
              data-no-export="true"
              aria-hidden
            >
              <GripVertical className="size-4" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h3
              className={cn(
                "leading-snug font-semibold",
                presenting ? "text-xl" : "text-base",
              )}
            >
              {title}
            </h3>
            {subtitle && (
              <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div
            className="flex shrink-0 items-center print:hidden"
            data-no-export="true"
          >
            {help && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={t("howToRead")}
                  >
                    <Info className="size-4" aria-hidden />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 text-sm">
                  <p className="mb-1 font-medium">{t("howToRead")}</p>
                  <p className="text-muted-foreground">{help}</p>
                </PopoverContent>
              </Popover>
            )}
            {table && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={showTable ? t("showChart") : t("showTable")}
                aria-pressed={showTable}
                onClick={() => setShowTable((v) => !v)}
                data-testid="toggle-table"
              >
                {showTable ? (
                  <ChartColumn className="size-4" aria-hidden />
                ) : (
                  <Table2 className="size-4" aria-hidden />
                )}
              </Button>
            )}
            {widget.kind === "custom" && openBuilder && !presenting && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t("editChart")}
                title={t("editChart")}
                onClick={() => openBuilder(widget)}
                data-testid="edit-chart"
              >
                <PencilLine className="size-4" aria-hidden />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t("downloadPng")}
              onClick={downloadPng}
            >
              <Download className="size-4" aria-hidden />
            </Button>
            {editMode && (
              <WidgetMenu
                widget={widget}
                title={title}
                charts={charts}
                onRemove={() => removeWidget(widget.id)}
                update={(p) => updateWidget(widget.id, p)}
              />
            )}
          </div>
        </div>
      )}

      {!bare && badges.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {badges.map((b) => (
            <Badge
              key={b.label}
              variant={b.tone === "warning" ? "outline" : "secondary"}
              className={cn(
                "max-w-full justify-start font-normal",
                b.tone === "warning" &&
                  "border-amber-500/60 text-amber-700 dark:text-amber-400",
                b.tone === "muted" && "text-muted-foreground",
              )}
              title={b.label}
            >
              {/* Text in a span: a flex badge does not ellipsize its own text. */}
              <span className="truncate">{b.label}</span>
            </Badge>
          ))}
        </div>
      )}

      <div className={cn("min-h-0 flex-1", !bare && "mt-3")}>
        {showTable && table ? (
          <DataTable
            columns={table.columns}
            rows={table.rows}
            className="h-full"
          />
        ) : (
          children
        )}
      </div>

      {!bare && insight && (
        <p
          className={cn("mt-3 flex gap-2 text-sm", presenting && "text-base")}
          data-testid="widget-insight"
        >
          <Lightbulb
            className="mt-0.5 size-4 shrink-0 text-amber-500"
            aria-hidden
          />
          <span>
            <span className="sr-only">{t("keyInsight")}: </span>
            {insight}
          </span>
        </p>
      )}
      {!bare && widget.note && (
        <p className="mt-2 border-l-2 pl-2 text-xs whitespace-pre-line text-muted-foreground">
          {widget.note}
        </p>
      )}
    </div>
  );
}

function WidgetMenu({
  widget,
  title,
  charts,
  update,
  onRemove,
}: {
  widget: Widget;
  title: string;
  charts: ChartType[];
  update: (patch: Partial<Widget>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("widgets");
  const tc = useTranslations("common");
  const { openBuilder, questions } = useDashboard();
  const question =
    widget.kind === "question" && widget.questionKey
      ? questions[widget.questionKey]
      : undefined;
  const fromQuestion = question ? specFromQuestion(question) : null;
  const [editing, setEditing] = useState<"rename" | "note" | null>(null);
  const [draft, setDraft] = useState("");
  const size =
    widget.layout.w >= 12 ? "large" : widget.layout.w >= 6 ? "medium" : "small";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t("menu")}
            data-testid="widget-menu"
          >
            <EllipsisVertical className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-56"
          onCloseAutoFocus={(e) => editing && e.preventDefault()}
        >
          {openBuilder && widget.kind === "custom" && (
            <DropdownMenuItem onSelect={() => openBuilder(widget)}>
              <PencilLine aria-hidden />
              {t("editChart")}
            </DropdownMenuItem>
          )}
          {openBuilder && fromQuestion && (
            <DropdownMenuItem
              onSelect={() => openBuilder(undefined, fromQuestion)}
              data-testid="open-in-builder"
            >
              <WandSparkles aria-hidden />
              {t("openInBuilder")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => update({ hidden: !widget.hidden })}>
            {widget.hidden ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
            {widget.hidden ? t("show") : t("hide")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setDraft(widget.title ?? title);
              setEditing("rename");
            }}
          >
            {t("rename")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setDraft(widget.note ?? "");
              setEditing("note");
            }}
          >
            {t("note")}
          </DropdownMenuItem>
          {charts.length > 1 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t("chartType")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={widget.chart}
                  onValueChange={(v) => update({ chart: v as ChartType })}
                >
                  {charts.map((c) => (
                    <DropdownMenuRadioItem key={c} value={c}>
                      {t(`charts.${c}`)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {widget.kind !== "custom" && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t("palette")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={widget.palette ?? "categorical"}
                  onValueChange={(v) =>
                    update({ palette: v as Widget["palette"] })
                  }
                >
                  {PALETTES.map((p) => (
                    <DropdownMenuRadioItem key={p} value={p}>
                      {t(`palettes.${p}`)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{t("size")}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={size}
                onValueChange={(v) => {
                  const w = SIZES[v as keyof typeof SIZES];
                  update({
                    layout: {
                      ...widget.layout,
                      w,
                      x: Math.min(widget.layout.x, 12 - w),
                    },
                  });
                }}
              >
                {(Object.keys(SIZES) as (keyof typeof SIZES)[]).map((s) => (
                  <DropdownMenuRadioItem key={s} value={s}>
                    {t(`sizes.${s}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {widget.origin === "user" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                <Trash2 aria-hidden />
                {t("remove")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing === "rename" ? t("rename") : t("note")}
            </DialogTitle>
          </DialogHeader>
          <Label htmlFor={`edit-${widget.id}`} className="sr-only">
            {editing === "rename" ? t("rename") : t("note")}
          </Label>
          {editing === "rename" ? (
            <Input
              id={`edit-${widget.id}`}
              value={draft}
              maxLength={300}
              onChange={(e) => setDraft(e.target.value)}
              data-testid="widget-rename-input"
            />
          ) : (
            <Textarea
              id={`edit-${widget.id}`}
              rows={3}
              value={draft}
              maxLength={1000}
              onChange={(e) => setDraft(e.target.value)}
            />
          )}
          <DialogFooter>
            <Button
              onClick={() => {
                if (editing === "rename")
                  update({ title: draft.trim() || undefined });
                else update({ note: draft.trim() || undefined });
                setEditing(null);
              }}
              data-testid="widget-edit-save"
            >
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
