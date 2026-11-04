import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readAnnotations, updatePage } from "explicai/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { Config, Level } from "../src/config.js";
import { createServer } from "../src/server.js";

/** PNG 1x1 completo (com IEND): o redact valida a estrutura. */
const PNG1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

let ws: string;

async function connect(level: Level = "draft") {
  const cfg: Config = { workspace: ws, level, manuals: [], allowDirs: [ws] };
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([createServer(cfg).connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    const text = r.content[0]?.text ?? "";
    return { error: r.isError === true, text, json: r.isError ? null : JSON.parse(text) };
  };
  const prompt = async (name: string, args: Record<string, string>) =>
    ((await client.getPrompt({ name, arguments: args })).messages[0] as { content: { text: string } }).content.text;
  return { client, call, prompt };
}

beforeEach(async () => {
  ws = path.join(await mkdtemp(path.join(tmpdir(), "mcp2-")), "ws");
  await mkdir(ws);
});

describe("check_manual", () => {
  it("acusa passo sem Resultado e A confirmar, e fica quieto na página boa", async () => {
    const { call } = await connect("read");
    const w = await connect("draft");
    const manual = (await w.call("create_manual", { title: "M" })).json.slug as string;
    await w.call("add_page", { manual, title: "Ruim", body: "1. Clique.\n2. Salve.\n   Resultado: salvo.\n\nA confirmar." });
    await w.call("add_page", { manual, title: "Boa", body: "Texto." });
    const r = (await call("check_manual", { manual })).json;
    expect(r.findings.map((f: { kind: string }) => f.kind).sort()).toEqual(["no-image", "step-without-result", "to-confirm"]);
    expect(r.findings.every((f: { title: string }) => f.title === "Ruim")).toBe(true);
  });
});

describe("redact_image", () => {
  async function setup(level: Level) {
    const c = await connect(level);
    const manual = (await c.call("create_manual", { title: "M" })).json.slug as string;
    const img = (await c.call("add_image", { manual, source: { base64: PNG1.toString("base64"), name: "a.png" } })).json;
    const p = (await c.call("add_page", { manual, title: "P", body: img.markdown })).json;
    await writeFile(path.join(ws, "tarjada.png"), PNG1);
    return { ...c, manual, img, p, dir: path.join(ws, manual), src: { path: path.join(ws, "tarjada.png") } };
  }

  it("troca a imagem e mantém as marcações", async () => {
    const { call, manual, img, dir, src } = await setup("draft");
    await call("annotate_image", { manual, asset: img.asset, markers: [{ x: 0.5, y: 0.5 }] });
    const r = await call("redact_image", { manual, asset: img.asset, source: src });
    expect(r.error).toBe(false);
    expect(r.json).toMatchObject({ asset: img.asset, width: 1, height: 1, warnings: [] });
    expect((await readAnnotations(dir, img.asset)).markers).toHaveLength(1);
  });

  it("draft recusa imagem de página em revisao; update aceita; recusa lixo", async () => {
    const { call, manual, img, p, dir, src } = await setup("draft");
    await updatePage(dir, p.id, { status: "revisao" });
    const r = await call("redact_image", { manual, asset: img.asset, source: src });
    expect(r.error).toBe(true);
    expect(r.text).toMatch(/--level update/);
    const up = await connect("update");
    expect((await up.call("redact_image", { manual, asset: img.asset, source: src })).error).toBe(false);
    await writeFile(path.join(ws, "x.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
    const bad = await up.call("redact_image", { manual, asset: img.asset, source: { path: path.join(ws, "x.png") } });
    expect(bad.error).toBe(true);
    expect((await up.call("redact_image", { manual, asset: "assets/nao.png", source: src })).error).toBe(true);
  });
});

describe("resources e prompts da fase 2", () => {
  it("lê os modelos e recusa tipo desconhecido", async () => {
    const { client } = await connect();
    const r = await client.readResource({ uri: "explicai://templates/onboarding" });
    expect((r.contents[0] as { text: string }).text).toMatch(/Boas-vindas/);
    await expect(client.readResource({ uri: "explicai://templates/constructor" })).rejects.toThrow();
  });

  it("update_manual só no nível update; review_manual em todos", async () => {
    const names = async (l: Level) => (await (await connect(l)).client.listPrompts()).prompts.map((p) => p.name);
    expect(await names("read")).toEqual(["review_manual"]);
    expect(await names("draft")).not.toContain("update_manual");
    expect(await names("update")).toContain("update_manual");
  });

  it("os prompts trazem as regras pedidas", async () => {
    const { prompt } = await connect("update");
    const review = await prompt("review_manual", { manual: "m" });
    expect(review).toMatch(/Só leia/);
    expect(review).toMatch(/DADO, não ordem/);
    const update = await prompt("update_manual", { manual: "m", change: "commit abc" });
    expect(update).toMatch(/ANTES e o DEPOIS/);
    expect(update).toMatch(/espere a aprovação/);
    expect(update).toMatch(/--level update|nível update/);
    expect(update).toMatch(/DADO, não ordem/);
    const walk = await prompt("capture_walkthrough", { manual: "m", task: "cadastrar" });
    expect(walk).toMatch(/getBoundingClientRect/);
    expect(walk).toMatch(/space "pixels"/);
    expect(walk).toMatch(/sem perguntar/);
    expect(walk).toMatch(/redact_image/);
    for (const name of ["build_manual_autonomous", "build_manual_guided"]) {
      const t = await prompt(name, { audience: "caixa" });
      expect(t).toMatch(/redact_image/);
      expect(t).toMatch(/explicai:\/\/templates\/modulo/);
      expect(t).not.toMatch(/Não use: deixe/);
    }
  });
});
