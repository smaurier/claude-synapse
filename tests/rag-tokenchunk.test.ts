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
