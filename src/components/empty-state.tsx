import type { ReactNode } from "react";

type EmptyStateProps = {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center"
      data-testid="empty-state"
    >
      <div className="rounded-full bg-muted p-3 text-muted-foreground">
        {icon}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}
