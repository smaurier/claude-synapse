import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_REFRESH_MAX_SECONDS,
  HARD_STOP_GRACE_MS,
  armHardStop,
  recordRefreshRun,
  refreshLockMaxAgeMs,
  refreshLogPath,
  refreshMaxMs,
} from "../src/commands/refreshCeiling.js";
import { writeLocalConfig } from "../src/config/config.js";
import { rmTree } from "./helpers/fsTemp.js";

let pluginDataDir: string;

const localConfig = { hubUrl: "git@github.com:example-user/my-hub.git", hubClonePath: "/hub", machineId: "poste" };

beforeEach(() => {
  pluginDataDir = mkdtempSync(join(tmpdir(), "synapse-refresh-ceiling-"));
});

afterEach(() => {
  vi.useRealTimers();
  rmTree(pluginDataDir);
});

describe("refreshMaxMs", () => {
  it("vaut 5 minutes par défaut : le pire fichier mesuré seul prend 170 s", () => {
    writeLocalConfig(join(pluginDataDir, "local-config.json"), localConfig);

    expect(DEFAULT_REFRESH_MAX_SECONDS).toBe(300);
    expect(refreshMaxMs(pluginDataDir)).toBe(300_000);
  });

  it("se règle par poste dans la config locale (refreshMaxSeconds)", () => {
    writeLocalConfig(join(pluginDataDir, "local-config.json"), { ...localConfig, refreshMaxSeconds: 45 });

    expect(refreshMaxMs(pluginDataDir)).toBe(45_000);
  });

  it.each([0, -3, Number.NaN, "600"])("retombe sur le défaut quand la valeur est inutilisable (%s)", (value) => {
    writeFileSync(join(pluginDataDir, "local-config.json"), JSON.stringify({ ...localConfig, refreshMaxSeconds: value }), "utf8");

    expect(refreshMaxMs(pluginDataDir)).toBe(300_000);
  });

  it("retombe sur le défaut quand la config locale est absente ou illisible", () => {
    expect(refreshMaxMs(pluginDataDir)).toBe(300_000);
  });
});

describe("refreshLockMaxAgeMs", () => {
  it("dépasse le plafond et sa marge d'arrêt forcé : un verrou plus vieux ne peut appartenir qu'à un processus figé", () => {
    expect(refreshLockMaxAgeMs(300_000)).toBeGreaterThan(300_000 + HARD_STOP_GRACE_MS);
  });
});

describe("armHardStop", () => {
  it("ne fait rien avant le plafond et sa marge", () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const onStop = vi.fn();

    armHardStop(1_000, onStop, exit);
    vi.advanceTimersByTime(1_000 + HARD_STOP_GRACE_MS - 1);

    expect(exit).not.toHaveBeenCalled();
  });

  it("passé le plafond et sa marge, nettoie puis tue le processus avec le code 0", () => {
    vi.useFakeTimers();
    const calls: string[] = [];

    armHardStop(1_000, () => calls.push("nettoyage"), (code) => calls.push(`exit ${code}`));
    vi.advanceTimersByTime(1_000 + HARD_STOP_GRACE_MS);

    expect(calls).toEqual(["nettoyage", "exit 0"]);
  });

  it("tue quand même si le nettoyage échoue", () => {
    vi.useFakeTimers();
    const exit = vi.fn();

    armHardStop(
      1_000,
      () => {
        throw new Error("verrou déjà parti");
      },
      exit,
    );
    vi.advanceTimersByTime(1_000 + HARD_STOP_GRACE_MS);

    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe("recordRefreshRun", () => {
  const run = {
    outcome: "terminé" as const,
    durationMs: 170_234,
    filesEmbedded: 1,
    pluginRoot: "C:/Users/x/.claude/plugins/cache/synapse/synapse/0.1.15",
  };

  it("laisse une ligne datée avec l'issue, la durée, le PID et le dossier de la version qui a tourné", () => {
    recordRefreshRun(pluginDataDir, run, new Date("2026-11-17T18:14:00.000Z"), 4242);

    expect(readFileSync(refreshLogPath(pluginDataDir), "utf8")).toBe(
      "2026-11-17T18:14:00.000Z pid 4242 terminé 170.2 s 1 fichier(s) C:/Users/x/.claude/plugins/cache/synapse/synapse/0.1.15\n",
    );
  });

  it("ne grossit pas sans fin : au-delà de 500 lignes, seules les plus récentes restent", () => {
    for (let i = 0; i < 520; i++) recordRefreshRun(pluginDataDir, { ...run, filesEmbedded: i });

    const lines = readFileSync(refreshLogPath(pluginDataDir), "utf8").trimEnd().split("\n");

    expect(lines.length).toBeLessThanOrEqual(500);
    expect(lines.at(-1)).toContain(" 519 fichier(s) ");
  });

  it("ne lève jamais : la trace est un bonus", () => {
    expect(() => recordRefreshRun(join(pluginDataDir, "absent", "plus-loin"), run)).not.toThrow();
  });
});
