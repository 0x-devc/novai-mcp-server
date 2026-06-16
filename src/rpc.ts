// Minimal JSON-RPC 2.0 client for the public NOVAI endpoint.
// Read-only by construction: this client only ever sends query methods. It holds no
// keys, performs no signing, and exposes no path that could submit or mutate state.

export const DEFAULT_RPC_URL = "https://rpc.novai.network";
const DEFAULT_TIMEOUT_MS = 15000;

// Raised when the endpoint returns a JSON-RPC error object, for example an invalid
// parameter or a height above the current tip. The code and message come from the node.
export class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

// Raised for transport-level problems: timeout, unreachable endpoint, a non success HTTP
// status, or a body that is not a well formed JSON-RPC envelope. Messages are intentionally
// generic and never include endpoint internals.
export class RpcTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcTransportError";
  }
}

export interface RpcClient {
  call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
  readonly url: string;
  readonly timeoutMs: number;
}

export interface RpcClientOptions {
  url?: string;
  timeoutMs?: number;
  // Injectable for tests. Defaults to the global fetch.
  fetchImpl?: typeof fetch;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
}

export function createRpcClient(options: RpcClientOptions = {}): RpcClient {
  const url = options.url ?? process.env.NOVAI_RPC_URL ?? DEFAULT_RPC_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;
  let nextId = 0;

  async function call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method, params, id: ++nextId }),
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) {
          throw new RpcTransportError(`the NOVAI RPC request timed out after ${timeoutMs} ms`);
        }
        throw new RpcTransportError("could not reach the NOVAI RPC endpoint");
      }

      if (!response.ok) {
        throw new RpcTransportError(`the NOVAI RPC endpoint returned HTTP status ${response.status}`);
      }

      let body: JsonRpcResponse;
      try {
        body = (await response.json()) as JsonRpcResponse;
      } catch {
        if (controller.signal.aborted) {
          throw new RpcTransportError(`the NOVAI RPC request timed out after ${timeoutMs} ms`);
        }
        throw new RpcTransportError("the NOVAI RPC endpoint returned a response that was not valid JSON");
      }

      if (body != null && typeof body === "object" && body.error != null) {
        const code = typeof body.error.code === "number" ? body.error.code : -1;
        const message =
          typeof body.error.message === "string" ? body.error.message : "unknown RPC error";
        throw new RpcError(code, message);
      }

      if (body == null || typeof body !== "object" || !("result" in body)) {
        throw new RpcTransportError("the NOVAI RPC endpoint returned a malformed JSON-RPC response");
      }

      return body.result as T;
    } finally {
      clearTimeout(timer);
    }
  }

  return { call, url, timeoutMs };
}
