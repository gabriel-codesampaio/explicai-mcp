import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type AnnotationsPatch,
  addPage,
  appendAnnotations,
  checkManual,
  createManual,
  type ExportFormat,
  exportManual,
  flatten,
  imageSize,
  listManuals,
  type PageTreeNode,
  readAnnotations,
  readManual,
  readPage,
  readPageTree,
  redactAsset,
  saveAsset,
  saveVersion,
  slugify,
  updatePage,
} from "explicai/core";
import { z } from "zod";
import { type Config, LEVELS, type Level } from "./config.js";
import { safe, UserError } from "./errors.js";
import { loadImage, manualDir, secretWarning, slugOf } from "./guards.js";
import { readSection, replaceSection } from "./sections.js";

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const pt = z.object({ x: z.number(), y: z.number() });
const rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const target = z.union([
  z.object({ type: z.literal("page"), pageId: z.string() }),
  z.object({ type: z.literal("anchor"), pageId: z.string(), anchor: z.string() }),
  z.object({ type: z.literal("url"), href: z.string() }),
]);

const ASSET = /^assets\/[^/\\]+$/;
const MENTION = /assets\/([^)\s"'#?]+)/g;

interface PageInput {
  title: string;
  body?: string | undefined;
  children?: PageInput[] | undefined;
}

const stripTree = (nodes: PageTreeNode[]): unknown[] =>
  nodes.map((n) => ({
    id: n.id,
    title: n.title,
    status: n.status,
    ...(n.problem ? { problem: n.problem } : {}),
    children: stripTree(n.children),
  }));

/** Registra só as tools que o nível permite: a que sobra fora do nível o modelo nem vê. */
export function registerTools(server: McpServer, cfg: Config): void {
  const rank = (l: Level) => LEVELS.indexOf(l);
  function add<S extends z.ZodRawShape>(
    name: string,
    min: Level,
    config: { description: string; inputSchema: S; annotations: typeof RO },
    run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  ) {
    if (rank(cfg.level) < rank(min)) return;
    server.registerTool(name, config, ((args: z.infer<z.ZodObject<S>>) => safe(() => run(args))) as never);
  }
  const manual = z.string().describe("Manual slug, as returned by list_manuals.");

  add(
    "list_manuals",
    "read",
    { description: "List the manuals in the workspace (slug, title, language, page count).", inputSchema: {}, annotations: RO },
    async () => {
      const all = await listManuals(cfg.workspace);
      return all
        .filter((m) => cfg.manuals.length === 0 || cfg.manuals.includes(slugOf(m.dir)))
        .map((m) => ({
          slug: slugOf(m.dir),
          title: m.meta.title,
          language: m.meta.language,
          pageCount: flatten(m.meta.pages).length,
        }));
    },
  );

  add(
    "get_manual",
    "read",
    {
      description: "Manual title, language, theme and page tree (id, title, status). Call before writing to an existing manual.",
      inputSchema: { manual },
      annotations: RO,
    },
    async ({ manual }) => {
      const dir = await manualDir(cfg, manual);
      const meta = await readManual(dir);
      return { title: meta.title, language: meta.language, theme: meta.theme ?? null, tree: stripTree(await readPageTree(dir)) };
    },
  );

  add(
    "read_page",
    "read",
    {
      description:
        "Read a page: body (Markdown), status, rev (needed by update_page) and its images with annotations. section (heading title) returns only that section's text.",
      inputSchema: { manual, pageId: z.string(), section: z.string().optional() },
      annotations: RO,
    },
    async ({ manual, pageId, section }) => {
      const dir = await manualDir(cfg, manual);
      const p = await readPage(dir, pageId);
      const text = section === undefined ? p.body : readSection(p.body, section);
      const assets = [...new Set([...p.body.matchAll(MENTION)].map((m) => decode(`assets/${m[1]}`)))];
      const images = await Promise.all(
        assets.filter((a) => ASSET.test(a)).map(async (asset) => ({ asset, annotations: await readAnnotations(dir, asset) })),
      );
      return { id: p.id, title: p.title, status: p.status, body: text, rev: p.rev, images };
    },
  );

  if (cfg.manuals.length === 0) {
    add(
      "create_manual",
      "draft",
      {
        description: "Create an empty manual. Refuses an existing slug. Write the text in the language set here.",
        inputSchema: {
          title: z.string().min(1),
          language: z.string().default("pt-BR").describe("BCP 47 tag, e.g. pt-BR or en-US."),
        },
        annotations: WRITE,
      },
      async ({ title, language }) => {
        const slug = slugify(title);
        if ((await listManuals(cfg.workspace)).some((m) => slugOf(m.dir) === slug)) {
          throw new UserError(`Já existe o manual "${slug}". Use get_manual para ver o que já tem, ou escolha outro título.`);
        }
        const created = await createManual(cfg.workspace, { title, language });
        return { slug: slugOf(created.dir) };
      },
    );
  }

  add(
    "add_page",
    "draft",
    {
      description: "Add a page (always draft). body is Markdown, see explicai://format. Returns id, file, rev.",
      inputSchema: {
        manual,
        title: z.string().min(1),
        body: z.string().optional(),
        parentId: z.string().optional().describe("Parent page id; omit for a top-level page."),
        index: z.number().int().min(0).optional(),
      },
      annotations: WRITE,
    },
    async ({ manual, title, body, parentId, index }) => {
      const dir = await manualDir(cfg, manual);
      const p = await addPage(dir, {
        title,
        ...(body === undefined ? {} : { body }),
        parentId: parentId ?? null,
        ...(index === undefined ? {} : { index }),
      });
      return { id: p.id, file: p.file, rev: p.rev, warnings: secretWarning(body) };
    },
  );

  const node: z.ZodType<PageInput> = z.lazy(() =>
    z.object({ title: z.string().min(1), body: z.string().optional(), children: z.array(node).optional() }),
  );
  add(
    "add_pages",
    "draft",
    {
      description:
        "Add a whole page tree in one call (always draft; same checks as add_page). pages: [{title, body?, children?}], in reading order. Returns id, title, file, rev per page, flat, plus warnings.",
      inputSchema: {
        manual,
        pages: z.array(node).min(1).max(100),
        parentId: z.string().optional().describe("Parent of the top-level pages; omit for the root."),
      },
      annotations: WRITE,
    },
    async ({ manual, pages, parentId }) => {
      const dir = await manualDir(cfg, manual);
      const created: { id: string; title: string; file: string; rev: string | undefined }[] = [];
      const warnings: string[] = [];
      const walk = async (list: PageInput[], parent: string | null) => {
        for (const n of list) {
          const p = await addPage(dir, { title: n.title, ...(n.body === undefined ? {} : { body: n.body }), parentId: parent });
          created.push({ id: p.id, title: n.title, file: p.file, rev: p.rev });
          for (const w of secretWarning(n.body)) warnings.push(`${n.title}: ${w}`);
          await walk(n.children ?? [], p.id);
        }
      };
      try {
        await walk(pages, parentId ?? null);
      } catch (err) {
        const done = created.map((c) => c.title).join(", ") || "nenhuma";
        throw new UserError(
          `${err instanceof Error ? err.message : "Falha ao gravar"} Páginas já criadas: ${done}. Não crie de novo; continue a partir delas.`,
        );
      }
      return { created, warnings };
    },
  );

  add(
    "update_page",
    "draft",
    {
      description:
        "Edit a page's title, body or status. Needs the rev from read_page (stale rev refused); saves version 'Antes do agente' when the body changes. With section (heading title), body replaces only that section's text. status: rascunho or revisao. At level draft, only rascunho pages.",
      inputSchema: {
        manual,
        pageId: z.string(),
        rev: z.string().describe("rev returned by read_page, add_page or the last update_page."),
        title: z.string().min(1).optional(),
        body: z.string().optional(),
        section: z.string().optional().describe("Heading title; body then replaces only that section."),
        status: z.string().optional().describe("rascunho or revisao."),
      },
      annotations: WRITE,
    },
    async ({ manual, pageId, rev, title, body: given, section, status }) => {
      const dir = await manualDir(cfg, manual);
      if (status !== undefined && status !== "rascunho" && status !== "revisao") {
        throw new UserError(
          `O agente não define o status "${status}". Deixe em rascunho ou revisao e peça à pessoa para aprovar ou publicar no Studio.`,
        );
      }
      const page = await readPage(dir, pageId);
      if (cfg.level === "draft" && page.status !== "rascunho") {
        throw new UserError(
          `A página está em "${page.status}". No nível draft só se edita rascunho; reinicie o servidor com --level update ou peça à pessoa para editar no Studio.`,
        );
      }
      if (page.rev !== rev) {
        throw new UserError("A página mudou desde a última leitura. Chame read_page de novo e refaça a edição com o rev novo.");
      }
      if (section !== undefined && given === undefined) throw new UserError("section pede body com o texto novo da seção.");
      const body = section === undefined || given === undefined ? given : replaceSection(page.body, section, given);
      const changed = body !== undefined && body !== page.body;
      // Texto novo numa página que a pessoa já aprovou ou publicou precisa de nova revisão dela.
      const reopen = changed && status === undefined && (page.status === "aprovado" || page.status === "publicado");
      const next = await updatePage(
        dir,
        pageId,
        {
          ...(title === undefined ? {} : { title }),
          ...(body === undefined ? {} : { body }),
          ...(status === undefined ? (reopen ? { status: "revisao" as const } : {}) : { status }),
        },
        {
          ifRev: rev,
          // A versão só é guardada depois de o rev passar, dentro da fila da pasta.
          ...(changed && { beforeWrite: async () => void (await saveVersion(dir, pageId, "Antes do agente")) }),
        },
      );
      const warnings = secretWarning(given);
      if (reopen) {
        warnings.push(
          `A página estava "${page.status}" e voltou para revisao porque o texto mudou. Peça à pessoa para aprovar de novo no Studio.`,
        );
      }
      return { id: next.id, rev: next.rev, warnings };
    },
  );

  add(
    "add_image",
    "draft",
    {
      description:
        "Import an image (PNG, JPG, GIF, WebP; max 10 MB; no SVG). source: {path} (workspace, current folder or --allow-dir) or {base64, name}. Returns the Markdown line to paste in the page, plus width and height in pixels.",
      inputSchema: {
        manual,
        source: z.object({ path: z.string().optional(), base64: z.string().optional(), name: z.string().optional() }),
        alt: z.string().optional().describe("Alt text, in the manual's language."),
      },
      annotations: WRITE,
    },
    async ({ manual, source, alt }) => {
      const dir = await manualDir(cfg, manual);
      const { name, data } = await loadImage(cfg, source);
      const asset = await saveAsset(dir, name, data);
      const size = await imageSize(path.join(dir, asset));
      const text = (alt ?? "").replace(/[[\]\n]/g, " ").trim();
      return { asset, markdown: `![${text}](../${asset})`, width: size?.w ?? null, height: size?.h ?? null };
    },
  );

  add(
    "annotate_image",
    "draft",
    {
      description:
        "Append numbered markers, highlights, arrows and clickable hotspots to an imported image. space: 'normalized' (0-1) or 'pixels' (image pixels, e.g. from getBoundingClientRect). Hotspot target: {type:'page',pageId} (must exist), {type:'anchor',pageId,anchor} or {type:'url',href} (http, https, mailto). Returns counts.",
      inputSchema: {
        manual,
        asset: z.string().describe("assets/<file> as returned by add_image."),
        space: z.enum(["normalized", "pixels"]).default("normalized"),
        markers: z.array(pt.extend({ label: z.string().optional() })).optional(),
        highlights: z.array(rect).optional(),
        arrows: z.array(z.object({ from: pt, to: pt })).optional(),
        hotspots: z.array(rect.extend({ target })).optional(),
      },
      annotations: WRITE,
    },
    async ({ manual, asset, space, markers, highlights, arrows, hotspots }) => {
      const dir = await manualDir(cfg, manual);
      if (!ASSET.test(asset)) throw new UserError("asset deve ser assets/<arquivo>, como devolvido por add_image.");
      if (!/\.(png|jpe?g|gif|webp)$/i.test(asset)) throw new UserError("Só imagens PNG, JPG, GIF ou WebP têm marcações.");
      const size = await imageSize(path.join(dir, asset)).catch(() => null);
      if (!size) throw new UserError(`Imagem ${asset} não encontrada. Importe com add_image primeiro.`);
      const ids = new Set(flatten((await readManual(dir)).pages).map((n) => n.id));
      if (cfg.level === "draft") await assertOnlyDraftPagesUse(dir, asset, [...ids]);
      for (const h of hotspots ?? []) {
        if (h.target.type !== "url" && !ids.has(h.target.pageId)) {
          throw new UserError(`O hotspot aponta para a página "${h.target.pageId}", que não existe. Veja os ids em get_manual.`);
        }
      }
      const px = space === "pixels";
      const sx = (v: number) => (px ? round(v / size.w) : v);
      const sy = (v: number) => (px ? round(v / size.h) : v);
      const P = (p: { x: number; y: number }) => ({ x: sx(p.x), y: sy(p.y) });
      const R = (r: { x: number; y: number; w: number; h: number }) => ({ ...P(r), w: sx(r.w), h: sy(r.h) });
      const patch: AnnotationsPatch = {
        ...(markers && { markers: markers.map((m) => ({ ...P(m), ...(m.label === undefined ? {} : { label: m.label }) })) }),
        ...(highlights && { highlights: highlights.map(R) }),
        ...(arrows && { arrows: arrows.map((a) => ({ from: P(a.from), to: P(a.to) })) }),
        ...(hotspots && { hotspots: hotspots.map((h) => ({ ...R(h), target: h.target })) }),
      };
      const a = await appendAnnotations(dir, asset, patch);
      return {
        asset,
        markers: a.markers.length,
        highlights: a.highlights.length,
        arrows: a.arrows.length,
        hotspots: a.hotspots.length,
      };
    },
  );

  add(
    "check_manual",
    "read",
    {
      description:
        "Read-only check. Findings per page: steps without 'Resultado:', pages with steps and no screenshot, dead links, missing or unmarked images, hotspots to deleted pages, leftover 'A confirmar'.",
      inputSchema: { manual },
      annotations: RO,
    },
    async ({ manual }) => {
      const findings = await checkManual(await manualDir(cfg, manual));
      return { count: findings.length, findings };
    },
  );

  add(
    "redact_image",
    "draft",
    {
      description:
        "Replace an imported image with a copy where personal data is covered by opaque bars. YOU draw the bars on a copy (PNG, JPG or WebP, same format and size as the asset) and pass it as source ({path} or {base64, name}). The original is gone afterwards; markers stay valid; metadata is stripped.",
      inputSchema: {
        manual,
        asset: z.string().describe("assets/<file> to replace, as returned by add_image."),
        source: z.object({ path: z.string().optional(), base64: z.string().optional(), name: z.string().optional() }),
      },
      annotations: { ...WRITE, destructiveHint: true },
    },
    async ({ manual, asset, source }) => {
      const dir = await manualDir(cfg, manual);
      if (!ASSET.test(asset)) throw new UserError("asset deve ser assets/<arquivo>, como devolvido por add_image.");
      const before = await imageSize(path.join(dir, asset)).catch(() => null);
      if (!before) throw new UserError(`Imagem ${asset} não encontrada. Importe com add_image primeiro.`);
      if (cfg.level === "draft")
        await assertOnlyDraftPagesUse(
          dir,
          asset,
          flatten((await readManual(dir)).pages).map((n) => n.id),
        );
      const { data } = await loadImage(cfg, source);
      await redactAsset(dir, asset, data);
      const after = await imageSize(path.join(dir, asset));
      const resized = after && (after.w !== before.w || after.h !== before.h);
      return {
        asset,
        width: after?.w ?? null,
        height: after?.h ?? null,
        warnings: resized ? ["O tamanho mudou: as marcações já postas podem ter saído do lugar. Confira no Studio."] : [],
      };
    },
  );

  add(
    "export_manual",
    "draft",
    {
      description:
        "Export to html, markdown or pdf (pdf needs Chrome or Edge; if it fails, use html). Returns file (relative to the workspace), pages, warnings. onlyApproved leaves out drafts.",
      inputSchema: { manual, format: z.enum(["html", "markdown", "pdf"]), onlyApproved: z.boolean().optional() },
      annotations: WRITE,
    },
    async ({ manual, format, onlyApproved }) => {
      const dir = await manualDir(cfg, manual);
      const r = await exportManual(dir, format as ExportFormat, onlyApproved ? { onlyApproved: true } : {});
      return { file: `${slugOf(dir)}/${r.file}`, pages: r.pages, warnings: r.warnings };
    },
  );
}

const decode = (t: string) => {
  try {
    return decodeURI(t);
  } catch {
    return t;
  }
};
const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** No nível draft, marcar uma imagem que página em revisão, aprovada ou publicada usa mudaria o que a pessoa já revisou. */
async function assertOnlyDraftPagesUse(dir: string, asset: string, pageIds: string[]): Promise<void> {
  for (const id of pageIds) {
    const page = await readPage(dir, id).catch(() => null);
    if (!page || page.status === "rascunho") continue;
    if ([...page.body.matchAll(MENTION)].some((m) => decode(`assets/${m[1]}`) === asset)) {
      throw new UserError(
        `A imagem ${asset} aparece na página "${page.title}", que está em "${page.status}". No nível draft só se marca imagem usada por rascunho; reinicie o servidor com --level update ou peça à pessoa para marcar no Studio.`,
      );
    }
  }
}
