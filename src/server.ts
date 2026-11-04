import { readFileSync } from "node:fs";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import {
  autonomousPrompt,
  FORMAT_GUIDE,
  guidedPrompt,
  reviewPrompt,
  TEMPLATES,
  type TemplateKind,
  updatePrompt,
  WRITING_GUIDE,
  walkthroughPrompt,
} from "./content.js";
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

  server.registerResource(
    "templates",
    new ResourceTemplate("explicai://templates/{tipo}", {
      list: async () => ({
        resources: Object.keys(TEMPLATES).map((tipo) => ({ uri: `explicai://templates/${tipo}`, name: `Modelo: ${tipo}` })),
      }),
      complete: { tipo: (v) => Object.keys(TEMPLATES).filter((k) => k.startsWith(v)) },
    }),
    {
      title: "Modelos de manual",
      description: "Árvore e molde de cada nível: modulo, onboarding, administracao.",
      mimeType: "text/markdown",
    },
    (uri, { tipo }) => {
      const body = Object.hasOwn(TEMPLATES, String(tipo)) ? TEMPLATES[tipo as TemplateKind] : undefined;
      if (!body) throw new Error(`Modelo desconhecido: ${String(tipo)}. Use ${Object.keys(TEMPLATES).join(", ")}.`);
      return text(uri, body);
    },
  );

  const user = (t: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: t } }] });
  const manual = z.string().describe("Slug do manual, como devolvido por list_manuals.");
  server.registerPrompt(
    "review_manual",
    {
      title: "Revisar manual",
      description: "O agente só lê o manual e lista os achados por página, sem corrigir.",
      argsSchema: { manual },
    },
    (a) => user(reviewPrompt(a)),
  );
  if (cfg.level !== "read") {
    server.registerPrompt(
      "capture_walkthrough",
      {
        title: "Capturar passo a passo",
        description: "O agente percorre a tarefa no navegador, tira um print por passo, marca e oculta dados sensíveis.",
        argsSchema: {
          manual,
          task: z.string().describe("Tarefa a capturar, ex.: cadastrar cliente."),
          url: z.string().optional(),
        },
      },
      (a) => user(walkthroughPrompt(a)),
    );
  }
  if (cfg.level === "update") {
    server.registerPrompt(
      "update_manual",
      {
        title: "Atualizar manual",
        description:
          "O agente acha as páginas afetadas por uma mudança, mostra antes e depois e grava só com aprovação. Exige --level update.",
        argsSchema: { manual, change: z.string().describe("A mudança no produto: commit, branch, diff ou descrição.") },
      },
      (a) => user(updatePrompt(a)),
    );
  }

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
