import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmTree } from "./helpers/fsTemp.js";
import {
  recordRecallTimeout,
  RECALL_DEADLINE_MS,
  recallTimeoutLogPath,
  runInChildWithDeadline,
} from "../src/commands/recallDeadline.js";

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

// 18/11/2026 : sous CPU saturé, le rappel 0.1.16 prenait 21 à 31 s malgré
// l'échéance de 8 s, et finissait même son travail. Le minuteur vivait dans le
// fil qui faisait le travail : construction du tokenizer (1 s à vide), session
// ONNX, parcours de l'index et import de transformers.js sont synchrones, et
// tant qu'ils tournent aucun minuteur ne part. Le travail passe donc dans un
// processus enfant, le hook ne fait qu'attendre.
const child = (name: string): string => join(__dirname, "fixtures", "recall-processes", `${name}.mjs`);

describe("runInChildWithDeadline", () => {
  it("rend la réponse de l'enfant quand il finit avant l'échéance", async () => {
    const r = await runInChildWithDeadline(child("echo"), { prompt: "x" }, 5000, {});
    expect(r).toEqual({ value: { additionalContext: "x" }, timedOut: false });
  });

  it("coupe à l'échéance un enfant qui bloque sa boucle d'événements", async () => {
    const debut = Date.now();
    const r = await runInChildWithDeadline(child("blocking"), {}, 500, {});
    expect(r).toEqual({ value: {}, timedOut: true });
    expect(Date.now() - debut).toBeLessThan(3000);
  });

  it("rend le repli, sans dépassement, quand l'enfant plante", async () => {
    const r = await runInChildWithDeadline(child("crashing"), {}, 5000, {});
    expect(r).toEqual({ value: {}, timedOut: false });
  });

  it("rend le repli, sans dépassement, quand l'enfant se termine sans répondre", async () => {
    const r = await runInChildWithDeadline(child("silent"), {}, 5000, {});
    expect(r).toEqual({ value: {}, timedOut: false });
  });
});

describe("contrat : le hook ne fait jamais le travail du rappel dans son propre processus", () => {
  const cli = (): string => readFileSync(join(__dirname, "..", "src", "commands", "proactiveRecallCli.ts"), "utf8");

  it("proactiveRecallCli n'importe pas le rappel, il le lance dans proactiveRecallProcess", () => {
    expect(cli()).not.toMatch(/from "\.\/proactiveRecall\.js"/);
    expect(cli()).toMatch(/runInChildWithDeadline\(\s*fileURLToPath\(new URL\("\.\/proactiveRecallProcess\.js", import\.meta\.url\)\)/);
  });

  it("le processus du rappel existe à côté du hook", () => {
    expect(existsSync(join(__dirname, "..", "src", "commands", "proactiveRecallProcess.ts"))).toBe(true);
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
