import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VectorStore } from "../src/rag/store.js";
import { writeLocalConfig } from "../src/config/config.js";
import { rmTree } from "./helpers/fsTemp.js";

// 18/11/2026 : 204 Mo de pages libres sur 278,6 Mo dans l'index du poste pro.
// Le compactage passe par le refresh, sous son verrou : un seul processus du
// poste réécrit le fichier, et les deux postes se compactent sans geste.

let root: string;
let pluginDataDir: string;
let hubDir: string;

const indexPath = (): string => join(hubDir, ".synapse", "index.sqlite");

function fakeTransformers(): Record<string, unknown> {
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

async function refresh(): Promise<Awaited<ReturnType<typeof import("../src/commands/refreshIndex.js").runRefreshIndex>>> {
  vi.resetModules();
  vi.doMock("@huggingface/transformers", fakeTransformers);
  const { runRefreshIndex } = await import("../src/commands/refreshIndex.js");
  return runRefreshIndex(pluginDataDir, undefined, join(root, "plugin-root-sans-package-json"));
}

/** Leaves the index mostly free pages, the way the stacked refreshes did. */
function bloatIndex(): void {
  mkdirSync(join(hubDir, ".synapse"), { recursive: true });
  const store = new VectorStore(indexPath());
  const big = Array.from({ length: 10_000 }, (_, i) => i / 10_000);
  for (let i = 0; i < 20; i++) store.upsert(`junk-${i}`, big); // about 1.5 Mo, over the 1 Mo floor
  store.clear();
  store.close();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-refresh-compaction-"));
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

describe("runRefreshIndex compacte un index vide à plus de moitié", () => {
  it("rend la place après un rafraîchissement complet", async () => {
    bloatIndex();
    const before = statSync(indexPath()).size;

    const result = await refresh();

    expect(result.indexCompleted).toBe(true);
    expect(result.indexCompacted?.beforeBytes).toBe(before);
    expect(statSync(indexPath()).size).toBeLessThan(before / 4);
  });

  it("ne réécrit pas un index sain", async () => {
    await refresh();

    const result = await refresh();

    expect(result.indexCompacted).toBeUndefined();
  });
});
