"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

// next-themes renders an inline <script> that applies the stored theme before
// the first paint. It only has to run from the server HTML. When the provider
// renders on the client (e.g. switching language remounts the [locale]
// layout), React 19 warns about script tags, so on the client the script is
// marked as an inert data block. next-themes already sets
// suppressHydrationWarning on it, so the attribute difference is fine.
const clientScriptProps =
  typeof window === "undefined" ? undefined : { type: "application/json" };

export function ThemeProvider(
  props: ComponentProps<typeof NextThemesProvider>,
) {
  return <NextThemesProvider {...props} scriptProps={clientScriptProps} />;
}
