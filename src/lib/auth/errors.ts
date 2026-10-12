export type LoginErrorKey =
  | "invalidInput"
  | "invalidCredentials"
  | "inactive"
  | "rateLimited"
  | "emailNotConfirmed"
  | "generic";

export const LOGIN_ERROR_KEYS: readonly LoginErrorKey[] = [
  "invalidInput",
  "invalidCredentials",
  "inactive",
  "rateLimited",
  "emailNotConfirmed",
  "generic",
];

export function isLoginErrorKey(value: unknown): value is LoginErrorKey {
  return (
    typeof value === "string" &&
    (LOGIN_ERROR_KEYS as readonly string[]).includes(value)
  );
}

/** Maps a Supabase Auth error to a translated message key. Never leaks raw errors. */
export function mapAuthError(
  error: { code?: string; status?: number } | null,
): LoginErrorKey {
  if (!error) return "generic";
  switch (error.code) {
    case "invalid_credentials":
      return "invalidCredentials";
    case "user_banned":
      return "inactive";
    case "email_not_confirmed":
      return "emailNotConfirmed";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "rateLimited";
  }
  if (error.status === 429) return "rateLimited";
  if (error.status === 400) return "invalidCredentials";
  return "generic";
}
