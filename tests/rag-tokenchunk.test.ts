import { describe, it, expect } from "vitest";
import { chunkFileByTokens, type Tokenizer } from "../src/rag/tokenChunk.js";

// Fake tokenizer: one "token" per character, decode joins them back. Makes
// the windowing logic verifiable without loading a real model — the real
// tokenizer is exercised separately in a slower integration test.
const charTokenizer: Tokenizer = {
  encode: (text: string) => Array.from(text).map((ch) => ch.charCodeAt(0)),
  decode: (ids: number[]) => ids.map((id) => String.fromCharCode(id)).join(""),
};

describe("chunkFileByTokens", () => {
  it("returns a single chunk when content fits within the token limit", () => {
    const chunks = chunkFileByTokens("a.md", "short", charTokenizer, 256, 30);
    expect(chunks).toEqual([{ chunkId: "a.md", sourcePath: "a.md", text: "short" }]);
  });

  it("never produces a chunk whose re-encoded token count exceeds maxTokens", () => {
    const content = "x".repeat(1000);
    const chunks = chunkFileByTokens("big.md", content, charTokenizer, 256, 30);
    for (const c of chunks) {
      expect(charTokenizer.encode(c.text).length).toBeLessThanOrEqual(256);
    }
  });

  it("windows overlap by the requested number of tokens", () => {
    const content = Array.from({ length: 1000 }, (_, i) => String(i % 10)).join("");
    const chunks = chunkFileByTokens("big.md", content, charTokenizer, 256, 30);

    const firstIds = charTokenizer.encode(chunks[0]!.text);
    const secondIds = charTokenizer.encode(chunks[1]!.text);
    const overlapFromFirst = firstIds.slice(-30);
    const overlapFromSecond = secondIds.slice(0, 30);
    expect(overlapFromSecond).toEqual(overlapFromFirst);
  });

  it("covers the entire content with no gap between consecutive windows", () => {
    const content = Array.from({ length: 1000 }, (_, i) => String(i % 10)).join("");
    const ids = charTokenizer.encode(content);
    const chunks = chunkFileByTokens("big.md", content, charTokenizer, 256, 30);
    const last = chunks[chunks.length - 1]!;
    const lastIds = charTokenizer.encode(last.text);
    // The last window's decoded text must reach the very end of the content.
    expect(charTokenizer.decode(ids.slice(-lastIds.length))).toBe(last.text);
  });
});

// Ajouté 03/10 : constaté sur le vrai hub via /brain-lint. Quatre mémoires
// sans le moindre rapport (project_tribuzen, project_stockage_photos,
// reference_hub_projets, reference_postes — zéro ligne en commun) sortaient
// appariées à une similarité de 1.000. Cause : chacune se terminait par un
// chunk d'UN caractère, « . ». Embarquer le même « . » donne forcément le
// même vecteur, donc un cosinus de 1 — un faux doublon parfait, fabriqué de
// toutes pièces par le découpage.
//
// Ces miettes ne portent aucune information NOUVELLE : une fenêtre dont il
// reste moins que le recouvrement est déjà entièrement contenue dans la
// précédente. On ne les coupe donc pas sur une longueur minimale arbitraire,
// on arrête quand il n'y a plus rien d'inédit à couvrir.
describe("chunkFileByTokens — miettes de fin de fichier", () => {
  it("n'émet pas de fenêtre finale entièrement couverte par le recouvrement de la précédente", () => {
    // 257 tokens, fenêtre 256, pas 226 : la 2e fenêtre démarrerait à 226 et
    // ne couvrirait que 31 tokens, dont 30 déjà vus. Sans garde, la 3e
    // démarrerait à 452 > 257 — mais le vrai cas est le résidu d'un token.
    const content = "x".repeat(257);
    const chunks = chunkFileByTokens("tail.md", content, charTokenizer, 256, 30);

    for (const c of chunks) {
      expect(charTokenizer.encode(c.text).length).toBeGreaterThan(30);
    }
  });

  it("le cas réel : un résidu d'un seul token n'est jamais émis comme chunk", () => {
    // Longueur choisie pour que la dernière fenêtre ne porte qu'un token.
    const stride = 256 - 30;
    const content = "y".repeat(stride * 2 + 1);
    const chunks = chunkFileByTokens("tail.md", content, charTokenizer, 256, 30);

    const tiny = chunks.filter((c) => charTokenizer.encode(c.text).length <= 1);
    expect(tiny).toEqual([]);
  });

  it("couvre toujours la fin du contenu malgré le garde", () => {
    const content = "z".repeat(257);
    const ids = charTokenizer.encode(content);
    const chunks = chunkFileByTokens("tail.md", content, charTokenizer, 256, 30);
    const last = chunks[chunks.length - 1]!;
    const lastIds = charTokenizer.encode(last.text);
    expect(charTokenizer.decode(ids.slice(-lastIds.length))).toBe(last.text);
  });
});
