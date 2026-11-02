/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/depsUpdateCli.js" "${CLAUDE_PROJECT_DIR}"
 *
 * Contrairement à la quasi-totalité des autres *Cli.ts de ce dossier, ceci ne
 * prend JAMAIS `${CLAUDE_PLUGIN_DATA}`/`${CLAUDE_PLUGIN_ROOT}` comme cible —
 * cette commande agit sur le dépôt de DÉVELOPPEMENT (là où vivent
 * package.json, src/, les commits), jamais sur la copie installée et
 * jetable du plugin. `${CLAUDE_PROJECT_DIR}` est le bon candidat parce que
 * cette commande n'a de sens que lancée par Sylvain pendant qu'il travaille
 * sur ce dépôt — jamais depuis un hook, jamais depuis un hub quelconque.
 *
 * Garde avant toute action : `package.json.name` doit valoir
 * "claude-synapse". Sans ça, un appel depuis le mauvais répertoire de
 * travail écrirait dans le package.json d'un projet sans rapport — un
 * `--save-exact --save-dev` sur un dépôt qu'on ne voulait pas toucher.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runDepsUpdate } from "./depsUpdate.js";

async function main(): Promise<void> {
  const [projectDir] = process.argv.slice(2);

  if (!projectDir) {
    console.error("Usage: depsUpdateCli <projectDir>");
    process.exitCode = 1;
    return;
  }

  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8")) as { name?: string };
    if (pkg.name !== "claude-synapse") {
      console.error(`synapse: "${projectDir}" ne ressemble pas au dépôt claude-synapse (package.json.name = "${pkg.name ?? "?"}") — rien fait, par sécurité.`);
      process.exitCode = 1;
      return;
    }
  } catch (err) {
    console.error(`synapse: impossible de lire package.json dans "${projectDir}" — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const result = await runDepsUpdate(projectDir);

  if (result.plan.length === 0) {
    console.log("synapse: rien à appliquer — aucune vulnérabilité sûre à corriger automatiquement en ce moment.");
    return;
  }

  console.log(`synapse: ${result.plan.length} paquet(s) planifié(s) : ${result.plan.map((u) => `${u.name}@${u.version}`).join(", ")}`);
  if (result.applied.length > 0) {
    console.log(`  appliqué(s) : ${result.applied.map((u) => `${u.name}@${u.version}`).join(", ")}`);
  }
  if (result.failed.length > 0) {
    console.log(`  échec(s), rien appliqué pour ceux-ci : ${result.failed.map((u) => `${u.name}@${u.version}`).join(", ")}`);
    process.exitCode = 1;
  }
}

void main();
