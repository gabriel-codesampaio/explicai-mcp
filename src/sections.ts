import { UserError } from "./errors.js";

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

interface Span {
  /** Linha do título e linha onde a seção termina (exclusive). */
  start: number;
  end: number;
}

/** Acha a seção pelo título (sem os #), ignorando blocos de código. Vai até o próximo título do mesmo nível ou maior. */
function find(lines: string[], title: string): Span {
  let fence = false;
  const hits: { at: number; level: number }[] = [];
  const heads: { at: number; level: number }[] = [];
  lines.forEach((l, at) => {
    if (/^\s*```/.test(l)) fence = !fence;
    const m = fence ? null : HEADING.exec(l);
    if (!m) return;
    heads.push({ at, level: m[1]?.length ?? 1 });
    if ((m[2] ?? "").toLowerCase() === title.trim().toLowerCase()) hits.push({ at, level: m[1]?.length ?? 1 });
  });
  if (hits.length === 0)
    throw new UserError(
      `Não há seção "${title}" nesta página. Títulos: ${sectionTitles(lines.join("\n")).join(", ") || "nenhum"}.`,
    );
  if (hits.length > 1) throw new UserError(`Há mais de uma seção "${title}". Use o corpo inteiro ou renomeie uma delas.`);
  const hit = hits[0] as { at: number; level: number };
  const next = heads.find((h) => h.at > hit.at && h.level <= hit.level);
  return { start: hit.at, end: next?.at ?? lines.length };
}

export function sectionTitles(body: string): string[] {
  let fence = false;
  return body.split(/\r?\n/).flatMap((l) => {
    if (/^\s*```/.test(l)) fence = !fence;
    const m = fence ? null : HEADING.exec(l);
    return m ? [m[2] ?? ""] : [];
  });
}

/** Texto da seção, sem a linha do título. */
export function readSection(body: string, title: string): string {
  const lines = body.split(/\r?\n/);
  const { start, end } = find(lines, title);
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

/** Troca o texto da seção, mantendo a linha do título. O resto da página fica igual. */
export function replaceSection(body: string, title: string, text: string): string {
  const lines = body.split(/\r?\n/);
  const { start, end } = find(lines, title);
  const head = lines.slice(0, start + 1);
  const tail = lines.slice(end);
  return [...head, "", ...text.trim().split("\n"), ...(tail.length ? ["", ...tail] : [])].join("\n");
}
