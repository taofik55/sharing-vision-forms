"use client";

import { LayoutGrid, Search, Table2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePathname, useRouter } from "@/lib/i18n/navigation";
import {
  FORM_SCOPES,
  FORM_SORTS,
  FORM_STATUSES,
  type FormsQuery,
} from "@/lib/forms/list-query";

const ALL = "__all__";

type FormsToolbarProps = {
  query: FormsQuery;
  owners: { id: string; name: string }[];
};

/** Filters live in the URL so lists are shareable and server-rendered. */
export function FormsToolbar({ query, owners }: FormsToolbarProps) {
  const t = useTranslations("forms");
  const tStatus = useTranslations("formStatus");
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(query.q);
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function push(patch: Partial<FormsQuery>) {
    const next = { ...query, ...patch, page: patch.page ?? 1 };
    const params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
    if (next.status) params.set("status", next.status);
    if (next.owner) params.set("owner", next.owner);
    if (next.scope !== "all") params.set("scope", next.scope);
    if (next.sort !== "updated_desc") params.set("sort", next.sort);
    if (next.view !== "table") params.set("view", next.view);
    if (next.page > 1) params.set("page", String(next.page));
    if (next.demo) params.set("demo", "1");
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="forms-toolbar"
    >
      <div className="relative min-w-48 flex-1">
        <Search
          className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={search}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchLabel")}
          className="pl-8"
          onChange={(e) => {
            const value = e.target.value;
            setSearch(value);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => push({ q: value.trim() }), 300);
          }}
        />
      </div>
      <Select
        value={query.status ?? ALL}
        onValueChange={(v) =>
          push({ status: v === ALL ? null : (v as FormsQuery["status"]) })
        }
      >
        <SelectTrigger className="w-44" aria-label={t("statusFilter")}>
          {/* Explicit text so the server render is not empty before hydration. */}
          <SelectValue>
            {query.status ? tStatus(query.status) : t("anyStatus")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("anyStatus")}</SelectItem>
          {FORM_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {tStatus(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={query.scope}
        onValueChange={(v) => push({ scope: v as FormsQuery["scope"] })}
      >
        <SelectTrigger className="w-44" aria-label={t("scopeFilter")}>
          <SelectValue>{t(`scope.${query.scope}`)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {FORM_SCOPES.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`scope.${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {owners.length > 1 && (
        <Select
          value={query.owner ?? ALL}
          onValueChange={(v) => push({ owner: v === ALL ? null : v })}
        >
          <SelectTrigger className="w-44" aria-label={t("ownerFilter")}>
            <SelectValue>
              {owners.find((o) => o.id === query.owner)?.name ?? t("anyOwner")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("anyOwner")}</SelectItem>
            {owners.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select
        value={query.sort}
        onValueChange={(v) => push({ sort: v as FormsQuery["sort"] })}
      >
        <SelectTrigger className="w-48" aria-label={t("sortLabel")}>
          <SelectValue>{t(`sort.${query.sort}`)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {FORM_SORTS.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`sort.${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Switch
          checked={query.demo}
          onCheckedChange={(demo) => push({ demo })}
          data-testid="show-demo-forms"
        />
        {t("showDemo")}
      </label>
      <ToggleGroup
        type="single"
        variant="outline"
        value={query.view}
        onValueChange={(v) =>
          v && push({ view: v as FormsQuery["view"], page: query.page })
        }
        aria-label={t("view.label")}
      >
        <ToggleGroupItem value="table" aria-label={t("view.table")}>
          <Table2 aria-hidden />
        </ToggleGroupItem>
        <ToggleGroupItem value="cards" aria-label={t("view.cards")}>
          <LayoutGrid aria-hidden />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
