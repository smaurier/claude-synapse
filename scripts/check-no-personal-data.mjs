// Backlog 16/08 (étude de marché Synapse) — the automated, repeatable
// replacement for the pre-first-push "revue anti-données-perso" (14/08),
// which was a one-time targeted grep, never a full re-read (per project
// memory). Scans every git-TRACKED file (not the whole working tree —
// build output, node_modules, etc. aren't the target and would just add
// noise) for src/security/personalDataScan.ts's denylist. Same shape as
// scale-test.mjs: measures real compiled code (dist/), not a
// reimplementation, run manually or from CI.
//
// Usage: node scripts/check-no-personal-data.mjs
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { scanFilesForPersonalData } from "../dist/security/personalDataScan.js";

const trackedFiles = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  // This script's own fixtures/denylist necessarily NAME what they
  // search for — scanning them would always self-flag.
  .filter((f) => f !== "src/security/personalDataScan.ts" && f !== "tests/personalDataScan.test.ts" && f !== "scripts/check-no-personal-data.mjs");

const files = trackedFiles.map((path) => {
  try {
    return { path, content: readFileSync(path, "utf8") };
  } catch {
    return { path, content: "" }; // binary/unreadable — nothing to scan as text
  }
});

const result = scanFilesForPersonalData(files);
const paths = Object.keys(result);

if (paths.length === 0) {
  console.log(`synapse: rien à signaler (${files.length} fichiers suivis par git).`);
  process.exit(0);
}

console.error(`synapse: donnée(s) personnelle(s) trouvée(s) dans ${paths.length} fichier(s) :`);
for (const path of paths) {
  for (const m of result[path]) {
    console.error(`  [${m.pattern}] ${path}:${m.line} — ${m.excerpt}`);
  }
}
process.exit(1);
