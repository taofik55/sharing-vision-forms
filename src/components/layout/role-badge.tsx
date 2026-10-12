import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { AppRole } from "@/lib/auth/roles";

const VARIANTS = {
  admin: "default",
  editor: "secondary",
  viewer: "outline",
} as const satisfies Record<AppRole, "default" | "secondary" | "outline">;

export function RoleBadge({ role }: { role: AppRole }) {
  const t = useTranslations("roles");
  return (
    <Badge variant={VARIANTS[role]} data-testid="role-badge" data-role={role}>
      {t(role)}
    </Badge>
  );
}
