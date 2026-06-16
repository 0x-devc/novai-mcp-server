import { test } from "node:test";
import assert from "node:assert/strict";
import { createRpcClient, RpcError, RpcTransportError } from "../src/rpc.js";

// A fake fetch that returns a chosen JSON body, status, and ok flag.
function fetchReturning(json: unknown, ok = true, status = 200): typeof fetch {
  return (async () => ({
    ok,
    status,
    json: async () => json,
  })) as unknown as typeof fetch;
}

test("returns the result field on a valid JSON-RPC response", async () => {
  const client = createRpcClient({
    fetchImpl: fetchReturning({ jsonrpc: "2.0", id: 1, result: { height: 5 } }),
  });
  const out = await client.call("novai_getLatestBlock", {});
  assert.deepEqual(out, { height: 5 });
});

test("maps a JSON-RPC error object to RpcError carrying the code and message", async () => {
  const client = createRpcClient({
    fetchImpl: fetchReturning({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad params" } }),
  });
  await assert.rejects(
    () => client.call("m", {}),
    (e: unknown) => {
      assert.ok(e instanceof RpcError);
      assert.equal(e.code, -32602);
      assert.match(e.message, /bad params/);
      return true;
    },
  );
});

test("maps a non success HTTP status to a transport error", async () => {
  const client = createRpcClient({ fetchImpl: fetchReturning({}, false, 503) });
  await assert.rejects(
    () => client.call("m", {}),
    (e: unknown) => {
      assert.ok(e instanceof RpcTransportError);
      assert.match(e.message, /HTTP status 503/);
      return true;
    },
  );
});

test("maps a body that is not valid JSON to a transport error", async () => {
  const badFetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("not json");
    },
  })) as unknown as typeof fetch;
  const client = createRpcClient({ fetchImpl: badFetch });
  await assert.rejects(
    () => client.call("m", {}),
    (e: unknown) => {
      assert.ok(e instanceof RpcTransportError);
      assert.match(e.message, /not valid JSON/);
      return true;
    },
  );
});

test("maps a network failure to a transport error without leaking the cause", async () => {
  const failing = (async () => {
    throw new Error("RAW_TRANSPORT_CAUSE_DETAIL");
  }) as unknown as typeof fetch;
  const client = createRpcClient({ fetchImpl: failing });
  await assert.rejects(
    () => client.call("m", {}),
    (e: unknown) => {
      assert.ok(e instanceof RpcTransportError);
      assert.match(e.message, /could not reach the NOVAI RPC endpoint/);
      // The underlying cause string must never appear in the clean, user facing message.
      assert.doesNotMatch(e.message, /RAW_TRANSPORT_CAUSE_DETAIL/);
      return true;
    },
  );
});

test("aborts and reports a timeout when the endpoint never responds", async () => {
  const hanging = ((_url: string, init: { signal: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const err = new Error("aborted");
        (err as { name: string }).name = "AbortError";
        reject(err);
      });
    })) as unknown as typeof fetch;
  const client = createRpcClient({ fetchImpl: hanging, timeoutMs: 20 });
  await assert.rejects(
    () => client.call("m", {}),
    (e: unknown) => {
      assert.ok(e instanceof RpcTransportError);
      assert.match(e.message, /timed out/);
      return true;
    },
  );
});

test("treats a null result as a valid null rather than an error", async () => {
  const client = createRpcClient({
    fetchImpl: fetchReturning({ jsonrpc: "2.0", id: 1, result: null }),
  });
  const out = await client.call("novai_getTransaction", { txid: "x" });
  assert.equal(out, null);
});

test("maps a response missing both result and error to a transport error", async () => {
  const client = createRpcClient({ fetchImpl: fetchReturning({ jsonrpc: "2.0", id: 1 }) });
  await assert.rejects(
    () => client.call("m", {}),
    (e: unknown) => {
      assert.ok(e instanceof RpcTransportError);
      assert.match(e.message, /malformed/);
      return true;
    },
  );
});
