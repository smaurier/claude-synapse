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
import type { LintFinding } from "./brainLint.js";
export interface NpmAuditAdvisory {
    title: string;
}
/** Un élément de `via` est soit le nom d'un paquet dont dépend celui-ci
 *  (chaîne), soit le détail d'une advisory GitHub (objet). */
export type NpmAuditVia = string | NpmAuditAdvisory;
export interface NpmAuditFixAvailable {
    name: string;
    version: string;
    isSemVerMajor: boolean;
}
export interface NpmAuditVulnerability {
    severity: "critical" | "high" | "moderate" | "low";
    via: NpmAuditVia[];
    /** Paquets en aval qui héritent de cette vulnérabilité parce qu'ils
     *  dépendent de celui-ci — c'est par ce champ qu'une vulnérabilité d'un
     *  paquet dev peut quand même « être joignable » depuis un paquet de
     *  production. Absent sur certaines versions de npm — jamais supposé
     *  présent. */
    effects?: string[];
    fixAvailable: boolean | NpmAuditFixAvailable;
}
export interface NpmAuditReport {
    vulnerabilities: Record<string, NpmAuditVulnerability>;
}
export interface NpmOutdatedEntry {
    current: string;
    wanted: string;
    latest: string;
}
/** `npm outdated --json` rend `{}` (objet vide, pas un tableau) quand rien
 *  n'est obsolète. */
export type NpmOutdatedReport = Record<string, NpmOutdatedEntry>;
type VulnerabilityClassification = "needs-owner" | "safe-to-apply" | "refused-major" | "no-fix";
/**
 * La règle de classification de la spec, dans l'ordre où elle doit être
 * évaluée : la question « ça touche la production ? » prime sur tout —
 * même un correctif dev-only non-major n'est jamais automatique s'il est
 * aussi joignable depuis une dépendance de production.
 */
export declare function classifyVulnerability(name: string, vuln: NpmAuditVulnerability, productionDependencyNames: ReadonlySet<string>): VulnerabilityClassification;
/**
 * Un rapport de vingt lignes, une par advisory, n'est lu par personne — leçon
 * tirée deux fois dans ce dépôt (voir checkWipLimit). Ici, une ligne par
 * PAQUET (pas par advisory : un même paquet peut cumuler plusieurs advisories
 * dans `via`, ça reste une seule décision à prendre), et les deux populations
 * que la politique distingue — sûr à appliquer / nécessite une décision — sont
 * comptées et nommées séparément, jamais mélangées dans une seule liste.
 */
export declare function auditVulnerabilities(audit: NpmAuditReport, productionDependencyNames: ReadonlySet<string>): LintFinding[];
export interface SafeUpdate {
    name: string;
    version: string;
}
/**
 * Backlog item 49 (question laissée ouverte le 16/10, tranchée le 01/11/2026
 * par Sylvain : « oui, une commande explicite ») — le planificateur PUR du
 * sous-ensemble que la politique approuvée qualifie déjà de « sûr à
 * appliquer » (voir classifyVulnerability). Aucune seconde règle : une
 * vulnérabilité n'entre dans le plan QUE si classifyVulnerability la classe
 * "safe-to-apply", jamais une logique dupliquée qui pourrait diverger.
 *
 * Deux formes de `fixAvailable` à résoudre en une cible (nom, version) :
 *  - objet `{ name, version, isSemVerMajor }` : la cible EST cette donnée,
 *    telle quelle — `name` peut différer du paquet vulnérable lui-même (un
 *    paquet profondément transitif se corrige en montant un paquet racine,
 *    ex. `tinypool` via `vitest`).
 *  - `true` (booléen) : npm affirme qu'un correctif existe dans la plage
 *    déjà déclarée, sans donner de version — ce dépôt épingle des versions
 *    EXACTES, donc "déjà déclarée" ne laisse aucune marge ; la seule cible
 *    exploitable est `outdated[name].latest`, seulement si ce paquet
 *    apparaît dans `npm outdated` ET que ce n'est pas un saut majeur. Sans
 *    ces deux conditions, aucune cible sûre n'est déductible : ignoré, pas
 *    deviné.
 *
 * Dédupliqué par nom de cible (`Map`) : plusieurs vulnérabilités distinctes
 * peuvent se résoudre par le même paquet racine, une seule installation
 * suffit. Trié pour un ordre déterministe, pas celui de `Object.entries`.
 */
export declare function planSafeUpdates(audit: NpmAuditReport, outdated: NpmOutdatedReport, productionDependencyNames: ReadonlySet<string>): SafeUpdate[];
/**
 * Les dépendances obsolètes mais pas vulnérables : signal plus faible qu'une
 * vulnérabilité (rien d'exploitable connu), donc délibérément plus discret —
 * une seule ligne, sans la double énumération par population de
 * `auditVulnerabilities`. La politique s'applique quand même : on nomme
 * explicitement un major (jamais automatique) et une dépendance de
 * production (jamais automatique) plutôt que de les fondre dans la liste.
 */
export declare function auditOutdated(outdated: NpmOutdatedReport, productionDependencyNames: ReadonlySet<string>, vulnerableNames: ReadonlySet<string>): LintFinding[];
/** Point d'entrée pur combiné — `audit`/`outdated` à `null` quand leur
 *  exécution ou leur parsing a échoué (voir collectDependencyFindings) :
 *  traité comme "rien à en dire", jamais comme une erreur à propager. */
export declare function auditDependencies(audit: NpmAuditReport | null, outdated: NpmOutdatedReport | null, productionDependencyNames: ReadonlySet<string>): LintFinding[];
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
/**
 * `shell: true` est indispensable pour atteindre un `.cmd` sous Windows, mais il
 * concatene la commande et les arguments SANS les echapper : un chemin qui
 * contient un blanc est coupe au premier espace. Mesure du 29/10/2026 sur un
 * poste Windows ordinaire, ou Node vit dans `C:\Program Files\nodejs` : cmd.exe
 * repond « 'C:\Program' n'est pas reconnu » et stdout revient VIDE. Comme cette
 * fonction resout sur stdout sans regarder l'erreur, l'appelant recoit un
 * silence qu'il lit comme « rien a signaler » : le meme echec silencieux que le
 * commentaire de `resolveNpmBinary` plus bas dit avoir corrige, revenu par une
 * autre porte. La CI ne pouvait pas l'attraper : sur `windows-latest`, Node est
 * installe dans `C:\hostedtoolcache`, sans espace.
 */
export declare function quoteForShell(token: string): string;
export declare function runCommandCapturingStdout(command: string, args: string[], cwd: string, timeoutMs?: number): Promise<string>;
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
/** `JSON.parse` sur une sortie npm, en silence : stdout vide (npm absent,
 *  timeout, erreur process) ou tronqué/invalide rend `null`, jamais une
 *  exception qui remonterait jusqu'au hook. */
export declare function parseNpmJsonSafely<T>(raw: string): T | null;
export interface DependencyAuditRunner {
    runNpmAudit: (cwd: string) => Promise<string>;
    runNpmOutdated: (cwd: string) => Promise<string>;
}
/** Le vrai exécuteur, utilisé partout sauf dans les tests (qui injectent de
 *  fausses sorties — même convention DI que gitLastCommitDate/fetchImpl
 *  ailleurs dans ce dépôt). */
export declare const realDependencyAuditRunner: DependencyAuditRunner;
/**
 * Lit les dépendances de production déclarées par le plugin lui-même
 * (`dependencies`, jamais `devDependencies`) depuis son propre package.json —
 * c'est la distinction production/dev de la politique, prise dans les faits,
 * jamais devinée sur un nom de paquet. Un package.json absent ou illisible
 * rend `null` : sans cette liste, aucune classification sûre n'est possible
 * (impossible de garantir qu'on ne traite pas une dépendance de production
 * comme sûre), donc mieux vaut ne rien rapporter que mal classer.
 */
export declare function readProductionDependencyNames(pluginRoot: string): Set<string> | null;
/**
 * Le point d'entrée appelé depuis /synapse-doctor. Best-effort de bout en
 * bout : toute défaillance (package.json illisible, npm absent, réseau
 * coupé, JSON invalide) rend `[]`, jamais une exception — cohérent avec la
 * posture documentée en tête de postCompactCli.ts : un contrôle qui tourne
 * dans un hook ne doit jamais faire échouer ni ralentir visiblement une
 * session.
 */
export declare function collectDependencyFindings(pluginRoot: string, runner?: DependencyAuditRunner): Promise<LintFinding[]>;
