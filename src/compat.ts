import { readFileSync } from "node:fs";

/** Faixa de `explicai` que este MCP aceita: do core com `explicai/core` (0.3.0) até antes da 2.0. Mantenha igual ao peerDependencies. */
export const EXPLICAI_RANGE = ">=0.3.0 <2.0.0";
const MIN: Version = [0, 3, 0];
const MAX_EXCLUSIVE = 2;

type Version = [number, number, number];

function parse(v: string): Version | undefined {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/** Lê a versão do `explicai` instalado (o `exports` do pacote não expõe o package.json, então sobe a partir do core). */
export function installedExplicaiVersion(): string | undefined {
  try {
    const core = new URL(import.meta.resolve("explicai/core"));
    return (JSON.parse(readFileSync(new URL("../../package.json", core), "utf8")) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

/** Falha com instrução quando a versão instalada está fora da faixa. `installed` é injetável para teste. */
export function assertExplicaiVersion(installed: string | undefined = installedExplicaiVersion()): void {
  const v = installed ? parse(installed) : undefined;
  if (!v) {
    throw new Error(
      `Não consegui ler a versão do pacote explicai. O explicai-mcp precisa de explicai ${EXPLICAI_RANGE}: rode "npm install explicai@latest".`,
    );
  }
  const old = v[0] < MIN[0] || (v[0] === MIN[0] && (v[1] < MIN[1] || (v[1] === MIN[1] && v[2] < MIN[2])));
  if (old) {
    throw new Error(
      `explicai ${installed} é antigo demais para este explicai-mcp (precisa de ${EXPLICAI_RANGE}). Atualize: "npm install explicai@latest".`,
    );
  }
  if (v[0] >= MAX_EXCLUSIVE) {
    throw new Error(
      `explicai ${installed} é mais novo do que este explicai-mcp conhece (aceita ${EXPLICAI_RANGE}). Atualize o MCP: "npm install explicai-mcp@latest"; se já é a última, instale "explicai@<2".`,
    );
  }
}
