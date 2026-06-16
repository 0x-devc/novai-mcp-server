// Wires the confirmed read-only tools into an MCP server instance.
// This module is the only place that touches the MCP SDK. The tool logic itself lives in
// tools.ts and has no dependency on the transport or the server framework.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { RpcClient } from "./rpc.js";
import { buildTools } from "./tools.js";

const SERVER_NAME = "novai-mcp-server";
const SERVER_VERSION = "0.1.0";

const INSTRUCTIONS =
  "Read-only access to the live NOVAI chain over its public JSON-RPC endpoint. " +
  "Every tool is a query. None can submit transactions, sign, hold keys, or change chain state.";

export function createServer(client: RpcClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  for (const tool of buildTools(client)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputShape,
      },
      async (args: unknown): Promise<CallToolResult> => {
        const result = await tool.handler(args);
        return result as CallToolResult;
      },
    );
  }

  return server;
}
