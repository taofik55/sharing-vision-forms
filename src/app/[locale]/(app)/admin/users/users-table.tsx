"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { APP_ROLES, isAppRole, type AppRole } from "@/lib/auth/roles";
import type { AdminActionResult } from "@/lib/users/schema";
import { setUserActiveAction, updateUserRoleAction } from "./actions";

export type UserRow = {
  id: string;
  email: string;
  fullName: string | null;
  role: AppRole;
  isActive: boolean;
  createdAtLabel: string;
  isSelf: boolean;
};

export function UsersTable({ rows }: { rows: UserRow[] }) {
  const t = useTranslations();
  const [isPending, startTransition] = useTransition();

  function run(
    action: () => Promise<AdminActionResult>,
    successMessage: string,
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast.success(successMessage);
      else toast.error(t(`adminUsers.errors.${result.error}`));
    });
  }

  return (
    <div className="rounded-md border">
      <Table data-testid="users-table">
        <TableHeader>
          <TableRow>
            <TableHead>{t("adminUsers.fullName")}</TableHead>
            <TableHead>{t("adminUsers.email")}</TableHead>
            <TableHead>{t("adminUsers.role")}</TableHead>
            <TableHead>{t("adminUsers.status")}</TableHead>
            <TableHead>{t("adminUsers.createdAt")}</TableHead>
            <TableHead className="text-right">
              {t("adminUsers.actions")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="h-24 text-center text-muted-foreground"
              >
                {t("adminUsers.empty")}
              </TableCell>
            </TableRow>
          )}
          {rows.map((row) => {
            const name = row.fullName ?? row.email;
            return (
              <TableRow key={row.id} data-testid={`user-row-${row.email}`}>
                <TableCell className="font-medium">
                  {name}
                  {row.isSelf && (
                    <Badge variant="outline" className="ml-2">
                      {t("adminUsers.you")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{row.email}</TableCell>
                <TableCell>
                  <Select
                    value={row.role}
                    disabled={row.isSelf || isPending}
                    onValueChange={(value) => {
                      if (!isAppRole(value) || value === row.role) return;
                      run(
                        () =>
                          updateUserRoleAction({ userId: row.id, role: value }),
                        t("adminUsers.toast.roleUpdated"),
                      );
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-32"
                      aria-label={t("adminUsers.changeRole", { name })}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {APP_ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {t(`roles.${role}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Badge variant={row.isActive ? "secondary" : "destructive"}>
                    {row.isActive
                      ? t("adminUsers.active")
                      : t("adminUsers.inactive")}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.createdAtLabel}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={row.isSelf || isPending}
                    onClick={() =>
                      run(
                        () =>
                          setUserActiveAction({
                            userId: row.id,
                            active: !row.isActive,
                          }),
                        row.isActive
                          ? t("adminUsers.toast.deactivated")
                          : t("adminUsers.toast.activated"),
                      )
                    }
                  >
                    {row.isActive
                      ? t("adminUsers.deactivate")
                      : t("adminUsers.activate")}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
