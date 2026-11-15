/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/commitPathsCli.js" "${CLAUDE_PLUGIN_DATA}" -m "<message>" -- <chemin>...
 *
 * How a session commits into the hub (see commitPaths.ts). Exit 0 when every
 * named path is now in history (committed here or already by someone else),
 * 1 otherwise.
 */

import { existsSync } from "node:fs";
import { readLocalConfig, defaultLocalConfigPath } from "../config/config.js";
import { commitPaths, type CommitPathsResult } from "./commitPaths.js";

const USAGE = 'Usage: commitPathsCli <pluginDataDir> -m "<message>" -- <chemin>...';

export function parseArgs(argv: string[]): { pluginDataDir: string; message: string; paths: string[] } | null {
  const [pluginDataDir, ...rest] = argv;
  const sep = rest.indexOf("--");
  const flags = sep === -1 ? rest : rest.slice(0, sep);
  const paths = sep === -1 ? [] : rest.slice(sep + 1);
  const m = flags.indexOf("-m");
  const message = m === -1 ? undefined : flags[m + 1];
  if (!pluginDataDir || !message || paths.length === 0) return null;
  return { pluginDataDir, message, paths };
}

export function formatResult(result: CommitPathsResult): string[] {
  const lines: string[] = [];
  const short = result.commitHash?.slice(0, 7);
  switch (result.status) {
    case "committed":
      lines.push(`synapse: commité et poussé (${short}) : ${result.committed?.join(", ")}`);
      break;
    case "committed-not-pushed":
      lines.push(`synapse: commité (${short}) mais PAS poussé (le distant a divergé, résoudre à la main) : ${result.committed?.join(", ")}`);
      break;
    case "nothing-to-commit":
      lines.push("synapse: rien de nouveau à commiter pour ces chemins.");
      break;
    case "aborted-lock-held":
      lines.push(`synapse: verrou du hub toujours détenu par ${result.heldBy} après attente, rien commité. Réessayer.`);
      break;
    case "aborted-secrets-found":
      lines.push("synapse: COMMIT ANNULÉ, secret(s) potentiel(s) détecté(s), rien n'a été commité :");
      for (const [path, matches] of Object.entries(result.secretsFound ?? {})) {
        for (const match of matches) lines.push(`  ${path}:${match.line}: ${match.pattern} (${match.excerpt})`);
      }
      break;
  }
  for (const e of result.elsewhere ?? []) {
    lines.push(
      e.commit === null
        ? `  ${e.path} : aucune modification et jamais commité (chemin erroné ?)`
        : `  ${e.path} : déjà dans l'historique, dernier commit qui le touche : ${e.commit}`,
    );
  }
  return lines;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (!existsSync(defaultLocalConfigPath(args.pluginDataDir))) {
    console.error("synapse: pas initialisé sur ce poste (/synapse-init).");
    process.exitCode = 1;
    return;
  }

  try {
    const local = readLocalConfig(defaultLocalConfigPath(args.pluginDataDir));
    const result = await commitPaths(local.hubClonePath, local.machineId, args.message, args.paths);
    const ok = result.status === "committed" || result.status === "committed-not-pushed" || result.status === "nothing-to-commit";
    const unknownPath = (result.elsewhere ?? []).some((e) => e.commit === null);
    for (const line of formatResult(result)) (ok ? console.log : console.error)(line);
    if (!ok || unknownPath) process.exitCode = 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("commitPathsCli.js")) void main();
