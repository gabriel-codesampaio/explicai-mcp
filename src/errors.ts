import { ExplicaiError } from "explicai/core";

/** Erro que o agente pode corrigir sozinho: a mensagem diz como. */
export class UserError extends Error {}

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

// Caminho absoluto (Windows ou POSIX) não vai para o modelo: ele não precisa e pode ser sensível.
const ABS_PATH = /(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var|etc|mnt)\/)[^\s"'`)]*/g;

export function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

/** Roda a tool e traduz qualquer falha em resposta de erro em português, sem caminho absoluto. */
export async function safe(run: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await run());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const text = err instanceof UserError || err instanceof ExplicaiError ? msg : `Erro: ${msg}`;
    return { content: [{ type: "text", text: text.replace(ABS_PATH, "<caminho>") }], isError: true };
  }
}
