# Design

The README covers what Synapse does and how to install it. This is the *why* — the
architecture decisions behind each piece, and the trade-offs that were deliberate rather than
accidental.

## The thesis, precisely

Tools that keep memory consistent across machines generally work by **syncing**: each machine
holds its own copy, and something (a background service, a manual command) reconciles them —
which means there is always a moment where two copies can diverge, and always a merge strategy
deciding what happens when they do.

Synapse avoids the reconciliation problem instead of solving it well: there is exactly **one**
physical copy of the memory, living in a git repository the user owns (the *hub*). Every
machine and every project reference that single copy through a filesystem link — an NTFS
junction on Windows, a symlink elsewhere. Reading or writing "the local memory" *is* reading or
writing the hub. Nothing is ever duplicated, so there is nothing to merge and no divergence to
detect.

The trade-off this buys: no conflict resolution logic anywhere in the codebase, no "last write
wins" surprises, no partial-sync states. The trade-off it costs: the hub itself is a single
point of failure for write access — if the network is down, the hub can't be cloned or pushed
to. That's accepted, not hidden; see "Known limitations" below.

## Seven design decisions

**1. Cross-platform linking.** A link creation failure hard-stops with a diagnostic and the
likely cause — it never silently falls back to copying files, because a silent copy would break
the single-copy guarantee without telling anyone. Re-running the setup command is always safe:
an existing correct link is left alone, a link pointing at the wrong place gets recreated
without asking, and if something *real* (not a link) already occupies the target path, it gets
renamed aside with a visible timestamp rather than overwritten. A post-install check writes a
marker file through the link and confirms it's visible at the hub — proof the link actually
works, not just that creating it didn't error.

**2. Two-layer configuration.** Some settings need to agree across every machine (how often to
audit, which embedding model version is pinned); others are inherently per-machine (the hub's
URL, the local clone path). Shared config lives inside the hub itself, versioned like everything
else in it. Local config lives outside the hub, one file per machine, never synced. Nothing is
ever hand-edited — a dedicated command reads and writes both.

**3. A whole-repo lock, not per-file.** Two machines could push a config change or a memory edit
at the same moment. Locking is deliberately coarse (the whole hub, not individual files) —
a memory corpus is small enough that finer-grained locking buys nothing but complexity. A lock
older than its configured timeout is reclaimed automatically, so a machine that crashed mid-write
can never block every other machine forever.

**4. A local, disposable search index — never a synced one.** Search runs against a small
SQLite database, rebuilt from the hub's markdown files whenever they've changed since the last
build (a content fingerprint decides "changed", diffed per-file so an edit to one file doesn't
force re-embedding the whole corpus). It is never committed to the hub: it's derived data, cheap
to regenerate, and syncing it would just reintroduce the exact reconciliation problem the whole
project exists to avoid.

Embeddings run locally (no external API call, no data leaving the machine) via a small
multilingual sentence-transformer, quantized to keep the download light. Long files are split
into overlapping windows sized against the *real* tokenizer the model uses — not an estimated
characters-per-token ratio, which measurably drifts across languages and content types (dense
markdown with code spans and wiki-links tokenizes quite differently from plain prose). A search
also runs a lexical exact-match pass alongside the semantic one: short, context-free queries —
an acronym, a project code name — are a known weak spot for embedding models, and a literal
match in the text is a reliable backstop for exactly that case.

**5. A daemon-less periodic audit.** Nothing runs in the background. Instead, a timestamp in
shared config records when the last full audit ran; every session start compares it against a
configurable cadence and triggers the audit inline if it's overdue. No process to keep alive, no
extra moving part — the audit piggybacks on something that already happens every session.

**6. Multi-project linking — two complementary mechanisms, one gap left.** A brand-new project
(one the user actually opens a Claude Code session in) gets linked automatically at session
start, zero action required. A project that already existed *before* Synapse was ever set up
needs one manual scan of its root (`/synapse-refresh-projects <root>`) — but that root is then
remembered in shared config, and every later periodic audit re-scans it on its own, so the
manual step only ever happens once per root. What's still missing: cleanup of a link left behind
after its project directory is removed — v1 only ever adds links, it never removes one on its
own initiative.

**7. Uninstall is deliberately narrow.** It removes the link for the current project and the
local config on this machine. It never touches the hub clone itself, and never asks whether to —
that's a real git repository the user may still want, not disposable plugin state.

## Tested at scale (16/08)

"A memory corpus is small enough that a specialized vector index buys nothing" was a design
assumption from day one, never actually measured beyond a few hundred real files — flagged
internally as something to validate before a public release, then published without being
checked. Measured afterwards (`scripts/scale-test.mjs`, synthetic corpus, a fast fake embed to
isolate algorithmic cost from real-model latency):

| Files | Index build | Search (linear cosine scan) | Merge-candidate detection (O(n²)) |
|---|---|---|---|
| 100 | 1.8s | 14ms | 0.3s |
| 500 | 8.9s | 63ms | 7.0s |
| 1,000 | 18.0s | 126ms | 27.3s |
| 2,000 | 37.6s | 207ms | 117.2s |

Search itself holds up fine — the linear scan stays well under a second even at thousands of
files, so the original assumption is correct for that piece. Merge-candidate detection is a
different story: it's a genuine O(n²) pairwise chunk comparison, and at 2,000 files alone it
already consumes most of the 120-second budget the automatic periodic audit runs inside. Fixed
the same day, not just documented: above a configurable file-count threshold
(`SharedConfig.mergeCandidatesMaxFiles`, default 500), the comparison is skipped entirely and
the report says why, rather than risking a hook timeout.

## Device registry (16/08)

A competitive review found two higher-starred comparable projects both track which machines are
actively using a shared memory store — genuinely useful, not just a feature-checklist item: it
answers "is this hub actually still in use from my old laptop" without having to go check. Added
the same day: `SharedConfig.knownMachines` maps each machine to when it last started a session
against this hub, updated on every `SessionStart` and surfaced in `/synapse-doctor`'s report.
Deliberately unlocked, unlike most shared-config writes — it's a soft presence signal, not
correctness-critical, and the one failure mode (two machines racing to write it at the exact
same instant) just leaves one machine's timestamp a session stale, which self-corrects the next
time that machine starts a session.

## Known limitations

- **`SessionEnd` sync is best-effort, not guaranteed.** The hook Claude Code calls at session end
  is documented as non-blocking, with no guarantee it completes before the process actually
  exits. A manual sync command exists specifically as the fallback for whatever the automatic
  hook missed — it is not just a documented caveat, it's a designed-around one.
- **Secret scanning is pattern-based, not entropy analysis.** It catches well-known credential
  *shapes* (cloud provider keys, PEM headers, common `key = "..."` assignments) — a deliberate
  scope, not full-coverage secret detection.
- **No single embedding model covers every language equally.** The multilingual model in use
  covers dozens of languages but not all of them, and empirically favors realistic paraphrases
  over rare literary synonyms. This is a property of embedding models generally, not specific to
  the one chosen here — documented as a real limitation rather than presented as solved.
- **Mixing embedding models in one hub is not supported, on purpose.** Cosine similarity only
  means something between vectors from the same model. One model is pinned per hub; changing it
  means re-embedding the whole corpus, never mixing two spaces in one index.
- **Assumes a note-taking convention it doesn't enforce.** The frontmatter/type/dating
  conventions used throughout this project are one way of organizing a memory hub, not the only
  one — a corpus with no frontmatter at all, or a very different structure (Obsidian-style,
  freeform), would work for search but get little value from `/brain-lint`'s frontmatter checks.
  No solution attempted; noted as an open question, not something quietly assumed universal.
- **A sentence-embedding model is a mediocre fit for non-prose content.** Code blocks, tables,
  and structured data embed and search noticeably worse than prose — the model wasn't built for
  them, and nothing here compensates for that.
- **Prompt injection via memory content itself is possible and unmitigated.** If a memory file
  ever contains adversarial text (pasted from a compromised external source, say) and
  `/brain-search` surfaces it into context, that text could attempt to influence the assistant
  reading it. Not specific to Synapse — a generic risk for any RAG system feeding an LLM — but
  worth naming rather than leaving implicit. No mitigation built for this yet.

## Security notes

The secret scanner (pattern-based, see above) and the hub-visibility check (`/synapse-init`
refuses to link a public GitHub repo) are the two active safeguards. A pass looking specifically
for injection surfaces found nothing to fix: git and SQLite calls use parameterized/argument-
array APIs throughout (no shell string concatenation, no `child_process.exec`, no `eval`), and
the one place a filename is derived from user input (`/brain-new`'s slug) strips everything
outside `a-z0-9-` before it touches the filesystem. What's explicitly out of scope: credential
management (relies on whatever git/GitHub auth is already configured on the machine), at-rest
encryption of the local index or config (the hub itself is already private; the machine's own
security is a different boundary), and the prompt-injection vector noted just above.

## Comparison with sync-based approaches

The category this sits in — keeping Claude Code memory consistent across machines — is mostly
served by tools that sync (copy + reconcile). Synapse's difference is structural, not a feature
checklist: there is nothing to reconcile because there is nothing duplicated. That buys away an
entire class of bugs (partial syncs, silent overwrites, "which copy is current") at the cost of
needing a git host reachable from every machine that wants access, and of the hub being a single
point of failure for writes when it isn't reachable.

`/synapse-market-watch` tracks a handful of comparable projects and scans for new ones — see it
for the current list, since that's exactly the kind of thing that goes stale in a written
document and stays current in a command that actually queries GitHub.

**A limitation in the watch mechanism itself, found 16/08**: it searches ONE fixed keyword
string ("claude code memory sync plugin"), sorted by stars alone. Proven on Synapse's own repo
before its description was fixed: it didn't match that query at all despite being exactly the
kind of project it describes — different wording, same category, invisible to a single fixed
query. A genuinely thorough "find the best of the market" pass needs more than this: multiple
query phrasings, a topic-based search (`topic:claude-code`) as a second axis independent of
wording, forks excluded, and activity/recency considered alongside star count (stars-only
sorting surfaces popular-but-abandoned projects and buries active-but-new ones). Not built —
`/synapse-market-watch` stays as a cheap, fast first pass; a deeper one-off review (like the
16/08 competitive read of 6 projects) is still worth doing by hand periodically.
