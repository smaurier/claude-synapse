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

const EXCLUDED = new Set([
  // This script's own fixtures/denylist necessarily NAME what they
  // search for — scanning them would always self-flag.
  "src/security/personalDataScan.ts",
  "tests/personalDataScan.test.ts",
  "scripts/check-no-personal-data.mjs",
  // The maintainer's real name in the copyright line is intentional, not
  // a leak — confirmed explicitly (16/08): the public identity is
  // already de-anonymized via a linked LinkedIn profile, so hiding it
  // here specifically would protect nothing. Everywhere else in the repo
  // (comments, code, commit history) still avoids naming them directly —
  // this is the one deliberate, narrow exception, not a loophole.
  "LICENSE",
]);

const trackedFiles = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !EXCLUDED.has(f))
  // dist/ is committed (decided 24/08 — plain `git clone` installs need
  // compiled JS present, see .gitignore) but it's build output mirroring
  // src/, already scanned above with its own EXCLUDED entries. Scanning
  // dist/ too is pure redundancy AND reopens exactly the self-reference
  // problem those entries exist to prevent: dist/security/personalDataScan.js
  // is the compiled form of the one file whose whole job is to NAME what
  // it searches for.
  .filter((f) => !f.startsWith("dist/"));

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
