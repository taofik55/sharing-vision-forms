import "server-only";
import QRCode from "qrcode";
import type { Locale } from "@/lib/i18n/routing";

export function publicFormUrl(slug: string, locale: Locale): string {
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ).replace(/\/+$/, "");
  return `${base}/${locale}/f/${encodeURIComponent(slug)}`;
}

/** QR code as SVG markup (rendered on the server, no client library). */
export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    margin: 1,
    width: 256,
    errorCorrectionLevel: "M",
  });
}
