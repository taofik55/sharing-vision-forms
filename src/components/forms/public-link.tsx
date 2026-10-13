"use client";

import { Copy, Download, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PublicLinkProps = {
  url: string;
  /** SVG markup generated on the server by the `qrcode` package from `url`. */
  qrSvg: string;
  closed?: boolean;
};

export function PublicLink({ url, qrSvg, closed }: PublicLinkProps) {
  const t = useTranslations("publicLink");
  const qrHref = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("copied"));
    } catch {
      toast.error(url);
    }
  }

  return (
    <div
      className="flex flex-col gap-3 sm:flex-row sm:items-start"
      data-testid="public-link"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- inline data URL */}
      <img
        src={qrHref}
        alt={t("qrAlt")}
        width={128}
        height={128}
        className="rounded-md border bg-white p-1"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          {closed ? t("closedNotice") : t("description")}
        </p>
        <Input
          readOnly
          value={url}
          aria-label={t("title")}
          onFocus={(e) => e.currentTarget.select()}
          data-testid="public-url"
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={copy}>
            <Copy aria-hidden />
            {t("copy")}
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden />
              {t("open")}
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={qrHref} download="sharing-vision-form-qr.svg">
              <Download aria-hidden />
              {t("downloadQr")}
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
