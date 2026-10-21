"use client";

import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  serializeFilters,
  type DashboardFilters,
} from "@/lib/analytics/filters";

/** CSV / XLSX download of the responses that match the current filters. */
export function ExportMenu({
  formId,
  filters,
  size = "sm",
}: {
  formId: string;
  filters: DashboardFilters;
  size?: "sm" | "default";
}) {
  const t = useTranslations("export");
  const locale = useLocale();
  const href = (format: "csv" | "xlsx", codes = false) => {
    const params = serializeFilters(filters);
    params.set("format", format);
    params.set("ui", locale);
    if (codes) params.set("codes", "1");
    return `/api/forms/${formId}/export?${params}`;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} data-testid="export-menu">
          <Download aria-hidden />
          {t("button")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t("hint")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={href("csv")} download data-testid="export-csv">
            <FileText aria-hidden />
            {t("csv")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={href("xlsx")} download data-testid="export-xlsx">
            <FileSpreadsheet aria-hidden />
            {t("xlsx")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t("codesHint")}
        </DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href={href("csv", true)} download data-testid="export-csv-codes">
            <FileText aria-hidden />
            {t("csvCodes")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={href("xlsx", true)} download data-testid="export-xlsx-codes">
            <FileSpreadsheet aria-hidden />
            {t("xlsxCodes")}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
