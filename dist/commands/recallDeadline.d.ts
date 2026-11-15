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
 * Le rappel s'arrête donc lui-même, avant le harnais. Le plafond du hook
 * (hooks.json) doit laisser une marge pour deux choses que ce minuteur ne
 * maîtrise pas : la boucle d'événements bloquée par une étape synchrone de
 * l'inférence (0,7 s mesurées à vide, davantage sous charge), et le démarrage
 * de node avant que le minuteur existe. Un test verrouille cette marge.
 */
export declare const RECALL_DEADLINE_MS = 8000;
export interface DeadlineResult<T> {
    value: T;
    timedOut: boolean;
}
/** Le résultat du travail s'il arrive avant `ms`, sinon `fallback`. Un échec
 *  du travail rend aussi `fallback` (contrat fail-silent du rappel), mais ne
 *  compte pas comme un dépassement. */
export declare function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<DeadlineResult<T>>;
export declare function recallTimeoutLogPath(pluginDataDir: string): string;
/** Un repli silencieux sans trace est une panne qu'on ne mesure plus : chaque
 *  abandon laisse une ligne datée, pour savoir si l'échéance mord souvent. */
export declare function recordRecallTimeout(pluginDataDir: string, ms: number, now?: Date): void;
