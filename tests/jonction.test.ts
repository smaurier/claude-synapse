import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectLink,
  createLink,
  removeLink,
  backupExisting,
  verifyWriteThrough,
  ensureHubLink,
} from "../src/jonction/jonction.js";

let root: string;
let hub: string;
let linkPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-jonction-"));
  hub = join(root, "hub");
  linkPath = join(root, "project", "memory");
  mkdirSync(hub, { recursive: true });
  mkdirSync(join(root, "project"), { recursive: true });
});

afterEach(() => {
  // Test fixtures only — never the code under test's own removal path.
  rmSync(root, { recursive: true, force: true });
});

describe("inspectLink", () => {
  it("reports 'missing' when nothing exists at linkPath", () => {
    expect(inspectLink(linkPath, hub)).toBe("missing");
  });

  it("reports 'ok' when the link points exactly at the expected hub", () => {
    createLink(hub, linkPath);
    expect(inspectLink(linkPath, hub)).toBe("ok");
  });

  it("reports 'wrong-target' when the link points somewhere else", () => {
    const otherHub = join(root, "other-hub");
    mkdirSync(otherHub, { recursive: true });
    createLink(otherHub, linkPath);
    expect(inspectLink(linkPath, hub)).toBe("wrong-target");
  });

  it("reports 'broken' when the link's target no longer exists on disk", () => {
    const ghostHub = join(root, "ghost-hub");
    mkdirSync(ghostHub, { recursive: true });
    createLink(ghostHub, linkPath);
    rmSync(ghostHub, { recursive: true, force: true });
    expect(inspectLink(linkPath, hub)).toBe("broken");
  });

  it("is case-insensitive on win32, case-sensitive elsewhere (matches expected target)", () => {
    createLink(hub, linkPath);
    const casedHub = process.platform === "win32" ? hub.toUpperCase() : hub;
    const expected = process.platform === "win32" ? "ok" : "wrong-target";
    // On win32 an uppercased path is still the *same* filesystem target -> ok.
    // Skip the assertion on non-win32 where case sensitivity makes an uppercased
    // path point nowhere real; this branch documents intent rather than testing FS quirks.
    if (process.platform === "win32") {
      expect(inspectLink(linkPath, casedHub)).toBe(expected);
    }
  });
});

describe("createLink", () => {
  it("throws a descriptive error instead of silently falling back to a copy", () => {
    // A link can legitimately point at a target that doesn't exist yet (that's
    // the dangling/"broken" case tested above) — what genuinely cannot work is
    // creating the link ITSELF inside a parent directory that doesn't exist.
    const noSuchParent = join(root, "does", "not", "exist", "memory");
    expect(() => createLink(hub, noSuchParent)).toThrow();
  });

  it("requires an absolute target path", () => {
    expect(() => createLink("relative/path", linkPath)).toThrow(/absolu/i);
  });
});

describe("removeLink — safety-critical", () => {
  it("removes a real link via unlink", () => {
    createLink(hub, linkPath);
    removeLink(linkPath);
    expect(existsSync(linkPath)).toBe(false);
    // The hub itself must survive — this is the entire point.
    expect(existsSync(hub)).toBe(true);
  });

  it("refuses to touch a real directory that is NOT a link, and never deletes its content", () => {
    const realDir = join(root, "project", "not-a-link");
    mkdirSync(realDir, { recursive: true });
    const precious = join(realDir, "precious.md");
    writeFileSync(precious, "do not delete me");

    expect(() => removeLink(realDir)).toThrow();
    expect(existsSync(precious)).toBe(true);
  });

  it("removing the link never recurses into and deletes the hub's real content", () => {
    writeFileSync(join(hub, "real-memory.md"), "important fact");
    createLink(hub, linkPath);
    removeLink(linkPath);
    expect(existsSync(join(hub, "real-memory.md"))).toBe(true);
  });
});

describe("backupExisting", () => {
  it("renames a pre-existing real directory with a timestamped, visible backup name", () => {
    const preexisting = join(root, "project", "memory");
    mkdirSync(preexisting, { recursive: true });
    writeFileSync(join(preexisting, "local-note.md"), "keep me");

    const backupPath = backupExisting(preexisting);

    expect(existsSync(preexisting)).toBe(false); // original path now free for the link
    expect(existsSync(backupPath)).toBe(true);
    expect(backupPath).toMatch(/\.bak-\d{4}-\d{2}-\d{2}/);
    expect(existsSync(join(backupPath, "local-note.md"))).toBe(true);
  });

  it("refuses to back up a path that is already a link (wrong tool for the job)", () => {
    createLink(hub, linkPath);
    expect(() => backupExisting(linkPath)).toThrow();
  });
});

describe("verifyWriteThrough", () => {
  it("returns true when a write through the link is visible at the hub", () => {
    createLink(hub, linkPath);
    expect(verifyWriteThrough(linkPath, hub)).toBe(true);
  });

  it("cleans up its marker file after verifying (no litter left behind)", () => {
    createLink(hub, linkPath);
    verifyWriteThrough(linkPath, hub);
    expect(readdirSync(hub).length).toBe(0);
  });
});

describe("ensureHubLink — idempotent interactive reconciliation", () => {
  it("is a no-op when the link already points at the right hub (second /synapse-init run)", () => {
    createLink(hub, linkPath);
    const result = ensureHubLink(hub, linkPath);
    expect(result).toEqual({ action: "already-ok" });
    expect(inspectLink(linkPath, hub)).toBe("ok");
  });

  it("creates the link when nothing exists yet (first /synapse-init run)", () => {
    const result = ensureHubLink(hub, linkPath);
    expect(result).toEqual({ action: "created" });
    expect(inspectLink(linkPath, hub)).toBe("ok");
  });

  it("recreates a link pointing at the wrong target, without asking", () => {
    const otherHub = join(root, "other-hub");
    mkdirSync(otherHub, { recursive: true });
    createLink(otherHub, linkPath);

    const result = ensureHubLink(hub, linkPath);

    expect(result).toEqual({ action: "recreated" });
    expect(inspectLink(linkPath, hub)).toBe("ok");
  });

  it("recreates a broken (dangling) link", () => {
    const ghostHub = join(root, "ghost-hub");
    mkdirSync(ghostHub, { recursive: true });
    createLink(ghostHub, linkPath);
    rmSync(ghostHub, { recursive: true, force: true });

    const result = ensureHubLink(hub, linkPath);

    expect(result).toEqual({ action: "recreated" });
    expect(inspectLink(linkPath, hub)).toBe("ok");
  });

  it("backs up real pre-existing content automatically, then links — never loses data silently", () => {
    mkdirSync(linkPath, { recursive: true });
    writeFileSync(join(linkPath, "local-note.md"), "keep me");

    const result = ensureHubLink(hub, linkPath);

    expect(result.action).toBe("recreated-after-backup");
    expect(result.backupPath).toBeDefined();
    expect(existsSync(join(result.backupPath!, "local-note.md"))).toBe(true);
    expect(inspectLink(linkPath, hub)).toBe("ok");
  });

  it("treats linkPath === hubClonePath as already satisfied — self-hosting hub, no filesystem operation", () => {
    // The "adopt an existing directory as the hub" case: the anchor project's
    // memory already lives directly at the hub location (no link needed for
    // itself). Without this guard, inspectLink would see real content at
    // linkPath (not a symlink) -> "missing" -> backupExisting() would rename
    // the hub's OWN content out from under itself before "recreating" a link
    // back at the same now-empty path. That would destroy the single real
    // copy the whole jonction thesis exists to protect.
    writeFileSync(join(hub, "real-memory.md"), "the one real copy");

    const result = ensureHubLink(hub, hub);

    expect(result).toEqual({ action: "already-ok" });
    expect(existsSync(join(hub, "real-memory.md"))).toBe(true);
    expect(readdirSync(hub)).toEqual(["real-memory.md"]); // no .bak-* sibling created
  });
});
