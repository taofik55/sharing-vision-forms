"use client";

import { ErrorState } from "@/components/error-state";

// Errors inside the app shell (sidebar and header stay usable).
export default function AppError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState {...props} />;
}
