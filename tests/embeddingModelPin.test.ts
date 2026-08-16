import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensurePinnedEmbeddingModel, DEFAULT_MODEL_ID } from "../src/rag/embeddingProvider.js";
import { readSharedConfig, writeSharedConfig, DEFAULT_SHARED_CONFIG } from "../src/config/config.js";

let hubDir: string;

beforeEach(() => {
  hubDir = mkdtempSync(join(tmpdir(), "synapse-embedding-pin-"));
  mkdirSync(join(hubDir, ".synapse"), { recursive: true });
});

afterEach(() => {
  rmSync(hubDir, { recursive: true, force: true });
});

describe("ensurePinnedEmbeddingModel", () => {
  it("pins the default model and persists it when never set before ('unset')", () => {
    const resolved = ensurePinnedEmbeddingModel(hubDir);

    expect(resolved).toBe(DEFAULT_MODEL_ID);
    expect(readSharedConfig(hubDir).ragEmbeddingModelVersion).toBe(DEFAULT_MODEL_ID);
  });

  it("returns the already-pinned model without rewriting anything when it matches the default", () => {
    writeSharedConfig(hubDir, { ...DEFAULT_SHARED_CONFIG, ragEmbeddingModelVersion: DEFAULT_MODEL_ID });

    expect(ensurePinnedEmbeddingModel(hubDir)).toBe(DEFAULT_MODEL_ID);
  });

  it("refuses when a different model is pinned — never silently switches", () => {
    writeSharedConfig(hubDir, { ...DEFAULT_SHARED_CONFIG, ragEmbeddingModelVersion: "some/other-model" });

    expect(() => ensurePinnedEmbeddingModel(hubDir)).toThrow(/some\/other-model/);
  });
});
