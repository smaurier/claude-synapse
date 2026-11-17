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
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultLocalConfigPath, readLocalConfig } from "../config/config.js";
export const DEFAULT_REFRESH_MAX_SECONDS = 300;
export const HARD_STOP_GRACE_MS = 60_000;
const LOCK_AGE_MARGIN_MS = 60_000;
const LOG_MAX_LINES = 500;
export function refreshMaxMs(pluginDataDir) {
    let configured;
    try {
        configured = readLocalConfig(defaultLocalConfigPath(pluginDataDir)).refreshMaxSeconds;
    }
    catch {
        configured = undefined;
    }
    const seconds = typeof configured === "number" && configured > 0 ? configured : DEFAULT_REFRESH_MAX_SECONDS;
    return seconds * 1000;
}
export function refreshLockMaxAgeMs(maxMs) {
    return maxMs + HARD_STOP_GRACE_MS + LOCK_AGE_MARGIN_MS;
}
export function armHardStop(maxMs, onStop, exit = (code) => process.exit(code)) {
    const timer = setTimeout(() => {
        try {
            onStop();
        }
        catch {
            // Le nettoyage est un bonus, l'arrêt ne l'est pas.
        }
        exit(0);
    }, maxMs + HARD_STOP_GRACE_MS);
    timer.unref();
}
export function refreshLogPath(pluginDataDir) {
    return join(pluginDataDir, "refresh-index.log");
}
export function recordRefreshRun(pluginDataDir, run, now = new Date(), pid = process.pid) {
    try {
        if (!existsSync(pluginDataDir))
            return;
        const path = refreshLogPath(pluginDataDir);
        const line = `${now.toISOString()} pid ${pid} ${run.outcome} ${(run.durationMs / 1000).toFixed(1)} s ${run.filesEmbedded} fichier(s) ${run.pluginRoot}\n`;
        appendFileSync(path, line, "utf8");
        const lines = readFileSync(path, "utf8").split("\n");
        if (lines.length - 1 > LOG_MAX_LINES) {
            writeFileSync(path, lines.slice(-(LOG_MAX_LINES / 2) - 1).join("\n"), "utf8");
        }
    }
    catch {
        // La trace est un bonus : elle ne doit jamais faire échouer le hook.
    }
}
//# sourceMappingURL=refreshCeiling.js.map