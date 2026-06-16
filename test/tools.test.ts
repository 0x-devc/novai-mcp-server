import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTools, type ToolDescriptor } from "../src/tools.js";
import type { RpcClient } from "../src/rpc.js";
import { RpcError, RpcTransportError } from "../src/rpc.js";

// A mock RPC client that records every call and returns a scripted result or throws.
function mockClient(opts: { result?: unknown; throwError?: unknown } = {}) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client: RpcClient = {
    url: "http://example.invalid",
    timeoutMs: 1000,
    async call(method, params) {
      calls.push({ method, params });
      if (opts.throwError) throw opts.throwError;
      return opts.result as never;
    },
  };
  return { client, calls };
}

function byName(tools: ToolDescriptor[], name: string): ToolDescriptor {
  const found = tools.find((x) => x.name === name);
  assert.ok(found, `tool ${name} should exist`);
  return found;
}

const HEX = "a".repeat(64);

test("exposes exactly the twelve expected read tools and nothing that suggests a write path", () => {
  const { client } = mockClient();
  const names = buildTools(client)
    .map((t) => t.name)
    .sort();
  assert.deepEqual(names, [
    "novai_get_ai_entity",
    "novai_get_balance",
    "novai_get_block",
    "novai_get_chain_status",
    "novai_get_memory_objects",
    "novai_get_oracle_anchor",
    "novai_get_oracle_anchors_by_entity",
    "novai_get_oracle_anchors_by_tag",
    "novai_get_signals_by_height",
    "novai_get_signals_by_issuer",
    "novai_get_signals_by_type",
    "novai_get_transaction",
  ]);
  for (const n of names) {
    // Positive invariant: every tool is a read-only getter.
    assert.ok(n.startsWith("novai_get_"), `${n} must be a read-only get tool`);
    // Negative invariant: no name suggests a write verb. "sign(?!al)" guards the signing
    // sense without flagging the legitimate "signals" read tools.
    assert.doesNotMatch(n, /submit|faucet|transfer|deposit|withdraw|sign(?!al)/i, `${n} must not suggest a write path`);
  }
});

test("chain_status calls novai_getLatestBlock with empty params", async () => {
  const { client, calls } = mockClient({ result: { height: 1 } });
  const res = await byName(buildTools(client), "novai_get_chain_status").handler({});
  assert.equal(res.isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, "novai_getLatestBlock");
  assert.deepEqual(calls[0]!.params, {});
});

test("get_block by height routes to novai_getBlockByHeight", async () => {
  const { client, calls } = mockClient({ result: { height: 42 } });
  await byName(buildTools(client), "novai_get_block").handler({ height: 42 });
  assert.equal(calls[0]!.method, "novai_getBlockByHeight");
  assert.deepEqual(calls[0]!.params, { height: 42 });
});

test("get_block by hash routes to novai_getBlockByHash with the hash as a structured param", async () => {
  const { client, calls } = mockClient({ result: { height: 42 } });
  await byName(buildTools(client), "novai_get_block").handler({ hash: HEX });
  assert.equal(calls[0]!.method, "novai_getBlockByHash");
  assert.deepEqual(calls[0]!.params, { hash: HEX });
});

test("get_block rejects both height and hash together, with no network call", async () => {
  const { client, calls } = mockClient({ result: {} });
  const res = await byName(buildTools(client), "novai_get_block").handler({ height: 1, hash: HEX });
  assert.equal(res.isError, true);
  assert.match(res.content[0]!.text, /exactly one of height or hash/);
  assert.equal(calls.length, 0);
});

test("get_block rejects neither height nor hash, with no network call", async () => {
  const { client, calls } = mockClient({ result: {} });
  const res = await byName(buildTools(client), "novai_get_block").handler({});
  assert.equal(res.isError, true);
  assert.equal(calls.length, 0);
});

test("get_block rejects a malformed hash before any network call", async () => {
  const { client, calls } = mockClient({ result: {} });
  const res = await byName(buildTools(client), "novai_get_block").handler({ hash: "zzz" });
  assert.equal(res.isError, true);
  assert.match(res.content[0]!.text, /64 character hex/);
  assert.equal(calls.length, 0);
});

test("get_block rejects a height above the safe integer range before any network call", async () => {
  const { client, calls } = mockClient({ result: {} });
  const res = await byName(buildTools(client), "novai_get_block").handler({ height: 1e21 });
  assert.equal(res.isError, true);
  assert.equal(calls.length, 0);
});

test("get_block rejects a negative or fractional height before any network call", async () => {
  const { client, calls } = mockClient({ result: {} });
  const r1 = await byName(buildTools(client), "novai_get_block").handler({ height: -1 });
  const r2 = await byName(buildTools(client), "novai_get_block").handler({ height: 1.5 });
  assert.equal(r1.isError, true);
  assert.equal(r2.isError, true);
  assert.equal(calls.length, 0);
});

test("an adversarial hash like string is rejected by validation, so nothing reaches the chain", async () => {
  const { client, calls } = mockClient({ result: null });
  // Looks like an attempt to smuggle another method name. It is not valid hex, so it never leaves the process.
  const evil = '","method":"novai_faucet","x":"' + "a".repeat(33);
  const res = await byName(buildTools(client), "novai_get_block").handler({ hash: evil });
  assert.equal(res.isError, true);
  assert.equal(calls.length, 0);
});

test("signals_by_type allows any byte value and lets the chain be the authority", async () => {
  const { client, calls } = mockClient({
    throwError: new RpcError(-32602, "Invalid signal type: 99 (must be 0-6)"),
  });
  const res = await byName(buildTools(client), "novai_get_signals_by_type").handler({
    signal_type: 99,
    start_height: 0,
    end_height: 10,
  });
  assert.equal(calls.length, 1);
  assert.equal(res.isError, true);
  assert.match(res.content[0]!.text, /code -32602/);
  assert.match(res.content[0]!.text, /must be 0-6/);
});

test("signals_by_type rejects a value outside the byte range before any network call", async () => {
  const { client, calls } = mockClient({ result: {} });
  const res = await byName(buildTools(client), "novai_get_signals_by_type").handler({
    signal_type: 256,
    start_height: 0,
    end_height: 10,
  });
  assert.equal(res.isError, true);
  assert.equal(calls.length, 0);
});

test("range tools reject start_height greater than end_height before any network call", async () => {
  const { client, calls } = mockClient({ result: {} });
  const res = await byName(buildTools(client), "novai_get_signals_by_issuer").handler({
    issuer: HEX,
    start_height: 100,
    end_height: 1,
  });
  assert.equal(res.isError, true);
  assert.match(res.content[0]!.text, /start_height/);
  assert.equal(calls.length, 0);
});

test("a transport error becomes a clean tool error with no stack trace", async () => {
  const { client } = mockClient({
    throwError: new RpcTransportError("could not reach the NOVAI RPC endpoint"),
  });
  const res = await byName(buildTools(client), "novai_get_balance").handler({ address: HEX });
  assert.equal(res.isError, true);
  assert.match(res.content[0]!.text, /could not complete the NOVAI RPC request/);
  assert.doesNotMatch(res.content[0]!.text, /\n\s+at\s/);
});

test("a successful entity query returns the chain result verbatim as JSON text", async () => {
  const { client } = mockClient({ result: { entity: null } });
  const res = await byName(buildTools(client), "novai_get_ai_entity").handler({ entity_id: HEX });
  assert.equal(res.isError, undefined);
  assert.deepEqual(JSON.parse(res.content[0]!.text), { entity: null });
});

test("optional oracle timestamp params are omitted when not provided", async () => {
  const { client, calls } = mockClient({ result: { anchors: [] } });
  await byName(buildTools(client), "novai_get_oracle_anchors_by_entity").handler({
    entity_id: HEX,
    start_height: 0,
    end_height: 10,
  });
  assert.deepEqual(calls[0]!.params, { entity_id: HEX, start_height: 0, end_height: 10 });
});

test("oracle timestamp params are forwarded when provided", async () => {
  const { client, calls } = mockClient({ result: { anchors: [] } });
  await byName(buildTools(client), "novai_get_oracle_anchors_by_tag").handler({
    data_tag: "weather",
    start_height: 0,
    end_height: 10,
    ts_min: 5,
    ts_max: 9,
  });
  assert.deepEqual(calls[0]!.params, {
    data_tag: "weather",
    start_height: 0,
    end_height: 10,
    ts_min: 5,
    ts_max: 9,
  });
});
