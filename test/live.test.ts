import { test } from "node:test";
import assert from "node:assert/strict";
import { createRpcClient } from "../src/rpc.js";
import { buildTools, type ToolDescriptor } from "../src/tools.js";

// These tests hit the real public endpoint. They are skipped unless NOVAI_LIVE_TEST=1 so
// the default test run stays fast and offline. Run them with: npm run test:live
const LIVE = process.env.NOVAI_LIVE_TEST === "1";
const opts = LIVE ? {} : { skip: "set NOVAI_LIVE_TEST=1 to run live endpoint tests" };

function tool(name: string): ToolDescriptor {
  const found = buildTools(createRpcClient()).find((x) => x.name === name);
  assert.ok(found, `tool ${name} should exist`);
  return found;
}

function parse(res: { content: Array<{ text: string }> }): any {
  return JSON.parse(res.content[0]!.text);
}

test("chain_status returns a live tip with a numeric height and a 64 hex block hash", opts, async () => {
  const block = parse(await tool("novai_get_chain_status").handler({}));
  assert.equal(typeof block.height, "number");
  assert.match(block.block_hash, /^[0-9a-f]{64}$/);
});

test("get_block by a recent height matches and round trips by hash", opts, async () => {
  const tip = parse(await tool("novai_get_chain_status").handler({}));
  const recent = Math.max(0, tip.height - 5);
  const byHeight = parse(await tool("novai_get_block").handler({ height: recent }));
  assert.equal(byHeight.height, recent);
  const byHash = parse(await tool("novai_get_block").handler({ hash: byHeight.block_hash }));
  assert.equal(byHash.height, recent);
});

test("get_block above the tip yields a clean error rather than a crash", opts, async () => {
  const res = await tool("novai_get_block").handler({ height: 999999999 });
  assert.equal(res.isError, true);
  assert.match(res.content[0]!.text, /exceeds committed height|code -32602/);
});

test("a non existent transaction returns null cleanly", opts, async () => {
  const res = await tool("novai_get_transaction").handler({ txid: "0".repeat(64) });
  assert.equal(res.isError, undefined);
  assert.equal(parse(res), null);
});

test("a non existent entity returns entity null cleanly", opts, async () => {
  const res = await tool("novai_get_ai_entity").handler({ entity_id: "0".repeat(64) });
  assert.equal(res.isError, undefined);
  assert.deepEqual(parse(res), { entity: null });
});
