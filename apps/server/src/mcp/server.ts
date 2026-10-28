import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { resolveAccessToken } from "../auth/access-tokens.ts";
import { requestOrigin, type AppEnv, type Listener } from "../auth/identity.ts";
import type { FailureLimiter } from "../auth/rate-limit.ts";
import { registerTools, type ToolDeps } from "./tools.ts";

export type McpDeps = ToolDeps & { listener: Listener; limiter: FailureLimiter; version?: string };

const LIMIT_KEY = "mcp-token";

/**
 * Runyard's MCP server at /api/mcp: Streamable HTTP, stateless, JSON
 * responses. Callers sign in with a personal access token (Bearer); the
 * dashboard's session cookies and tailnet identity don't apply here, and
 * tokens don't apply anywhere else.
 */
export function mcpRoutes(deps: McpDeps) {
  return new Hono<AppEnv>().all("/mcp", async (c) => {
    if (deps.limiter.blocked(LIMIT_KEY))
      return c.json({ error: "Too many failed tokens. Wait a few minutes." }, 429);
    const header = c.req.header("Authorization") ?? "";
    const resolved = header.startsWith("Bearer ")
      ? resolveAccessToken(deps.db, header.slice(7).trim())
      : undefined;
    if (!resolved) {
      if (header) deps.limiter.fail(LIMIT_KEY);
      return c.json(
        { error: "Send a Runyard access token as Authorization: Bearer <token>." },
        401,
        { "WWW-Authenticate": 'Bearer realm="runyard"' },
      );
    }
    let origin: string;
    try {
      origin = requestOrigin(c, deps.listener).origin;
    } catch {
      origin = "";
    }
    const server = new McpServer({ name: "runyard", version: deps.version ?? "0.1.0" });
    registerTools(server, deps, { user: resolved.user, token: resolved.token, origin });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      // Stateless: each request gets its own server, bound to its caller.
      void server.close();
    }
  });
}
