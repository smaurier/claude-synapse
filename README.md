# Synapse

**Don't sync memory across machines — link it.**

Most tools that keep Claude Code's memory consistent across machines *sync* it: copy files
back and forth, merge on conflict, hope nothing diverges. Synapse takes a different position —
there is exactly **one** physical copy of your memory (a git repo you own), and every machine,
every project, references it through a filesystem link (an NTFS junction on Windows, a symlink
elsewhere). Nothing to merge, because nothing is ever duplicated in the first place.

## How it works

1. You point Synapse at a private git repo — the **hub**. It gets cloned once per machine.
2. Every project that wants memory gets a link (`<project>/.claude/memory` by default) pointing
   straight at that one clone. Read or write through the link, and you're reading or writing the
   hub directly — no sync step in between.
3. A `SessionStart` hook keeps a local RAG index fresh (semantic + exact-match search) when the
   hub changed since last time. A `SessionEnd` hook commits and pushes automatically, gated by a
   secret scan — nothing with a shape resembling a credential ever gets committed silently.

That's the whole mechanism. Everything else (linting the memory, watching for stale links,
scanning for merge candidates, tracking the competitive landscape) is built on top of it, never
a second source of truth.

## Commands

| Command | What it does |
|---|---|
| `/synapse-init` | First-time setup: clone/link the hub for this project. Idempotent — safe to re-run. |
| `/brain-search` | Hybrid search (semantic + exact match) across the hub. |
| `/brain-new` | Scaffold a new memory file with the conventional frontmatter. |
| `/brain-status` | Quick health snapshot for the current project: link state, corpus size, last audit. |
| `/brain-lint` | Frontmatter validity, expired entries, merge/split candidates — report only. |
| `/synapse-doctor` | Broader periodic audit (link, index, lint) in one report. Auto-fixes only a broken link — never a wrong-target one, that's a human call. |
| `/synapse-config` | Read or edit the hub's shared config — never by hand-editing a file. |
| `/synapse-refresh-projects` | Link every Claude Code project found under a given root, in one pass. |
| `/synapse-sync` | Manual commit + push, in case the automatic hook didn't run. |
| `/synapse-market-watch` | Read-only GitHub scan of comparable projects — never acts on what it finds. |
| `/synapse-uninstall` | Remove the link and local config for this project. The hub itself is never touched. |

## Install

Not yet published to a marketplace — load it in dev mode:

```bash
claude --plugin-dir /path/to/claude-synapse
```

Then run `/synapse-init` and give it the URL of a **private** git repo to use as your hub
(Synapse refuses to link a public one on GitHub — memory doesn't belong in a public repo).
Requires Node >= 20.

## Status

Core mechanism built and tested: 209 tests, real-hub validation (not just fixtures) surfaced
and fixed several real bugs along the way — a lexical fallback for bare-acronym search, word-
boundary matching to avoid false positives, incremental indexing, chunk-aware merge detection.
Not yet in a marketplace listing; the multi-project auto-detection (`/synapse-init` currently
configures one project at a time) is the next open piece.

## Learn more

[`docs/DESIGN.md`](docs/DESIGN.md) covers the architecture decisions behind each piece, the
trade-offs made on purpose, and the limitations documented as such rather than left implicit.

## License

MIT
