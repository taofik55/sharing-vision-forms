import { DashboardSkeleton } from "@/components/loading/skeletons";
import { PublicShell } from "@/components/public/public-shell";

export default function Loading() {
  return (
    <PublicShell>
      <div className="w-full max-w-7xl">
        <DashboardSkeleton />
      </div>
    </PublicShell>
  );
}
