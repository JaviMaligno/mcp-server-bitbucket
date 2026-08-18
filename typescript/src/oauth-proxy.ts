/**
 * Minimal OAuth proxy in front of the upstream authorization server.
 *
 * Why this exists: the MCP authorization spec and Microsoft Entra ID cannot be
 * satisfied at the same time by pointing clients straight at Entra.
 *
 * - RFC 9728 requires the `resource` in our metadata to be the identifier the
 *   metadata URL was built from, i.e. https://<host>/mcp. Clients send that as
 *   the RFC 8707 `resource` parameter.
 * - Entra rejects exactly that with AADSTS9010010 ("the resource parameter
 *   provided in the request doesn't match with the requested scopes"): for Entra
 *   the resource is the API's Application ID URI, and it only accepts https
 *   identifiers on domains verified in the tenant.
 * - Entra also serves no RFC 8414 metadata and no dynamic client registration.
 *
 * So this server becomes the authorization server clients talk to, and
 * translates on the way through. It is deliberately thin:
 *
 * - it issues nothing and stores nothing — no tokens, no codes, no sessions;
 * - /oauth/authorize redirects to Entra, swapping the scope for the one Entra
 *   expects and dropping `resource`, while PKCE and state pass through untouched;
 * - /oauth/token forwards the exchange to Entra verbatim (minus `resource`) and
 *   returns its response, so the access token is still Entra's and is still
 *   verified against Entra's keys by src/auth.ts.
 *
 * Redirect URIs are checked against an allowlist: this is the one place where a
 * proxy like this can be turned into an open redirect, so it is not optional.
 *
 * Environment variables:
 * - MCP_OAUTH_UPSTREAM_SCOPE: scope requested from Entra, e.g.
 *   "api://<app-id>/mcp.access offline_access"
 * - MCP_OAUTH_REDIRECT_ALLOWLIST: comma-separated redirect URIs to accept
 *   (defaults to Claude's callbacks)
 */

import type { AuthConfig } from './auth.js';
import { authorizationServerMetadata, serverOrigin } from './auth.js';

export const AUTHORIZE_PATH = '/oauth/authorize';
export const TOKEN_PATH = '/oauth/token';

/** Claude's callbacks; localhost is allowed for MCP clients that run locally. */
const DEFAULT_REDIRECT_ALLOWLIST = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
];

export interface ProxyConfig {
  /** Public origin of this server; it is the issuer clients see. */
  origin: string;
  /** Scope to request upstream, in place of whatever the client asked for. */
  upstreamScope: string;
  /** Redirect URIs we are willing to send users back to. */
  redirectAllowlist: string[];
}

export function getProxyConfig(
  auth: AuthConfig,
  env: NodeJS.ProcessEnv = process.env
): ProxyConfig {
  const configured = (env.MCP_OAUTH_REDIRECT_ALLOWLIST || '')
    .split(/[\s,]+/)
    .filter(Boolean);

  return {
    origin: serverOrigin(auth),
    upstreamScope:
      (env.MCP_OAUTH_UPSTREAM_SCOPE || '').trim() ||
      [...(auth.advertisedScopes ?? []), 'offline_access'].join(' ').trim(),
    redirectAllowlist: configured.length > 0 ? configured : DEFAULT_REDIRECT_ALLOWLIST,
  };
}

/**
 * Metadata for ourselves as the authorization server (RFC 8414). Clients build
 * the whole flow from this, so the endpoints are ours, not Entra's.
 */
export function proxyAuthorizationServerMetadata(
  auth: AuthConfig,
  proxy: ProxyConfig
): Record<string, unknown> {
  return {
    issuer: proxy.origin,
    authorization_endpoint: `${proxy.origin}${AUTHORIZE_PATH}`,
    token_endpoint: `${proxy.origin}${TOKEN_PATH}`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: [
      'client_secret_post',
      'client_secret_basic',
      'none',
    ],
    ...(auth.advertisedScopes ? { scopes_supported: auth.advertisedScopes } : {}),
  };
}

export type AuthorizeResult =
  | { status: 302; location: string }
  | { status: 400; error: string; description: string };

/**
 * Turn the client's authorization request into the upstream one.
 *
 * Everything the client chose about the flow — state, PKCE challenge, response
 * type — is passed through unchanged. Only the parameters Entra disagrees with
 * are rewritten: `scope` becomes the API scope, and `resource` is dropped.
 */
export function buildAuthorizeRedirect(
  requestUrl: URL,
  proxy: ProxyConfig,
  upstreamAuthorizeEndpoint: string
): AuthorizeResult {
  const redirectUri = requestUrl.searchParams.get('redirect_uri');
  if (!redirectUri) {
    return { status: 400, error: 'invalid_request', description: 'redirect_uri is required' };
  }
  if (!proxy.redirectAllowlist.includes(redirectUri)) {
    // An unchecked redirect_uri here would make this an open redirect.
    return {
      status: 400,
      error: 'invalid_request',
      description: 'redirect_uri is not allowed for this server',
    };
  }

  const upstream = new URL(upstreamAuthorizeEndpoint);
  const passthrough = [
    'client_id',
    'response_type',
    'redirect_uri',
    'state',
    'code_challenge',
    'code_challenge_method',
    'prompt',
    'login_hint',
  ];
  for (const name of passthrough) {
    const value = requestUrl.searchParams.get(name);
    if (value !== null) {
      upstream.searchParams.set(name, value);
    }
  }
  upstream.searchParams.set('scope', proxy.upstreamScope);

  return { status: 302, location: upstream.toString() };
}

/**
 * Body to forward to the upstream token endpoint: the client's own body with
 * `resource` removed, since that is what Entra objects to.
 */
export function buildTokenRequestBody(rawBody: string): URLSearchParams {
  const params = new URLSearchParams(rawBody);
  params.delete('resource');
  return params;
}

export interface TokenResponse {
  status: number;
  body: string;
  contentType: string;
}

/** Forward the token exchange upstream and hand back whatever it answers. */
export async function forwardTokenRequest(
  rawBody: string,
  authorizationHeader: string | undefined,
  upstreamTokenEndpoint: string,
  fetchImpl: typeof fetch = fetch
): Promise<TokenResponse> {
  const response = await fetchImpl(upstreamTokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
    },
    body: buildTokenRequestBody(rawBody).toString(),
  });

  return {
    status: response.status,
    body: await response.text(),
    contentType: response.headers.get('content-type') ?? 'application/json',
  };
}

/** Upstream endpoints, read from the issuer's own configuration. */
export async function resolveUpstreamEndpoints(
  auth: AuthConfig,
  fetchImpl: typeof fetch = fetch
): Promise<{ authorize: string; token: string }> {
  const metadata = await authorizationServerMetadata(auth, fetchImpl);
  const authorize = metadata.authorization_endpoint;
  const token = metadata.token_endpoint;

  if (typeof authorize !== 'string' || typeof token !== 'string') {
    throw new Error('Issuer configuration is missing authorization_endpoint or token_endpoint');
  }

  return { authorize, token };
}

/**
 * A URL safe to write to the log: authorization requests carry state and PKCE
 * challenges, and token responses carry tokens. Neither belongs in a log line.
 */
export function redactUrlForLog(url: string): string {
  const [path, query] = url.split('?');
  return query ? `${path}?<redacted>` : path;
}
