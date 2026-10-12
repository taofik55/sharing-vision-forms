"use client";

import { Monitor, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormRenderer } from "@/components/renderer/form-renderer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { FormDefinition } from "@/lib/forms/schema";
import { cn } from "@/lib/utils";

type PreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definition: FormDefinition;
  title: string;
  description: string | null;
  thankYouMessage: string | null;
};

/** Renders the REAL FormRenderer in preview mode inside a desktop or phone frame. */
export function PreviewDialog({
  open,
  onOpenChange,
  definition,
  title,
  description,
  thankYouMessage,
}: PreviewDialogProps) {
  const t = useTranslations("builder.previewDialog");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[95svh] max-w-[calc(100%-1rem)] flex-col gap-3 sm:max-w-5xl">
        <DialogHeader className="flex-row flex-wrap items-center justify-between gap-2 pr-8">
          <div>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("notice")}</DialogDescription>
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            value={device}
            onValueChange={(v) => v && setDevice(v as "desktop" | "mobile")}
            aria-label={t("title")}
          >
            <ToggleGroupItem
              value="desktop"
              aria-label={t("desktop")}
              data-testid="preview-desktop"
            >
              <Monitor aria-hidden />
              <span className="hidden sm:inline">{t("desktop")}</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="mobile"
              aria-label={t("mobile")}
              data-testid="preview-mobile"
            >
              <Smartphone aria-hidden />
              <span className="hidden sm:inline">{t("mobile")}</span>
            </ToggleGroupItem>
          </ToggleGroup>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 justify-center overflow-hidden rounded-md bg-muted/50">
          <div
            className={cn(
              "overflow-y-auto bg-background",
              device === "mobile"
                ? "my-4 h-[min(780px,calc(100%-2rem))] w-[390px] max-w-full rounded-[2rem] border-8 border-neutral-800 p-3 shadow-xl"
                : "h-full w-full p-4 sm:p-8",
            )}
            data-testid={`preview-frame-${device}`}
          >
            <FormRenderer
              mode="preview"
              definition={definition}
              title={title}
              description={description}
              thankYouMessage={thankYouMessage}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
