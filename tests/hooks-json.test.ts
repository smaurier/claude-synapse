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

  // 17/11/2026, correctif 0.1.15. Le verrou et le plafond vivent dans
  // refreshIndexCli : ce contrat garantit que la reconstruction passe par lui,
  // une seule fois par fin de tour, et jamais par un hook qui bloque le prompt
  // (retour en arrière vers le rappel UserPromptSubmit, cf. correctif 0.1.7).
  it("le hook Stop lance refreshIndexCli, une seule fois, et rien d'autre", () => {
    const stop = commandsOf("Stop");

    expect(stop).toHaveLength(1);
    expect(stop[0]?.command).toContain("dist/commands/refreshIndexCli.js");
    expect(stop[0]?.async).toBe(true);
  });

  it("UserPromptSubmit ne reconstruit jamais l'index", () => {
    const commands = commandsOf("UserPromptSubmit").map((h) => h.command);

    expect(commands).toHaveLength(1);
    expect(commands.join(" ")).not.toContain("refreshIndexCli");
  });

  it("hors SessionStart, tout hook qui reconstruit l'index est asynchrone", () => {
    const blockingRebuilds = Object.keys(hooks.hooks)
      .filter((event) => event !== "SessionStart")
      .flatMap((event) => commandsOf(event).map((h) => ({ event, ...h })))
      .filter((h) => h.command.includes("refreshIndexCli") && h.async !== true)
      .map((h) => h.event);

    expect(blockingRebuilds).toEqual([]);
  });

  it("refreshIndexCli reçoit le dossier de données du plugin, où vit son verrou", () => {
    const rebuilds = Object.keys(hooks.hooks)
      .flatMap((event) => commandsOf(event))
      .filter((h) => h.command.includes("refreshIndexCli"));

    expect(rebuilds.length).toBeGreaterThan(0);
    for (const h of rebuilds) expect(h.command).toContain('"${CLAUDE_PLUGIN_DATA}"');
  });
});
