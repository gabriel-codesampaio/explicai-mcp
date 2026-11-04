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
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }] };
}

/** Roda a tool e traduz qualquer falha em resposta de erro em português, sem caminho absoluto. */
export async function safe(run: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await run());
  } catch (err) {
    // Erro do sistema tem `code` (ex.: `EACCES, open '...'`) e vira só o código. O core lança
    // `Error` simples com mensagem útil ao agente (ex.: PDF sem navegador), que segue sem o caminho.
    const code = (err as { code?: unknown } | null)?.code;
    const own = err instanceof UserError || err instanceof ExplicaiError;
    const text =
      own || (err instanceof Error && code === undefined)
        ? err.message
        : `Erro inesperado${typeof code === "string" ? ` (${code})` : ""}`;
    return { content: [{ type: "text", text: text.replace(ABS_PATH, "<caminho>") }], isError: true };
  }
}
