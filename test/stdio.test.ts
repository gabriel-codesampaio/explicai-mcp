import { execSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { beforeAll, expect, it } from "vitest";

beforeAll(() => {
  execSync("npm run build", { stdio: "ignore" });
}, 120_000);

it("conversa por stdio: lista tools e cria um manual", async () => {
  const ws = await mkdtemp(path.join(tmpdir(), "mcp-stdio-"));
  const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/cli.js", ws, "--level", "draft"] });
  const client = new Client({ name: "stdio-test", version: "0" });
  await client.connect(transport);
  try {
    expect((await client.listTools()).tools.map((t) => t.name)).toContain("add_page");
    const r = (await client.callTool({ name: "create_manual", arguments: { title: "Via stdio" } })) as {
      content: { text: string }[];
    };
    expect(JSON.parse(r.content[0]?.text ?? "{}")).toEqual({ slug: "via-stdio" });
  } finally {
    await client.close();
  }
}, 60_000);
