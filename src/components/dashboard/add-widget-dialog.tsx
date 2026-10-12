"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { allowedCharts, defaultSize, hasWidget } from "@/lib/analytics/auto";
import type { ChartType, Widget } from "@/lib/analytics/config";
import { newId } from "@/lib/forms/operations";
import type { Question } from "@/lib/forms/schema";

type Kind = "question" | "cross" | "text" | "kpi";

/** Add a question chart, a cross-tab, a text/heading block or a KPI card. */
export function AddWidgetDialog({
  questions,
  onAdd,
}: {
  questions: Question[];
  onAdd: (
    widget: Omit<Widget, "layout"> & { layout: Widget["layout"] },
  ) => void;
}) {
  const t = useTranslations("addWidget");
  const tw = useTranslations("widgets");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("question");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [chart, setChart] = useState<ChartType | "">("");
  const [text, setText] = useState("");
  const [asHeading, setAsHeading] = useState(false);
  const [metric, setMetric] = useState<"count" | "average" | "nps">("count");

  const eligible = questions.filter((q) => hasWidget(q.type));
  const crossable = questions.filter((q) =>
    [
      "multiple_choice",
      "dropdown",
      "checkboxes",
      "rating",
      "linear_scale",
      "number",
    ].includes(q.type),
  );
  const numeric = questions.filter((q) =>
    ["rating", "linear_scale", "number"].includes(q.type),
  );
  const qa = questions.find((q) => q.key === a);
  const kpiSources =
    metric === "nps"
      ? numeric.filter((q) => q.type === "linear_scale")
      : numeric;

  const valid =
    (kind === "question" && qa) ||
    (kind === "cross" && a && b && a !== b) ||
    (kind === "text" && text.trim()) ||
    (kind === "kpi" && (metric === "count" || a));

  function submit() {
    const id = `user:${newId()}`;
    if (kind === "question" && qa) {
      const size = defaultSize(qa.type);
      onAdd({
        id,
        kind: "question",
        origin: "user",
        questionKey: qa.key,
        chart: (chart || allowedCharts(qa.type)[0]) as ChartType,
        layout: { x: 0, y: 0, ...size },
      });
    } else if (kind === "cross") {
      onAdd({
        id,
        kind: "cross",
        origin: "user",
        questionKey: a,
        questionKeyB: b,
        layout: { x: 0, y: 0, w: 6, h: 10 },
      });
    } else if (kind === "text") {
      onAdd(
        asHeading
          ? {
              id,
              kind: "heading",
              origin: "user",
              title: text.trim().slice(0, 300),
              layout: { x: 0, y: 0, w: 12, h: 2 },
            }
          : {
              id,
              kind: "text",
              origin: "user",
              text: text.trim(),
              layout: { x: 0, y: 0, w: 6, h: 5 },
            },
      );
    } else if (kind === "kpi") {
      onAdd({
        id,
        kind: "kpi",
        origin: "user",
        kpi: { metric, questionKey: metric === "count" ? undefined : a },
        layout: { x: 0, y: 0, w: 3, h: 4 },
      });
    }
    setOpen(false);
    setA("");
    setB("");
    setChart("");
    setText("");
  }

  const questionSelect = (
    value: string,
    onChange: (v: string) => void,
    list: Question[],
    label: string,
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {list.map((q) => (
            <SelectItem key={q.key} value={q.key}>
              <span className="line-clamp-1">{q.title}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="add-widget">
          <Plus aria-hidden />
          {t("title")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{t("type")}</Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                setKind(v as Kind);
                setA("");
                setB("");
              }}
            >
              <SelectTrigger className="w-full" aria-label={t("type")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["question", "cross", "text", "kpi"] as const).map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`types.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {kind === "question" && (
            <>
              {questionSelect(
                a,
                (v) => {
                  setA(v);
                  setChart("");
                },
                eligible,
                t("question"),
              )}
              {qa && (
                <div className="flex flex-col gap-1.5">
                  <Label>{t("chart")}</Label>
                  <Select
                    value={chart || allowedCharts(qa.type)[0]}
                    onValueChange={(v) => setChart(v as ChartType)}
                  >
                    <SelectTrigger className="w-full" aria-label={t("chart")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {allowedCharts(qa.type).map((c) => (
                        <SelectItem key={c} value={c}>
                          {tw(`charts.${c}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}

          {kind === "cross" && (
            <>
              {questionSelect(a, setA, crossable, t("question"))}
              {questionSelect(
                b,
                setB,
                crossable.filter((q) => q.key !== a),
                t("questionB"),
              )}
            </>
          )}

          {kind === "text" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="widget-text">{t("text")}</Label>
                <Textarea
                  id="widget-text"
                  rows={4}
                  maxLength={5000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={asHeading} onCheckedChange={setAsHeading} />
                {t("asHeading")}
              </label>
            </>
          )}

          {kind === "kpi" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>{t("metric")}</Label>
                <Select
                  value={metric}
                  onValueChange={(v) => {
                    setMetric(v as typeof metric);
                    setA("");
                  }}
                >
                  <SelectTrigger className="w-full" aria-label={t("metric")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["count", "average", "nps"] as const).map((m) => (
                      <SelectItem key={m} value={m}>
                        {t(`metrics.${m}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {metric !== "count" &&
                questionSelect(a, setA, kpiSources, t("question"))}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button
            disabled={!valid}
            onClick={submit}
            data-testid="add-widget-confirm"
          >
            {t("add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
