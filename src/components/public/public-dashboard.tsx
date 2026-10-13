"use client";

import { useMemo } from "react";
import {
  DashboardView,
  type DashboardViewProps,
} from "@/components/dashboard/dashboard-view";
import { publicSource } from "@/components/dashboard/use-dashboard-data";
import { QueryProvider } from "@/components/providers/query-provider";

/** Read-only shared dashboard: data via /api/d/:token/stats, polled every 10 s. */
export function PublicDashboard({
  token,
  ...props
}: Omit<DashboardViewProps, "mode" | "source" | "canEdit"> & {
  token: string;
}) {
  const source = useMemo(() => publicSource(token), [token]);
  return (
    <QueryProvider>
      <DashboardView {...props} canEdit={false} mode="public" source={source} />
    </QueryProvider>
  );
}
