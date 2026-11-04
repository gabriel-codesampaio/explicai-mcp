import path from "node:path";

export const LEVELS = ["read", "draft", "update"] as const;
export type Level = (typeof LEVELS)[number];

export interface Config {
  workspace: string;
  level: Level;
  /** Vazio = todos os manuais do workspace. */
  manuals: string[];
  /** Pastas de onde `add_image` pode ler: workspace, pasta onde o MCP abriu e `--allow-dir`. */
  allowDirs: string[];
}

export const USAGE = "Uso: explicai-mcp <workspace> [--level read|draft|update] [--manual <slug>]... [--allow-dir <pasta>]...";

/** Lê a linha de comando. Lança Error com a mensagem de uso quando algo não bate. */
export function parseArgs(argv: string[], cwd: string): Config {
  const rest: string[] = [];
  const manuals: string[] = [];
  const extra: string[] = [];
  let level: Level = "draft";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith("--")) {
      rest.push(arg);
      continue;
    }
    const [flag, inline] = arg.split(/=(.*)/s, 2);
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`${flag} pede um valor. ${USAGE}`);
    if (flag === "--level") {
      if (!LEVELS.includes(value as Level)) throw new Error(`--level aceita ${LEVELS.join(", ")}. Recebi "${value}".`);
      level = value as Level;
    } else if (flag === "--manual") manuals.push(value);
    else if (flag === "--allow-dir") extra.push(path.resolve(cwd, value));
    else throw new Error(`Opção desconhecida: ${flag}. ${USAGE}`);
  }
  if (rest.length !== 1) throw new Error(USAGE);
  const workspace = path.resolve(cwd, rest[0] as string);
  return { workspace, level, manuals, allowDirs: [workspace, path.resolve(cwd), ...extra] };
}
