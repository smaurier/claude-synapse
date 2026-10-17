import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "@huggingface/transformers";
import { defaultModelCacheDir, useModelCacheDir } from "../src/rag/embeddingProvider.js";
import { rmTree } from "./helpers/fsTemp.js";

// Backlog 53 (17/10/2026) : transformers.js range le modèle téléchargé
// (130 Mo) dans node_modules/@huggingface/transformers/.cache, c'est-à-dire
// DANS le cache de version du plugin. Chaque `claude plugin update` crée un
// nouveau dossier de version, donc re-télécharge le modèle au premier rappel
// proactif : 59 s mesurées, soit un timeout du hook UserPromptSubmit (15 s)
// au premier prompt après chaque mise à jour, sur chaque poste. Le dossier de
// données du plugin (${CLAUDE_PLUGIN_DATA}) survit aux mises à jour par
// contrat : le modèle doit y vivre.

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "synapse-model-cache-"));
});

afterEach(() => {
  rmTree(dataDir);
});

describe("defaultModelCacheDir", () => {
  it("dérive le cache du modèle du dossier de données du plugin, sous-dossier models/", () => {
    expect(defaultModelCacheDir(dataDir)).toBe(join(dataDir, "models"));
  });
});

describe("useModelCacheDir", () => {
  it("pointe env.cacheDir de transformers.js sur le dossier demandé et le crée", () => {
    const dir = join(dataDir, "models");
    expect(existsSync(dir)).toBe(false);

    useModelCacheDir(dir);

    expect(env.cacheDir).toBe(dir);
    expect(existsSync(dir)).toBe(true);
  });
});

// Contrat : tout module de src/commands qui atteint l'embedding (recherche
// ou reconstruction d'index) doit rediriger le cache du modèle AVANT. Un
// nouveau module qui oublierait l'appel retomberait silencieusement sur le
// cache dans node_modules, et la boucle de timeouts reviendrait à la mise à
// jour suivante. Vérification statique, sans charger le modèle.
describe("contrat : qui charge le modèle redirige son cache", () => {
  const commandsDir = join(__dirname, "..", "src", "commands");
  const reachesEmbedding = /\b(hybridSearchHub|searchHub|refreshHubIndex|synapseSearch|rebuildIndexIfStale)\b/;

  const modules = readdirSync(commandsDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith("Cli.ts"))
    .filter((f) => reachesEmbedding.test(readFileSync(join(commandsDir, f), "utf8")));

  it("recense bien les trois modules connus (sinon la liste a bougé : relire ce test)", () => {
    expect(modules.sort()).toEqual(["brainSearch.ts", "proactiveRecall.ts", "refreshIndex.ts"]);
  });

  it.each(modules)("%s appelle useModelCacheDir(defaultModelCacheDir(pluginDataDir))", (file) => {
    const source = readFileSync(join(commandsDir, file), "utf8");
    expect(source).toMatch(/useModelCacheDir\(defaultModelCacheDir\(pluginDataDir\)\)/);
  });
});
