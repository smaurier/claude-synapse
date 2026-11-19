# Synapse

![CI](https://github.com/smaurier/claude-synapse/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node >= 22.5](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen)

**Your Claude Code memory is a git repo.**

You teach Claude something in one project, and the next project has never heard of it.
You switch to your other machine, and it's gone again.

Synapse gives Claude Code one memory, shared by every project on every machine. That memory is a
plain git repo you own. Not a backup of it, not a sync of it: the repo *is* the memory.

So everything you already know from git now works on what your AI remembers:

- `git log`: when did Claude learn this, and on which machine?
- `git diff`: what changed in its memory this week?
- `git revert`: it learned something wrong? Undo it.

## Quick start

```
/plugin marketplace add smaurier/claude-synapse
/plugin install synapse@synapse
/synapse-init
```

Give `/synapse-init` the URL of a **private** git repo: that repo becomes your hub. Run it again in
any other project, or on any other machine, and they all share the same memory.

Requires Node >= 22.5 (the local search index uses `node:sqlite`, a builtin from that version on).

## What you get

- **Recall without asking.** Before Claude answers, Synapse searches your memory and hands it the
  few notes that matter for this prompt.
- **Search it yourself.** `/brain-search` combines semantic and exact-match search, so names and
  acronyms are found too, not just ideas.
- **Saved on its own.** At the end of every session, changes are committed and pushed, with the
  machine name in the commit message, after a secret scan.
- **Private by design.** Synapse refuses a public GitHub repo as a hub. The search index stays on
  your machine and is never committed.
- **A memory that stays healthy.** `/brain-lint` and `/synapse-doctor` flag expired notes, probable
  duplicates and broken links. Report only: you decide what to change.
- **Survives compaction.** The memories you searched for during a session are handed back to
  Claude after a compaction.
- **Cross-platform.** NTFS junctions on Windows, symlinks on macOS and Linux.

## Don't sync it. Link it.

```
              ┌──────────────────────────────┐
              │   your private git remote    │
              └───────┬──────────────┬───────┘
                 push │ pull    push │ pull
              ┌───────▼──────┐ ┌─────▼────────┐
              │  machine A   │ │  machine B   │
              │  one clone   │ │  one clone   │
              └──┬────────┬──┘ └──────┬───────┘
            link │   link │      link │
                 ▼        ▼           ▼
            project 1 project 2   project 1
```

Each machine holds one clone of your hub. Every project on that machine reads and writes it
through a filesystem link, so there is nothing to copy between projects. Between machines, it's
plain git.

|  | Sync-based tools | Synapse |
|---|---|---|
| Where your memory lives | On each machine, copied to a remote and back | In a git repo you own: the repo is the memory |
| Two machines disagree | Merged by the tool's own logic, sometimes by an LLM | Merged by git, in the open, with full history |
| New machine | Install, then a first sync | Clone once, link every project to it |

See [`docs/DESIGN.md`](docs/DESIGN.md) for the full reasoning and trade-offs, not just the pitch.

## Commands

| Command | What it does |
|---|---|
| `/synapse-init` | Link this project to your hub. Safe to re-run. |
| `/brain-search` | Search your memory: semantic and exact match. |
| `/brain-new` | Create a memory file with the conventional frontmatter. |
| `/brain-status` | Link state, corpus size and last audit for this project. |
| `/synapse-doctor` | Full periodic check-up in one report. Its only auto-fix is a broken link. |

<details>
<summary>14 more commands</summary>

| Command | What it does |
|---|---|
| `/brain-lint` | Frontmatter validity, expired entries, probable duplicates, split candidates. Report only. |
| `/brain-audit` | Semantic audit of one memory or a small group: contradictions, dead data, findability. On demand, never automatic. |
| `/synapse-refresh-projects` | Link every Claude Code project under a root in one pass. The root is remembered, so later audits keep scanning it. |
| `/synapse-register-project` | Register a project's local path on this machine, so memories that cite its code can resolve it. |
| `/synapse-sync` | Commit and push now, in case the automatic hook didn't run. |
| `/synapse-commit` | Commit only the named paths into the hub, under the hub lock, then push. Safe when several sessions share the hub. |
| `/synapse-sync-status` | Check every watched repo for local/remote divergence. Alerts only, never pulls or pushes. |
| `/synapse-config` | Read or edit the hub's shared config, or forget a retired machine, without hand-editing a file. |
| `/synapse-recent-sessions` | List your recent Claude Code sessions on this machine: date, title, project. |
| `/synapse-market-watch` | Read-only GitHub scan of comparable projects. |
| `/synapse-ideas-refresh` | Check the hub's ideas registry against reality and update it. On demand only. |
| `/synapse-redteam` | Manual red-team of memory poisoning: can adversarial content in the hub steer the agent? |
| `/synapse-deps-update` | Apply the safe subset of dependency fixes (dev-only, non-major) in the plugin's own development repo. |
| `/synapse-uninstall` | Remove the link and local config for this project. The hub itself is never touched. |

</details>

## Status

Used every day by its author across two machines. 600+ tests, CI on Ubuntu and Windows.
The design decisions, the trade-offs made on purpose and the known limits are documented in
[`docs/DESIGN.md`](docs/DESIGN.md).

To try it without registering a marketplace:

```bash
claude --plugin-dir /path/to/claude-synapse
```

## Contributing

Bug reports, improvement requests and suggestions are welcome: [open an issue](https://github.com/smaurier/claude-synapse/issues/new).

## License

MIT
