/**
 * OAuth 2.1 bearer-token protection for the HTTP transport.
 *
 * The remote server holds a single company-owned Bitbucket credential, so
 * anyone who can reach /mcp can use it. This module gates that endpoint on a
 * bearer token issued by an external authorization server (Microsoft Entra ID
 * in our deployment), following the MCP authorization spec: the server acts as
 * an OAuth *resource server*, advertises where to get a token via
 * /.well-known/oauth-protected-resource (RFC 9728), and answers unauthenticated
 * requests with 401 + WWW-Authenticate so the client can start the flow.
 *
 * Note this authenticates *who may use the server*, not who acts on Bitbucket:
 * calls still reach Bitbucket as the service identity.
 *
 * Disabled unless both MCP_OAUTH_ISSUER and MCP_OAUTH_AUDIENCE are set, so an
 * unconfigured deployment keeps behaving exactly as before.
 *
 * Environment variables:
 * - MCP_OAUTH_ISSUER: token issuer, e.g. https://login.microsoftonline.com/<tenant>/v2.0
 * - MCP_OAUTH_AUDIENCE: expected `aud`, e.g. api://<app-id>
 * - MCP_OAUTH_JWKS_URI: override for the signing keys (derived from the issuer otherwise)
 * - MCP_OAUTH_REQUIRED_SCOPE: scope(s) the token must carry, comma-separated when
 *   more than one is acceptable, e.g. "mcp.access,mcp.invoke" (Entra names the
 *   delegated scope and the application role differently, and a token only ever
 *   carries one of the two)
 * - MCP_OAUTH_SCOPES_SUPPORTED: scope(s) advertised to clients, when they differ
 *   from the ones validated. Entra hands out `scp: mcp.access` but expects the
 *   client to *request* `api://<app-id>/mcp.access`, so the full URI goes here
 * - MCP_PUBLIC_URL: public URL of this server. The resource identifier is the MCP
 *   endpoint itself (<public-url>/mcp), which is the most specific canonical URI
 *   per RFC 8707, and the metadata is served at the path RFC 9728 derives from
 *   it: /.well-known/oauth-protected-resource/mcp
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

export interface AuthConfig {
  /** Token issuer that must match the `iss` claim. */
  issuer: string;
  /** Expected `aud` claim — the identifier of this API. */
  audience: string;
  /** Scopes the token must carry at least one of, if any. */
  requiredScopes?: string[];
  /** Scopes advertised in the metadata document; defaults to requiredScopes. */
  advertisedScopes?: string[];
  /** Public URL of this server, advertised as the protected resource. */
  resourceUrl: string;
  /** Key source used to verify token signatures. */
  jwks: JWTVerifyGetKey;
}

export interface AuthFailure {
  ok: false;
  /** HTTP status to answer with: 401 for a missing/invalid token, 403 for a valid one lacking the scope. */
  status: 401 | 403;
  /** OAuth error code for the WWW-Authenticate header. */
  error: 'invalid_token' | 'insufficient_scope';
  description: string;
}

export interface AuthSuccess {
  ok: true;
  /** `sub` claim, useful for attributing calls in logs. */
  subject?: string;
  /** Human-readable caller, when the token carries one. */
  caller?: string;
}

export type AuthResult = AuthSuccess | AuthFailure;

/**
 * Entra ID publishes its signing keys next to the issuer; the v2.0 suffix in
 * the issuer is not part of the discovery path.
 */
export function defaultJwksUri(issuer: string): string {
  const base = issuer.replace(/\/+$/, '').replace(/\/v2\.0$/, '');
  return `${base}/discovery/v2.0/keys`;
}

/**
 * Build the auth configuration from the environment, or null when OAuth is not
 * configured (the server then serves /mcp unauthenticated, as it did before).
 *
 * `jwksOverride` exists for tests, which cannot fetch a remote key set.
 */
export function getAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
  jwksOverride?: JWTVerifyGetKey
): AuthConfig | null {
  const issuer = (env.MCP_OAUTH_ISSUER || '').trim();
  const audience = (env.MCP_OAUTH_AUDIENCE || '').trim();

  if (!issuer || !audience) {
    return null;
  }

  const jwksUri = (env.MCP_OAUTH_JWKS_URI || '').trim() || defaultJwksUri(issuer);
  const requiredScopes = parseScopes(env.MCP_OAUTH_REQUIRED_SCOPE);
  const advertisedScopes = parseScopes(env.MCP_OAUTH_SCOPES_SUPPORTED) ?? requiredScopes;
  const publicUrl = (env.MCP_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  // The resource is the MCP endpoint, not the host: clients ask for the most
  // specific URI they can, and the audience check depends on this matching.
  const resourceUrl = publicUrl ? `${publicUrl}/mcp` : audience;

  return {
    issuer,
    audience,
    requiredScopes,
    advertisedScopes,
    resourceUrl,
    jwks: jwksOverride ?? createRemoteJWKSet(new URL(jwksUri)),
  };
}

/** Split a comma- or space-separated scope list; undefined when empty. */
function parseScopes(raw: string | undefined): string[] | undefined {
  const scopes = (raw || '').split(/[\s,]+/).filter(Boolean);
  return scopes.length > 0 ? scopes : undefined;
}

/**
 * RFC 9728 metadata telling clients which authorization server issues tokens
 * for this resource. Claude fetches this after a 401 to start the OAuth flow.
 */
export function protectedResourceMetadata(config: AuthConfig): Record<string, unknown> {
  // Advertise what clients must request; when that is not spelled out, the
  // scopes we validate are the best available answer.
  const scopes = config.advertisedScopes ?? config.requiredScopes;

  return {
    resource: config.resourceUrl,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ['header'],
    ...(scopes ? { scopes_supported: scopes } : {}),
  };
}

/**
 * Paths the metadata document is served from. RFC 9728 derives the path from the
 * resource identifier, so a resource at /mcp is described at
 * /.well-known/oauth-protected-resource/mcp; the bare path is kept too because
 * some clients only look there.
 */
export const METADATA_PATHS = [
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-protected-resource',
];

/** Absolute URL of the metadata document, as advertised to clients. */
export function metadataUrl(config: AuthConfig): string {
  const origin = config.resourceUrl.replace(/\/mcp$/, '');
  return `${origin}${METADATA_PATHS[0]}`;
}

/**
 * Value for the WWW-Authenticate header, pointing at the metadata document so
 * the client can discover where to authenticate.
 */
export function wwwAuthenticate(config: AuthConfig, failure?: AuthFailure): string {
  const parts = [
    `Bearer realm="mcp"`,
    `resource_metadata="${metadataUrl(config)}"`,
  ];
  if (failure) {
    parts.push(`error="${failure.error}"`, `error_description="${failure.description}"`);
  }
  return parts.join(', ');
}

/**
 * Scopes arrive as a space-separated `scp` string (delegated tokens) or a
 * `roles` array (application tokens); accept either.
 */
function tokenScopes(payload: JWTPayload): string[] {
  const scp = payload.scp;
  if (typeof scp === 'string') {
    return scp.split(' ').filter(Boolean);
  }
  if (Array.isArray(scp)) {
    return scp.filter((s): s is string => typeof s === 'string');
  }
  const roles = payload.roles;
  if (Array.isArray(roles)) {
    return roles.filter((r): r is string => typeof r === 'string');
  }
  return [];
}

/**
 * Verify the Authorization header of an incoming request.
 *
 * Returns a typed result rather than throwing so the caller can map it onto a
 * 401 or 403 with the right WWW-Authenticate header.
 */
export async function verifyBearer(
  authorization: string | undefined,
  config: AuthConfig
): Promise<AuthResult> {
  if (!authorization) {
    return {
      ok: false,
      status: 401,
      error: 'invalid_token',
      description: 'Authorization header is required',
    };
  }

  const match = /^Bearer[ ]+(.+)$/i.exec(authorization.trim());
  if (!match) {
    return {
      ok: false,
      status: 401,
      error: 'invalid_token',
      description: 'Authorization header must use the Bearer scheme',
    };
  }

  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(match[1], config.jwks, {
      issuer: config.issuer,
      audience: config.audience,
    });
    payload = verified.payload;
  } catch (error) {
    return {
      ok: false,
      status: 401,
      error: 'invalid_token',
      description: error instanceof Error ? error.message : 'Token verification failed',
    };
  }

  if (config.requiredScopes) {
    const granted = tokenScopes(payload);
    if (!config.requiredScopes.some((scope) => granted.includes(scope))) {
      return {
        ok: false,
        status: 403,
        error: 'insufficient_scope',
        description: `Token carries none of the required scopes: ${config.requiredScopes.join(', ')}`,
      };
    }
  }

  const caller = [payload.preferred_username, payload.upn, payload.appid]
    .find((value): value is string => typeof value === 'string' && value.length > 0);

  return { ok: true, subject: typeof payload.sub === 'string' ? payload.sub : undefined, caller };
}
