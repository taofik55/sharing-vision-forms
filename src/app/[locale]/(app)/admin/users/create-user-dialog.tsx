"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { APP_ROLES } from "@/lib/auth/roles";
import { createUserSchema, type CreateUserInput } from "@/lib/users/schema";
import { createUserAction } from "./actions";

const DEFAULT_VALUES: CreateUserInput = {
  email: "",
  fullName: "",
  role: "viewer",
  password: "",
};

export function CreateUserDialog() {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: DEFAULT_VALUES,
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await createUserAction(values);
      if (result.ok) {
        toast.success(t("adminUsers.toast.created"));
        form.reset(DEFAULT_VALUES);
        setOpen(false);
      } else {
        toast.error(t(`adminUsers.errors.${result.error}`));
      }
    });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset(DEFAULT_VALUES);
      }}
    >
      <DialogTrigger asChild>
        <Button data-testid="create-user">
          <UserPlus aria-hidden />
          {t("adminUsers.createUser")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("adminUsers.createTitle")}</DialogTitle>
          <DialogDescription>
            {t("adminUsers.createDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            id="fullName"
            label={t("adminUsers.fullName")}
            error={errors.fullName && t("adminUsers.validation.fullName")}
          >
            <Input
              id="fullName"
              autoComplete="off"
              aria-invalid={!!errors.fullName}
              {...form.register("fullName")}
            />
          </Field>
          <Field
            id="email"
            label={t("adminUsers.email")}
            error={errors.email && t("adminUsers.validation.email")}
          >
            <Input
              id="email"
              type="email"
              autoComplete="off"
              aria-invalid={!!errors.email}
              {...form.register("email")}
            />
          </Field>
          <Field
            id="role"
            label={t("adminUsers.role")}
            error={errors.role && t("adminUsers.validation.role")}
          >
            <Controller
              control={form.control}
              name="role"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APP_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {t(`roles.${role}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field
            id="password"
            label={t("adminUsers.password")}
            error={errors.password && t("adminUsers.validation.password")}
          >
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              {...form.register("password")}
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? t("adminUsers.creating") : t("adminUsers.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string | false;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
