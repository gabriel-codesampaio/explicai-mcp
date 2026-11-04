import { describe, expect, it } from "vitest";
import { assertExplicaiVersion, EXPLICAI_RANGE, installedExplicaiVersion } from "../src/compat.js";

describe("faixa de versão do explicai", () => {
  it.each(["0.3.0", "0.3.9", "0.9.1", "1.0.0", "1.4.2", "1.0.0-rc.1"])("aceita %s", (v) => {
    expect(() => assertExplicaiVersion(v)).not.toThrow();
  });

  it.each(["0.2.1", "0.1.0"])("recusa %s (antigo) e manda atualizar o explicai", (v) => {
    expect(() => assertExplicaiVersion(v)).toThrow(/antigo demais.*npm install explicai@latest/);
  });

  it("recusa 2.0.0 (novo) e manda atualizar o MCP", () => {
    expect(() => assertExplicaiVersion("2.0.0")).toThrow(/mais novo.*explicai-mcp@latest/);
  });

  it("recusa versão ilegível ou ausente, citando a faixa", () => {
    expect(() => assertExplicaiVersion("abc")).toThrow(EXPLICAI_RANGE);
    expect(() => assertExplicaiVersion("")).toThrow(EXPLICAI_RANGE);
  });

  it("a faixa declarada bate com o peerDependencies", async () => {
    const pkg = (await import("../package.json", { with: { type: "json" } })).default;
    expect(pkg.peerDependencies.explicai).toBe(EXPLICAI_RANGE);
  });

  it("lê a versão instalada sem lançar (string ou undefined)", () => {
    expect(["string", "undefined"]).toContain(typeof installedExplicaiVersion());
  });
});
