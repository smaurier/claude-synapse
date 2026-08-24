/**
 * Backlog 16/08 (item 8, résolu le 17/08) — the missing piece for
 * citedCodeDrift.ts: registers, on THIS machine, which local absolute
 * path a project NAME resolves to. `metadata.cites` in a memory can then
 * read `<project-name>/<relative-path>` — portable across machines,
 * because only the name travels; the path lookup happens locally.
 */
export declare function registerProjectRoot(pluginDataDir: string, name: string, absolutePath: string): void;
