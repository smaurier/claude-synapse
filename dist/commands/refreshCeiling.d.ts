/**
 * Plafond de durée du rafraîchissement de l'index (17/11/2026).
 *
 * Le délai du hook Stop (`timeout: 120`) ne tue pas un processus asynchrone :
 * rien ne bornait donc un refresh. Mesuré sur le poste pro, un refresh seul
 * prend 170 s quand le plus gros fichier du hub (693 Ko, 2 110 chunks) a
 * changé ; le défaut de 5 minutes en découle. Deux niveaux :
 *
 *  - coopératif : `stopAfter` (search.ts) rend la main entre deux chunks, ce
 *    qui est fini reste indexé, le reste attend le lancement suivant ;
 *  - forcé : `armHardStop` tue le processus si une étape synchrone (découpage
 *    d'un gros fichier, chargement du modèle) empêche le premier d'agir.
 */
export declare const DEFAULT_REFRESH_MAX_SECONDS = 300;
export declare const HARD_STOP_GRACE_MS = 60000;
export declare function refreshMaxMs(pluginDataDir: string): number;
export declare function refreshLockMaxAgeMs(maxMs: number): number;
export declare function armHardStop(maxMs: number, onStop: () => void, exit?: (code: number) => void): void;
export interface RefreshRun {
    outcome: "terminé" | "interrompu au plafond" | "arrêt forcé" | "déjà en cours" | "échec";
    durationMs: number;
    filesEmbedded: number;
    /** Le dossier de version réellement exécuté : la seule preuve de la
     *  version CHARGÉE par une session, que `installed_plugins.json` ne donne pas. */
    pluginRoot: string;
}
export declare function refreshLogPath(pluginDataDir: string): string;
export declare function recordRefreshRun(pluginDataDir: string, run: RefreshRun, now?: Date, pid?: number): void;
