import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/lib/i18n/navigation";
import { FormActionsMenu, type FormActionsTarget } from "./form-actions-menu";
import { FormStatusBadge } from "./form-status-badge";

export type FormListRow = FormActionsTarget & {
  ownerName: string;
  access: "owner" | "admin" | "editor" | "viewer";
  lastResponseLabel: string | null;
  updatedLabel: string;
  versionNumber: number | null;
  hasUnpublishedChanges: boolean;
  isDemo: boolean;
};

type FormsListProps = {
  rows: FormListRow[];
  view: "table" | "cards";
  canCreate: boolean;
};

function primaryHref(row: FormListRow) {
  return row.canEdit
    ? `/forms/${row.id}/builder`
    : `/forms/${row.id}/dashboard`;
}

export function FormsList({ rows, view, canCreate }: FormsListProps) {
  const t = useTranslations("forms");

  if (view === "cards") {
    return (
      <ul
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        data-testid="forms-cards"
      >
        {rows.map((row) => (
          <li key={row.id}>
            <Card className="h-full gap-3" data-testid="form-row">
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <CardTitle className="min-w-0 text-base leading-snug">
                  <Link
                    href={primaryHref(row)}
                    className="line-clamp-2 hover:underline"
                  >
                    {row.title}
                  </Link>
                </CardTitle>
                <FormActionsMenu form={row} canCreate={canCreate} />
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                <FormStatusBadge status={row.status} />
                {row.versionNumber !== null && (
                  <Badge variant="outline">
                    {t("version", { number: row.versionNumber })}
                  </Badge>
                )}
                {row.hasUnpublishedChanges && (
                  <Badge variant="secondary">{t("unpublishedChanges")}</Badge>
                )}
                {row.isDemo && (
                  <Badge variant="outline">{t("demoBadge")}</Badge>
                )}
              </CardContent>
              <CardFooter className="mt-auto flex flex-col items-start gap-0.5 text-xs text-muted-foreground">
                <span>{t("responsesCount", { count: row.responseCount })}</span>
                <span>
                  {t("columns.lastResponse")}:{" "}
                  {row.lastResponseLabel ?? t("never")}
                </span>
                <span>
                  {t("columns.updated")}: {row.updatedLabel} · {row.ownerName}
                </span>
              </CardFooter>
            </Card>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="rounded-md border">
      <Table data-testid="forms-table">
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.title")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
            <TableHead className="text-right">
              {t("columns.responses")}
            </TableHead>
            <TableHead>{t("columns.lastResponse")}</TableHead>
            <TableHead>{t("columns.updated")}</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">{t("columns.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} data-testid="form-row">
              <TableCell className="max-w-80">
                <Link
                  href={primaryHref(row)}
                  className="block truncate font-medium hover:underline"
                >
                  {row.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {row.ownerName}
                  {row.access !== "owner" && (
                    <> · {t(`access.${row.access}`)}</>
                  )}
                </span>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1">
                  <FormStatusBadge status={row.status} />
                  {row.versionNumber !== null && (
                    <Badge variant="outline">
                      {t("version", { number: row.versionNumber })}
                    </Badge>
                  )}
                  {row.hasUnpublishedChanges && (
                    <Badge variant="secondary" title={t("unpublishedChanges")}>
                      {t("unpublishedChanges")}
                    </Badge>
                  )}
                  {row.isDemo && (
                    <Badge variant="outline">{t("demoBadge")}</Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.responseCount.toLocaleString()}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {row.lastResponseLabel ?? t("never")}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {row.updatedLabel}
              </TableCell>
              <TableCell>
                <FormActionsMenu form={row} canCreate={canCreate} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
