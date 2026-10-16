import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmTree } from "./helpers/fsTemp.js";
import {
  classifyVulnerability,
  auditVulnerabilities,
  auditOutdated,
  auditDependencies,
  collectDependencyFindings,
  runCommandCapturingStdout,
  resolveNpmBinary,
  type NpmAuditReport,
  type NpmAuditVulnerability,
  type NpmOutdatedReport,
  type DependencyAuditRunner,
} from "../src/commands/dependencyAudit.js";

/**
 * Rejouée depuis `npm audit --json` lancé réellement sur ce dépôt le
 * 16/10/2026, après la dernière montée de version : 6 vulnérabilités (2
 * critical, 1 high, 3 moderate), toutes transitives à `vitest` (dev-only),
 * toutes résolues par `vitest@3.2.7` qui EST un major. Les tableaux `via`
 * sont raccourcis (une advisory au lieu de deux/trois) mais la forme — chaîne
 * vs objet `{ title }`, `fixAvailable` en objet `{ name, version,
 * isSemVerMajor }` — est fidèle à la sortie réelle.
 */
const REAL_AUDIT_FIXTURE: NpmAuditReport = {
  vulnerabilities: {
    "@vitest/mocker": {
      severity: "moderate",
      via: [{ title: "Vitest: Path Traversal / Arbitrary File Read via @vitest/mocker Redirect Mock" }, "vite"],
      effects: ["vitest"],
      fixAvailable: { name: "vitest", version: "3.2.7", isSemVerMajor: true },
    },
    esbuild: {
      severity: "moderate",
      via: [{ title: "esbuild enables any website to send any requests to the development server and read the response" }],
      effects: ["vite"],
      fixAvailable: { name: "vitest", version: "3.2.7", isSemVerMajor: true },
    },
    tinypool: {
      severity: "critical",
      via: [{ title: "Tinypool: Prototype Pollution gadget in worker options leads to Remote Code Execution" }],
      effects: ["vitest"],
      fixAvailable: { name: "vitest", version: "3.2.7", isSemVerMajor: true },
    },
    vite: {
      severity: "high",
      via: [{ title: "vite: `server.fs.deny` bypass on Windows alternate paths" }, "esbuild"],
      effects: ["@vitest/mocker", "vite-node", "vitest"],
      fixAvailable: { name: "vitest", version: "3.2.7", isSemVerMajor: true },
    },
    "vite-node": {
      severity: "moderate",
      via: ["vite"],
      effects: ["vitest"],
      fixAvailable: { name: "vitest", version: "3.2.7", isSemVerMajor: true },
    },
    vitest: {
      severity: "critical",
      via: [
        "@vitest/mocker",
        { title: "When Vitest UI server is listening, arbitrary file can be read and executed" },
        "tinypool",
        "vite",
        "vite-node",
      ],
      effects: [],
      fixAvailable: { name: "vitest", version: "3.2.7", isSemVerMajor: true },
    },
  },
};

const PROD_DEPS = new Set(["@huggingface/transformers"]);

describe("classifyVulnerability", () => {
  it("classifies a production dependency with a fix available as needing the owner, NOT as safe to apply", () => {
    const vuln: NpmAuditVulnerability = { severity: "high", via: [], fixAvailable: true };
    expect(classifyVulnerability("@huggingface/transformers", vuln, PROD_DEPS)).toBe("needs-owner");
  });

  it("classifies a dev-only dependency with a non-major fix as safe to apply", () => {
    const vuln: NpmAuditVulnerability = {
      severity: "moderate",
      via: [],
      fixAvailable: { name: "eslint", version: "10.8.2", isSemVerMajor: false },
    };
    expect(classifyVulnerability("eslint", vuln, PROD_DEPS)).toBe("safe-to-apply");
  });

  it("classifies a dev-only dependency whose fix is isSemVerMajor: true as refused, human decision", () => {
    const vuln: NpmAuditVulnerability = {
      severity: "critical",
      via: [],
      fixAvailable: { name: "vitest", version: "3.2.7", isSemVerMajor: true },
    };
    expect(classifyVulnerability("vitest", vuln, PROD_DEPS)).toBe("refused-major");
  });

  it("records fixAvailable: false as having no fix", () => {
    const vuln: NpmAuditVulnerability = { severity: "low", via: [], fixAvailable: false };
    expect(classifyVulnerability("some-pkg", vuln, PROD_DEPS)).toBe("no-fix");
  });

  it("a dev-only package whose fixAvailable is true is still 'needs-owner' when reachable through a production dependency via `effects`", () => {
    const vuln: NpmAuditVulnerability = {
      severity: "moderate",
      via: [],
      effects: ["@huggingface/transformers"],
      fixAvailable: true,
    };
    expect(classifyVulnerability("some-dev-only-transitive", vuln, PROD_DEPS)).toBe("needs-owner");
  });

  it("a dev-only package reachable through production via a string entry in `via` is also 'needs-owner'", () => {
    const vuln: NpmAuditVulnerability = {
      severity: "moderate",
      via: ["@huggingface/transformers"],
      fixAvailable: { name: "x", version: "1.0.0", isSemVerMajor: false },
    };
    expect(classifyVulnerability("some-dev-only-dependent", vuln, PROD_DEPS)).toBe("needs-owner");
  });
});

describe("auditVulnerabilities", () => {
  it("produces no finding at all on an empty audit, rather than a finding saying zero", () => {
    expect(auditVulnerabilities({ vulnerabilities: {} }, PROD_DEPS)).toEqual([]);
  });

  it("on the realistic fixture (6 vulns, all dev-only, all requiring a vitest major), everything lands in 'needs a decision', none safe", () => {
    const findings = auditVulnerabilities(REAL_AUDIT_FIXTURE, PROD_DEPS);

    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding!.path).toBe("(corpus)");
    expect(finding!.severity).toBe("warning");
    expect(finding!.message).toContain("6 vulnérabilité");
    expect(finding!.message).toContain("0 sûre");
    expect(finding!.message).toContain("6 nécessite");
    // Les six paquets sont nommés...
    for (const name of ["@vitest/mocker", "esbuild", "tinypool", "vite", "vite-node", "vitest"]) {
      expect(finding!.message).toContain(name);
    }
    // ...mais le rapport ne vide jamais chaque advisory : ni les titres
    // d'advisory GitHub, ni les URLs ne doivent fuiter dans le message.
    expect(finding!.message).not.toContain("GHSA");
    expect(finding!.message).not.toContain("https://");
    expect(finding!.message).not.toContain("Prototype Pollution");
  });

  it("counts the safe-to-apply and needs-a-decision populations separately and names them, never dumping every advisory", () => {
    const audit: NpmAuditReport = {
      vulnerabilities: {
        "dev-pkg-safe": { severity: "low", via: [], fixAvailable: { name: "dev-pkg-safe", version: "1.1.0", isSemVerMajor: false } },
        "dev-pkg-major": { severity: "high", via: [], fixAvailable: { name: "dev-pkg-major", version: "2.0.0", isSemVerMajor: true } },
        "@huggingface/transformers": { severity: "critical", via: [], fixAvailable: true },
      },
    };

    const [finding] = auditVulnerabilities(audit, PROD_DEPS);

    expect(finding!.message).toContain("1 sûre");
    expect(finding!.message).toContain("dev-pkg-safe");
    expect(finding!.message).toContain("2 nécessite");
    expect(finding!.message).toContain("dev-pkg-major");
    expect(finding!.message).toContain("@huggingface/transformers");
    expect(finding!.message).toContain("production");
  });
});

describe("auditOutdated", () => {
  it("produces no finding when nothing is outdated", () => {
    expect(auditOutdated({}, PROD_DEPS, new Set())).toEqual([]);
  });

  it("excludes packages already reported as vulnerable, to avoid double-reporting the same package", () => {
    const outdated: NpmOutdatedReport = { vitest: { current: "2.1.9", wanted: "2.1.9", latest: "3.2.7" } };
    expect(auditOutdated(outdated, PROD_DEPS, new Set(["vitest"]))).toEqual([]);
  });

  it("reports an outdated, non-vulnerable dev dependency and flags a major bump explicitly", () => {
    const outdated: NpmOutdatedReport = {
      typescript: { current: "5.9.3", wanted: "5.9.3", latest: "7.0.2" },
      "typescript-eslint": { current: "8.67.0", wanted: "8.67.0", latest: "8.71.2" },
    };

    const [finding] = auditOutdated(outdated, PROD_DEPS, new Set());

    expect(finding!.path).toBe("(corpus)");
    expect(finding!.message).toContain("2 dépendance");
    expect(finding!.message).toContain("typescript (majeur)");
    expect(finding!.message).toContain("typescript-eslint");
    expect(finding!.message).not.toContain("typescript-eslint (majeur)");
  });

  it("flags a production dependency explicitly, distinct from a major bump", () => {
    const outdated: NpmOutdatedReport = {
      "@huggingface/transformers": { current: "4.3.1", wanted: "4.3.1", latest: "4.4.0" },
    };

    const [finding] = auditOutdated(outdated, PROD_DEPS, new Set());

    expect(finding!.message).toContain("@huggingface/transformers (production)");
  });
});

describe("auditDependencies", () => {
  it("treats a null audit or a null outdated report as nothing to say, never as an error", () => {
    expect(auditDependencies(null, null, PROD_DEPS)).toEqual([]);
    expect(auditDependencies(REAL_AUDIT_FIXTURE, null, PROD_DEPS).length).toBeGreaterThan(0);
    expect(auditDependencies(null, { x: { current: "1", wanted: "1", latest: "2" } }, PROD_DEPS).length).toBeGreaterThan(0);
  });
});

describe("runCommandCapturingStdout (le piège du code de sortie non-zéro)", () => {
  // Fichiers plutôt que `-e "<script inline>"` : `shell: true` (nécessaire
  // pour .cmd Windows, voir plus bas) fait passer la commande par cmd.exe,
  // qui traite `(`, `)` et `;` comme des métacaractères — un script inline
  // contenant ces caractères (comme `JSON.stringify({ok: true})`) se
  // retrouve tronqué par le shell avant même d'atteindre node. Un fichier
  // évite la question entièrement : aucun caractère spécial ne traverse la
  // ligne de commande, seul le chemin du fichier (sans espace ici).
  let scriptsDir: string;

  beforeEach(() => {
    scriptsDir = mkdtempSync(join(tmpdir(), "synapse-dep-audit-scripts-"));
  });

  afterEach(() => {
    rmTree(scriptsDir);
  });

  function writeScript(content: string): string {
    const path = join(scriptsDir, "script.cjs");
    writeFileSync(path, content, "utf8");
    return path;
  }

  it("still parses stdout when the process exits with a non-zero code — the exact trap of npm audit/outdated", async () => {
    const script = writeScript("console.log(JSON.stringify({ ok: true })); process.exitCode = 1;");

    const stdout = await runCommandCapturingStdout(process.execPath, [script], process.cwd());

    expect(JSON.parse(stdout)).toEqual({ ok: true });
  });

  it("gives up after the timeout rather than hanging, and resolves (never rejects)", async () => {
    const script = writeScript("setTimeout(function () {}, 5000);");
    const start = Date.now();

    const stdout = await runCommandCapturingStdout(process.execPath, [script], process.cwd(), 200);

    expect(Date.now() - start).toBeLessThan(4000);
    expect(typeof stdout).toBe("string");
  });

  it("resolves with an empty string rather than rejecting when the command itself doesn't exist", async () => {
    await expect(runCommandCapturingStdout("une-commande-qui-nexiste-pas-xyz", [], process.cwd())).resolves.toBe("");
  });

  /**
   * Trouvé le 16/10/2026 (revue du coordinateur) : `execFile("npm", ...)`
   * rend ENOENT sous Windows (le binaire s'appelle `npm.cmd`), et comme
   * toute l'implémentation est fail-silent par conception (c'est le bon
   * choix pour un hook SessionStart), ce test-ci était le seul capable de
   * l'attraper — toutes les autres tests injectent un faux runner, donc
   * rien n'exécutait jamais le vrai chemin. Sans ce test, le check restait
   * muet pour toujours sur Windows en ayant l'air parfaitement sain : c'est
   * exactement le mode de panne que cet item devait éviter.
   *
   * `npm --version` plutôt que `npm audit`/`npm outdated` : hors-ligne et
   * instantané, donc ni lent ni flaky — contrairement aux deux vraies
   * commandes qui interrogent le registre. Ce test tourne sur les deux
   * jambes de la matrice CI (ubuntu-latest, windows-latest) et c'est le
   * seul de cette tâche qui peut échouer pour une raison de plateforme.
   */
  it("spawns the real, platform-correct npm binary and gets real stdout back (npm --version, offline, instant)", async () => {
    const stdout = await runCommandCapturingStdout(resolveNpmBinary(), ["--version"], process.cwd());

    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("collectDependencyFindings", () => {
  const createdRoots: string[] = [];

  afterEach(() => {
    while (createdRoots.length > 0) rmTree(createdRoots.pop()!);
  });

  function makeFakePluginRoot(dependencies: Record<string, string>, devDependencies: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "synapse-dep-audit-"));
    createdRoots.push(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fake-plugin", dependencies, devDependencies }), "utf8");
    return root;
  }

  it("produces no findings when package.json is missing — can't tell prod from dev safely, so says nothing rather than guessing", async () => {
    const root = mkdtempSync(join(tmpdir(), "synapse-dep-audit-nopkg-"));
    createdRoots.push(root);
    const findings = await collectDependencyFindings(root);
    expect(findings).toEqual([]);
  });

  it("produces no findings when npm's output is unparsable, rather than throwing", async () => {
    const root = makeFakePluginRoot({ "@huggingface/transformers": "4.3.1" }, { vitest: "2.1.9" });
    const brokenRunner: DependencyAuditRunner = {
      runNpmAudit: async () => "ceci n'est pas du json {{{",
      runNpmOutdated: async () => "",
    };

    const findings = await collectDependencyFindings(root, brokenRunner);

    expect(findings).toEqual([]);
  });

  it("wires a real-shaped audit + outdated pair end to end into findings", async () => {
    const root = makeFakePluginRoot(
      { "@huggingface/transformers": "4.3.1" },
      { "@types/node": "22.20.1", eslint: "10.8.1", typescript: "5.9.3", "typescript-eslint": "8.67.0", vitest: "2.1.9" },
    );
    const outdated: NpmOutdatedReport = {
      "@types/node": { current: "22.20.1", wanted: "22.20.1", latest: "26.6.5" },
      "typescript-eslint": { current: "8.67.0", wanted: "8.67.0", latest: "8.71.2" },
    };
    const fakeRunner: DependencyAuditRunner = {
      runNpmAudit: async () => JSON.stringify(REAL_AUDIT_FIXTURE),
      runNpmOutdated: async () => JSON.stringify(outdated),
    };

    const findings = await collectDependencyFindings(root, fakeRunner);

    expect(findings).toHaveLength(2);
    expect(findings[0]!.message).toContain("6 vulnérabilité");
    expect(findings[1]!.message).toContain("@types/node (majeur)");
  });
});
