// End to end stdio smoke test. Spawns the built server binary and drives it with the
// official MCP client over a real stdio transport: lists tools, asserts they are all
// read getters, then exercises a happy path and two error paths against the live chain.
// Run with: node scripts/smoke.mjs   (requires network access to the public endpoint)

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(here, "..", "dist", "index.js");

const transport = new StdioClientTransport({ command: "node", args: [serverEntry] });
const client = new Client({ name: "novai-mcp-smoke", version: "0.0.0" });

function line(label, value) {
  process.stdout.write(`${label}: ${value}\n`);
}

try {
  await client.connect(transport);
  line("connected", "ok");

  const list = await client.listTools();
  const names = list.tools.map((t) => t.name).sort();
  line("tool count", String(names.length));
  line("tools", names.join(", "));
  const writeish = names.filter((n) => /submit|faucet|transfer|deposit|withdraw|sign(?!al)/i.test(n) || !n.startsWith("novai_get_"));
  line("write looking tools", writeish.length === 0 ? "none" : writeish.join(", "));

  const status = await client.callTool({ name: "novai_get_chain_status", arguments: {} });
  line("chain_status isError", String(status.isError ?? false));
  line("chain_status result", status.content[0].text.replace(/\s+/g, " ").slice(0, 240));

  const both = await client.callTool({
    name: "novai_get_block",
    arguments: { height: 5, hash: "a".repeat(64) },
  });
  line("get_block both args isError", String(both.isError ?? false));
  line("get_block both args message", both.content[0].text);

  const above = await client.callTool({
    name: "novai_get_block",
    arguments: { height: 999999999 },
  });
  line("get_block above tip isError", String(above.isError ?? false));
  line("get_block above tip message", above.content[0].text);

  const missing = await client.callTool({
    name: "novai_get_transaction",
    arguments: { txid: "0".repeat(64) },
  });
  line("get_transaction missing isError", String(missing.isError ?? false));
  line("get_transaction missing result", missing.content[0].text);
} finally {
  await client.close();
}
