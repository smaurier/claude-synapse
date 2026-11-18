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
export declare const RECALL_DEADLINE_MS = 8000;
export interface DeadlineResult<T> {
    value: T;
    timedOut: boolean;
}
/** Lance `script` dans un processus node enfant, `input` en JSON sur son
 *  entrée. Rend sa sortie JSON si elle arrive avant `ms` ; sinon tue l'enfant
 *  et rend `fallback`. Un enfant qui plante ou ne répond pas un JSON rend
 *  aussi `fallback` (contrat fail-silent du rappel), sans compter comme un
 *  dépassement. */
export declare function runInChildWithDeadline<T>(script: string, input: unknown, ms: number, fallback: T): Promise<DeadlineResult<T>>;
export declare function recallTimeoutLogPath(pluginDataDir: string): string;
/** Un repli silencieux sans trace est une panne qu'on ne mesure plus : chaque
 *  abandon laisse une ligne datée, pour savoir si l'échéance mord souvent. */
export declare function recordRecallTimeout(pluginDataDir: string, ms: number, now?: Date): void;
