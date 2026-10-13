"use client";

import { ErrorState } from "@/components/error-state";

// Public pages (forms, shared dashboards, login).
export default function LocaleError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState {...props} />;
}
