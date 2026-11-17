import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { acquireRefreshLock, refreshLockPath, releaseRefreshLock, withRefreshLock } from "../src/lock/refreshLock.js";
import { rmTree } from "./helpers/fsTemp.js";

// 17/11/2026 : sept sessions ouvertes sur un poste, un hook Stop par fin de
// tour, aucun verrou. Six refresh de 600 Mo tournaient ensemble sur le même
// fichier de 693 Ko. Le verrou vit dans le dossier de données du plugin, donc
// par POSTE : le verrou du hub (lock.ts) est partagé entre postes et aurait
// bloqué les commits des autres sessions.

const MAX_AGE_MS = 10 * 60_000;
const SOMEONE_ELSE = process.pid + 1;

let pluginDataDir: string;

beforeEach(() => {
  pluginDataDir = mkdtempSync(join(tmpdir(), "synapse-refresh-lock-"));
});

afterEach(() => {
  rmTree(pluginDataDir);
});

describe("acquireRefreshLock", () => {
  it("prend le verrou quand personne ne le tient, et y écrit PID et horodatage", () => {
    const now = new Date("2026-11-17T18:14:00.000Z");

    const result = acquireRefreshLock(pluginDataDir, MAX_AGE_MS, now);

    expect(result.acquired).toBe(true);
    expect(JSON.parse(readFileSync(refreshLockPath(pluginDataDir), "utf8"))).toEqual({
      pid: process.pid,
      acquiredAt: "2026-11-17T18:14:00.000Z",
    });
  });

  it("vit dans le dossier de données du plugin, jamais dans le hub", () => {
    expect(dirname(refreshLockPath(pluginDataDir))).toBe(pluginDataDir);
  });

  it("crée le dossier de données s'il n'existe pas encore", () => {
    const missing = join(pluginDataDir, "pas-encore-la");

    expect(acquireRefreshLock(missing, MAX_AGE_MS).acquired).toBe(true);
  });

  it("refuse tant qu'un processus vivant le tient, en nommant le tenant", () => {
    const since = new Date(Date.now() - 60_000);
    acquireRefreshLock(pluginDataDir, MAX_AGE_MS, since);

    const result = acquireRefreshLock(pluginDataDir, MAX_AGE_MS, new Date(), SOMEONE_ELSE);

    expect(result).toEqual({ acquired: false, heldByPid: process.pid, since: since.toISOString() });
  });

  it("n'est pas réentrant : le même processus ne lance pas deux refresh", () => {
    acquireRefreshLock(pluginDataDir, MAX_AGE_MS);

    expect(acquireRefreshLock(pluginDataDir, MAX_AGE_MS).acquired).toBe(false);
  });

  it("reprend le verrou d'un processus mort", () => {
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid as number;
    acquireRefreshLock(pluginDataDir, MAX_AGE_MS, new Date(), deadPid);

    expect(acquireRefreshLock(pluginDataDir, MAX_AGE_MS).acquired).toBe(true);
  });

  it("reprend un verrou plus vieux que le plafond, même si son PID est vivant (PID recyclé, processus figé)", () => {
    const tooOld = new Date(Date.now() - MAX_AGE_MS - 1000);
    acquireRefreshLock(pluginDataDir, MAX_AGE_MS, tooOld);

    expect(acquireRefreshLock(pluginDataDir, MAX_AGE_MS, new Date(), SOMEONE_ELSE).acquired).toBe(true);
  });
});

describe("releaseRefreshLock", () => {
  it("libère le verrou de son tenant", () => {
    acquireRefreshLock(pluginDataDir, MAX_AGE_MS);

    releaseRefreshLock(pluginDataDir);

    expect(existsSync(refreshLockPath(pluginDataDir))).toBe(false);
  });

  it("ne touche pas au verrou d'un autre processus", () => {
    acquireRefreshLock(pluginDataDir, MAX_AGE_MS);

    releaseRefreshLock(pluginDataDir, SOMEONE_ELSE);

    expect(existsSync(refreshLockPath(pluginDataDir))).toBe(true);
  });

  it("ne lève pas quand il n'y a rien à libérer", () => {
    expect(() => releaseRefreshLock(pluginDataDir)).not.toThrow();
  });
});

describe("contrat : le point d'entrée des hooks passe par le verrou", () => {
  it("refreshIndexCli enveloppe runRefreshIndex dans withRefreshLock", () => {
    const source = readFileSync(join(__dirname, "..", "src", "commands", "refreshIndexCli.ts"), "utf8");

    expect(source).toMatch(/withRefreshLock\(pluginDataDir,[\s\S]*runRefreshIndex\(/);
  });
});

describe("withRefreshLock", () => {
  it("deux lancements concurrents : un seul travaille, l'autre apprend qui tient le verrou", async () => {
    let runs = 0;
    const slowRefresh = async (): Promise<string> => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "index à jour";
    };

    const [first, second] = await Promise.all([
      withRefreshLock(pluginDataDir, MAX_AGE_MS, slowRefresh),
      withRefreshLock(pluginDataDir, MAX_AGE_MS, slowRefresh),
    ]);

    expect(runs).toBe(1);
    expect(first).toEqual({ ran: true, value: "index à jour" });
    expect(second).toMatchObject({ ran: false, heldByPid: process.pid });
  });

  it("libère le verrou une fois le travail fini : le lancement suivant travaille", async () => {
    await withRefreshLock(pluginDataDir, MAX_AGE_MS, async () => "premier");

    const next = await withRefreshLock(pluginDataDir, MAX_AGE_MS, async () => "second");

    expect(next).toEqual({ ran: true, value: "second" });
  });

  it("libère le verrou même quand le travail échoue", async () => {
    await expect(
      withRefreshLock(pluginDataDir, MAX_AGE_MS, async () => {
        throw new Error("modèle introuvable");
      }),
    ).rejects.toThrow("modèle introuvable");

    expect(existsSync(refreshLockPath(pluginDataDir))).toBe(false);
  });
});
