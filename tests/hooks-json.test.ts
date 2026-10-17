import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface CommandHook {
  type: string;
  command: string;
  timeout?: number;
  async?: boolean;
}
interface HooksFile {
  hooks: Record<string, Array<{ matcher?: string; hooks: CommandHook[] }>>;
}

const hooks = JSON.parse(readFileSync(join(__dirname, "..", "hooks", "hooks.json"), "utf8")) as HooksFile;
const commandsOf = (event: string): CommandHook[] => (hooks.hooks[event] ?? []).flatMap((g) => g.hooks);

// Backlog 51 (16/10/2026) : le contrat de répartition reconstruction /
// lecture entre les hooks. Un refactor qui remettrait la reconstruction
// dans le hook UserPromptSubmit (15 s) rejouerait la boucle de timeouts.
describe("hooks.json — répartition index / rappel", () => {
  it("le rappel proactif (UserPromptSubmit) reste borné à 15 s : il ne reconstruit pas, il n'a pas besoin de plus", () => {
    const [recall] = commandsOf("UserPromptSubmit");
    expect(recall?.command).toContain("proactiveRecallCli.js");
    expect(recall?.timeout).toBe(15);
  });

  it("la reconstruction après édition tourne dans un hook Stop ASYNCHRONE, pour ne jamais bloquer le prompt suivant", () => {
    const refresh = commandsOf("Stop").find((h) => h.command.includes("refreshIndexCli.js"));
    expect(refresh).toBeDefined();
    expect(refresh?.async).toBe(true);
    expect(refresh?.timeout).toBeGreaterThanOrEqual(120);
  });
});
