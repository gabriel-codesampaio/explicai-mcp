import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { listVersions, readPage, readPageTree, updatePage } from "explicai/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { Config, Level } from "../src/config.js";
import { createServer } from "../src/server.js";

/** PNG mínimo com cabeçalho de 200x100: basta para o tamanho e para os bytes mágicos. */
function png(w = 200, h = 100): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "latin1");
  ihdr.writeUInt32BE(w, 8);
  ihdr.writeUInt32BE(h, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(12)]);
}

let root: string;
let ws: string;
let outside: string;

async function connect(over: Partial<Config> = {}, level: Level = "draft") {
  const cfg: Config = { workspace: ws, level, manuals: [], allowDirs: [ws], ...over };
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
  root = await mkdtemp(path.join(tmpdir(), "mcp-"));
  ws = path.join(root, "ws");
  outside = path.join(root, "fora");
  await mkdir(ws);
  await mkdir(outside);
});

describe("níveis", () => {
  it("registra só as tools do nível", async () => {
    const names = async (l: Level) => (await (await connect({}, l)).client.listTools()).tools.map((t) => t.name).sort();
    expect(await names("read")).toEqual(["get_manual", "list_manuals", "read_page"]);
    const draft = await names("draft");
    expect(draft).toContain("create_manual");
    expect(draft).toHaveLength(9);
    expect(draft.some((n) => /delete|remove|approve|publish/.test(n))).toBe(false);
  });

  it("expõe resources e prompts; o guiado manda esperar aprovação", async () => {
    const { client } = await connect();
    expect((await client.listResources()).resources.map((r) => r.uri).sort()).toEqual([
      "explicai://format",
      "explicai://writing-guide",
    ]);
    const p = await client.getPrompt({ name: "build_manual_guided", arguments: { audience: "caixa" } });
    const text = (p.messages[0] as { content: { text: string } }).content.text;
    expect(text).toMatch(/PARE/);
    expect(text).toMatch(/aprovação/);
    expect((await client.listPrompts()).prompts.map((x) => x.name).sort()).toEqual([
      "build_manual_autonomous",
      "build_manual_guided",
    ]);
  });
});

describe("fluxo completo com o Studio fechado", () => {
  it("cria árvore, imagem anotada e exporta html e markdown", async () => {
    const { call } = await connect();
    const { json: created } = await call("create_manual", { title: "Caixa", language: "pt-BR" });
    const manual = created.slug as string;

    const a = (await call("add_page", { manual, title: "Visão geral", body: "Objetivo." })).json;
    const b = (
      await call("add_page", { manual, title: "Vender", body: "1. Clique em **Novo**.\n\nResultado: abre.", parentId: a.id })
    ).json;
    const c = (await call("add_page", { manual, title: "Cancelar venda", parentId: a.id })).json;

    await writeFile(path.join(ws, "tela.png"), png());
    const img = (await call("add_image", { manual, source: { path: path.join(ws, "tela.png") }, alt: "Tela" })).json;
    expect(img).toMatchObject({ width: 200, height: 100, markdown: `![Tela](../${img.asset})` });

    const ann = await call("annotate_image", {
      manual,
      asset: img.asset,
      space: "pixels",
      markers: [
        { x: 100, y: 50 },
        { x: 20, y: 10, label: "Botão" },
      ],
      hotspots: [{ x: 0, y: 0, w: 100, h: 50, target: { type: "page", pageId: c.id } }],
    });
    expect(ann.json.markers.map((m: { n: number; x: number; y: number }) => [m.n, m.x, m.y])).toEqual([
      [1, 0.5, 0.5],
      [2, 0.1, 0.1],
    ]);
    expect(ann.json.hotspots[0]).toMatchObject({ x: 0, y: 0, w: 0.5, h: 0.5 });

    await call("update_page", { manual, pageId: b.id, rev: b.rev, body: `1. Clique.\n\n${img.markdown}` });

    const html = (await call("export_manual", { manual, format: "html" })).json;
    const md = (await call("export_manual", { manual, format: "markdown" })).json;
    expect(html.pages).toBe(3);
    expect(await readFile(path.join(ws, html.file), "utf8")).toContain("Vender");
    expect(await readFile(path.join(ws, md.file), "utf8")).toContain("Cancelar venda");

    // O Studio abre pelo core: árvore em 2 níveis, sem página com problema.
    const tree = await readPageTree(path.join(ws, manual));
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children).toHaveLength(2);
    expect(JSON.stringify(tree)).not.toContain("problem");
  });
});

describe("update_page", () => {
  it("rev antigo não grava; rev certo guarda 'Antes do agente'; aprovado é recusado", async () => {
    const { call } = await connect();
    const manual = (await call("create_manual", { title: "M" })).json.slug;
    const p = (await call("add_page", { manual, title: "P", body: "um" })).json;
    const dir = path.join(ws, manual);

    const ok = await call("update_page", { manual, pageId: p.id, rev: p.rev, body: "dois" });
    expect(ok.error).toBe(false);
    const stale = await call("update_page", { manual, pageId: p.id, rev: p.rev, body: "três" });
    expect(stale.error).toBe(true);
    expect(stale.text).toMatch(/read_page/);
    expect((await readPage(dir, p.id)).body).toBe("dois");
    expect((await listVersions(dir, p.id)).map((v) => v.note)).toEqual(["Antes do agente"]);

    const bad = await call("update_page", { manual, pageId: p.id, rev: ok.json.rev, status: "aprovado" });
    expect(bad.error).toBe(true);
    expect(bad.text).toMatch(/Studio/);
    expect((await readPage(dir, p.id)).status).toBe("rascunho");
  });

  it("draft não edita página fora de rascunho; update edita", async () => {
    const { call } = await connect();
    const manual = (await call("create_manual", { title: "M" })).json.slug;
    const p = (await call("add_page", { manual, title: "P" })).json;
    const r = (await call("update_page", { manual, pageId: p.id, rev: p.rev, status: "revisao" })).json;
    const denied = await call("update_page", { manual, pageId: p.id, rev: r.rev, body: "x" });
    expect(denied.error).toBe(true);
    expect(denied.text).toMatch(/--level update/);
    const upd = await connect({}, "update");
    expect((await upd.call("update_page", { manual, pageId: p.id, rev: r.rev, body: "x" })).error).toBe(false);
  });

  it("update: corpo alterado em página aprovada ou publicada volta para revisao e avisa", async () => {
    const { call } = await connect({}, "update");
    const manual = (await call("create_manual", { title: "M" })).json.slug;
    const dir = path.join(ws, manual);
    for (const status of ["aprovado", "publicado"] as const) {
      const p = (await call("add_page", { manual, title: status, body: "um" })).json;
      const rev = (await updatePage(dir, p.id, { status })).rev;
      const r = await call("update_page", { manual, pageId: p.id, rev, body: "dois" });
      expect(r.error).toBe(false);
      expect(r.json.warnings.join(" ")).toMatch(/revisao/);
      expect((await readPage(dir, p.id)).status).toBe("revisao");
    }
  });

  it("rev velho não deixa versão 'Antes do agente' para trás", async () => {
    const { call } = await connect();
    const manual = (await call("create_manual", { title: "M" })).json.slug;
    const p = (await call("add_page", { manual, title: "P", body: "um" })).json;
    await call("update_page", { manual, pageId: p.id, rev: p.rev, title: "Q" });
    expect((await call("update_page", { manual, pageId: p.id, rev: p.rev, body: "dois" })).error).toBe(true);
    expect(await listVersions(path.join(ws, manual), p.id)).toHaveLength(0);
  });

  it("avisa quando o corpo parece ter token", async () => {
    const { call } = await connect();
    const manual = (await call("create_manual", { title: "M" })).json.slug;
    const r = await call("add_page", { manual, title: "P", body: "api_key = abcdef123456789" });
    expect(r.json.warnings).toHaveLength(1);
  });
});

describe("add_image", () => {
  async function setup() {
    const c = await connect();
    const manual = (await c.call("create_manual", { title: "M" })).json.slug as string;
    return { ...c, manual };
  }

  it("recusa caminho fora das pastas, sem mostrar caminho absoluto", async () => {
    const { call, manual } = await setup();
    const file = path.join(outside, "x.png");
    await writeFile(file, png());
    const r = await call("add_image", { manual, source: { path: file } });
    expect(r.error).toBe(true);
    expect(r.text).not.toContain(outside);
  });

  it("recusa link simbólico que aponta para fora", async (ctx) => {
    const { call, manual } = await setup();
    const target = path.join(outside, "y.png");
    await writeFile(target, png());
    const link = path.join(ws, "link.png");
    try {
      await symlink(target, link);
    } catch {
      return ctx.skip(); // sem permissão para criar link no Windows comum
    }
    expect((await call("add_image", { manual, source: { path: link } })).error).toBe(true);
  });

  it("recusa bytes que não batem, SVG e arquivo acima de 10 MB", async () => {
    const { call, manual } = await setup();
    await writeFile(path.join(ws, "falso.png"), "não sou imagem");
    await writeFile(path.join(ws, "a.svg"), "<svg><script/></svg>");
    await writeFile(path.join(ws, "grande.png"), Buffer.concat([png(), Buffer.alloc(10 * 1024 * 1024)]));
    for (const f of ["falso.png", "a.svg", "grande.png"]) {
      const r = await call("add_image", { manual, source: { path: path.join(ws, f) } });
      expect(r.error, f).toBe(true);
    }
  });

  it("aceita base64 com nome", async () => {
    const { call, manual } = await setup();
    const r = await call("add_image", { manual, source: { base64: png().toString("base64"), name: "b.png" } });
    expect(r.json.asset).toMatch(/^assets\/b/);
  });
});

describe("annotate_image", () => {
  it("recusa hotspot para página inexistente", async () => {
    const { call } = await connect();
    const manual = (await call("create_manual", { title: "M" })).json.slug;
    const img = (await call("add_image", { manual, source: { base64: png().toString("base64"), name: "b.png" } })).json;
    const r = await call("annotate_image", {
      manual,
      asset: img.asset,
      hotspots: [{ x: 0, y: 0, w: 0.5, h: 0.5, target: { type: "page", pageId: "nao-existe" } }],
    });
    expect(r.error).toBe(true);
  });
});

describe("annotate_image e páginas fora de rascunho", () => {
  async function setup(level: Level) {
    const c = await connect({}, level);
    const manual = (await c.call("create_manual", { title: "M" })).json.slug as string;
    const img = (await c.call("add_image", { manual, source: { base64: png().toString("base64"), name: "b.png" } })).json;
    const p = (await c.call("add_page", { manual, title: "P", body: img.markdown })).json;
    return { ...c, manual, img, p, dir: path.join(ws, manual) };
  }

  it("draft recusa imagem citada por página em revisao e diz como resolver; update aceita", async () => {
    const { call, manual, img, p, dir } = await setup("draft");
    const marker = { manual, asset: img.asset, markers: [{ x: 0.1, y: 0.1 }] };
    expect((await call("annotate_image", marker)).error).toBe(false);
    await updatePage(dir, p.id, { status: "revisao" });
    const r = await call("annotate_image", marker);
    expect(r.error).toBe(true);
    expect(r.text).toMatch(/--level update/);
    expect((await (await connect({}, "update")).call("annotate_image", marker)).error).toBe(false);
  });

  it("recusa arquivo de assets/ que não é imagem", async () => {
    const { call, manual, dir } = await setup("draft");
    await writeFile(path.join(dir, "assets", "notas.txt"), png());
    const r = await call("annotate_image", { manual, asset: "assets/notas.txt", markers: [{ x: 0.1, y: 0.1 }] });
    expect(r.error).toBe(true);
    expect(r.text).toMatch(/PNG, JPG, GIF ou WebP/);
  });
});

describe("--manual e slug", () => {
  it("esconde e recusa manual fora da lista; recusa slug com ..", async () => {
    const { call } = await connect();
    const a = (await call("create_manual", { title: "Alfa" })).json.slug;
    const b = (await call("create_manual", { title: "Beta" })).json.slug;
    const lim = await connect({ manuals: [a] });
    expect((await lim.call("list_manuals")).json.map((m: { slug: string }) => m.slug)).toEqual([a]);
    expect((await lim.call("get_manual", { manual: b })).error).toBe(true);
    expect((await lim.call("add_page", { manual: b, title: "x" })).error).toBe(true);
    expect((await lim.client.listTools()).tools.map((t) => t.name)).not.toContain("create_manual");
    for (const slug of ["../x", "a/b", "a\\b", ".."]) expect((await call("get_manual", { manual: slug })).error, slug).toBe(true);
  });

  it("create_manual recusa slug existente", async () => {
    const { call } = await connect();
    await call("create_manual", { title: "Alfa" });
    expect((await call("create_manual", { title: "Alfa" })).error).toBe(true);
  });
});
