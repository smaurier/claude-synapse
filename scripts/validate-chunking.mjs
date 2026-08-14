// Empirical validation of the token reserve for a candidate embedding model,
// run against the REAL memory corpus (not a sample) — same rigor as the
// original 104-file/762-chunk validation for all-MiniLM-L6-v2 (see
// embeddingProvider.ts). Tries increasing reserves until zero violations.
//
// Usage: node scripts/validate-chunking.mjs <hubDir>
// No default path on purpose: this script reads real memory content, so it
// must never silently point at anyone's actual hub — pass it explicitly.
import { AutoTokenizer } from "@huggingface/transformers";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const HUB_DIR = process.argv[2];
if (!HUB_DIR) {
  console.error("Usage: node scripts/validate-chunking.mjs <hubDir>");
  process.exit(1);
}
const MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const MODEL_MAX_TOKENS = 128;
const SKIP_DIRS = new Set([".git", "node_modules", ".synapse"]);

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (entry.endsWith(".md")) out.push(full);
  }
}

const files = [];
walk(HUB_DIR, files);
console.log(`Corpus reel : ${files.length} fichiers .md sous ${HUB_DIR}`);

const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);

function chunkByTokens(content, maxContentTokens, overlapTokens) {
  const ids = tokenizer.encode(content, { add_special_tokens: false });
  if (ids.length <= maxContentTokens) return [content];
  const stride = maxContentTokens - overlapTokens;
  const chunks = [];
  let start = 0;
  while (start < ids.length) {
    const windowIds = ids.slice(start, start + maxContentTokens);
    chunks.push(tokenizer.decode(windowIds, { skip_special_tokens: true }));
    start += stride;
  }
  return chunks;
}

for (const reserve of [2, 4, 8, 12, 16, 20, 24]) {
  const maxContentTokens = MODEL_MAX_TOKENS - reserve;
  const overlapTokens = Math.round(maxContentTokens * 0.125);
  let totalChunks = 0;
  let maxObserved = 0;
  let violations = 0;

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const chunk of chunkByTokens(content, maxContentTokens, overlapTokens)) {
      totalChunks++;
      const finalCount = tokenizer.encode(chunk).length; // with special tokens, matches what the model sees
      if (finalCount > maxObserved) maxObserved = finalCount;
      if (finalCount > MODEL_MAX_TOKENS) violations++;
    }
  }

  console.log(
    `reserve=${reserve} maxContentTokens=${maxContentTokens} overlap=${overlapTokens} ` +
      `-> chunks=${totalChunks} maxObserved=${maxObserved} violations=${violations}`,
  );
  if (violations === 0) {
    console.log(`=> reserve=${reserve} suffit : 0 violation sur ${files.length} fichiers / ${totalChunks} chunks.`);
    break;
  }
}
