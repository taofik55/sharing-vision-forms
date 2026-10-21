"use client";

import { UserPlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addMemberAction,
  removeMemberAction,
  updateMemberRoleAction,
} from "@/lib/forms/actions";
import { MEMBER_ROLES } from "@/lib/forms/settings";

export type Member = {
  userId: string;
  email: string;
  fullName: string | null;
  role: "viewer" | "editor" | "surveyor";
  appRole: "admin" | "editor" | "viewer" | "surveyor";
};

type SharingCardProps = {
  formId: string;
  ownerName: string;
  members: Member[];
  canManage: boolean;
};

export function SharingCard({
  formId,
  ownerName,
  members,
  canManage,
}: SharingCardProps) {
  const t = useTranslations("formSettings");
  const te = useTranslations("formErrors");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("viewer");
  const [isPending, startTransition] = useTransition();

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    success: string,
    after?: () => void,
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(success);
        after?.();
      } else {
        toast.error(
          te((result.error ?? "generic") as Parameters<typeof te>[0]),
        );
      }
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="sharing-card">
      {canManage ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim()) return;
            run(
              () => addMemberAction({ formId, email: email.trim(), role }),
              t("memberAdded"),
              () => setEmail(""),
            );
          }}
        >
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("emailPlaceholder")}
            aria-label={t("addPerson")}
            className="flex-1"
            data-testid="member-email"
          />
          <Select
            value={role}
            onValueChange={(v) => setRole(v as Member["role"])}
          >
            <SelectTrigger
              className="w-full sm:w-40"
              aria-label={t("memberRoleLabel", { name: email || "—" })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEMBER_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {t(`memberRole.${r}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" disabled={isPending} data-testid="member-add">
            <UserPlus aria-hidden />
            {t("add")}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">{t("sharingReadOnly")}</p>
      )}

      <ul className="divide-y rounded-md border">
        <li className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="min-w-0 truncate text-sm font-medium">
            {ownerName}
          </span>
          <span className="text-sm text-muted-foreground">
            {t("ownerLabel")}
          </span>
        </li>
        {members.length === 0 && (
          <li className="px-3 py-2 text-sm text-muted-foreground">
            {t("noMembers")}
          </li>
        )}
        {members.map((m) => {
          const name = m.fullName || m.email;
          return (
            <li
              key={m.userId}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              data-testid={`member-${m.email}`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {m.email}
                </p>
                {m.appRole === "viewer" && m.role === "editor" && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {t("viewerAppRoleNote")}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Select
                  value={m.role}
                  disabled={!canManage || isPending}
                  onValueChange={(v) =>
                    run(
                      () =>
                        updateMemberRoleAction({
                          formId,
                          userId: m.userId,
                          role: v,
                        }),
                      t("memberUpdated"),
                    )
                  }
                >
                  <SelectTrigger
                    size="sm"
                    className="w-36"
                    aria-label={t("memberRoleLabel", { name })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEMBER_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {t(`memberRole.${r}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("removeLabel", { name })}
                    disabled={isPending}
                    onClick={() =>
                      run(
                        () => removeMemberAction({ formId, userId: m.userId }),
                        t("memberRemoved"),
                      )
                    }
                  >
                    <X aria-hidden />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
