/**
 * Settings management for Bitbucket MCP Server
 *
 * Configuration via environment variables:
 * - BITBUCKET_WORKSPACE: Bitbucket workspace slug (required)
 * - BITBUCKET_EMAIL: Account email for Basic Auth (required for basic auth)
 * - BITBUCKET_API_TOKEN: Atlassian API token / access token (required)
 * - BITBUCKET_OAUTH_TOKEN: Access token used with `Authorization: Bearer` (optional)
 * - BITBUCKET_AUTH_TYPE: Force auth mode - 'basic' or 'bearer' (optional, auto-detected)
 * - API_TIMEOUT: Request timeout in seconds (default: 30, max: 300)
 * - MAX_RETRIES: Max retry attempts for rate limiting (default: 3, max: 10)
 * - OUTPUT_FORMAT: Output format - 'json' or 'toon' (default: json)
 *
 * Auth modes:
 * - basic: Atlassian API tokens (ATATT...) authenticate as `email:token`.
 * - bearer: Workspace/project/repository access tokens (ATCTT...) only work as
 *   `Authorization: Bearer <token>`; Basic auth returns 401 for them.
 */

import { z } from 'zod';

export type AuthType = 'basic' | 'bearer';

const settingsSchema = z.object({
  bitbucketWorkspace: z.string().min(1, 'BITBUCKET_WORKSPACE is required'),
  bitbucketEmail: z.string().default(''),
  bitbucketApiToken: z.string().min(1, 'BITBUCKET_API_TOKEN (or BITBUCKET_OAUTH_TOKEN) is required'),
  bitbucketAuthType: z.enum(['basic', 'bearer']),
  apiTimeout: z.number().min(1).max(300).default(30),
  maxRetries: z.number().min(0).max(10).default(3),
  outputFormat: z.enum(['json', 'toon']).default('json'),
}).refine(
  (s) => s.bitbucketAuthType !== 'basic' || s.bitbucketEmail.length > 0,
  { message: 'BITBUCKET_EMAIL is required when using basic auth', path: ['bitbucketEmail'] }
);

export type Settings = z.infer<typeof settingsSchema>;

let cachedSettings: Settings | null = null;

/**
 * Resolve which auth mode to use.
 *
 * Explicit BITBUCKET_AUTH_TYPE wins. Otherwise bearer is used when an
 * OAuth/access token is configured or when no email is available (an access
 * token has no account to pair with), and basic otherwise.
 */
function resolveAuthType(
  explicit: string,
  oauthToken: string,
  email: string
): AuthType {
  const normalized = explicit.trim().toLowerCase();
  if (normalized === 'bearer' || normalized === 'basic') {
    return normalized;
  }
  if (oauthToken.length > 0 || email.length === 0) {
    return 'bearer';
  }
  return 'basic';
}

/**
 * Load and validate settings from environment variables.
 * Results are cached for subsequent calls.
 */
export function getSettings(): Settings {
  if (cachedSettings) {
    return cachedSettings;
  }

  const email = process.env.BITBUCKET_EMAIL || '';
  const oauthToken = process.env.BITBUCKET_OAUTH_TOKEN || '';
  const apiToken = process.env.BITBUCKET_API_TOKEN || '';
  const authType = resolveAuthType(process.env.BITBUCKET_AUTH_TYPE || '', oauthToken, email);

  const rawSettings = {
    bitbucketWorkspace: process.env.BITBUCKET_WORKSPACE || '',
    bitbucketEmail: email,
    // Bearer mode prefers the dedicated OAuth/access token when both are set
    bitbucketApiToken: authType === 'bearer' ? (oauthToken || apiToken) : apiToken,
    bitbucketAuthType: authType,
    apiTimeout: parseInt(process.env.API_TIMEOUT || '30', 10),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    outputFormat: (process.env.OUTPUT_FORMAT || 'json') as 'json' | 'toon',
  };

  const result = settingsSchema.safeParse(rawSettings);

  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Configuration error: ${errors}`);
  }

  cachedSettings = result.data;
  return cachedSettings;
}

/**
 * Reset cached settings (useful for testing)
 */
export function resetSettings(): void {
  cachedSettings = null;
}
