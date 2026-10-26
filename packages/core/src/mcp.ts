/**
 * Minimal, dependency-free MCP (Model Context Protocol) client for the
 * streamable-HTTP transport used by the Polyester read-only endpoints.
 *
 * Protocol flow (as implemented by fabriclabs workers):
 *   1. POST initialize            → response headers carry `Mcp-Session-Id`
 *   2. POST notifications/initialized
 *   3. POST tools/call            → SSE stream of `data: {jsonrpc}` lines;
 *                                   result is in `result.structuredContent`
 *
 * Works in Node 18+, browsers (when CORS allows), Cloudflare Workers, Vercel Edge.
 */

export interface McpClientOptions {
  url: string;
  clientName?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface JsonRpcError {
  code: number;
  message: string;
}

export class McpError extends Error {
  constructor(
    message: string,
    public readonly rpcCode?: number,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "McpError";
  }
}

export class McpClient {
  private sessionId: string | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly url: string;
  private readonly clientName: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: McpClientOptions) {
    if (!opts.url) throw new McpError("MCP url is required");
    this.url = opts.url;
    this.clientName = opts.clientName ?? "polyester-tools";
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...extra,
    };
    if (this.sessionId) h["Mcp-Session-Id"] = this.sessionId;
    return h;
  }

  private async post<T>(
    body: unknown,
    consume: (response: Response) => Promise<T>,
    captureSid = false,
  ): Promise<{ response: Response; value: T }> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const fetchFn = this.fetchImpl;
    const withTimeout = <R>(operation: () => Promise<R>): Promise<R> => new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        ctrl.signal.removeEventListener("abort", onAbort);
        callback();
      };
      const onAbort = () => finish(() => reject(new DOMException("MCP request timed out", "AbortError")));
      if (ctrl.signal.aborted) {
        onAbort();
        return;
      }
      ctrl.signal.addEventListener("abort", onAbort, { once: true });
      void Promise.resolve()
        .then(() => settled ? undefined : operation())
        .then(
          (value) => finish(() => resolve(value as R)),
          (error) => finish(() => reject(error)),
        );
    });
    try {
      const res = await withTimeout(() => fetchFn(this.url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }));
      const value = await withTimeout(() => consume(res));
      if (captureSid) {
        const sid = res.headers.get("mcp-session-id");
        if (sid) this.sessionId = sid;
      }
      return { response: res, value };
    } catch (error) {
      if (ctrl.signal.aborted) {
        throw new McpError(`MCP request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(t);
    }
  }

  /** Parse an SSE (or plain JSON) response into the first JSON-RPC object. */
  private async parse(res: Response): Promise<any> {
    const text = await res.text();
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        return JSON.parse(payload);
      } catch {
        /* keep scanning */
      }
    }
    // Fallback: maybe it was a plain JSON response.
    try {
      return JSON.parse(text);
    } catch {
      const snippet = text.trim().slice(0, 120);
      throw new McpError(
        snippet
          ? `Unparseable MCP response (${res.status}): ${snippet}`
          : `Unparseable MCP response (${res.status})`,
        undefined,
        res.status,
      );
    }
  }

  private assertOk(msg: any, httpStatus?: number): void {
    if (msg?.error) {
      const err = msg.error as JsonRpcError;
      throw new McpError(err.message ?? "MCP error", err.code, httpStatus);
    }
  }

  private isSessionError(err: unknown, httpStatus?: number): boolean {
    if (httpStatus === 404) return true;
    if (!(err instanceof McpError)) return false;
    if (err.httpStatus === 404) return true;
    if (err.rpcCode === -32000 && /session/i.test(err.message)) return true;
    return /session not found|unknown session|expired session|invalid session/i.test(
      err.message,
    );
  }

  /** Initialize (or reuse) the session. Single-flight + auto-retry once. */
  private ensureSession(): Promise<void> {
    if (this.sessionId) return Promise.resolve();
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      await this.post(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: this.clientName, version: "1.0.0" },
          },
        },
        async (response) => {
          const msg = await this.parse(response);
          this.assertOk(msg, response.status);
          return msg;
        },
        true,
      );
      await this.post(
        {
          jsonrpc: "2.0",
          method: "notifications/initialized",
        },
        async () => undefined,
      );
    })().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  /**
   * Call an MCP tool. Returns `result.structuredContent` when present,
   * otherwise attempts to JSON-parse the first text content block.
   * Transparently re-initializes once ONLY on session-expiry errors, and
   * surfaces tool-level `result.isError === true` as an `McpError`.
   */
  async callTool<T = unknown>(
    name: string,
    args: Record<string, unknown> = {},
    _retried = false,
  ): Promise<T> {
    await this.ensureSession();
    const usedSessionId = this.sessionId;
    let parsedResponse: { response: Response; value: any };
    try {
      parsedResponse = await this.post(
        {
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: { name, arguments: args },
        },
        async (response) => {
          if (response.status === 404) {
            const text = (await response.text()).trim();
            throw new McpError(text || "Session not found", -32000, 404);
          }
          const msg = await this.parse(response);
          this.assertOk(msg, response.status);
          return msg;
        },
      );
    } catch (error) {
      // Rebuild session and retry once ONLY when the session expired / was not found.
      const httpStatus = error instanceof McpError ? error.httpStatus : undefined;
      if (!_retried && this.isSessionError(error, httpStatus)) {
        if (this.sessionId === usedSessionId) {
          this.sessionId = null;
        }
        return this.callTool<T>(name, args, true);
      }
      throw error;
    }

    const { response: res, value: msg } = parsedResponse;
    const result = msg?.result ?? {};
    if (result.isError === true) {
      const content: Array<{ type?: string; text?: string }> = Array.isArray(
        result.content,
      )
        ? result.content
        : [];
      const text = content
        .filter((c) => c?.type === "text" && typeof c.text === "string")
        .map((c) => c.text!.trim())
        .filter(Boolean)
        .join("\n");
      throw new McpError(text || "MCP tool error", undefined, res.status);
    }

    if (result.structuredContent !== undefined && result.structuredContent !== null) {
      return result.structuredContent as T;
    }
    const content: Array<{ type?: string; text?: string }> = result.content ?? [];
    const textBlock = content.find((c) => c?.type === "text" && typeof c.text === "string");
    if (textBlock?.text) {
      try {
        return JSON.parse(textBlock.text) as T;
      } catch {
        return { text: textBlock.text } as unknown as T;
      }
    }
    return result as T;
  }
}
