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
 * - MCP_OAUTH_REQUIRED_SCOPE: scope the token must carry, e.g. mcp.access
 * - MCP_PUBLIC_URL: public URL of this server, used as the resource identifier
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

export interface AuthConfig {
  /** Token issuer that must match the `iss` claim. */
  issuer: string;
  /** Expected `aud` claim — the identifier of this API. */
  audience: string;
  /** Scope the token must carry, if any. */
  requiredScope?: string;
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
  const requiredScope = (env.MCP_OAUTH_REQUIRED_SCOPE || '').trim() || undefined;
  const resourceUrl = (env.MCP_PUBLIC_URL || '').trim().replace(/\/+$/, '') || audience;

  return {
    issuer,
    audience,
    requiredScope,
    resourceUrl,
    jwks: jwksOverride ?? createRemoteJWKSet(new URL(jwksUri)),
  };
}

/**
 * RFC 9728 metadata telling clients which authorization server issues tokens
 * for this resource. Claude fetches this after a 401 to start the OAuth flow.
 */
export function protectedResourceMetadata(config: AuthConfig): Record<string, unknown> {
  return {
    resource: config.resourceUrl,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ['header'],
    ...(config.requiredScope ? { scopes_supported: [config.requiredScope] } : {}),
  };
}

/**
 * Value for the WWW-Authenticate header, pointing at the metadata document so
 * the client can discover where to authenticate.
 */
export function wwwAuthenticate(config: AuthConfig, failure?: AuthFailure): string {
  const parts = [
    `Bearer realm="mcp"`,
    `resource_metadata="${config.resourceUrl}/.well-known/oauth-protected-resource"`,
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

  if (config.requiredScope && !tokenScopes(payload).includes(config.requiredScope)) {
    return {
      ok: false,
      status: 403,
      error: 'insufficient_scope',
      description: `Token is missing the '${config.requiredScope}' scope`,
    };
  }

  const caller = [payload.preferred_username, payload.upn, payload.appid]
    .find((value): value is string => typeof value === 'string' && value.length > 0);

  return { ok: true, subject: typeof payload.sub === 'string' ? payload.sub : undefined, caller };
}
