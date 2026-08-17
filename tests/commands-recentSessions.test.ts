import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSessionTitle, findRecentSessions } from "../src/commands/recentSessions.js";

// Backlog 16/08 (étude de marché Synapse — remplace l'idée initiale
// "indexer tout l'historique des sessions" par une version dégradée : un
// simple répertoire dates/postes/titres, pas une indexation sémantique.
// Répond à l'angoisse vécue le jour même de la conception ("est-ce que
// c'est encore là ?") sans le chantier lourd d'un vrai mineur de
// transcripts.

describe("parseSessionTitle", () => {
  it("extracts the aiTitle from an ai-title line", () => {
    const content = [
      '{"type":"last-prompt","sessionId":"a"}',
      '{"type":"ai-title","aiTitle":"Étude de marché Synapse","sessionId":"a"}',
    ].join("\n");
    expect(parseSessionTitle(content)).toBe("Étude de marché Synapse");
  });

  it("takes the LAST ai-title when the title was updated more than once", () => {
    const content = [
      '{"type":"ai-title","aiTitle":"Premier titre, encore flou","sessionId":"a"}',
      '{"type":"user"}',
      '{"type":"ai-title","aiTitle":"Titre final, plus précis","sessionId":"a"}',
    ].join("\n");
    expect(parseSessionTitle(content)).toBe("Titre final, plus précis");
  });

  it("returns null when there is no ai-title line at all", () => {
    const content = ['{"type":"last-prompt","sessionId":"a"}', '{"type":"mode","mode":"normal"}'].join("\n");
    expect(parseSessionTitle(content)).toBeNull();
  });

  it("skips malformed JSON lines rather than throwing", () => {
    const content = ["not json at all", '{"type":"ai-title","aiTitle":"Titre valide","sessionId":"a"}', "{broken"].join(
      "\n",
    );
    expect(parseSessionTitle(content)).toBe("Titre valide");
  });

  it("ignores blank lines", () => {
    const content = ["", '{"type":"ai-title","aiTitle":"Titre","sessionId":"a"}', ""].join("\n");
    expect(parseSessionTitle(content)).toBe("Titre");
  });
});

describe("findRecentSessions", () => {
  let projectsDir: string;

  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), "synapse-sessions-"));
  });

  afterEach(() => {
    rmSync(projectsDir, { recursive: true, force: true });
  });

  function writeSession(slug: string, sessionId: string, content: string, mtime: Date): void {
    const dir = join(projectsDir, slug);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${sessionId}.jsonl`);
    writeFileSync(file, content, "utf8");
    utimesSync(file, mtime, mtime);
  }

  it("lists sessions across every project slug, most recent first", () => {
    writeSession("slug-a", "session-old", '{"type":"ai-title","aiTitle":"Vieille session"}', new Date("2026-08-01"));
    writeSession("slug-b", "session-new", '{"type":"ai-title","aiTitle":"Session récente"}', new Date("2026-08-16"));

    const results = findRecentSessions(projectsDir);

    expect(results.map((r) => r.title)).toEqual(["Session récente", "Vieille session"]);
    expect(results[0]).toMatchObject({ slug: "slug-b", sessionId: "session-new" });
  });

  it("falls back to the session id when no ai-title line exists", () => {
    writeSession("slug-a", "abc123", '{"type":"last-prompt"}', new Date("2026-08-16"));

    const results = findRecentSessions(projectsDir);

    expect(results[0]?.title).toBeNull();
    expect(results[0]?.sessionId).toBe("abc123");
  });

  it("respects the limit and returns nothing beyond it", () => {
    writeSession("slug-a", "s1", "{}", new Date("2026-08-14"));
    writeSession("slug-a", "s2", "{}", new Date("2026-08-15"));
    writeSession("slug-a", "s3", "{}", new Date("2026-08-16"));

    expect(findRecentSessions(projectsDir, 2)).toHaveLength(2);
  });

  it("returns an empty list when the projects directory doesn't exist yet (fresh install, never used Claude Code)", () => {
    expect(findRecentSessions(join(projectsDir, "does-not-exist"))).toEqual([]);
  });

  it("ignores non-.jsonl files in a project directory", () => {
    const dir = join(projectsDir, "slug-a");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "notes.txt"), "pas une session", "utf8");

    expect(findRecentSessions(projectsDir)).toEqual([]);
  });
});
