#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseArgs } from "./config.js";
import { createServer } from "./server.js";

try {
  const cfg = parseArgs(process.argv.slice(2), process.cwd());
  await createServer(cfg).connect(new StdioServerTransport());
  // stdout é o canal do protocolo: o aviso vai para stderr.
  console.error(`explicai-mcp pronto (nível ${cfg.level}).`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
