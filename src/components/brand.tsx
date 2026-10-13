import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Sharing Vision wordmark (public/sharing-vision.svg, 173 x 28) with the
 * product name. The visible text is the translated app name; the logo image is
 * decorative next to it.
 */
export function Brand({
  appName,
  productName,
  size = "md",
  className,
}: {
  /** Full name for screen readers (common.appName). */
  appName: string;
  /** Visible product name under the wordmark (common.productName). */
  productName: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const height = size === "sm" ? 16 : size === "lg" ? 28 : 20;
  const width = Math.round((173 / 28) * height);
  return (
    <span className={cn("inline-flex flex-col items-start gap-1", className)}>
      <Image
        src="/sharing-vision.svg"
        alt=""
        aria-hidden
        width={width}
        height={height}
        priority
        unoptimized
      />
      <span
        className={cn(
          "leading-none font-semibold tracking-tight text-foreground",
          size === "sm" ? "text-xs" : size === "lg" ? "text-base" : "text-sm",
        )}
      >
        <span className="sr-only">{appName}</span>
        <span aria-hidden>{productName}</span>
      </span>
    </span>
  );
}
