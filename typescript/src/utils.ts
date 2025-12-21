/**
 * Utility functions for Bitbucket MCP Server
 */

/**
 * Ensure a UUID has braces around it (Bitbucket API requirement)
 */
export function ensureUuidBraces(uuid: string): string {
  if (!uuid) return uuid;
  if (uuid.startsWith('{') && uuid.endsWith('}')) {
    return uuid;
  }
  return `{${uuid}}`;
}

/**
 * Remove braces from a UUID
 */
export function removeUuidBraces(uuid: string): string {
  if (!uuid) return uuid;
  return uuid.replace(/^{|}$/g, '');
}

/**
 * Truncate a hash to short form (7 characters)
 */
export function truncateHash(hash: string | undefined | null): string {
  if (!hash) return '';
  return hash.substring(0, 7);
}

/**
 * Sanitize a search term to prevent BQL injection
 */
export function sanitizeSearchTerm(term: string): string {
  // Remove or escape special characters that could be used for BQL injection
  return term.replace(/["\\]/g, '').trim();
}

/**
 * Validate and clamp a limit parameter
 */
export function validateLimit(limit: number, maxLimit: number = 100): number {
  if (limit < 1) return 1;
  if (limit > maxLimit) return maxLimit;
  return limit;
}

/**
 * Create a "not found" response object
 */
export function notFoundResponse(type: string, identifier: string): Record<string, unknown> {
  return {
    error: `${type} '${identifier}' not found`,
    found: false,
  };
}

/**
 * Format a timestamp string, truncating to date only if needed
 */
export function formatTimestamp(timestamp: string | undefined | null): string | null {
  if (!timestamp) return null;
  // Return ISO format truncated to seconds
  return timestamp.split('.')[0];
}

/**
 * Extract a URL from Bitbucket links structure
 */
export function extractUrl(links: Record<string, unknown> | undefined, key: string = 'html'): string {
  if (!links) return '';
  const link = links[key] as { href?: string } | undefined;
  return link?.href || '';
}

/**
 * Sleep for a specified duration (for rate limiting retries)
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

