/**
 * Tests for the OAuth bearer protection of the HTTP transport.
 *
 * Tokens are signed with a locally generated key pair and verified against that
 * same key, so nothing here touches the network or a real authorization server.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWTVerifyGetKey } from 'jose';
import {
  defaultJwksUri,
  getAuthConfig,
  METADATA_PATHS,
  metadataUrl,
  protectedResourceMetadata,
  verifyBearer,
  wwwAuthenticate,
  type AuthConfig,
} from '../src/auth.js';

const ISSUER = 'https://login.microsoftonline.com/2f340cb1-3fa1-4e6e-b876-98a0f3732499/v2.0';
const AUDIENCE = 'api://bitbucket-mcp';
const RESOURCE = 'https://bitbucket-mcp-server.example.com';

let privateKey: CryptoKey;
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  const publicJwk = await exportJWK(pair.publicKey);
  publicJwk.kid = 'test-key';
  publicJwk.alg = 'RS256';
  jwks = createLocalJWKSet({ keys: [publicJwk] });
});

function config(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    issuer: ISSUER,
    audience: AUDIENCE,
    resourceUrl: `${RESOURCE}/mcp`,
    jwks,
    ...overrides,
  };
}

async function token(claims: Record<string, unknown> = {}, options: { expired?: boolean } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer((claims.iss as string) ?? ISSUER)
    .setAudience((claims.aud as string) ?? AUDIENCE)
    .setSubject((claims.sub as string) ?? 'user-123')
    .setIssuedAt(options.expired ? now - 7200 : now)
    .setExpirationTime(options.expired ? now - 3600 : now + 3600)
    .sign(privateKey);
}

describe('configuration', () => {
  it('is disabled unless both issuer and audience are set', () => {
    expect(getAuthConfig({}, jwks)).toBeNull();
    expect(getAuthConfig({ MCP_OAUTH_ISSUER: ISSUER }, jwks)).toBeNull();
    expect(getAuthConfig({ MCP_OAUTH_AUDIENCE: AUDIENCE }, jwks)).toBeNull();
  });

  it('is enabled when both are set', () => {
    const cfg = getAuthConfig(
      { MCP_OAUTH_ISSUER: ISSUER, MCP_OAUTH_AUDIENCE: AUDIENCE, MCP_PUBLIC_URL: `${RESOURCE}/` },
      jwks
    );

    expect(cfg).not.toBeNull();
    expect(cfg!.issuer).toBe(ISSUER);
    // trailing slash trimmed, and the resource is the MCP endpoint itself
    expect(cfg!.resourceUrl).toBe(`${RESOURCE}/mcp`);
  });

  it('derives the Entra keys endpoint from the issuer', () => {
    expect(defaultJwksUri(ISSUER)).toBe(
      'https://login.microsoftonline.com/2f340cb1-3fa1-4e6e-b876-98a0f3732499/discovery/v2.0/keys'
    );
  });
});

describe('metadata', () => {
  it('advertises the issuer as the authorization server', () => {
    const meta = protectedResourceMetadata(config({ requiredScopes: ['mcp.access'] }));

    expect(meta).toMatchObject({
      resource: `${RESOURCE}/mcp`,
      authorization_servers: [ISSUER],
      scopes_supported: ['mcp.access'],
    });
  });

  it('advertises the scopes clients must request when they differ from the validated ones', () => {
    // Entra validates `scp: mcp.access` but the client has to ask for the full URI
    const meta = protectedResourceMetadata(
      config({ requiredScopes: ['mcp.access'], advertisedScopes: ['api://bitbucket-mcp/mcp.access'] })
    );

    expect(meta).toMatchObject({ scopes_supported: ['api://bitbucket-mcp/mcp.access'] });
  });

  it('accepts a token carrying any one of several accepted scopes', async () => {
    const cfg = config({ requiredScopes: ['mcp.access', 'mcp.invoke'] });

    expect((await verifyBearer(`Bearer ${await token({ scp: 'mcp.access' })}`, cfg)).ok).toBe(true);
    expect((await verifyBearer(`Bearer ${await token({ roles: ['mcp.invoke'] })}`, cfg)).ok).toBe(true);
  });

  it('points the WWW-Authenticate header at the metadata document', () => {
    expect(wwwAuthenticate(config())).toContain(
      `resource_metadata="${RESOURCE}/.well-known/oauth-protected-resource/mcp"`
    );
  });

  it('derives the metadata URL from the resource, without duplicating /mcp', () => {
    expect(metadataUrl(config())).toBe(`${RESOURCE}/.well-known/oauth-protected-resource/mcp`);
  });

  it('serves the metadata at both the path-aware and the bare well-known location', () => {
    // RFC 9728 derives the path from the resource; some clients only try the bare one
    expect(METADATA_PATHS).toEqual([
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-protected-resource',
    ]);
  });
});

describe('token verification', () => {
  it('accepts a valid token', async () => {
    const result = await verifyBearer(`Bearer ${await token({ preferred_username: 'javier@simplekyc.com' })}`, config());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.subject).toBe('user-123');
      expect(result.caller).toBe('javier@simplekyc.com');
    }
  });

  it('rejects a missing header with 401', async () => {
    const result = await verifyBearer(undefined, config());

    expect(result).toMatchObject({ ok: false, status: 401, error: 'invalid_token' });
  });

  it('rejects a non-Bearer scheme', async () => {
    const result = await verifyBearer('Basic dXNlcjpwYXNz', config());

    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a token for another audience', async () => {
    const result = await verifyBearer(`Bearer ${await token({ aud: 'api://something-else' })}`, config());

    expect(result).toMatchObject({ ok: false, status: 401, error: 'invalid_token' });
  });

  it('rejects a token from another issuer', async () => {
    const result = await verifyBearer(`Bearer ${await token({ iss: 'https://evil.example.com' })}`, config());

    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects an expired token', async () => {
    const result = await verifyBearer(`Bearer ${await token({}, { expired: true })}`, config());

    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a tampered signature', async () => {
    const valid = await token();
    const tampered = `${valid.slice(0, -4)}AAAA`;

    const result = await verifyBearer(`Bearer ${tampered}`, config());

    expect(result).toMatchObject({ ok: false, status: 401 });
  });
});

describe('scopes', () => {
  it('accepts a delegated token carrying the required scope in scp', async () => {
    const result = await verifyBearer(
      `Bearer ${await token({ scp: 'mcp.access other.scope' })}`,
      config({ requiredScopes: ['mcp.access'] })
    );

    expect(result.ok).toBe(true);
  });

  it('accepts an application token carrying it in roles', async () => {
    const result = await verifyBearer(
      `Bearer ${await token({ roles: ['mcp.access'] })}`,
      config({ requiredScopes: ['mcp.access'] })
    );

    expect(result.ok).toBe(true);
  });

  it('answers 403 insufficient_scope when the scope is missing', async () => {
    const result = await verifyBearer(
      `Bearer ${await token({ scp: 'other.scope' })}`,
      config({ requiredScopes: ['mcp.access'] })
    );

    expect(result).toMatchObject({ ok: false, status: 403, error: 'insufficient_scope' });
  });
});
