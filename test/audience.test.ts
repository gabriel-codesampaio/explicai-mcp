import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readPage, updatePage } from "explicai/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { Config, Level } from "../src/config.js";
import { createServer } from "../src/server.js";

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
  return { client, call };
}

beforeEach(async () => {
  ws = path.join(await mkdtemp(path.join(tmpdir(), "mcp-aud-")), "ws");
  await mkdir(ws);
});

describe("audience", () => {
  it("add_page, add_pages e update_page gravam; get_manual e read_page mostram; export_manual filtra", async () => {
    const { call } = await connect("update");
    const manual = (await call("create_manual", { title: "M" })).json.slug as string;
    const open = (await call("add_page", { manual, title: "Aberta", body: "texto-aberto" })).json;
    const adm = (await call("add_page", { manual, title: "Admin", body: "texto-segredo", audience: ["admin"] })).json;
    const tree = (
      await call("add_pages", {
        manual,
        pages: [{ title: "Pai", audience: ["cliente"], children: [{ title: "Filha", body: "filha-cliente" }] }],
      })
    ).json;
    expect(tree.created).toHaveLength(2);

    const got = (await call("get_manual", { manual })).json;
    expect(got.audiences).toEqual(["admin", "cliente"]);
    expect(got.tree.map((n: { audience?: string[] }) => n.audience)).toEqual([undefined, ["admin"], ["cliente"]]);
    expect((await call("read_page", { manual, pageId: adm.id })).json.audience).toEqual(["admin"]);
    expect((await call("read_page", { manual, pageId: open.id })).json).not.toHaveProperty("audience");

    const r = await call("export_manual", { manual, format: "markdown", audience: "cliente" });
    expect(r.error).toBe(false);
    expect(r.json.pages).toBe(3); // Aberta, Pai, Filha
    const text = await readFile(path.join(ws, r.json.file), "utf8");
    expect(text).toContain("filha-cliente");
    expect(text).not.toContain("texto-segredo");

    const all = (await call("export_manual", { manual, format: "markdown" })).json;
    expect(all.pages).toBe(4);

    const up = await call("update_page", { manual, pageId: adm.id, rev: adm.rev, audience: [] });
    expect(up.error).toBe(false);
    expect((await readPage(path.join(ws, manual), adm.id)).audience).toBeUndefined();
  });

  it("mudar o público de página aprovada a devolve para revisao", async () => {
    const { call } = await connect("update");
    const manual = (await call("create_manual", { title: "M" })).json.slug as string;
    const dir = path.join(ws, manual);
    const p = (await call("add_page", { manual, title: "P", body: "x", audience: ["admin"] })).json;
    const rev = (await updatePage(dir, p.id, { status: "aprovado" })).rev;
    const r = await call("update_page", { manual, pageId: p.id, rev, audience: [] });
    expect(r.json.warnings.join(" ")).toMatch(/revisao/);
    expect((await readPage(dir, p.id)).status).toBe("revisao");
  });

  it("recusa perfil vazio ou grande demais", async () => {
    const { call } = await connect();
    const manual = (await call("create_manual", { title: "M" })).json.slug as string;
    expect((await call("add_page", { manual, title: "P", audience: [""] })).error).toBe(true);
    expect((await call("add_page", { manual, title: "P", audience: ["x".repeat(41)] })).error).toBe(true);
  });

  it("os prompts de criação perguntam os perfis", async () => {
    const { client } = await connect();
    const text = async (name: string) =>
      ((await client.getPrompt({ name, arguments: { audience: "caixa" } })).messages[0] as { content: { text: string } }).content
        .text;
    expect(await text("build_manual_guided")).toMatch(/Pergunte quais perfis/);
    expect(await text("build_manual_autonomous")).toMatch(/audience/);
  });
});
