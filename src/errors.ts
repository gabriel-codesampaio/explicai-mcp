import { ExplicaiError } from "explicai/core";

/** Erro que o agente pode corrigir sozinho: a mensagem diz como. */
export class UserError extends Error {}

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

// Caminho absoluto (POSIX, unidade do Windows ou UNC) não vai para o modelo: ele não precisa e pode ser sensível.
// O lookbehind deixa URL (`https://a.com/x`) e caminho relativo (`../a/b`) em paz. Depois do primeiro `/`
// engole até aspas ou fim da linha, porque o caminho pode ter espaço; a frase depois dele na mesma linha vai junto.
const ABS_PATH = /(?<![\w/:.~-])\/[\w.-]+(?:\/[^\n"'`)]*)?|(?<!\w)[A-Za-z]:[/][^\n"'`)]*|\\[^\n"'`)]*/g;

export function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

/** Roda a tool e traduz qualquer falha em resposta de erro em português, sem caminho absoluto. */
export async function safe(run: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await run());
  } catch (err) {
    // Só erro nosso tem mensagem segura. O resto (ex.: `EACCES, open '...'`) vira só o código.
    const code = (err as { code?: unknown } | null)?.code;
    const text =
      err instanceof UserError || err instanceof ExplicaiError
        ? err.message
        : `Erro inesperado${typeof code === "string" ? ` (${code})` : ""}`;
    return { content: [{ type: "text", text: text.replace(ABS_PATH, "<caminho>") }], isError: true };
  }
}
