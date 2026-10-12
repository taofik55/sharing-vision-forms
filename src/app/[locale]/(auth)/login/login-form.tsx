"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LoginErrorKey } from "@/lib/auth/errors";
import { signIn, type LoginState } from "./actions";

type LoginFormProps = {
  next: string;
  initialError: LoginErrorKey | null;
  signedOut: boolean;
};

export function LoginForm({ next, initialError, signedOut }: LoginFormProps) {
  const t = useTranslations("auth");
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(
    signIn,
    {
      error: initialError,
      email: "",
    },
  );

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.error ? (
        <Alert variant="destructive" role="alert" data-testid="login-error">
          <CircleAlert aria-hidden />
          <AlertDescription>{t(`errors.${state.error}`)}</AlertDescription>
        </Alert>
      ) : signedOut ? (
        <Alert role="status">
          <CircleCheck aria-hidden />
          <AlertDescription>{t("signedOut")}</AlertDescription>
        </Alert>
      ) : null}

      <input type="hidden" name="next" value={next} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          aria-invalid={state.error === "invalidInput" || undefined}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
