import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { autonomousPrompt, FORMAT_GUIDE, guidedPrompt, WRITING_GUIDE } from "./content.js";
import { registerTools } from "./tools.js";

const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

export function createServer(cfg: Config): McpServer {
  const server = new McpServer({ name: "explicai-mcp", version });

  registerTools(server, cfg);

  const text = (uri: URL, body: string) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: body }] });
  server.registerResource(
    "format",
    "explicai://format",
    {
      title: "Formato das páginas",
      description: "Markdown aceito nas páginas: passos, alertas, links, imagens.",
      mimeType: "text/markdown",
    },
    (uri) => text(uri, FORMAT_GUIDE),
  );
  server.registerResource(
    "writing-guide",
    "explicai://writing-guide",
    { title: "Guia de escrita", description: "Regras de escrita do manual.", mimeType: "text/markdown" },
    (uri) => text(uri, WRITING_GUIDE),
  );

  // Prompts só existem se o nível deixa criar manual: no nível read não há o que gravar.
  if (cfg.level !== "read" && cfg.manuals.length === 0) {
    const args = {
      audience: z.string().describe("Quem vai usar o manual, ex.: operador do caixa."),
      language: z.string().optional().describe("Idioma do texto (padrão pt-BR)."),
      tone: z.string().optional().describe("Tom de voz."),
      focus: z.string().optional().describe("Parte do produto a cobrir."),
    };
    server.registerPrompt(
      "build_manual_autonomous",
      {
        title: "Criar manual (autônomo)",
        description: "O agente explora o projeto e cria um manual novo sozinho.",
        argsSchema: args,
      },
      (a) => ({ messages: [{ role: "user", content: { type: "text", text: autonomousPrompt(a) } }] }),
    );
    server.registerPrompt(
      "build_manual_guided",
      {
        title: "Criar manual (guiado)",
        description: "O agente propõe a árvore, espera aprovação e grava página por página.",
        argsSchema: args,
      },
      (a) => ({ messages: [{ role: "user", content: { type: "text", text: guidedPrompt(a) } }] }),
    );
  }
  return server;
}
