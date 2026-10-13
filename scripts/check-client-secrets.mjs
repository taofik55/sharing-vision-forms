/**
 * Proves that server secrets never reach the browser:
 *   pnpm build && pnpm check:secrets
 *
 * Scans everything a browser can download from a production build
 * (.next/static and the prerendered HTML / RSC payloads) for the VALUES of
 * SUPABASE_SECRET_KEY and IP_HASH_SALT and for their names / any sb_secret_ key. Exits with code 1 on any hit.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(".next");
if (!existsSync(path.join(root, "static"))) {
  console.error("No production build found. Run `pnpm build` first.");
  process.exit(1);
}

const needles = [
  {
    label: "SUPABASE_SECRET_KEY value",
    value: process.env.SUPABASE_SECRET_KEY,
  },
  { label: "IP_HASH_SALT value", value: process.env.IP_HASH_SALT },
  { label: "name SUPABASE_SECRET_KEY", value: "SUPABASE_SECRET_KEY" },
  { label: "name IP_HASH_SALT", value: "IP_HASH_SALT" },
].filter((n) => n.value && n.value.length >= 8);
// Any secret key, not just this project's (supabase-js itself contains the
// bare prefix in a startsWith() check, so only a prefix plus key text counts).
const secretKeyPattern = /sb_secret_[A-Za-z0-9_-]{8,}/;

if (!process.env.SUPABASE_SECRET_KEY || !process.env.IP_HASH_SALT) {
  console.warn(
    "SUPABASE_SECRET_KEY / IP_HASH_SALT not set: only names and prefixes are checked.",
  );
}

function* files(dir, filter) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* files(full, filter);
    else if (filter(full)) yield full;
  }
}

const clientFiles = [
  ...files(path.join(root, "static"), () => true),
  ...(existsSync(path.join(root, "server"))
    ? files(path.join(root, "server"), (f) => /\.(html|rsc|body)$/.test(f))
    : []),
];

let hits = 0;
for (const file of clientFiles) {
  const content = readFileSync(file, "utf8");
  for (const needle of needles) {
    if (content.includes(needle.value)) {
      hits += 1;
      console.error(
        `LEAK: ${needle.label} in ${path.relative(process.cwd(), file)}`,
      );
    }
  }
  if (secretKeyPattern.test(content)) {
    hits += 1;
    console.error(
      `LEAK: a secret key (sb_secret_...) in ${path.relative(process.cwd(), file)}`,
    );
  }
}

console.log(
  `Scanned ${clientFiles.length} client-reachable files for ${needles.length} patterns.`,
);
if (hits) {
  console.error(`${hits} leak(s) found.`);
  process.exit(1);
}
console.log("No server secrets in client bundles.");
