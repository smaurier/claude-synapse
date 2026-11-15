import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmTree } from "./helpers/fsTemp.js";
import { withDeadline, recordRecallTimeout, RECALL_DEADLINE_MS, recallTimeoutLogPath } from "../src/commands/recallDeadline.js";

// 15/11/2026 : 159 annulations du hook UserPromptSubmit relevées dans les
// transcripts du poste pro (15,4 à 24,6 s, plafond 15 s), surtout avec deux
// sessions ouvertes dont les reconstructions asynchrones se disputent le CPU.
// Le contrat « le rappel ne bloque jamais la session » ne tenait que si le
// travail finissait à temps : c'est le harnais qui coupait, en rouge.
// Désormais c'est le rappel qui s'arrête lui-même, avant le harnais.

let dir: string | undefined;
afterEach(() => {
  if (dir) rmTree(dir);
  dir = undefined;
});

describe("withDeadline", () => {
  it("rend le résultat du travail quand il finit avant l'échéance", async () => {
    const r = await withDeadline(Promise.resolve({ additionalContext: "x" }), 1000, {});
    expect(r).toEqual({ value: { additionalContext: "x" }, timedOut: false });
  });

  it("rend le repli et signale le dépassement quand le travail traîne", async () => {
    const lent = new Promise<Record<string, string>>((res) => setTimeout(() => res({ additionalContext: "trop tard" }), 500));
    const debut = Date.now();
    const r = await withDeadline(lent, 50, {});
    expect(r).toEqual({ value: {}, timedOut: true });
    expect(Date.now() - debut).toBeLessThan(400);
  });

  it("rend le repli, sans dépassement, quand le travail échoue", async () => {
    const r = await withDeadline(Promise.reject(new Error("boom")), 1000, {});
    expect(r).toEqual({ value: {}, timedOut: false });
  });
});

describe("recordRecallTimeout", () => {
  it("laisse une trace datée : un repli silencieux sans trace est une panne qu'on ne mesure plus", () => {
    dir = mkdtempSync(join(tmpdir(), "synapse-deadline-"));
    recordRecallTimeout(dir, 8000, new Date("2026-11-15T20:00:00Z"));
    recordRecallTimeout(dir, 8000, new Date("2026-11-15T20:05:00Z"));
    const log = readFileSync(recallTimeoutLogPath(dir), "utf8").trim().split("\n");
    expect(log).toEqual([
      "2026-11-15T20:00:00.000Z rappel abandonné après 8000 ms",
      "2026-11-15T20:05:00.000Z rappel abandonné après 8000 ms",
    ]);
  });

  it("ne lève jamais, même si le dossier n'existe pas", () => {
    const absent = join(tmpdir(), "synapse-dossier-qui-n-existe-pas", "x");
    expect(() => recordRecallTimeout(absent, 8000)).not.toThrow();
    expect(existsSync(recallTimeoutLogPath(absent))).toBe(false);
  });
});

describe("échéance interne vs plafond du harnais", () => {
  it("laisse au moins 5 s de marge sous le timeout du hook (boucle bloquée par l'inférence, sortie de node)", () => {
    const hooks = JSON.parse(readFileSync(join(__dirname, "..", "hooks", "hooks.json"), "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string; timeout?: number }> }>>;
    };
    const recall = hooks.hooks.UserPromptSubmit?.flatMap((g) => g.hooks).find((h) => h.command.includes("proactiveRecallCli.js"));
    expect(recall?.timeout).toBeDefined();
    expect(RECALL_DEADLINE_MS + 5000).toBeLessThanOrEqual((recall?.timeout ?? 0) * 1000);
  });
});
