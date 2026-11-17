import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VectorStore } from "../src/rag/store.js";
import { isIndexCurrent, rebuildIfStale } from "../src/rag/search.js";
import { writeLocalConfig } from "../src/config/config.js";
import { rmTree } from "./helpers/fsTemp.js";

// 17/11/2026 : le hook Stop part à CHAQUE fin de tour, et presque toujours
// pour rien. Mesuré sur le poste pro : 1,3 à 1,6 s sur un corpus inchangé,
// dont 0,75 à 1 s pour le seul import de transformers.js, alors que le modèle
// n'était même pas chargé. Un corpus inchangé ne doit plus toucher à la
// bibliothèque d'embedding du tout.

const transformers = { loads: 0 };

function fakeTransformers(): Record<string, unknown> {
  transformers.loads += 1;
  return {
    env: {},
    AutoTokenizer: {
      from_pretrained: async () => ({
        encode: (text: string) => Array.from(text, (ch) => ch.charCodeAt(0)).slice(0, 100),
        decode: (ids: number[]) => String.fromCharCode(...ids),
      }),
    },
    pipeline: async () => async (text: string) => ({ data: Float32Array.from([text.length, 1, 0]) }),
  };
}

let root: string;
let pluginDataDir: string;
let hubDir: string;

async function refreshInAFreshProcess(): Promise<{ indexCompleted: boolean; filesEmbedded: number }> {
  vi.resetModules();
  vi.doMock("@huggingface/transformers", fakeTransformers);
  const { runRefreshIndex } = await import("../src/commands/refreshIndex.js");
  return runRefreshIndex(pluginDataDir, undefined, join(root, "plugin-root-sans-package-json"));
}

beforeEach(() => {
  transformers.loads = 0;
  root = mkdtempSync(join(tmpdir(), "synapse-refresh-unchanged-"));
  pluginDataDir = join(root, "plugin-data");
  hubDir = join(root, "hub");
  mkdirSync(pluginDataDir, { recursive: true });
  mkdirSync(hubDir, { recursive: true });
  writeLocalConfig(join(pluginDataDir, "local-config.json"), {
    hubUrl: "git@github.com:example-user/my-hub.git",
    hubClonePath: hubDir,
    machineId: "test-machine",
  });
  writeFileSync(join(hubDir, "chat.md"), "Le chat dort sur le canapé.", "utf8");
});

afterEach(() => {
  vi.doUnmock("@huggingface/transformers");
  rmTree(root);
});

describe("runRefreshIndex sur un corpus inchangé", () => {
  it("charge la bibliothèque d'embedding quand il y a du travail (le compteur sait rougir)", async () => {
    const result = await refreshInAFreshProcess();

    expect(result).toMatchObject({ indexCompleted: true, filesEmbedded: 1 });
    expect(transformers.loads).toBe(1);
  });

  it("ne charge ni le modèle ni sa bibliothèque au second lancement sans modification", async () => {
    await refreshInAFreshProcess();
    transformers.loads = 0;

    const result = await refreshInAFreshProcess();

    expect(result).toMatchObject({ indexCompleted: true, filesEmbedded: 0 });
    expect(transformers.loads).toBe(0);
  });

  it("la recharge dès qu'un fichier change", async () => {
    await refreshInAFreshProcess();
    transformers.loads = 0;
    writeFileSync(join(hubDir, "chat.md"), "Le chat s'est réveillé.", "utf8");

    const result = await refreshInAFreshProcess();

    expect(result).toMatchObject({ indexCompleted: true, filesEmbedded: 1 });
    expect(transformers.loads).toBe(1);
  });
});

describe("isIndexCurrent", () => {
  const corpus = [{ path: "a.md", content: "aaa" }];
  const embed = (): number[] => [1, 0, 0];
  let store: VectorStore;

  beforeEach(() => {
    store = new VectorStore(join(root, "index.sqlite"));
  });

  afterEach(() => {
    store.close();
  });

  it("faux tant que rien n'est indexé", () => {
    expect(isIndexCurrent(store, corpus, "model@1")).toBe(false);
  });

  it("vrai une fois le corpus indexé par le même embedder", async () => {
    await rebuildIfStale(store, corpus, embed, "model@1");

    expect(isIndexCurrent(store, corpus, "model@1")).toBe(true);
  });

  it("faux dès qu'un fichier change", async () => {
    await rebuildIfStale(store, corpus, embed, "model@1");

    expect(isIndexCurrent(store, [{ path: "a.md", content: "modifié" }], "model@1")).toBe(false);
  });

  it("faux quand l'embedder a changé, même sur un corpus identique", async () => {
    await rebuildIfStale(store, corpus, embed, "model@1");

    expect(isIndexCurrent(store, corpus, "model@2")).toBe(false);
  });

  it("une identité invérifiable (null) ne déclenche rien : même abstention que rebuildIfStale", async () => {
    await rebuildIfStale(store, corpus, embed, "model@1");

    expect(isIndexCurrent(store, corpus, null)).toBe(true);
  });

  it("un corpus inchangé ne découpe ni n'embedde aucun fichier", async () => {
    const chunkFn = vi.fn((path: string, content: string) => [{ chunkId: path, sourcePath: path, text: content }]);
    const countingEmbed = vi.fn(embed);
    await rebuildIfStale(store, corpus, countingEmbed, "model@1", chunkFn);
    chunkFn.mockClear();
    countingEmbed.mockClear();

    await rebuildIfStale(store, corpus, countingEmbed, "model@1", chunkFn);

    expect(chunkFn).not.toHaveBeenCalled();
    expect(countingEmbed).not.toHaveBeenCalled();
  });
});
