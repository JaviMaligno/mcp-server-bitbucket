#!/usr/bin/env node
/**
 * Bitbucket MCP Server - TypeScript Implementation
 *
 * Provides tools for interacting with Bitbucket repositories,
 * pull requests, pipelines, branches, commits, deployments, and webhooks.
 *
 * Supports two transport modes:
 * - stdio (default): For local MCP clients like Claude Desktop
 * - http: For remote MCP clients via Streamable HTTP (set MCP_TRANSPORT=http)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer as createHttpServer } from 'node:http';
import {
  getAuthConfig,
  METADATA_PATHS,
  protectedResourceMetadata,
  verifyBearer,
  wwwAuthenticate,
} from './auth.js';

import { getSettings } from './settings.js';
import { toolDefinitions, handleToolCall } from './tools/index.js';
import { resourceDefinitions, handleResourceRead } from './resources.js';
import { promptDefinitions, handlePromptGet } from './prompts.js';

const VERSION = '0.15.0';

function createServer(): Server {
  const server = new Server(
    {
      name: 'bitbucket',
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolDefinitions,
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    try {
      const result = await handleToolCall(name, args || {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: message }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  // List available resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: resourceDefinitions,
    };
  });

  // Handle resource reads
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    
    try {
      const content = await handleResourceRead(uri);
      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: content,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to read resource: ${message}`);
    }
  });

  // List available prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: promptDefinitions,
    };
  });

  // Handle prompt gets
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    try {
      const result = handlePromptGet(name, args || {});
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get prompt: ${message}`);
    }
  });

  return server;
}

async function startStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Bitbucket MCP Server v${VERSION} started (stdio)`);
}

async function startHttp(): Promise<void> {
  const port = parseInt(process.env.PORT || '3000', 10);
  const sessions = new Map<string, { server: Server; transport: StreamableHTTPServerTransport }>();

  // OAuth protection for /mcp. Null when unconfigured, in which case the
  // endpoint stays open exactly as before (see src/auth.ts).
  const auth = getAuthConfig();

  const httpServer = createHttpServer(async (req, res) => {
    // CORS headers for remote MCP clients
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, mcp-session-id');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // One line per request. With a single shared Bitbucket credential this is
    // the only record of who used the server, and it is what makes an OAuth
    // problem diagnosable from the outside.
    const clientIp =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress ??
      'unknown';
    res.on('finish', () => {
      console.error(
        `${req.method} ${req.url} -> ${res.statusCode} from ${clientIp}${
          callerLabel ? ` (${callerLabel})` : ''
        }`
      );
    });
    let callerLabel = '';

    // Health check — deliberately left open so platform probes keep working
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: VERSION }));
      return;
    }

    // Tells clients which authorization server issues tokens for this resource
    if (auth && req.method === 'GET' && METADATA_PATHS.includes(req.url || '')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(protectedResourceMetadata(auth)));
      return;
    }

    if (req.url !== '/mcp') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    // Every /mcp request carries its own token: a session is not a credential,
    // so an established session must not become a way around the check.
    if (auth) {
      const result = await verifyBearer(req.headers.authorization, auth);
      if (result.ok) {
        callerLabel = result.caller ?? result.subject ?? 'authenticated';
      }
      if (!result.ok) {
        res.writeHead(result.status, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': wwwAuthenticate(auth, result),
        });
        res.end(JSON.stringify({ error: result.error, error_description: result.description }));
        return;
      }
    }

    // Check for existing session
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      // Existing session — route to its transport
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res);
      return;
    }

    // New session (POST without session ID = initialize)
    if (req.method === 'POST' && !sessionId) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      });
      const server = createServer();

      transport.onclose = () => {
        const sid = (transport as unknown as { _sessionId?: string })._sessionId;
        if (sid) sessions.delete(sid);
        server.close();
      };

      await server.connect(transport);
      await transport.handleRequest(req, res);

      // Capture the session ID that was generated
      const newSessionId = res.getHeader('mcp-session-id') as string | undefined;
      if (newSessionId) {
        sessions.set(newSessionId, { server, transport });
      }
      return;
    }

    // Session not found
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid or missing session' }));
  });

  httpServer.listen(port, () => {
    const mode = auth ? `OAuth required (issuer ${auth.issuer})` : 'unauthenticated';
    console.error(`Bitbucket MCP Server v${VERSION} started (http) on port ${port} — ${mode}`);
  });
}

async function main(): Promise<void> {
  // Validate settings on startup
  try {
    getSettings();
  } catch (error) {
    console.error('Configuration error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const transport = process.env.MCP_TRANSPORT || (process.argv.includes('--http') ? 'http' : 'stdio');

  if (transport === 'http') {
    await startHttp();
  } else {
    await startStdio();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
