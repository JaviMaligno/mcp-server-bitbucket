/**
 * Settings management for Bitbucket MCP Server
 * 
 * Configuration via environment variables:
 * - BITBUCKET_WORKSPACE: Bitbucket workspace slug (required)
 * - BITBUCKET_EMAIL: Account email for Basic Auth (required)
 * - BITBUCKET_API_TOKEN: Repository access token (required)
 * - API_TIMEOUT: Request timeout in seconds (default: 30, max: 300)
 * - MAX_RETRIES: Max retry attempts for rate limiting (default: 3, max: 10)
 * - OUTPUT_FORMAT: Output format - 'json' or 'toon' (default: json)
 */

import { z } from 'zod';

const settingsSchema = z.object({
  bitbucketWorkspace: z.string().min(1, 'BITBUCKET_WORKSPACE is required'),
  bitbucketEmail: z.string().min(1, 'BITBUCKET_EMAIL is required'),
  bitbucketApiToken: z.string().min(1, 'BITBUCKET_API_TOKEN is required'),
  apiTimeout: z.number().min(1).max(300).default(30),
  maxRetries: z.number().min(0).max(10).default(3),
  outputFormat: z.enum(['json', 'toon']).default('json'),
});

export type Settings = z.infer<typeof settingsSchema>;

let cachedSettings: Settings | null = null;

/**
 * Load and validate settings from environment variables.
 * Results are cached for subsequent calls.
 */
export function getSettings(): Settings {
  if (cachedSettings) {
    return cachedSettings;
  }

  const rawSettings = {
    bitbucketWorkspace: process.env.BITBUCKET_WORKSPACE || '',
    bitbucketEmail: process.env.BITBUCKET_EMAIL || '',
    bitbucketApiToken: process.env.BITBUCKET_API_TOKEN || '',
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

