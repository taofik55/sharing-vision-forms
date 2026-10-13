"use client";

import { FlaskConical, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setupScaleFormAction } from "@/app/[locale]/(app)/admin/demo/scale/actions";

/** Creates the "Scale test (Demo)" form (is_demo = true) owned by this admin. */
export function SetupScaleForm() {
  const t = useTranslations("demo");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      data-testid="setup-scale-form"
      onClick={() =>
        startTransition(async () => {
          const result = await setupScaleFormAction();
          if (result.ok) router.refresh();
          else toast.error(t("errors.generic"));
        })
      }
    >
      {pending ? (
        <LoaderCircle className="animate-spin" aria-hidden />
      ) : (
        <FlaskConical aria-hidden />
      )}
      {t("setup.button")}
    </Button>
  );
}
