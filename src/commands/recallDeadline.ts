/**
 * Échéance interne du rappel proactif (UserPromptSubmit).
 *
 * 15/11/2026 : 159 annulations du hook relevées dans les transcripts du poste
 * pro, entre 15,4 et 24,6 s pour un plafond de 15 s. Le rappel prend ~3 s à
 * vide (démarrage de node, chargement du modèle, inférence), mais plusieurs
 * sessions ouvertes et leurs reconstructions asynchrones (hook Stop) se
 * disputent le CPU. Le contrat « le rappel ne bloque jamais la session »
 * reposait sur un travail fini à temps ; quand il ne l'était pas, c'est le
 * harnais qui tuait le processus, et l'utilisateur voyait une ligne rouge.
 *
 * Le rappel s'arrête donc lui-même, avant le harnais.
 *
 * 18/11/2026 : ça ne tenait pas sous charge. CPU saturé, le rappel 0.1.13 à
 * 0.1.16 prenait 21 à 31 s et finissait même son travail : le minuteur vivait
 * dans le fil qui travaillait, et la construction du tokenizer (1 s à vide),
 * la session ONNX, le parcours de l'index et l'import de transformers.js sont
 * synchrones. Tant qu'ils tournent, aucun minuteur ne part. Le travail passe
 * donc dans un processus enfant : le hook ne fait qu'attendre, son minuteur
 * part à l'heure. Un processus et pas un worker thread : à la sortie, node
 * attend un worker coincé dans un appel natif (chargement du modèle ONNX,
 * lecture SQLite), alors qu'un enfant se tue sur-le-champ. Le plafond du hook
 * (hooks.json) garde une marge pour le démarrage de node avant que le
 * minuteur existe ; un test la verrouille.
 */

import { spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const RECALL_DEADLINE_MS = 8000;

export interface DeadlineResult<T> {
  value: T;
  timedOut: boolean;
}

/** Lance `script` dans un processus node enfant, `input` en JSON sur son
 *  entrée. Rend sa sortie JSON si elle arrive avant `ms` ; sinon tue l'enfant
 *  et rend `fallback`. Un enfant qui plante ou ne répond pas un JSON rend
 *  aussi `fallback` (contrat fail-silent du rappel), sans compter comme un
 *  dépassement. */
export function runInChildWithDeadline<T>(script: string, input: unknown, ms: number, fallback: T): Promise<DeadlineResult<T>> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    let settled = false;
    const settle = (result: DeadlineResult<T>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(result);
    };
    const timer = setTimeout(() => settle({ value: fallback, timedOut: true }), ms);
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.on("error", () => settle({ value: fallback, timedOut: false }));
    child.on("close", () => {
      try {
        settle({ value: JSON.parse(output) as T, timedOut: false });
      } catch {
        settle({ value: fallback, timedOut: false });
      }
    });
    child.stdin.on("error", () => {}); // a child that dies early closes its stdin under our feet
    child.stdin.end(JSON.stringify(input));
  });
}

export function recallTimeoutLogPath(pluginDataDir: string): string {
  return join(pluginDataDir, "recall-timeouts.log");
}

/** Un repli silencieux sans trace est une panne qu'on ne mesure plus : chaque
 *  abandon laisse une ligne datée, pour savoir si l'échéance mord souvent. */
export function recordRecallTimeout(pluginDataDir: string, ms: number, now: Date = new Date()): void {
  try {
    if (!existsSync(pluginDataDir)) return;
    appendFileSync(recallTimeoutLogPath(pluginDataDir), `${now.toISOString()} rappel abandonné après ${ms} ms\n`, "utf8");
  } catch {
    // La trace est un bonus : elle ne doit jamais faire échouer le hook.
  }
}
