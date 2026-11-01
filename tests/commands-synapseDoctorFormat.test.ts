import { describe, it, expect } from "vitest";
import { formatDoctorReport } from "../src/commands/synapseDoctor.js";
import type { SynapseDoctorReport } from "../src/commands/synapseDoctor.js";

// Backlog item 48 (15/10/2026) : "aucun doublon détecté" vivait dans le main() de
// synapseDoctorCli.ts, qui exécute `void main()` au chargement — un test ne peut
// pas l'importer sans le déclencher avec de faux argv. Même remède que
// formatDuplicateCandidate (item 44) : extraire le formatage en fonction pure,
// testable sans jamais toucher au process réel.
function baseReport(overrides: Partial<SynapseDoctorReport> = {}): SynapseDoctorReport {
  return {
    hubClonePath: "/hub",
    linkState: "ok",
    linkAutoFixed: false,
    fileCount: 3,
    findings: [],
    duplicateCandidates: [],
    projectsRelinked: [],
    knownMachines: {},
    ragEmbeddingModelVersion: "Xenova/some-model",
    ...overrides,
  };
}

describe("formatDoctorReport", () => {
  it("reports the hub and link state on the first two lines", () => {
    const lines = formatDoctorReport(baseReport());
    expect(lines[0]).toBe("hub: /hub (3 fichiers)");
    expect(lines[1]).toBe("lien: ok");
  });

  it("notes when a broken link was auto-fixed", () => {
    const lines = formatDoctorReport(baseReport({ linkAutoFixed: true }));
    expect(lines[1]).toBe("lien: ok (recréé automatiquement, était cassé)");
  });

  it("always reports the pinned embedding model version", () => {
    const lines = formatDoctorReport(baseReport());
    expect(lines).toContain("modèle d'embedding épinglé : Xenova/some-model");
  });

  // Le coeur de l'item 48 : cette ligne précise doit rester couverte par un test.
  it('reports "aucun doublon détecté" when there is nothing to report', () => {
    const lines = formatDoctorReport(baseReport({ findings: [], duplicateCandidates: [] }));
    expect(lines).toContain("brain-lint: rien à signaler, aucun doublon détecté.");
  });

  it("lists findings instead, when there are any", () => {
    const lines = formatDoctorReport(
      baseReport({ findings: [{ path: "a.md", severity: "warning", message: "oups" }] }),
    );
    expect(lines).toContain("[warning] a.md — oups");
    expect(lines).not.toContain("brain-lint: rien à signaler, aucun doublon détecté.");
  });

  it("lists known machines sorted by most recently seen", () => {
    const lines = formatDoctorReport(
      baseReport({ knownMachines: { ancien: "2026-01-01T00:00:00.000Z", recent: "2026-06-01T00:00:00.000Z" } }),
    );
    const idx = lines.findIndex((l) => l.startsWith("machines connues"));
    expect(lines[idx]).toBe("machines connues (2) :");
    expect(lines[idx + 1]).toContain("recent");
    expect(lines[idx + 2]).toContain("ancien");
  });

  it("omits the known-machines block entirely when there are none", () => {
    const lines = formatDoctorReport(baseReport({ knownMachines: {} }));
    expect(lines.some((l) => l.startsWith("machines connues"))).toBe(false);
  });
});
