import { describe, it, expect } from "vitest";
import { scanContentForSecrets, scanFilesForSecrets } from "../src/security/secretScan.js";

describe("scanContentForSecrets", () => {
  it("finds nothing in ordinary prose", () => {
    expect(scanContentForSecrets("Décision du 12/03 : préférer la simplicité au clever.")).toEqual([]);
  });

  it("detects a PEM private key header", () => {
    const matches = scanContentForSecrets("-----BEGIN RSA PRIVATE KEY-----\nMIIExample==\n-----END RSA PRIVATE KEY-----");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.pattern).toBe("clé privée PEM");
    expect(matches[0]?.line).toBe(1);
  });

  it("detects a GitHub token", () => {
    // AWS's own documented example key format — not a real credential.
    const matches = scanContentForSecrets("export GH_TOKEN=ghp_1234567890abcdef1234567890abcdef1234");
    expect(matches.some((m) => m.pattern === "token GitHub")).toBe(true);
  });

  it("detects an AWS access key", () => {
    const matches = scanContentForSecrets("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
    expect(matches.some((m) => m.pattern === "clé d'accès AWS")).toBe(true);
  });

  it("detects a Slack token", () => {
    // "EXAMPLE" dans la valeur, même convention que le AKIA... d'AWS
    // ci-dessus — reconnu comme factice par le secret-scanning de GitHub.
    const matches = scanContentForSecrets("SLACK_TOKEN=xoxb-EXAMPLE-1234567890-abcdefgh");
    expect(matches.some((m) => m.pattern === "token Slack")).toBe(true);
  });

  it("detects a hardcoded generic secret assignment", () => {
    // Le pattern testé (clé/secret assigné en dur) est générique — il ne dépend
    // d'aucun préfixe de service réel (sk_live_, etc.), donc pas besoin d'en
    // imiter un : GitHub push-protection n'a pas d'allowlist "EXEMPLE" pour
    // Stripe comme pour AWS, mieux vaut ne ressembler à rien de reconnaissable.
    const matches = scanContentForSecrets('const apiKey = "notarealsecretvalue1234567890";');
    expect(matches.some((m) => m.pattern === "clé/secret assigné en dur")).toBe(true);
  });

  it("does not flag a short, obviously non-secret value assigned to a similar-looking key", () => {
    const matches = scanContentForSecrets('const apiKey = "unset";');
    expect(matches).toEqual([]);
  });

  it("redacts the matched excerpt — never surfaces the full secret", () => {
    const matches = scanContentForSecrets("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
    expect(matches[0]?.excerpt).not.toContain("IOSFODNN7EXAMPLE");
    expect(matches[0]?.excerpt).toMatch(/^AKIA…[A-Z0-9]{4}$/);
  });
});

describe("scanFilesForSecrets", () => {
  it("only includes files with at least one match", () => {
    const result = scanFilesForSecrets([
      { path: "clean.md", content: "rien ici" },
      { path: "risque.md", content: "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE" },
    ]);

    expect(Object.keys(result)).toEqual(["risque.md"]);
  });

  it("returns an empty object when nothing is found — not undefined, not a missing key", () => {
    expect(scanFilesForSecrets([{ path: "clean.md", content: "rien ici" }])).toEqual({});
  });
});
