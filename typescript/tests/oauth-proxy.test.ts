/**
 * Tests for the OAuth proxy.
 *
 * The proxy exists because Entra and the MCP spec disagree about the `resource`
 * parameter (AADSTS9010010), so the tests pin down exactly what gets rewritten
 * on the way through — and what must not be touched: PKCE, state, and the
 * redirect the user is sent back to.
 */

import { describe, it, expect } from 'vitest';
import {
  AUTHORIZE_PATH,
  buildAuthorizeRedirect,
  buildTokenRequestBody,
  forwardTokenRequest,
  getProxyConfig,
  proxyAuthorizationServerMetadata,
  redactUrlForLog,
  TOKEN_PATH,
  type ProxyConfig,
} from '../src/oauth-proxy.js';
import type { AuthConfig } from '../src/auth.js';

const ORIGIN = 'https://mcp.example.com';
const UPSTREAM_AUTHORIZE = 'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize';
const UPSTREAM_TOKEN = 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token';
const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

const auth = {
  issuer: 'https://login.microsoftonline.com/tenant/v2.0',
  audience: 'f310dc92',
  resourceUrl: `${ORIGIN}/mcp`,
  resourceIdentifier: `${ORIGIN}/mcp`,
  advertisedScopes: ['api://f310dc92/mcp.access'],
  proxyAuthorizationServerMetadata: true,
  jwks: (() => {
    throw new Error('not used');
  }) as unknown as AuthConfig['jwks'],
} as AuthConfig;

function proxy(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return { ...getProxyConfig(auth, {}), ...overrides };
}

function authorizeUrl(params: Record<string, string>): URL {
  const url = new URL(`${ORIGIN}${AUTHORIZE_PATH}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

describe('configuration', () => {
  it('requests the advertised scope plus offline_access upstream', () => {
    expect(getProxyConfig(auth, {}).upstreamScope).toBe('api://f310dc92/mcp.access offline_access');
  });

  it('accepts an explicit upstream scope', () => {
    const cfg = getProxyConfig(auth, { MCP_OAUTH_UPSTREAM_SCOPE: 'api://other/scope offline_access' });

    expect(cfg.upstreamScope).toBe('api://other/scope offline_access');
  });

  it("defaults the redirect allowlist to Claude's callbacks", () => {
    expect(getProxyConfig(auth, {}).redirectAllowlist).toContain(CLAUDE_CALLBACK);
  });
});

describe('authorization server metadata', () => {
  it('presents this server as the authorization server', () => {
    const meta = proxyAuthorizationServerMetadata(auth, proxy());

    expect(meta).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}${AUTHORIZE_PATH}`,
      token_endpoint: `${ORIGIN}${TOKEN_PATH}`,
      code_challenge_methods_supported: ['S256'],
    });
  });
});

describe('authorize', () => {
  const base = {
    client_id: 'client-123',
    response_type: 'code',
    redirect_uri: CLAUDE_CALLBACK,
    state: 'opaque-state',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
  };

  it('redirects upstream, passing PKCE and state through untouched', () => {
    const result = buildAuthorizeRedirect(authorizeUrl(base), proxy(), UPSTREAM_AUTHORIZE);

    expect(result.status).toBe(302);
    if (result.status !== 302) return;
    const location = new URL(result.location);

    expect(location.origin + location.pathname).toBe(UPSTREAM_AUTHORIZE);
    expect(location.searchParams.get('code_challenge')).toBe(base.code_challenge);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('state')).toBe(base.state);
    expect(location.searchParams.get('redirect_uri')).toBe(CLAUDE_CALLBACK);
    expect(location.searchParams.get('client_id')).toBe(base.client_id);
  });

  it('swaps the scope for the one the upstream expects', () => {
    const result = buildAuthorizeRedirect(
      authorizeUrl({ ...base, scope: `${ORIGIN}/mcp` }),
      proxy(),
      UPSTREAM_AUTHORIZE
    );

    expect(result.status).toBe(302);
    if (result.status !== 302) return;

    expect(new URL(result.location).searchParams.get('scope')).toBe(
      'api://f310dc92/mcp.access offline_access'
    );
  });

  it('drops the resource parameter, which is what the upstream rejects', () => {
    // AADSTS9010010: "the resource parameter doesn't match with the requested scopes"
    const result = buildAuthorizeRedirect(
      authorizeUrl({ ...base, resource: `${ORIGIN}/mcp` }),
      proxy(),
      UPSTREAM_AUTHORIZE
    );

    expect(result.status).toBe(302);
    if (result.status !== 302) return;

    expect(new URL(result.location).searchParams.has('resource')).toBe(false);
  });

  it('refuses a redirect_uri that is not on the allowlist', () => {
    const result = buildAuthorizeRedirect(
      authorizeUrl({ ...base, redirect_uri: 'https://evil.example.com/steal' }),
      proxy(),
      UPSTREAM_AUTHORIZE
    );

    expect(result).toMatchObject({ status: 400, error: 'invalid_request' });
  });

  it('refuses a request with no redirect_uri', () => {
    const { redirect_uri, ...withoutRedirect } = base;
    const result = buildAuthorizeRedirect(authorizeUrl(withoutRedirect), proxy(), UPSTREAM_AUTHORIZE);

    expect(result).toMatchObject({ status: 400 });
  });
});

describe('token', () => {
  it('forwards the exchange and returns the upstream response verbatim', async () => {
    let seen: { url: string; body: string; auth?: string } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = {
        url,
        body: String(init.body),
        auth: (init.headers as Record<string, string>).Authorization,
      };
      return new Response(JSON.stringify({ access_token: 'upstream-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await forwardTokenRequest(
      'grant_type=authorization_code&code=abc&code_verifier=xyz&resource=https%3A%2F%2Fmcp.example.com%2Fmcp',
      'Basic secret',
      UPSTREAM_TOKEN,
      fetchImpl
    );

    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).access_token).toBe('upstream-token');
    expect(seen!.url).toBe(UPSTREAM_TOKEN);
    expect(seen!.auth).toBe('Basic secret');
    // the exchange itself is untouched…
    expect(seen!.body).toContain('code=abc');
    expect(seen!.body).toContain('code_verifier=xyz');
    // …except for the parameter the upstream rejects
    expect(seen!.body).not.toContain('resource');
  });

  it('passes upstream errors through instead of masking them', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

    const result = await forwardTokenRequest('grant_type=authorization_code', undefined, UPSTREAM_TOKEN, fetchImpl);

    expect(result.status).toBe(400);
    expect(JSON.parse(result.body).error).toBe('invalid_grant');
  });

  it('keeps refresh_token grants working', () => {
    const body = buildTokenRequestBody('grant_type=refresh_token&refresh_token=r1&resource=x');

    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('r1');
    expect(body.has('resource')).toBe(false);
  });
});

describe('logging', () => {
  it('never writes the query string, which carries state and PKCE', () => {
    expect(redactUrlForLog(`${AUTHORIZE_PATH}?state=secret&code_challenge=abc`)).toBe(
      `${AUTHORIZE_PATH}?<redacted>`
    );
  });

  it('leaves plain paths readable', () => {
    expect(redactUrlForLog('/mcp')).toBe('/mcp');
  });
});
