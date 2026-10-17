import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmTree } from "./helpers/fsTemp.js";

// Backlog 51 (16/10/2026) : le hook UserPromptSubmit a 15 s ; reconstruire
// l'index dedans a produit un timeout à CHAQUE prompt sur un fichier de
// 274 Ko (44 s à ré-embedder, hash jamais stampé, reprise de zéro au prompt
// suivant). Ce test verrouille le contrat : le rappel proactif cherche en
// lecture seule, la reconstruction appartient aux hooks SessionStart et Stop.
vi.mock("../src/rag/hybridSearch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/rag/hybridSearch.js")>();
  return { ...actual, hybridSearchHub: vi.fn(async () => []) };
});

import { hybridSearchHub } from "../src/rag/hybridSearch.js";
import { runProactiveRecall } from "../src/commands/proactiveRecall.js";

let root: string;
let pluginDataDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-recall-ro-"));
  const hub = join(root, "hub");
  mkdirSync(hub, { recursive: true });
  writeFileSync(join(hub, "a.md"), "une mémoire quelconque", "utf8");
  pluginDataDir = join(root, "data");
  mkdirSync(pluginDataDir, { recursive: true });
  writeFileSync(
    join(pluginDataDir, "local-config.json"),
    JSON.stringify({ hubUrl: "https://example.invalid/hub", hubClonePath: hub, machineId: "test" }),
    "utf8",
  );
});

afterEach(() => {
  vi.mocked(hybridSearchHub).mockClear();
  rmTree(root);
});

describe("runProactiveRecall — lecture seule", () => {
  it("interroge le hub sans jamais demander la reconstruction de l'index", async () => {
    await runProactiveRecall(pluginDataDir, "une question assez longue pour passer le filtre");

    expect(hybridSearchHub).toHaveBeenCalledTimes(1);
    expect(vi.mocked(hybridSearchHub).mock.calls[0]?.[3]).toEqual({ refreshIndex: false });
  });
});
