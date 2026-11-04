import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { readManual, resolveInsideReal } from "explicai/core";
import type { Config } from "./config.js";
import { UserError } from "./errors.js";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Pasta do manual `slug`. Recusa slug com `..`, `/` ou `\`, e manual fora de `--manual`. */
export async function manualDir(cfg: Config, slug: string): Promise<string> {
  if (!slug || slug.includes("..") || slug.includes("/") || slug.includes("\\") || slug.startsWith(".")) {
    throw new UserError(`Manual inválido: "${slug}". Use o slug devolvido por list_manuals.`);
  }
  if (cfg.manuals.length > 0 && !cfg.manuals.includes(slug)) {
    throw new UserError(`O manual "${slug}" não está liberado neste servidor. Use list_manuals.`);
  }
  try {
    // Real: um link dentro do workspace que aponta para fora não vale.
    const dir = await resolveInsideReal(cfg.workspace, slug);
    await readManual(dir);
    return dir;
  } catch {
    throw new UserError(`Manual "${slug}" não encontrado. Use list_manuals.`);
  }
}

export const slugOf = (dir: string) => path.basename(dir);

// Assinaturas (bytes mágicos) por extensão. SVG fica de fora: pode carregar script.
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: (b) => b.subarray(0, 4).toString("latin1") === "GIF8",
  webp: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
};

export interface ImageSource {
  path?: string | undefined;
  base64?: string | undefined;
  name?: string | undefined;
}

const tooBig = () => new UserError("Imagem acima de 10 MB. Reduza o arquivo e tente de novo.");

/** Lê e confere a imagem. Devolve nome e bytes prontos para `saveAsset`. */
export async function loadImage(cfg: Config, src: ImageSource): Promise<{ name: string; data: Buffer }> {
  if ((src.path === undefined) === (src.base64 === undefined)) {
    throw new UserError("Informe source.path ou source.base64 (com source.name), não os dois.");
  }
  let name: string;
  let data: Buffer;
  if (src.path !== undefined) {
    name = path.basename(src.path);
    data = await readAllowed(cfg, src.path);
  } else {
    if (!src.name) throw new UserError("source.base64 pede source.name com a extensão (ex.: tela.png).");
    name = path.basename(src.name);
    if ((src.base64 as string).length > (MAX_IMAGE_BYTES * 4) / 3 + 4) throw tooBig();
    data = Buffer.from(src.base64 as string, "base64");
  }
  const ext = path.extname(name).slice(1).toLowerCase().replace("jpeg", "jpg");
  if (ext === "svg") throw new UserError("SVG não é aceito (pode conter script). Exporte a imagem como PNG ou JPG.");
  const matches = SIGNATURES[ext];
  if (!matches) throw new UserError("Formato não aceito. Use PNG, JPG, GIF ou WebP.");
  if (data.length > MAX_IMAGE_BYTES) throw tooBig();
  if (!matches(data)) throw new UserError(`O conteúdo do arquivo não é uma imagem .${ext} válida. Confira a extensão.`);
  return { name, data };
}

async function readAllowed(cfg: Config, file: string): Promise<Buffer> {
  // Mesma mensagem para "não existe" e "fora das pastas": não revela o que há no disco.
  const denied = new UserError("Arquivo não encontrado ou fora das pastas permitidas (workspace, pasta atual e --allow-dir).");
  let real: string;
  try {
    real = await realpath(path.resolve(file));
  } catch {
    throw denied;
  }
  const roots = await Promise.all(cfg.allowDirs.map((d) => realpath(d).catch(() => null)));
  const inside = roots.some((r) => {
    if (!r) return false;
    const rel = path.relative(r, real);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
  if (!inside) throw denied;
  const s = await stat(real);
  if (!s.isFile()) throw denied;
  if (s.size > MAX_IMAGE_BYTES) throw tooBig();
  return readFile(real);
}

const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /xox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/,
  /(api[_-]?key|secret|token|password|senha)\s*[:=]\s*["']?[^\s"']{8,}/i,
];

/** Aviso (não bloqueio) quando o texto parece trazer chave ou token. Pega só o óbvio. */
export function secretWarning(text: string | undefined): string[] {
  if (text && SECRET_PATTERNS.some((p) => p.test(text))) {
    return [
      "O corpo parece conter uma chave, token ou senha. Se for real, remova da página (update_page) e troque a credencial: o manual pode ir para o cliente.",
    ];
  }
  return [];
}
