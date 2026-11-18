import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";
import { lowerOwnPriority } from "../src/commands/processPriority.js";

// 17/11/2026 : un refresh qui réindexe une fiche de 693 Ko occupe 8 cœurs sur
// 14 pendant 170 s. C'est un travail de fond : il passe après ce que la
// personne fait vraiment sur la machine.

describe("lowerOwnPriority", () => {
  it("passe le processus sous la priorité normale", () => {
    const asked: number[] = [];

    expect(lowerOwnPriority((priority) => asked.push(priority))).toBe(true);
    expect(asked).toEqual([constants.priority.PRIORITY_BELOW_NORMAL]);
  });

  it("laisse le refresh tel quel quand le système refuse", () => {
    const refuse = (): void => {
      throw Object.assign(new Error("permission refusée"), { code: "EACCES" });
    };

    expect(lowerOwnPriority(refuse)).toBe(false);
  });
});

describe("contrat : le hook de refresh baisse sa priorité avant de travailler", () => {
  it("refreshIndexCli appelle lowerOwnPriority avant withRefreshLock", () => {
    const source = readFileSync(join(__dirname, "..", "src", "commands", "refreshIndexCli.ts"), "utf8");

    expect(source).toMatch(/lowerOwnPriority\(\);[\s\S]*withRefreshLock\(pluginDataDir,/);
  });
});
