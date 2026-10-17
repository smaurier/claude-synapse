/**
 * Backlog item 49 — « Synapse doit vérifier régulièrement ses propres
 * dépendances et se mettre à jour sur le stable quand c'est possible. »
 *
 * Politique approuvée (owner, avant ce travail) :
 *   - on rapporte toujours ;
 *   - seul ce qui est dev-only ET non-breaking peut un jour être appliqué
 *     automatiquement (jamais ici — voir plus bas) ;
 *   - on ne touche JAMAIS la dépendance de production sans l'owner ;
 *   - on refuse tout major, même dev-only.
 *
 * Contrainte posée avant ce travail, à ne pas redécider : le plugin installé
 * vit dans un dossier versionné par Claude Code
 * (`~/.claude/plugins/cache/synapse/synapse/<version>/`), qui porte un vrai
 * `node_modules` de ~578 Mo mais est jeté à chaque mise à jour du plugin et
 * recréé depuis zéro. Y modifier des dépendances serait inutile (la prochaine
 * mise à jour écrase le dossier) et dangereux (ça désynchroniserait l'install
 * de son propre lockfile). Le hook qui exécute ce code tourne lui-même depuis
 * cette copie installée et ne sait rien du dépôt de développement de l'owner.
 * Ce module fait donc UNIQUEMENT de la détection et du rapport. La moitié
 * "appliquer" est hors périmètre, volontairement : c'est une décision ouverte
 * de l'owner, jamais automatisée par ce fichier. Rien ici n'installe, ne
 * corrige, ni n'écrit dans node_modules ou package.json.
 *
 * Deux parties, pour rester testable malgré l'I/O :
 *  1. Un classeur pur (`auditVulnerabilities`, `auditOutdated`,
 *     `auditDependencies`) qui prend des données déjà parsées et rend des
 *     `LintFinding[]` — aucune I/O, donc testable à 100 % depuis des fixtures.
 *  2. Un exécuteur impur (`collectDependencyFindings`) qui lance
 *     `npm audit --json` / `npm outdated --json` dans le dossier racine du
 *     plugin, et traduit tout échec en "aucun signalement" plutôt qu'en erreur
 *     — même posture que documentée en tête de postCompactCli.ts : une
 *     vérification de dépendances tourne dans un hook SessionStart et ne doit
 *     jamais bloquer ni ralentir visiblement une session, ni la faire échouer.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { resolveNpmBinary } from "../config/dependencies.js";
/** Tous les noms de paquets impliqués par une entrée de vulnérabilité : le
 *  paquet lui-même, ceux dont il hérite (chaînes dans `via`) et ceux qui
 *  héritent de lui (`effects`). Utilisé pour juger si la vulnérabilité « touche
 *  une dépendance de production, ou est joignable depuis l'une d'elles » —
 *  pas seulement si le paquet vulnérable porte lui-même ce nom. */
function impliedPackageNames(name, vuln) {
    const names = new Set([name]);
    for (const via of vuln.via)
        if (typeof via === "string")
            names.add(via);
    for (const effect of vuln.effects ?? [])
        names.add(effect);
    return names;
}
function touchesProduction(names, productionDependencyNames) {
    for (const name of names)
        if (productionDependencyNames.has(name))
            return true;
    return false;
}
/**
 * La règle de classification de la spec, dans l'ordre où elle doit être
 * évaluée : la question « ça touche la production ? » prime sur tout —
 * même un correctif dev-only non-major n'est jamais automatique s'il est
 * aussi joignable depuis une dépendance de production.
 */
export function classifyVulnerability(name, vuln, productionDependencyNames) {
    if (touchesProduction(impliedPackageNames(name, vuln), productionDependencyNames))
        return "needs-owner";
    if (vuln.fixAvailable === false)
        return "no-fix";
    if (vuln.fixAvailable === true)
        return "safe-to-apply";
    return vuln.fixAvailable.isSemVerMajor ? "refused-major" : "safe-to-apply";
}
/**
 * Un rapport de vingt lignes, une par advisory, n'est lu par personne — leçon
 * tirée deux fois dans ce dépôt (voir checkWipLimit). Ici, une ligne par
 * PAQUET (pas par advisory : un même paquet peut cumuler plusieurs advisories
 * dans `via`, ça reste une seule décision à prendre), et les deux populations
 * que la politique distingue — sûr à appliquer / nécessite une décision — sont
 * comptées et nommées séparément, jamais mélangées dans une seule liste.
 */
export function auditVulnerabilities(audit, productionDependencyNames) {
    const entries = Object.entries(audit.vulnerabilities ?? {});
    if (entries.length === 0)
        return [];
    const safe = [];
    const needsOwner = [];
    const refusedMajor = [];
    const noFix = [];
    for (const [name, vuln] of entries) {
        switch (classifyVulnerability(name, vuln, productionDependencyNames)) {
            case "safe-to-apply":
                safe.push(name);
                break;
            case "needs-owner":
                needsOwner.push(name);
                break;
            case "refused-major":
                refusedMajor.push(name);
                break;
            case "no-fix":
                noFix.push(name);
                break;
        }
    }
    const decisionCount = needsOwner.length + refusedMajor.length + noFix.length;
    const decisionDetails = [];
    if (needsOwner.length > 0) {
        decisionDetails.push(`${needsOwner.length} touchent une dépendance de production (jamais automatique) : ${needsOwner.join(", ")}`);
    }
    if (refusedMajor.length > 0) {
        decisionDetails.push(`${refusedMajor.length} dev-only mais correctif majeur (refusé même dev-only par la politique) : ${refusedMajor.join(", ")}`);
    }
    if (noFix.length > 0) {
        decisionDetails.push(`${noFix.length} sans correctif disponible pour l'instant : ${noFix.join(", ")}`);
    }
    const safePart = safe.length > 0
        ? `${safe.length} sûre(s) à appliquer automatiquement (dev-only, correctif non majeur) : ${safe.join(", ")}`
        : `0 sûre(s) à appliquer automatiquement`;
    const decisionPart = decisionCount > 0
        ? `${decisionCount} nécessite(nt) une décision humaine (${decisionDetails.join(" ; ")})`
        : `0 nécessitant une décision humaine`;
    return [
        {
            path: "(corpus)",
            severity: "warning",
            message: `${entries.length} vulnérabilité(s) npm détectée(s) sur les dépendances du plugin — ${safePart} ; ${decisionPart}.`,
        },
    ];
}
const DEFAULT_MAJOR_SEGMENT_INDEX = 0;
/** Comparaison du seul numéro de major (premier segment avant le point) —
 *  suffisant pour juger "ça traverse une frontière semver", qu'il s'agisse
 *  d'une montée ou, cas vu en pratique sur un registre où `latest` peut être
 *  derrière `current` (tag `latest` pas encore avancé), d'une descente. */
function isMajorBump(current, latest) {
    const currentMajor = current.split(".")[DEFAULT_MAJOR_SEGMENT_INDEX];
    const latestMajor = latest.split(".")[DEFAULT_MAJOR_SEGMENT_INDEX];
    return currentMajor !== latestMajor;
}
/**
 * Les dépendances obsolètes mais pas vulnérables : signal plus faible qu'une
 * vulnérabilité (rien d'exploitable connu), donc délibérément plus discret —
 * une seule ligne, sans la double énumération par population de
 * `auditVulnerabilities`. La politique s'applique quand même : on nomme
 * explicitement un major (jamais automatique) et une dépendance de
 * production (jamais automatique) plutôt que de les fondre dans la liste.
 */
export function auditOutdated(outdated, productionDependencyNames, vulnerableNames) {
    const entries = Object.entries(outdated).filter(([name]) => !vulnerableNames.has(name));
    if (entries.length === 0)
        return [];
    const labelled = entries.map(([name, info]) => {
        const tags = [];
        if (touchesProduction(new Set([name]), productionDependencyNames))
            tags.push("production");
        if (isMajorBump(info.current, info.latest))
            tags.push("majeur");
        return tags.length > 0 ? `${name} (${tags.join(", ")})` : name;
    });
    return [
        {
            path: "(corpus)",
            severity: "warning",
            message: `${entries.length} dépendance(s) obsolète(s) sans vulnérabilité connue : ${labelled.join(", ")}.`,
        },
    ];
}
/** Point d'entrée pur combiné — `audit`/`outdated` à `null` quand leur
 *  exécution ou leur parsing a échoué (voir collectDependencyFindings) :
 *  traité comme "rien à en dire", jamais comme une erreur à propager. */
export function auditDependencies(audit, outdated, productionDependencyNames) {
    const vulnerabilityFindings = audit ? auditVulnerabilities(audit, productionDependencyNames) : [];
    const vulnerableNames = new Set(audit ? Object.keys(audit.vulnerabilities ?? {}) : []);
    const outdatedFindings = outdated ? auditOutdated(outdated, productionDependencyNames, vulnerableNames) : [];
    return [...vulnerabilityFindings, ...outdatedFindings];
}
// --- Exécuteur impur --------------------------------------------------------
/**
 * Quelques secondes, pas plus : ce check tourne dans le hook SessionStart
 * (timeout global 120 s, partagé avec le reste de /synapse-doctor et le
 * reste du rafraîchissement d'index) et `npm audit` interroge le registre
 * par le réseau — c'est la seule raison d'un timeout ici, pas la taille du
 * projet. 5 s laisse une vraie marge pour un aller-retour réseau normal sans
 * jamais se faire sentir sur une session.
 */
const NPM_COMMAND_TIMEOUT_MS = 5_000;
/**
 * Le piège de cette tâche : `npm audit` sort en code non-zéro dès qu'une
 * vulnérabilité existe, et `npm outdated` sort en code non-zéro dès qu'une
 * dépendance est obsolète — c'est le fonctionnement normal et documenté de
 * ces deux commandes, pas un échec. Une implémentation qui traite "code non
 * zéro" comme "échec, ne rien rapporter" ne rapporterait donc jamais rien,
 * silencieusement, pour toujours — le JSON utile est sur stdout quel que soit
 * le code de sortie, donc on l'y lit toujours, sans jamais regarder le code
 * ni laisser une erreur du process (timeout, npm absent, ENOENT) se
 * propager : on résout toujours avec ce que stdout contient (vide en cas
 * d'échec dur), jamais de rejet.
 *
 * `shell: true` est nécessaire, pas seulement pratique — mesuré le
 * 16/10/2026 : sur ce poste (Node 23.7.0), `execFile("npm.cmd", ...)` SANS
 * `shell: true` lève `EINVAL` de façon SYNCHRONE (avant même d'atteindre le
 * callback), parce que Node refuse désormais d'exécuter directement un
 * `.bat`/`.cmd` Windows sans passer par un shell (durcissement de sécurité
 * suite à CVE-2024-27980 — l'exécution directe d'un script batch pouvait
 * laisser cmd.exe réinterpréter les arguments). `resolveNpmBinary()` seul
 * (choisir `npm.cmd`) ne suffit donc pas : il faut les deux. Les arguments
 * passés ici sont toujours des constantes du code, jamais une entrée
 * utilisateur, donc `shell: true` ne rouvre aucune question d'injection —
 * c'est la même conclusion que la préférence initiale pour éviter un shell,
 * juste prouvée fausse par ce test réel sur cette version de Node.
 * Le `try`/`catch` autour de l'appel est une défense en profondeur : le
 * contrat de cette fonction est de ne JAMAIS rejeter, donc même un futur
 * throw synchrone imprévu (autre plateforme, autre version de Node) doit
 * rendre une chaîne vide plutôt que remonter jusqu'à l'appelant.
 *
 * Générique (pas câblée sur "npm") et son timeout en paramètre explicite —
 * exportée pour être testée directement en lançant un vrai sous-processus
 * (`node -e "..."` en lieu et place d'un vrai `npm`), seul moyen de prouver
 * le piège ci-dessus sans dépendre d'un vrai `npm` installé dans
 * l'environnement de test.
 */
export function runCommandCapturingStdout(command, args, cwd, timeoutMs = NPM_COMMAND_TIMEOUT_MS) {
    return new Promise((resolve) => {
        try {
            execFile(command, args, { cwd, timeout: timeoutMs, windowsHide: true, shell: true }, (_error, stdout) => {
                resolve(stdout ?? "");
            });
        }
        catch {
            resolve("");
        }
    });
}
/**
 * Mesuré le 16/10/2026 sur ce poste : `execFile("npm", ...)` rend ENOENT
 * (close code -4058) sous Windows, parce que le binaire s'appelle `npm.cmd`,
 * pas `npm`. Résoudre le bon nom reste utile même avec `shell: true` (voir
 * runCommandCapturingStdout) : `npm.cmd` explicite documente l'intention et
 * ne dépend pas de la résolution PATHEXT propre à cmd.exe. La cible
 * principale de ce dépôt EST Windows (voir le commentaire du matrix CI dans
 * .github/workflows/ci.yml), donc ce n'est pas un cas marginal : sans ce
 * correctif (et sans `shell: true`, voir plus haut), le check ne tournait
 * JAMAIS sur le poste de développement de l'owner — fail-silent qui
 * masquait un échec à 100 %, pas du tout le "rien à signaler" qu'il
 * prétendait être.
 */
export { resolveNpmBinary } from "../config/dependencies.js";
function runNpmJson(args, cwd) {
    return runCommandCapturingStdout(resolveNpmBinary(), args, cwd);
}
/** `JSON.parse` sur une sortie npm, en silence : stdout vide (npm absent,
 *  timeout, erreur process) ou tronqué/invalide rend `null`, jamais une
 *  exception qui remonterait jusqu'au hook. */
function parseNpmJsonSafely(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/** Le vrai exécuteur, utilisé partout sauf dans les tests (qui injectent de
 *  fausses sorties — même convention DI que gitLastCommitDate/fetchImpl
 *  ailleurs dans ce dépôt). */
export const realDependencyAuditRunner = {
    runNpmAudit: (cwd) => runNpmJson(["audit", "--json"], cwd),
    runNpmOutdated: (cwd) => runNpmJson(["outdated", "--json"], cwd),
};
/**
 * Lit les dépendances de production déclarées par le plugin lui-même
 * (`dependencies`, jamais `devDependencies`) depuis son propre package.json —
 * c'est la distinction production/dev de la politique, prise dans les faits,
 * jamais devinée sur un nom de paquet. Un package.json absent ou illisible
 * rend `null` : sans cette liste, aucune classification sûre n'est possible
 * (impossible de garantir qu'on ne traite pas une dépendance de production
 * comme sûre), donc mieux vaut ne rien rapporter que mal classer.
 */
function readProductionDependencyNames(pluginRoot) {
    try {
        const raw = readFileSync(join(pluginRoot, "package.json"), "utf8");
        const pkg = JSON.parse(raw);
        return new Set(Object.keys(pkg.dependencies ?? {}));
    }
    catch {
        return null;
    }
}
/**
 * Le point d'entrée appelé depuis /synapse-doctor. Best-effort de bout en
 * bout : toute défaillance (package.json illisible, npm absent, réseau
 * coupé, JSON invalide) rend `[]`, jamais une exception — cohérent avec la
 * posture documentée en tête de postCompactCli.ts : un contrôle qui tourne
 * dans un hook ne doit jamais faire échouer ni ralentir visiblement une
 * session.
 */
export async function collectDependencyFindings(pluginRoot, runner = realDependencyAuditRunner) {
    const productionDependencyNames = readProductionDependencyNames(pluginRoot);
    if (!productionDependencyNames)
        return [];
    const [auditRaw, outdatedRaw] = await Promise.all([runner.runNpmAudit(pluginRoot), runner.runNpmOutdated(pluginRoot)]);
    const audit = parseNpmJsonSafely(auditRaw);
    const outdated = parseNpmJsonSafely(outdatedRaw);
    return auditDependencies(audit, outdated, productionDependencyNames);
}
//# sourceMappingURL=dependencyAudit.js.map