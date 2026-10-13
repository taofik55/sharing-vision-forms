"use client";

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Columns3, Search, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ExportMenu } from "@/components/dashboard/export-menu";
import { FilterBar } from "@/components/dashboard/filter-bar";
import {
  supabaseBrowser,
  useStable,
} from "@/components/dashboard/use-dashboard-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { deleteResponseAction } from "@/lib/analytics/actions";
import {
  RESPONSE_SORTS,
  serializeFilters,
  toRpcFilters,
  type DashboardFilters,
  type ResponseSort,
} from "@/lib/analytics/filters";
import { OTHER_OPTION_ID, type Question } from "@/lib/forms/schema";
import { usePathname, useRouter } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils";

type Sort = ResponseSort;

type Answer = { t?: string; n?: number; d?: string; o?: string[] };
type Row = {
  id: string;
  submitted_at: string;
  version_number: number;
  duration_seconds: number | null;
  device: string | null;
  locale: string | null;
  identifier: string | null;
  answers: Record<string, Answer>;
};
type Page = {
  total: number;
  rows: Row[];
  next_cursor: { v: string; id: string } | null;
  identifiers_masked: boolean;
};

type Props = {
  formId: string;
  canDelete: boolean;
  questions: Record<string, Question>;
  /** Question keys of the current version, in order (default columns). */
  columnKeys: string[];
  versions: { id: string; number: number }[];
  initialFilters: DashboardFilters;
  initialSearch: string;
  initialSort: Sort;
};

const FIXED = [
  "submitted",
  "identifier",
  "version",
  "device",
  "language",
  "duration",
] as const;
const ROW_HEIGHT = 44;

export function ResponsesView(props: Props) {
  const t = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState(props.initialFilters);
  const [search, setSearch] = useState(props.initialSearch);
  const [debounced, setDebounced] = useState(props.initialSearch);
  const [sort, setSort] = useState<Sort>(props.initialSort);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const rpcFilters = useStable(toRpcFilters(filters));

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Keep filters, search and sort in the URL.
  useEffect(() => {
    const params = serializeFilters(filters);
    if (debounced) params.set("q", debounced);
    if (sort !== "newest") params.set("sort", sort);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [filters, debounced, sort, router, pathname]);

  const query = useInfiniteQuery({
    queryKey: ["responses", props.formId, rpcFilters, debounced, sort],
    initialPageParam: null as Page["next_cursor"],
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabaseBrowser().rpc("list_responses", {
        p_form_id: props.formId,
        p_filters: rpcFilters as never,
        p_search: debounced || undefined,
        p_sort: sort,
        p_cursor: (pageParam ?? undefined) as never,
        p_limit: 50,
      });
      if (error) throw error;
      return data as unknown as Page;
    },
    getNextPageParam: (last) => last.next_cursor,
  });

  const rows = useMemo(
    () => query.data?.pages.flatMap((p) => p.rows) ?? [],
    [query.data],
  );
  const total = query.data?.pages[0]?.total ?? 0;
  const masked = query.data?.pages[0]?.identifiers_masked ?? true;

  const optionLabel = (key: string, id: string) =>
    id === OTHER_OPTION_ID
      ? t("widgets.other")
      : (props.questions[key]?.options?.find((o) => o.id === id)?.label ?? id);
  const deviceLabel = (k: string) =>
    ["mobile", "desktop", "tablet"].includes(k)
      ? t(`devices.${k as "mobile"}`)
      : t("devices.unknown");
  const languageLabel = (k: string) =>
    k === "id" || k === "en" ? t(`languages.${k}`) : k;
  const duration = (s: number | null) =>
    s === null
      ? "—"
      : s < 60
        ? t("responsesTab.seconds", { value: s })
        : t("responsesTab.minutes", { m: Math.floor(s / 60), s: s % 60 });
  const display = (key: string, a: Answer | undefined) => {
    if (!a) return "";
    if (a.o)
      return a.o
        .map((o) =>
          o === OTHER_OPTION_ID && a.t
            ? `${optionLabel(key, o)}: ${a.t}`
            : optionLabel(key, o),
        )
        .join(", ");
    if (a.n !== undefined) return format.number(a.n);
    if (a.d)
      return format.dateTime(new Date(`${a.d}T00:00:00Z`), {
        dateStyle: "medium",
        timeZone: "UTC",
      });
    return a.t ?? "";
  };

  const fixedLabels: Record<(typeof FIXED)[number], string> = {
    submitted: t("responsesTab.submitted"),
    identifier: t("responsesTab.identifier"),
    version: t("responsesTab.version"),
    device: t("responsesTab.device"),
    language: t("responsesTab.language"),
    duration: t("responsesTab.duration"),
  };
  const columns = [
    ...FIXED.filter((c) => !hidden.has(c)).map((c) => ({
      id: c,
      label: fixedLabels[c],
      width: c === "submitted" ? 180 : c === "identifier" ? 200 : 110,
    })),
    ...props.columnKeys
      .filter((k) => !hidden.has(k))
      .map((k) => ({
        id: k,
        label: props.questions[k]?.title ?? k,
        width: 220,
      })),
  ];
  const tableWidth = columns.reduce((a, c) => a + c.width, 0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });
  const items = virtualizer.getVirtualItems();
  const lastItem = items[items.length - 1];
  useEffect(() => {
    if (
      lastItem &&
      lastItem.index >= rows.length - 5 &&
      query.hasNextPage &&
      !query.isFetchingNextPage
    ) {
      void query.fetchNextPage();
    }
  }, [lastItem, rows.length, query]);

  function cell(row: Row, column: string) {
    switch (column) {
      case "submitted":
        return format.dateTime(new Date(row.submitted_at), {
          dateStyle: "medium",
          timeStyle: "short",
        });
      case "identifier":
        return row.identifier ?? "—";
      case "version":
        return `v${row.version_number}`;
      case "device":
        return row.device ? deviceLabel(row.device) : "—";
      case "language":
        return row.locale ? languageLabel(row.locale) : "—";
      case "duration":
        return duration(row.duration_seconds);
      default:
        return display(column, row.answers[column]);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="responses-view">
      <FilterBar
        filters={filters}
        onChange={setFilters}
        questions={props.questions}
        versions={props.versions}
        showCompare={false}
        optionLabel={optionLabel}
        deviceLabel={deviceLabel}
        languageLabel={languageLabel}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            className="pl-8"
            value={search}
            placeholder={t("responsesTab.search")}
            aria-label={t("responsesTab.searchLabel")}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <SelectTrigger className="w-48" aria-label={t("responsesTab.sort")}>
            <SelectValue>{t(`responsesTab.sorts.${sort}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {RESPONSE_SORTS.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`responsesTab.sorts.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9">
              <Columns3 aria-hidden />
              {t("responsesTab.columns")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="max-h-80 w-64 overflow-auto"
          >
            {[
              ...FIXED.map((c) => ({ id: c as string, label: fixedLabels[c] })),
              ...props.columnKeys.map((k) => ({
                id: k,
                label: props.questions[k]?.title ?? k,
              })),
            ].map((c) => (
              <DropdownMenuCheckboxItem
                key={c.id}
                checked={!hidden.has(c.id)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(checked) =>
                  setHidden((h) => {
                    const next = new Set(h);
                    if (checked) next.delete(c.id);
                    else next.add(c.id);
                    return next;
                  })
                }
              >
                <span className="truncate">{c.label}</span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span
          className="ml-auto text-sm text-muted-foreground"
          data-testid="responses-count"
        >
          {t("responsesTab.count", { count: total })}
        </span>
        <ExportMenu formId={props.formId} filters={filters} />
      </div>
      {masked && (
        <p className="text-xs text-muted-foreground">
          {t("responsesTab.masked")}
        </p>
      )}

      <div
        ref={scrollRef}
        className="relative h-[min(70svh,720px)] overflow-auto rounded-md border"
        role="table"
        aria-rowcount={total}
      >
        <div style={{ width: Math.max(tableWidth, 600) }}>
          <div
            role="row"
            className="sticky top-0 z-10 flex border-b bg-muted/80 text-sm font-medium backdrop-blur"
          >
            {columns.map((c) => (
              <div
                key={c.id}
                role="columnheader"
                className="truncate px-3 py-2"
                style={{ width: c.width }}
              >
                {c.label}
              </div>
            ))}
          </div>
          {rows.length === 0 && !query.isLoading && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {t("responsesTab.empty")}
            </p>
          )}
          {query.isLoading && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {t("responsesTab.loading")}
            </p>
          )}
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {items.map((item) => {
              const row = rows[item.index];
              return (
                <button
                  key={row.id}
                  type="button"
                  role="row"
                  aria-label={t("responsesTab.open")}
                  onClick={() => setOpenId(row.id)}
                  className="absolute inset-x-0 flex border-b text-left text-sm hover:bg-muted/50"
                  style={{
                    height: ROW_HEIGHT,
                    transform: `translateY(${item.start}px)`,
                  }}
                  data-testid="response-row"
                >
                  {columns.map((c) => (
                    <span
                      key={c.id}
                      role="cell"
                      className="truncate px-3 py-2.5"
                      style={{ width: c.width }}
                      title={String(cell(row, c.id))}
                    >
                      {cell(row, c.id)}
                    </span>
                  ))}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <ResponseDrawer
        responseId={openId}
        onClose={() => setOpenId(null)}
        questions={props.questions}
        canDelete={props.canDelete}
        display={display}
        duration={duration}
        deviceLabel={deviceLabel}
        onDeleted={() => {
          setOpenId(null);
          void queryClient.invalidateQueries({
            queryKey: ["responses", props.formId],
          });
        }}
      />
    </div>
  );
}

type Detail = {
  id: string;
  form_version_id: string;
  version_number: number;
  submitted_at: string;
  duration_seconds: number | null;
  device: string | null;
  locale: string | null;
  is_demo: boolean;
  identifier_email: string | null;
  identifier_phone: string | null;
  identifiers_masked: boolean;
  answers: {
    question_key: string;
    question_type: string;
    value_text: string | null;
    value_number: number | null;
    value_date: string | null;
    value_options: string[] | null;
  }[];
};

function ResponseDrawer({
  responseId,
  onClose,
  questions,
  canDelete,
  display,
  duration,
  deviceLabel,
  onDeleted,
}: {
  responseId: string | null;
  onClose: () => void;
  questions: Record<string, Question>;
  canDelete: boolean;
  display: (key: string, a: Answer | undefined) => string;
  duration: (s: number | null) => string;
  deviceLabel: (k: string) => string;
  onDeleted: () => void;
}) {
  const t = useTranslations("responsesTab");
  const format = useFormatter();
  const [confirm, setConfirm] = useState(false);
  const { data } = useQuery({
    queryKey: ["response", responseId],
    enabled: Boolean(responseId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowser().rpc("get_response", {
        p_response_id: responseId!,
      });
      if (error) throw error;
      return data as unknown as Detail;
    },
  });
  const detail = data && data.id === responseId ? data : null;
  const answered = new Map(
    (detail?.answers ?? []).map((a) => [
      a.question_key,
      {
        t: a.value_text ?? undefined,
        n: a.value_number ?? undefined,
        d: a.value_date ?? undefined,
        o: a.value_options ?? undefined,
      } as Answer,
    ]),
  );
  // Questions of the response's version first (in order), then anything else answered.
  const keys = Array.from(
    new Set([
      ...Object.keys(questions).filter((k) => answered.has(k)),
      ...answered.keys(),
    ]),
  );

  return (
    <Sheet
      open={responseId !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <SheetContent
        className="w-full overflow-y-auto sm:max-w-lg"
        data-testid="response-drawer"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {t("detailTitle")}
            {detail?.is_demo && <Badge variant="outline">{t("demo")}</Badge>}
          </SheetTitle>
          {detail && (
            <SheetDescription>
              {t("detailMeta", {
                time: format.dateTime(new Date(detail.submitted_at), {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
                version: detail.version_number,
              })}
            </SheetDescription>
          )}
        </SheetHeader>
        {detail && (
          <div className="flex flex-col gap-4 px-4 pb-6">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {(detail.identifier_email || detail.identifier_phone) && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">
                    {t("identifier")}
                  </dt>
                  <dd data-testid="drawer-identifier">
                    {[detail.identifier_email, detail.identifier_phone]
                      .filter(Boolean)
                      .join(" · ")}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("duration")}
                </dt>
                <dd>{duration(detail.duration_seconds)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("device")}</dt>
                <dd>{detail.device ? deviceLabel(detail.device) : "—"}</dd>
              </div>
            </dl>
            <ol className="flex flex-col gap-3">
              {keys.map((key) => (
                <li key={key} className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">
                    {questions[key]?.title ?? key}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-sm whitespace-pre-line",
                      !answered.has(key) && "text-muted-foreground",
                    )}
                  >
                    {answered.has(key)
                      ? display(key, answered.get(key))
                      : t("notAnswered")}
                  </p>
                </li>
              ))}
            </ol>
            {canDelete && (
              <Button
                variant="destructive"
                onClick={() => setConfirm(true)}
                data-testid="delete-response"
              >
                <Trash2 aria-hidden />
                {t("delete")}
              </Button>
            )}
          </div>
        )}
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={t("deleteTitle")}
          description={t("deleteDescription")}
          confirmLabel={t("delete")}
          destructive
          onConfirm={async () => {
            const result = await deleteResponseAction({
              responseId: responseId!,
            });
            setConfirm(false);
            if (result.ok) {
              toast.success(t("deleted"));
              onDeleted();
            }
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
