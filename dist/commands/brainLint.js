/**
 * /brain-lint (périmètre IN) — reports only, never auto-fixes or
 * auto-executes anything (a merge/split/deletion suggestion acted on
 * automatically could conflate two distinct facts in silence, worse than
 * a stale link — see project memory's own reasoning for this). Frontmatter
 * validation needs no YAML library: the convention used is a flat 2-level
 * structure (top-level keys + one nesting level under `metadata:`), simple
 * enough to hand-parse without pulling in a dependency (léger bias).
 */
import { cosineSimilarity } from "../rag/store.js";
import { chunkFile } from "../rag/chunk.js";
export function extractFrontmatter(content) {
    // Strip a leading UTF-8 BOM (U+FEFF) if present — some Windows editors/tools
    // write one, and it sits before the very first `-` the regex anchors on.
    // Left unstripped, the match below silently fails and this file becomes
    // invisible to every check that depends on this parser, not just this one.
    const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
    const match = withoutBom.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match)
        return null;
    const fields = {};
    let currentPrefix = "";
    for (const rawLine of match[1].split("\n")) {
        if (!rawLine.trim())
            continue;
        const colonIdx = rawLine.indexOf(":");
        if (colonIdx === -1)
            continue;
        const indented = /^\s/.test(rawLine);
        const key = rawLine.slice(0, colonIdx).trim();
        const value = rawLine.slice(colonIdx + 1).trim();
        if (!indented) {
            currentPrefix = value === "" ? key : "";
            if (value !== "")
                fields[key] = value;
        }
        else if (currentPrefix) {
            fields[`${currentPrefix}.${key}`] = value;
        }
    }
    return { fields };
}
const VALID_TYPES = ["user", "feedback", "project", "reference"];
/** Status alias accepted in place of a date (convention of backlog item 24). */
const EXPIRES_CLOSED = "closed";
const DIVISION_LINE_THRESHOLD = 150;
const DIVISION_SECTION_THRESHOLD = 4;
const JOURNAL_DATE_HEADER_THRESHOLD = 4;
/** One source for "this `##` heading carries a date", used both to count
 *  them (global flag) and to locate the first one (no flag). */
const DATED_HEADER_SOURCE = String.raw `^##\s.*\d{2}[/-]\d{2}([/-]\d{2,4})?`;
function isCurrentStateHeading(heading) {
    const text = heading
        .replace(/^#+\s*/, "")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase();
    return text.startsWith("etat courant");
}
/**
 * Backlog item 42 (13/10/2026): the journal heuristic counts dated sections,
 * so it kept re-flagging fiches that had already been given the very remedy
 * its message recommends ("envisager une consolidation en état courant").
 * Four fiches of a real hub were consolidated on 13/10 and all four came
 * back identical at the next run, with the total unchanged at 15 — a report
 * that cannot tell a treated fiche from an untreated one is not a work
 * queue, it is 15 lines to re-read every time.
 *
 * The head section is recognised by position, not by content: it has to come
 * before any other dated section. A "État courant" paragraph buried under
 * ten dated entries is exactly the journal shape this check is meant to
 * catch, so it must keep firing. The heading itself usually carries its own
 * date ("## État courant (au 13/10/2026)"), hence the self-exclusion when
 * looking for the first dated section.
 */
function hasConsolidatedHeadSection(content) {
    const headings = content.split("\n").filter((line) => /^##\s/.test(line));
    const headIndex = headings.findIndex(isCurrentStateHeading);
    if (headIndex === -1)
        return false;
    const datedHeader = new RegExp(DATED_HEADER_SOURCE);
    const firstOtherDated = headings.findIndex((h, i) => i !== headIndex && datedHeader.test(h));
    return firstOtherDated === -1 || headIndex < firstOtherDated;
}
/** One file's checks — frontmatter validity, expiry, and the two
 *  structural heuristics. Pure, fast, no model needed. */
export function lintFile(path, content, today = new Date()) {
    const findings = [];
    const fm = extractFrontmatter(content);
    if (!fm) {
        return [{ path, severity: "error", message: "aucun frontmatter détecté (bloc --- ... ---)." }];
    }
    if (!fm.fields.name)
        findings.push({ path, severity: "error", message: "champ `name` manquant." });
    if (!fm.fields.description)
        findings.push({ path, severity: "error", message: "champ `description` manquant." });
    const type = fm.fields["metadata.type"];
    if (!type) {
        findings.push({ path, severity: "error", message: "champ `metadata.type` manquant." });
    }
    else if (!VALID_TYPES.includes(type)) {
        findings.push({ path, severity: "error", message: `type "${type}" invalide (attendus : ${VALID_TYPES.join(", ")}).` });
    }
    else if (type === "feedback" || type === "project") {
        if (!fm.fields["metadata.created"]) {
            findings.push({ path, severity: "warning", message: "type feedback/project sans `metadata.created` (convention datée)." });
        }
        const expires = fm.fields["metadata.expires"];
        if (!expires) {
            findings.push({ path, severity: "warning", message: "type feedback/project sans `metadata.expires` (convention datée)." });
        }
        else if (expires !== "ongoing" && expires !== EXPIRES_CLOSED) {
            const expiryDate = new Date(expires);
            if (Number.isNaN(expiryDate.getTime())) {
                // Item 41: this used to be visible only as a side effect of
                // checkWipLimit counting an unparseable expiry as active. That count
                // is gone, so the defect is reported here, where the field is
                // already being validated.
                findings.push({ path, severity: "warning", message: `\`expires: ${expires}\` illisible — attendu une date ISO, \`ongoing\` ou \`${EXPIRES_CLOSED}\`.` });
            }
            else if (expiryDate < today) {
                findings.push({ path, severity: "warning", message: `\`expires\` dépassé (${expires}) — à vérifier, pas à supprimer sans confirmation.` });
            }
        }
    }
    const lineCount = content.split("\n").length;
    const sectionCount = (content.match(/^##\s/gm) ?? []).length;
    if (lineCount > DIVISION_LINE_THRESHOLD && sectionCount > DIVISION_SECTION_THRESHOLD) {
        findings.push({
            path,
            severity: "warning",
            message: `candidat division : ${lineCount} lignes, ${sectionCount} sections — heuristique longueur+structure, à confirmer manuellement.`,
        });
    }
    const dateHeaderCount = (content.match(new RegExp(DATED_HEADER_SOURCE, "gm")) ?? []).length;
    if (dateHeaderCount >= JOURNAL_DATE_HEADER_THRESHOLD && !hasConsolidatedHeadSection(content)) {
        findings.push({
            path,
            severity: "warning",
            message: `ressemble à un journal narratif (${dateHeaderCount} sections datées) — envisager une consolidation en état courant.`,
        });
    }
    return findings;
}
/**
 * Backlog item 37 (13/10/2026): the index (`MEMORY.md`) and its sub-indexes
 * (`MEMORY-dormant.md`, ...) are a table of contents, not memories — they
 * carry no frontmatter by convention. Linting them as memories produced the
 * single `[error]` of a 257-line report on a real hub, and that one fake
 * error masked the fact that no memory in the corpus had a real one.
 * Matched on the basename, so a nested index is covered too: the uppercase
 * spelling is the convention and memory slugs are lowercase kebab-case, so
 * a real memory never collides with it.
 */
function isIndexFile(path) {
    const basename = path.split("/").pop() ?? path;
    return basename === "MEMORY.md" || /^MEMORY-.+\.md$/.test(basename);
}
export function lintCorpus(files, today = new Date()) {
    return files.filter((f) => !isIndexFile(f.path)).flatMap((f) => lintFile(f.path, f.content, today));
}
const DEFAULT_WIP_LIMIT = 5;
/**
 * WIP limiter (périmètre IN) — counts `project`-type memories that carry a
 * deadline still ahead of them, and flags it as a single corpus-wide finding
 * if over the limit. Deliberately a count, not a judgment call about which
 * projects to close — that's for the user.
 *
 * Backlog item 41 (13/10/2026): it used to count every project that wasn't
 * demonstrably finished, which on a real hub read "109 mémoires project
 * actives (limite indicative : 5)" followed by all 109 paths. Unreadable,
 * therefore unactionable, and measuring three different things at once: 52
 * `ongoing` (permanent by design, they will never be closed), 38 with no
 * `expires` at all, 19 with a real future deadline. Proof that the number
 * said nothing: closing 10 fiches did not move it by a single unit, while
 * flipping 3 dormant fiches to `ongoing` took it from 106 to 109 — and a
 * limit of 5 is unreachable by construction while the 52 permanent ones are
 * in the count. Only dated deadlines count now; the other populations are
 * named in the message, and "project without `expires`" is a convention
 * defect already reported per-file by lintFile, not a workload.
 */
export function checkWipLimit(files, today = new Date(), limit = DEFAULT_WIP_LIMIT) {
    const dated = [];
    let ongoing = 0;
    let undated = 0;
    for (const f of files) {
        const fm = extractFrontmatter(f.content);
        if (fm?.fields["metadata.type"] !== "project")
            continue;
        const expires = fm.fields["metadata.expires"];
        if (!expires) {
            undated++;
        }
        else if (expires === "ongoing") {
            ongoing++;
        }
        else if (expires !== EXPIRES_CLOSED) {
            const expiryDate = new Date(expires);
            // An unreadable expiry is not a deadline anyone signed up for; lintFile
            // reports it as the convention defect it is.
            if (!Number.isNaN(expiryDate.getTime()) && expiryDate >= today)
                dated.push(f.path);
        }
    }
    if (dated.length <= limit)
        return [];
    const aside = [];
    if (ongoing > 0)
        aside.push(`${ongoing} en \`expires: ongoing\` (permanents par conception)`);
    if (undated > 0)
        aside.push(`${undated} sans \`expires\` (défaut de convention, signalé fiche par fiche)`);
    return [
        {
            path: "(corpus)",
            severity: "warning",
            message: `${dated.length} projets à échéance datée encore ouverte (limite indicative : ${limit}) — ` +
                `envisager d'en clôturer avant d'en ouvrir de nouveaux : ${dated.join(", ")}.` +
                (aside.length > 0 ? ` Hors limite : ${aside.join(", ")}.` : ""),
        },
    ];
}
/**
 * Backlog 16/08 (agentic-stack's superseded_by, refined after review): flags
 * a `metadata.superseded_by: <path>` that names a file absent from the
 * corpus — hybridSearch.ts deliberately ignores this case rather than
 * annotating a link to nothing (see applySupersession()), so this is the
 * one place it actually gets surfaced to the user. A dangling reference
 * usually means a rename/typo, or the replacement was deleted without
 * updating the pointer — worth a look, not a silent no-op forever.
 */
export function checkSupersessionReferences(files) {
    const knownPaths = new Set(files.map((f) => f.path));
    const findings = [];
    for (const f of files) {
        const target = extractFrontmatter(f.content)?.fields["metadata.superseded_by"];
        if (target && !knownPaths.has(target)) {
            findings.push({
                path: f.path,
                severity: "warning",
                message: `\`superseded_by: ${target}\` pointe vers un fichier absent du corpus — renommage/typo, ou le remplaçant a été supprimé sans mettre à jour ce champ.`,
            });
        }
    }
    return findings;
}
/**
 * Merge candidates via RAG similarity — the one check that needs a real
 * embedding model, kept separate from lintFile/lintCorpus so those stay
 * fast and model-free. embed is injected (same pattern as production.ts)
 * so this stays testable with a fake; the real wiring uses embedLocal.
 * Suggestions only, as designed — this never merges anything itself.
 *
 * Chunked before embedding — found 14/08 on the real 121-file hub: the
 * first version embedded each file's FULL raw content directly, silently
 * truncated by the model past its token window (embedLocal's own defensive
 * warning fired for every file over the limit — "shouldn't happen if the
 * text comes from chunkFileForEmbedding()", and it was happening, because
 * this function never called it). That meant merge candidates were
 * computed from only the first ~128 tokens of each file, not its real
 * content — a likely contributor to an implausibly large false-positive
 * count (3001 pairs at ≥0.85 on that corpus, including clearly unrelated
 * files). chunkFn defaults to the character heuristic (fast, no model) for
 * unit tests, matching production.ts's split; the real wiring uses
 * chunkFileForEmbedding — same token-exact chunker as everything else,
 * never a second, weaker chunking path.
 *
 * Two files are scored by the MAX similarity across any pair of their
 * chunks — "these files overlap somewhere," not "their first chunks
 * happen to be similar."
 *
 * `metadata.protected: true` (backlog 16/08, étude de marché Synapse —
 * "Von Restorff" protection, mnemoverse) excludes a file from pairing
 * entirely, before any embedding call: a deliberately singular memory
 * (a garde-fou, say) must never become a merge candidate, no matter how
 * similar its content looks to another file. Excluded upstream of
 * embedding rather than filtered from the results afterward — cheaper
 * (protected files never pay the embed cost either), and it's the only
 * way to make the guarantee unconditional rather than "unless a future
 * change filters results differently".
 */
function isProtected(content) {
    const fm = extractFrontmatter(content);
    return fm?.fields["metadata.protected"] === "true";
}
function supersessionTarget(content) {
    return extractFrontmatter(content)?.fields["metadata.superseded_by"];
}
export async function findMergeCandidates(files, embed, chunkFn = chunkFile, threshold = 0.85) {
    // NB: this function has no size guard of its own — O(n²) pairwise chunk
    // comparison, measured 16/08 at 117s for 2000 files (scripts/scale-
    // test.mjs). Real callers (runBrainLint.ts, synapseDoctor.ts) go through
    // findMergeCandidatesGuarded() below instead, which skips the comparison
    // above SharedConfig.mergeCandidatesMaxFiles. This function stays a pure
    // algorithm — the size policy belongs at the application layer, same
    // reasoning as checkWipLimit being a separate concern from lintFile.
    const eligibleFiles = files.filter((f) => !isProtected(f.content));
    // metadata.superseded_by (found redundant 16/08 by manual testing on a
    // disposable hub, not by guessing): a pair already linked that way has
    // its relationship already named and resolved — suggesting a merge on
    // top of that is noise, not a second opinion.
    const supersessionTargetByPath = new Map(eligibleFiles.map((f) => [f.path, supersessionTarget(f.content)]));
    const fileEmbeddings = await Promise.all(eligibleFiles.map(async (f) => {
        const chunks = await chunkFn(f.path, f.content);
        return { path: f.path, embeddings: await Promise.all(chunks.map((c) => embed(c.text))) };
    }));
    const candidates = [];
    for (let i = 0; i < fileEmbeddings.length; i++) {
        for (let j = i + 1; j < fileEmbeddings.length; j++) {
            const pathA = fileEmbeddings[i].path;
            const pathB = fileEmbeddings[j].path;
            if (supersessionTargetByPath.get(pathA) === pathB || supersessionTargetByPath.get(pathB) === pathA)
                continue;
            let best = 0;
            for (const eA of fileEmbeddings[i].embeddings) {
                for (const eB of fileEmbeddings[j].embeddings) {
                    const score = cosineSimilarity(eA, eB);
                    if (score > best)
                        best = score;
                }
            }
            if (best >= threshold) {
                candidates.push({ a: pathA, b: pathB, score: best });
            }
        }
    }
    return candidates.sort((a, b) => b.score - a.score);
}
/**
 * The size-guarded entrypoint real callers use instead of findMergeCandidates
 * directly. Above maxFiles, skips the O(n²) comparison entirely and reports
 * why via a corpus-wide finding — never silently returns an empty list that
 * would read as "no duplicates found" when the real answer is "not checked".
 */
export async function findMergeCandidatesGuarded(files, embed, chunkFn, maxFiles) {
    if (files.length > maxFiles) {
        return {
            mergeCandidates: [],
            findings: [
                {
                    path: "(corpus)",
                    severity: "warning",
                    message: `détection de fusion sautée : ${files.length} fichiers dépasse le seuil configuré ` +
                        `(${maxFiles}) — comparaison par paire en O(n²), mesurée à plusieurs minutes au-delà de ` +
                        `quelques milliers de fichiers, risquerait de dépasser le budget du hook. Ajuster ` +
                        `mergeCandidatesMaxFiles via /synapse-config si le temps d'attente est acceptable.`,
                },
            ],
        };
    }
    return { mergeCandidates: await findMergeCandidates(files, embed, chunkFn), findings: [] };
}
//# sourceMappingURL=brainLint.js.map