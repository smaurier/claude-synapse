/**
 * /brain-new <type> <nom> — scaffolds a new memory file with the frontmatter
 * convention already established by the private system's memory files
 * (name/description/metadata.type, feedback+project get created/expires
 * per ~/.claude/CLAUDE.md's dated-memory convention). Content body is left
 * for the caller (Claude, via the skill) to fill in — this only guarantees
 * a syntactically valid, conventionally-shaped starting file so nobody
 * hand-rolls frontmatter and gets it subtly wrong.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCorpusRoot } from "../config/config.js";
export const MEMORY_TYPES = ["user", "feedback", "project", "reference"];
function todayIso() {
    return new Date().toISOString().slice(0, 10);
}
function slugify(name) {
    return name
        .toLowerCase()
        .normalize("NFD")
        .replace(new RegExp("[̀-ͯ]", "g"), "") // strip accents (combining diacritical marks block)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
export function createMemoryFile(hubClonePath, type, name) {
    if (!MEMORY_TYPES.includes(type)) {
        throw new Error(`synapse: type "${type}" invalide. Types valides : ${MEMORY_TYPES.join(", ")}.`);
    }
    const slug = slugify(name);
    if (!slug) {
        throw new Error(`synapse: nom "${name}" ne produit aucun slug valide.`);
    }
    // A hub whose SharedConfig.corpusRoot narrows the RAG scan to a
    // subdirectory (e.g. non-memory material at the hub root) must get new
    // memories written *inside* that subdirectory — otherwise they're
    // invisible to search/lint despite looking like they were created fine.
    const corpusRoot = resolveCorpusRoot(hubClonePath);
    const path = join(corpusRoot, `${slug}.md`);
    if (existsSync(path)) {
        throw new Error(`synapse: "${path}" existe déjà — choisir un autre nom ou éditer le fichier existant.`);
    }
    const datedFields = type === "feedback" || type === "project" ? `\n  created: ${todayIso()}\n  expires: ongoing` : "";
    const content = `---
name: ${slug}
description: TODO — une ligne, utilisée pour décider de la pertinence au recall
metadata:
  type: ${type}${datedFields}
---

TODO
`;
    mkdirSync(corpusRoot, { recursive: true });
    writeFileSync(path, content, "utf8");
    return { path, slug };
}
//# sourceMappingURL=brainNew.js.map