"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Body of route error boundaries: what happened, a retry, and a reference. */
export function ErrorState({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center"
      role="alert"
      data-testid="error-boundary"
    >
      <TriangleAlert className="size-8 text-destructive" aria-hidden />
      <h1 className="text-xl font-semibold tracking-tight">
        {t("boundaryTitle")}
      </h1>
      <p className="max-w-md text-muted-foreground">
        {t("boundaryDescription")}
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">
          {t("reference", { digest: error.digest })}
        </p>
      )}
      <Button variant="outline" onClick={reset}>
        <RotateCcw aria-hidden />
        {t("retry")}
      </Button>
    </div>
  );
}
