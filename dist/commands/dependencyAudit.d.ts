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
 * Générique (pas câblée sur "npm") et son timeout en paramètre explicite —
 * exportée pour être testée directement en lançant un vrai sous-processus
 * (`node -e "..."` en lieu et place d'un vrai `npm`), seul moyen de prouver
 * le piège ci-dessus sans dépendre d'un vrai `npm` installé dans
 * l'environnement de test.
 */
export declare function runCommandCapturingStdout(command: string, args: string[], cwd: string, timeoutMs?: number): Promise<string>;
export interface DependencyAuditRunner {
    runNpmAudit: (cwd: string) => Promise<string>;
    runNpmOutdated: (cwd: string) => Promise<string>;
}
/** Le vrai exécuteur, utilisé partout sauf dans les tests (qui injectent de
 *  fausses sorties — même convention DI que gitLastCommitDate/fetchImpl
 *  ailleurs dans ce dépôt). */
export declare const realDependencyAuditRunner: DependencyAuditRunner;
/**
 * Le point d'entrée appelé depuis /synapse-doctor. Best-effort de bout en
 * bout : toute défaillance (package.json illisible, npm absent, réseau
 * coupé, JSON invalide) rend `[]`, jamais une exception — cohérent avec la
 * posture documentée en tête de postCompactCli.ts : un contrôle qui tourne
 * dans un hook ne doit jamais faire échouer ni ralentir visiblement une
 * session.
 */
export declare function collectDependencyFindings(pluginRoot: string, runner?: DependencyAuditRunner): Promise<LintFinding[]>;
export {};
