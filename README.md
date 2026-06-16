# NOVAI MCP server

A read-only Model Context Protocol (MCP) server that lets any MCP-equipped agent query the live NOVAI chain over its public JSON-RPC endpoint. It exposes query tools only. There is no write, sign, submit, or key-handling path anywhere in this package.

NOVAI is an AI-native layer 1 with chained-BFT consensus. This server is a thin, typed bridge: an agent discovers the tools through standard MCP tooling and reads the chain without writing any SDK code.

## Safety boundary

This is version 0 and it is read-only by design.

- Every tool is a query that maps to a single read method on the public endpoint.
- The package never holds a private key, never signs, and never submits a transaction.
- The write methods the chain exposes are deliberately not wired in.

## Requirements

- Node.js 18 or newer.

## Install and run

Run it directly with npx:

```
npx novai-mcp-server
```

Or install it and run the binary:

```
npm install novai-mcp-server
novai-mcp-server
```

The server speaks MCP over stdio. Point your MCP client at the command above.

### Example MCP client configuration

```json
{
  "mcpServers": {
    "novai": {
      "command": "npx",
      "args": ["novai-mcp-server"]
    }
  }
}
```

## Configuration

- `NOVAI_RPC_URL` overrides the JSON-RPC endpoint. It defaults to the public NOVAI URL, `https://rpc.novai.network`. No other configuration, no secrets, and no auth are required, because the public endpoint is open and read-only.

## Tools

All hashes and ids are 64 hex characters (32 bytes, no `0x` prefix). All heights are non-negative integers. Every input is validated before any network call, and both chain errors and transport failures are returned as clean tool errors with no stack traces.

| Tool | Returns | Required params | Optional params |
| --- | --- | --- | --- |
| `novai_get_chain_status` | The latest committed block, so you can verify the chain is live and learn the tip height | none | none |
| `novai_get_block` | A single block | exactly one of `height` or `hash` | none |
| `novai_get_transaction` | A confirmed transaction, or null if unknown | `txid` | none |
| `novai_get_ai_entity` | An AI entity (agent) record, or null if unknown | `entity_id` | none |
| `novai_get_balance` | Balance (decimal string) and nonce for an address | `address` | none |
| `novai_get_signals_by_height` | Signal commitments recorded at a height | `height` | none |
| `novai_get_signals_by_issuer` | Signals issued by an entity within a height range | `issuer`, `start_height`, `end_height` | none |
| `novai_get_signals_by_type` | Signals of a type within a height range | `signal_type`, `start_height`, `end_height` | none |
| `novai_get_oracle_anchor` | An oracle anchor by signal hash, or null if unknown | `signal_hash` | none |
| `novai_get_oracle_anchors_by_entity` | Oracle anchors by issuer within a height range | `entity_id`, `start_height`, `end_height` | `ts_min`, `ts_max` |
| `novai_get_oracle_anchors_by_tag` | Oracle anchors by data tag within a height range | `data_tag`, `start_height`, `end_height` | `ts_min`, `ts_max` |
| `novai_get_memory_objects` | On-chain memory objects owned by an entity | `entity_id` | none |

### A note on block lookups by height

The endpoint retains a bounded recent window of blocks by height, so a height far below the current tip can return null even though it was a valid block. Lookups by hash work for any block the node still indexes. Call `novai_get_chain_status` first to learn the current tip height.

## Development

```
npm install
npm run build
npm test
```

`npm test` runs the offline unit and validation tests. To exercise the live endpoint:

```
npm run test:live
```

An end-to-end stdio check that spawns the built server and drives it with a real MCP client is available:

```
npm run build && node scripts/smoke.mjs
```

## License

MIT. See the LICENSE file.
