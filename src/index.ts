#!/usr/bin/env node
// Entry point for the NOVAI read-only MCP server over stdio.
// The RPC endpoint defaults to the public NOVAI URL and can be overridden with the
// NOVAI_RPC_URL environment variable. There are no other inputs, no keys, and no secrets.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRpcClient } from "./rpc.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const client = createRpcClient();
  const server = createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The stdio transport owns stdout for protocol traffic, so nothing else writes to stdout.
}

main().catch(() => {
  // Never surface internals. Emit one generic line to stderr and exit non zero.
  process.stderr.write("novai-mcp-server failed to start\n");
  process.exitCode = 1;
});
