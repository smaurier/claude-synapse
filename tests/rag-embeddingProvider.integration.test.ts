import { describe, it, expect, vi } from "vitest";
import { chunkFileForEmbedding, embedLocal } from "../src/rag/embeddingProvider.js";

// Real model, real tokenizer — slower than the rest of the suite (model
// load + WASM inference), kept in its own file for that reason. This is
// the actual proof the token-aware chunking holds, not an assumption:
// every produced chunk is re-encoded by the SAME tokenizer that will run
// at embedding time and checked against the true 128-token limit.

// Generic, invented content on purpose — exercises the same properties as
// real memory files (accents, em-dashes, guillemets, code spans, markdown
// structure) without being an actual excerpt of anyone's real notes.
const FRENCH_MARKDOWN_SAMPLE = `
Décision du 12/03/2026 (suite à une remarque d'une collègue « il faudrait vérifier ça ») : PAS
de solution rapide mais fragile — une architecture générique et documentée est le critère qui
prime sur la vitesse pure, c'est LE volet qui intéresse l'équipe (la démonstration publique et
l'article de blog sont annexes). Forme retenue : un module indépendant, installable seul —
hooks + commandes + install, PAS un dossier de scripts à copier. Totalement découplé du système
privé existant : module indépendant, installable seul. Nom de code retenu : « Exemple ». Le nom
porte la thèse « ne jamais dupliquer — toujours référencer ».

**Décision de conception n°2 (config utilisateur) tranchée le 10/03.** Pilotée par commandes,
jamais d'édition manuelle de fichier requise (\`/outil-init\` au premier lancement,
\`/outil-config show/set\` ensuite). Deux couches : config partagée dans le dépôt central lui-même
(versionnée, synchronisée automatiquement), config locale hors dépôt. Séquence de bootstrap :
1) config locale (URL) → 2) clone/pull du dépôt → 3) lecture de la config partagée →
4) création de la jonction → 5) vérification post-install.
`.repeat(3); // long enough to force multiple chunks

describe("chunkFileForEmbedding (real tokenizer)", () => {
  it("every chunk stays within the model's true token limit when re-encoded", async () => {
    const chunks = await chunkFileForEmbedding("sample.md", FRENCH_MARKDOWN_SAMPLE);

    expect(chunks.length).toBeGreaterThan(1); // confirms the sample actually needed chunking

    const { AutoTokenizer } = await import("@huggingface/transformers");
    const tokenizer = await AutoTokenizer.from_pretrained("Xenova/paraphrase-multilingual-MiniLM-L12-v2");

    for (const chunk of chunks) {
      const tokenCount = tokenizer.encode(chunk.text).length;
      expect(tokenCount).toBeLessThanOrEqual(128);
    }
  }, 120_000);
});

describe("embedLocal (real model)", () => {
  it("returns a 384-dimensional normalized vector for multilingual MiniLM", async () => {
    const vector = await embedLocal("test court");
    expect(vector).toHaveLength(384);
  }, 120_000);

  it("does not warn for a properly chunked input", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [chunk] = await chunkFileForEmbedding("sample.md", FRENCH_MARKDOWN_SAMPLE);
    await embedLocal(chunk!.text);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  }, 120_000);

  it("warns when given raw oversized text that bypassed chunking (the safety net actually fires)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await embedLocal(FRENCH_MARKDOWN_SAMPLE); // unchunked, well over 128 tokens
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("dépasse la limite"));
    warnSpy.mockRestore();
  }, 120_000);
});
