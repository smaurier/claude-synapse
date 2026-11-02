/**
 * Backlog item 49 — la moitié « appliquer » laissée ouverte le 16/10/2026 :
 * « veut-il une commande explicite (`/synapse-deps-update` ou équivalent) à
 * lancer DANS le dépôt de développement, qui applique le sous-ensemble sûr ? »
 * Tranché par Sylvain le 01/11/2026 : oui.
 *
 * Jamais appelé par un hook, jamais par `/synapse-doctor` — uniquement par
 * Sylvain, explicitement, via `/synapse-deps-update`, exécuté depuis le dépôt
 * de développement (le `cwd` passé ici n'est jamais `pluginRoot` au sens où le
 * reste de ce dossier l'entend : ce n'est PAS la copie installée et jetable du
 * plugin, c'est le dépôt que `npm publish`/`git push` servent réellement).
 *
 * `planSafeUpdates` (dependencyAudit.ts) décide QUOI installer — cette
 * fonction-ci ne fait QUE l'exécuter, sans dupliquer la moindre règle de
 * politique : une seule source de vérité pour « sûr à appliquer ».
 */
import { execFile } from "node:child_process";
import { resolveNpmBinary, quoteForShell, readProductionDependencyNames, parseNpmJsonSafely, planSafeUpdates, realDependencyAuditRunner } from "./dependencyAudit.js";
/**
 * Exécute le plan dans l'ordre, séquentiellement — jamais en parallèle :
 * plusieurs `npm install` concurrents sur le même `package-lock.json`
 * entreraient en conflit d'écriture. Un échec n'interrompt pas le lot : un
 * paquet qui échoue (réseau, registre, conflit de peer dependency résiduel)
 * ne doit pas priver les autres, sûrs eux aussi, de leur propre chance.
 */
export async function applySafeUpdates(updates, cwd, install) {
    const applied = [];
    const failed = [];
    for (const update of updates) {
        const ok = await install(update.name, update.version, cwd);
        (ok ? applied : failed).push(update);
    }
    return { applied, failed };
}
/**
 * Contrairement à `runCommandCapturingStdout` (dependencyAudit.ts), qui
 * ignore délibérément le code de sortie — un simple AUDIT ne doit jamais
 * échouer visiblement — cette commande-ci EST l'action : savoir si elle a
 * réussi est tout le sens de l'appel. Même protection Windows que le reste
 * de ce fichier (`shell: true` + citation manuelle des arguments, voir
 * `quoteForShell` et son commentaire dans dependencyAudit.ts) : sans elle,
 * `npm.cmd` échoue silencieusement sur un chemin avec un espace
 * (`C:\Program Files\nodejs`), exactement le piège déjà corrigé ailleurs.
 *
 * `--save-exact --save-dev` : ce dépôt épingle des versions exactes sans
 * exception (convention vérifiée dans chaque `package.json` existant) — une
 * commande qui écrirait un `^`/`~` romprait cette convention en silence à
 * la prochaine exécution.
 */
export function realInstall(name, version, cwd) {
    return new Promise((resolve) => {
        try {
            const npm = quoteForShell(resolveNpmBinary());
            const args = ["install", "--save-exact", "--save-dev", `${name}@${version}`].map(quoteForShell);
            execFile(npm, args, { cwd, windowsHide: true, shell: true, timeout: 60_000 }, (error) => {
                resolve(error === null);
            });
        }
        catch {
            resolve(false);
        }
    });
}
/**
 * Le point d'entrée appelé depuis `/synapse-deps-update`. Relit l'audit en
 * direct plutôt que de faire confiance à un rapport `/synapse-doctor`
 * potentiellement vieux de plusieurs jours (`auditCadenceDays`) : entre le
 * dernier audit et l'instant où Sylvain lance cette commande, le registre a
 * pu bouger. `productionDependencyNames` absent (package.json illisible) =
 * aucune classification sûre possible, donc plan vide plutôt que deviné —
 * même posture que `collectDependencyFindings`.
 */
export async function runDepsUpdate(cwd, runner = realDependencyAuditRunner, install = realInstall) {
    const productionDependencyNames = readProductionDependencyNames(cwd);
    if (!productionDependencyNames)
        return { plan: [], applied: [], failed: [] };
    const [auditRaw, outdatedRaw] = await Promise.all([runner.runNpmAudit(cwd), runner.runNpmOutdated(cwd)]);
    const audit = parseNpmJsonSafely(auditRaw) ?? { vulnerabilities: {} };
    const outdated = parseNpmJsonSafely(outdatedRaw) ?? {};
    const plan = planSafeUpdates(audit, outdated, productionDependencyNames);
    if (plan.length === 0)
        return { plan, applied: [], failed: [] };
    const { applied, failed } = await applySafeUpdates(plan, cwd, install);
    return { plan, applied, failed };
}
//# sourceMappingURL=depsUpdate.js.map