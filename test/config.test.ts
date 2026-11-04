import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/config.js";

describe("parseArgs", () => {
  const cwd = path.resolve("/proj");

  it("usa draft por padrão e aceita flags repetidas", () => {
    const c = parseArgs(["ws", "--manual", "a", "--manual=b", "--allow-dir", "prints"], cwd);
    expect(c.level).toBe("draft");
    expect(c.manuals).toEqual(["a", "b"]);
    expect(c.workspace).toBe(path.resolve(cwd, "ws"));
    expect(c.allowDirs).toEqual([c.workspace, cwd, path.resolve(cwd, "prints")]);
  });

  it("recusa nível e opção desconhecidos e workspace ausente", () => {
    expect(() => parseArgs(["ws", "--level", "admin"], cwd)).toThrow(/--level/);
    expect(() => parseArgs(["ws", "--x", "1"], cwd)).toThrow(/desconhecida/);
    expect(() => parseArgs([], cwd)).toThrow(/Uso/);
  });
});
