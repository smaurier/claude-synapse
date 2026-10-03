/**
 * Token-aware chunking — the reliable replacement for the character-count
 * heuristic in chunk.ts. the user's push-back on 13/08 was right: no fixed
 * chars-per-token ratio can be trusted across languages/content mixes (we
 * measured French markdown at ~2.7-3 chars/token vs. the ~4 assumed for
 * English, which would have silently overflowed the model's 256-token
 * limit even after "fixing" the default to 500 chars). This module
 * tokenizes with the SAME tokenizer that will run at embedding time and
 * windows over actual token ids — the chunk boundaries are exact by
 * construction, not estimated.
 *
 * The tokenizer is injected (encode/decode only) so this stays testable
 * without loading a real model; embeddingProvider.ts wires it to the real
 * one.
 */
export function chunkFileByTokens(path, content, tokenizer, maxTokens, overlapTokens) {
    const ids = tokenizer.encode(content);
    if (ids.length <= maxTokens) {
        return [{ chunkId: path, sourcePath: path, text: content }];
    }
    const stride = maxTokens - overlapTokens;
    const chunks = [];
    let start = 0;
    let index = 0;
    while (start < ids.length) {
        // A window whose remaining tokens are all within the previous window's
        // overlap carries nothing new: the previous window already reached
        // start + overlapTokens. Emitting it anyway produces end-of-file crumbs
        // — on the real hub, four unrelated memories each ended with a
        // one-character chunk ".", which embeds to the same vector every time
        // and surfaced as perfect-similarity merge candidates (found 03/10 via
        // /brain-lint). The guard is exact, not a minimum-length heuristic:
        // it drops only what is already covered.
        if (index > 0 && ids.length - start <= overlapTokens)
            break;
        const windowIds = ids.slice(start, start + maxTokens);
        chunks.push({
            chunkId: `${path}#${index}`,
            sourcePath: path,
            text: tokenizer.decode(windowIds),
        });
        start += stride;
        index += 1;
    }
    return chunks;
}
//# sourceMappingURL=tokenChunk.js.map