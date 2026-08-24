/**
 * /brain-new <type> <nom> — scaffolds a new memory file with the frontmatter
 * convention already established by the private system's memory files
 * (name/description/metadata.type, feedback+project get created/expires
 * per ~/.claude/CLAUDE.md's dated-memory convention). Content body is left
 * for the caller (Claude, via the skill) to fill in — this only guarantees
 * a syntactically valid, conventionally-shaped starting file so nobody
 * hand-rolls frontmatter and gets it subtly wrong.
 */
export declare const MEMORY_TYPES: readonly ["user", "feedback", "project", "reference"];
export type MemoryType = (typeof MEMORY_TYPES)[number];
export interface BrainNewResult {
    path: string;
    slug: string;
}
export declare function createMemoryFile(hubClonePath: string, type: MemoryType, name: string): BrainNewResult;
