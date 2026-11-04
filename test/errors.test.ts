import { ExplicaiError } from "explicai/core";
import { describe, expect, it } from "vitest";
import { safe, UserError } from "../src/errors.js";

const fail = (err: unknown) =>
  safe(async () => {
    throw err;
  }).then((r) => r.content[0]?.text ?? "");

describe("safe", () => {
  it.each([
    "/opt/app/x.png",
    "/root/.ssh/id",
    "/Volumes/Disco/x",
    "/srv/data/x",
    "/app/src/x.ts",
    "/private/var/x",
    "/home/ana/my docs/x.png",
    String.raw`C:\Users\ana\x.png`,
    "D:/dados/x.png",
    String.raw`\\srv\share\x`,
    "/app",
  ])("esconde %s numa mensagem de UserError", async (p) => {
    const text = await fail(new UserError(`Falhou em '${p}' agora`));
    expect(text).not.toMatch(/opt|root|Volumes|srv|app|private|ana|dados|docs|Users/);
    expect(text).toContain("<caminho>");
  });

  it("não estraga URL nem caminho relativo", async () => {
    const msg = "Veja https://a.com/x e ../assets/tela.png, assets/b.png e a/b";
    expect(await fail(new UserError(msg))).toBe(msg);
  });

  it("erro nativo não repassa a mensagem, só o código", async () => {
    const err = Object.assign(new Error("EACCES, open '/etc/shadow'"), { code: "EACCES" });
    expect(await fail(err)).toBe("Erro inesperado (EACCES)");
    expect(await fail(new Error("falha em /home/ana/x"))).toBe("Erro inesperado");
  });

  it("ExplicaiError passa a mensagem", async () => {
    expect(await fail(new ExplicaiError("x", "Mudou. Leia de novo."))).toBe("Mudou. Leia de novo.");
  });
});
