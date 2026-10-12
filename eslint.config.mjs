import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    // The secret key may only be read in src/lib/supabase/admin.ts.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/supabase/admin.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='SUPABASE_SECRET_KEY']",
          message:
            "SUPABASE_SECRET_KEY may only be used in src/lib/supabase/admin.ts.",
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    "src/types/database.ts",
    "supabase/.temp/**",
  ]),
]);

export default eslintConfig;
