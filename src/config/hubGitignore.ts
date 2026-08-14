/**
 * Ensures the hub REPO ITSELF has a .gitignore excluding what must never be
 * committed to it — the derived RAG index and the lock file (both explicitly
 * documented elsewhere as "never synced"), while leaving .synapse/config.json
 * and the future sync journal committable (they're meant to travel with the
 * hub). Not to be confused with claude-synapse's OWN .gitignore (this
 * plugin's source repo) — the hub is a separate, user-owned git repository
 * with no .gitignore of its own by default.
 *
 * Found 14/08 while building sync-brain: `git add -A` inside the hub would
 * otherwise happily stage index.sqlite and .sync-lock, exactly what
 * problème 4/3 say must stay local-only.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED_LINES = [".synapse/index.sqlite", ".synapse/*.sqlite-journal", ".synapse/.sync-lock"];

/** Idempotent: returns true if it wrote something, false if already complete. */
export function ensureHubGitignore(hubDir: string): boolean {
  const path = join(hubDir, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const existingLines = new Set(existing.split("\n").map((l) => l.trim()));
  const missing = REQUIRED_LINES.filter((line) => !existingLines.has(line));

  if (missing.length === 0) return false;

  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(path, existing + separator + missing.join("\n") + "\n", "utf8");
  return true;
}
