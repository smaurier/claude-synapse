import { describe, it, expect } from "vitest";
import { parseArgs, formatResult } from "../src/commands/commitPathsCli.js";

describe("commitPathsCli parseArgs", () => {
  it("reads the data dir, the message and the paths after --", () => {
    expect(parseArgs(["/data", "-m", "nayeli: ch. 3", "--", "a.md", "b c.md"])).toEqual({
      pluginDataDir: "/data",
      message: "nayeli: ch. 3",
      paths: ["a.md", "b c.md"],
    });
  });

  it("refuses without paths or without message", () => {
    expect(parseArgs(["/data", "-m", "msg"])).toBeNull();
    expect(parseArgs(["/data", "--", "a.md"])).toBeNull();
  });
});

describe("commitPathsCli formatResult", () => {
  it("names the other session's commit for a path it already took", () => {
    const lines = formatResult({
      status: "nothing-to-commit",
      committed: [],
      elsewhere: [{ path: "mine.md", commit: "abc1234 nayeli: autre session" }],
    });
    expect(lines.join("\n")).toContain("mine.md : déjà dans l'historique, dernier commit qui le touche : abc1234 nayeli: autre session");
  });
});
