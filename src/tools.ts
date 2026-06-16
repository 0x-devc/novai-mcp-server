// Tool definitions for the NOVAI read-only MCP server.
//
// Every tool maps to exactly one confirmed read method on the public NOVAI JSON-RPC
// endpoint. There is no write, sign, or submit path anywhere in this file. Each handler
// validates its input fully before any network call, then returns the chain result
// verbatim as pretty printed JSON. Errors from the chain or the transport are mapped to
// clean tool errors with no stack traces and no endpoint internals.

import { z } from "zod";
import type { RpcClient } from "./rpc.js";
import { RpcError, RpcTransportError } from "./rpc.js";
import { SIGNAL_TYPE_LABELS, MEMORY_OBJECT_TYPE_LABELS, labelList } from "./labels.js";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface ToolDescriptor {
  name: string;
  title: string;
  description: string;
  inputShape: z.ZodRawShape;
  handler: (args: unknown) => Promise<ToolResult>;
}

// Heights are u64 on chain. We cap at the safe integer range because JSON numbers above
// that lose precision in JavaScript, which would silently corrupt the request.
const MAX_SAFE_HEIGHT = Number.MAX_SAFE_INTEGER;

const hex32 = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "must be a 64 character hex string (32 bytes, no 0x prefix)");

const height = z
  .number()
  .int("must be an integer")
  .min(0, "must be zero or greater")
  .max(MAX_SAFE_HEIGHT, "is too large to be represented safely");

const timestamp = z.number().int("must be an integer").min(0, "must be zero or greater");

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function formatIssues(error: z.ZodError): string {
  const parts = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(input)";
    return `${path}: ${issue.message}`;
  });
  return `invalid input. ${parts.join("; ")}`;
}

function mapError(error: unknown): ToolResult {
  if (error instanceof RpcError) {
    return fail(`the NOVAI RPC endpoint rejected the request (code ${error.code}): ${error.message}`);
  }
  if (error instanceof RpcTransportError) {
    return fail(`could not complete the NOVAI RPC request: ${error.message}`);
  }
  return fail("could not complete the NOVAI RPC request: an unexpected error occurred");
}

// Build a handler that validates input first, so no network call can happen on bad input,
// then runs the query and maps any failure to a clean tool error.
function makeHandler<S extends z.ZodTypeAny>(
  schema: S,
  run: (input: z.infer<S>) => Promise<unknown>,
): (args: unknown) => Promise<ToolResult> {
  return async (args: unknown): Promise<ToolResult> => {
    const parsed = schema.safeParse(args ?? {});
    if (!parsed.success) return fail(formatIssues(parsed.error));
    try {
      return ok(await run(parsed.data));
    } catch (error) {
      return mapError(error);
    }
  };
}

export function buildTools(client: RpcClient): ToolDescriptor[] {
  const tools: ToolDescriptor[] = [];

  // ---------------------------------------------------------------- Tier A

  {
    const shape: z.ZodRawShape = {};
    const schema = z.object(shape);
    tools.push({
      name: "novai_get_chain_status",
      title: "NOVAI chain status",
      description:
        "Return the latest committed block of the live NOVAI chain: its height, block hash, round, transaction count, state root, and parent hash. Use this to verify the chain is live and advancing, and to learn the current tip height before requesting a specific block. Takes no parameters.",
      inputShape: shape,
      handler: makeHandler(schema, () => client.call("novai_getLatestBlock", {})),
    });
  }

  {
    const shape = {
      height: height.optional().describe("Block height. Provide either height or hash, not both."),
      hash: hex32.optional().describe("Block hash, 64 hex characters. Provide either height or hash, not both."),
    };
    const schema = z
      .object(shape)
      .refine((d) => (d.height === undefined) !== (d.hash === undefined), {
        message: "provide exactly one of height or hash",
      });
    tools.push({
      name: "novai_get_block",
      title: "NOVAI block by height or hash",
      description:
        "Fetch a single committed block by height or by hash. Provide exactly one of height or hash. Returns the block height, block hash, parent hash, round, state root, and transaction count, or null if no such block is known. Note: the endpoint retains a bounded recent window of blocks by height, so very old heights can return null even though they were valid blocks. Lookups by hash work for any block the node still indexes.",
      inputShape: shape,
      handler: makeHandler(schema, (input) =>
        input.height !== undefined
          ? client.call("novai_getBlockByHeight", { height: input.height })
          : client.call("novai_getBlockByHash", { hash: input.hash as string }),
      ),
    });
  }

  {
    const shape = { txid: hex32.describe("Transaction id, 64 hex characters.") };
    const schema = z.object(shape);
    tools.push({
      name: "novai_get_transaction",
      title: "NOVAI transaction by id",
      description:
        "Fetch a confirmed transaction by its transaction id. Returns the block height, transaction index, sender address, nonce, fee, and payload length, or null if the transaction is not found.",
      inputShape: shape,
      handler: makeHandler(schema, (input) => client.call("novai_getTransaction", { txid: input.txid })),
    });
  }

  // ---------------------------------------------------------------- Tier B

  {
    const shape = { entity_id: hex32.describe("Entity id, 64 hex characters.") };
    const schema = z.object(shape);
    tools.push({
      name: "novai_get_ai_entity",
      title: "NOVAI AI entity by id",
      description:
        "Fetch an on-chain AI entity (agent) by its entity id. Returns the entity record including code hash, creator, autonomy mode, capability bits, economic and stake balances, reputation score, transaction count, and activity timestamps, or null if no entity exists for that id.",
      inputShape: shape,
      handler: makeHandler(schema, (input) => client.call("novai_getAiEntity", { entity_id: input.entity_id })),
    });
  }

  {
    const shape = { address: hex32.describe("Account or entity address, 64 hex characters.") };
    const schema = z.object(shape);
    tools.push({
      name: "novai_get_balance",
      title: "NOVAI account balance",
      description:
        "Fetch the balance and nonce for an account or entity address. The balance is returned as a decimal string to preserve full precision.",
      inputShape: shape,
      handler: makeHandler(schema, (input) => client.call("novai_getBalance", { address: input.address })),
    });
  }

  // ---------------------------------------------------------------- Tier C

  {
    const shape = { height: height.describe("Block height to query.") };
    const schema = z.object(shape);
    tools.push({
      name: "novai_get_signals_by_height",
      title: "NOVAI signals at a block height",
      description:
        "List the signal commitments recorded at a specific block height. Each entry has a commitment hash, a numeric signal type, the height, and the issuer. Use this to see which signals were committed in a given block.",
      inputShape: shape,
      handler: makeHandler(schema, (input) => client.call("novai_getSignalsByHeight", { height: input.height })),
    });
  }

  {
    const shape = {
      issuer: hex32.describe("Issuer entity id, 64 hex characters."),
      start_height: height.describe("First block height in the range, inclusive."),
      end_height: height.describe("Last block height in the range, inclusive."),
    };
    const schema = z
      .object(shape)
      .refine((d) => d.start_height <= d.end_height, {
        message: "start_height must be less than or equal to end_height",
      });
    tools.push({
      name: "novai_get_signals_by_issuer",
      title: "NOVAI signals by issuer",
      description:
        "List the signal commitments issued by a given entity within a block height range. Returns commitment hash, signal type, height, and issuer for each.",
      inputShape: shape,
      handler: makeHandler(schema, (input) =>
        client.call("novai_getSignalsByIssuer", {
          issuer: input.issuer,
          start_height: input.start_height,
          end_height: input.end_height,
        }),
      ),
    });
  }

  {
    const shape = {
      signal_type: z
        .number()
        .int("must be an integer")
        .min(0, "must be zero or greater")
        .max(255, "must be a single byte value")
        .describe("Signal type code. The endpoint currently accepts 0 through 6."),
      start_height: height.describe("First block height in the range, inclusive."),
      end_height: height.describe("Last block height in the range, inclusive."),
    };
    const schema = z
      .object(shape)
      .refine((d) => d.start_height <= d.end_height, {
        message: "start_height must be less than or equal to end_height",
      });
    tools.push({
      name: "novai_get_signals_by_type",
      title: "NOVAI signals by type",
      description:
        `List the signal commitments of a given type within a block height range. The endpoint currently accepts these signal type codes: ${labelList(SIGNAL_TYPE_LABELS)}. Returns commitment hash, signal type, height, and issuer for each.`,
      inputShape: shape,
      handler: makeHandler(schema, (input) =>
        client.call("novai_getSignalsByType", {
          signal_type: input.signal_type,
          start_height: input.start_height,
          end_height: input.end_height,
        }),
      ),
    });
  }

  {
    const shape = { signal_hash: hex32.describe("Signal hash, 64 hex characters.") };
    const schema = z.object(shape);
    tools.push({
      name: "novai_get_oracle_anchor",
      title: "NOVAI oracle anchor by signal hash",
      description:
        "Fetch a single oracle anchor by its signal hash. Returns the issuer entity, data hash, external timestamp, source hash, expiry and anchor heights, and data tag, or null if no anchor exists for that hash.",
      inputShape: shape,
      handler: makeHandler(schema, (input) => client.call("novai_getOracleAnchor", { signal_hash: input.signal_hash })),
    });
  }

  {
    const shape = {
      entity_id: hex32.describe("Issuer entity id, 64 hex characters."),
      start_height: height.describe("First block height in the range, inclusive."),
      end_height: height.describe("Last block height in the range, inclusive."),
      ts_min: timestamp.optional().describe("Optional lowest external timestamp to include."),
      ts_max: timestamp.optional().describe("Optional highest external timestamp to include."),
    };
    const schema = z
      .object(shape)
      .refine((d) => d.start_height <= d.end_height, {
        message: "start_height must be less than or equal to end_height",
      })
      .refine((d) => d.ts_min === undefined || d.ts_max === undefined || d.ts_min <= d.ts_max, {
        message: "ts_min must be less than or equal to ts_max",
      });
    tools.push({
      name: "novai_get_oracle_anchors_by_entity",
      title: "NOVAI oracle anchors by issuer entity",
      description:
        "List oracle anchors issued by a given entity within a block height range, optionally filtered by an external timestamp range. Returns issuer entity, data hash, external timestamp, source hash, expiry and anchor heights, and data tag for each.",
      inputShape: shape,
      handler: makeHandler(schema, (input) => {
        const params: Record<string, unknown> = {
          entity_id: input.entity_id,
          start_height: input.start_height,
          end_height: input.end_height,
        };
        if (input.ts_min !== undefined) params.ts_min = input.ts_min;
        if (input.ts_max !== undefined) params.ts_max = input.ts_max;
        return client.call("novai_getOracleAnchorsByEntity", params);
      }),
    });
  }

  {
    const shape = {
      data_tag: z.string().min(1, "must not be empty").max(256, "is too long").describe("Data tag to match."),
      start_height: height.describe("First block height in the range, inclusive."),
      end_height: height.describe("Last block height in the range, inclusive."),
      ts_min: timestamp.optional().describe("Optional lowest external timestamp to include."),
      ts_max: timestamp.optional().describe("Optional highest external timestamp to include."),
    };
    const schema = z
      .object(shape)
      .refine((d) => d.start_height <= d.end_height, {
        message: "start_height must be less than or equal to end_height",
      })
      .refine((d) => d.ts_min === undefined || d.ts_max === undefined || d.ts_min <= d.ts_max, {
        message: "ts_min must be less than or equal to ts_max",
      });
    tools.push({
      name: "novai_get_oracle_anchors_by_tag",
      title: "NOVAI oracle anchors by data tag",
      description:
        "List oracle anchors carrying a given data tag within a block height range, optionally filtered by an external timestamp range. Returns issuer entity, data hash, external timestamp, source hash, expiry and anchor heights, and data tag for each.",
      inputShape: shape,
      handler: makeHandler(schema, (input) => {
        const params: Record<string, unknown> = {
          data_tag: input.data_tag,
          start_height: input.start_height,
          end_height: input.end_height,
        };
        if (input.ts_min !== undefined) params.ts_min = input.ts_min;
        if (input.ts_max !== undefined) params.ts_max = input.ts_max;
        return client.call("novai_getOracleAnchorsByTag", params);
      }),
    });
  }

  {
    const shape = { entity_id: hex32.describe("Owner entity id, 64 hex characters.") };
    const schema = z.object(shape);
    tools.push({
      name: "novai_get_memory_objects",
      title: "NOVAI memory objects by entity",
      description:
        `List the on-chain memory objects owned by an entity. Each object has an object id, a numeric object type, owner, creation and update heights, and hex encoded data. Object type codes: ${labelList(MEMORY_OBJECT_TYPE_LABELS)}.`,
      inputShape: shape,
      handler: makeHandler(schema, (input) => client.call("novai_getMemoryObjects", { entity_id: input.entity_id })),
    });
  }

  return tools;
}
