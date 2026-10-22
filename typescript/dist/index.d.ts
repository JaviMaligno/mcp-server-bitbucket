#!/usr/bin/env node
import { RequestListener } from 'node:http';

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

declare function createHttpHandler(): RequestListener;

export { createHttpHandler };
