/**
 * Tests for auth mode resolution (basic vs bearer).
 *
 * Atlassian API tokens (ATATT...) authenticate with Basic auth as `email:token`.
 * Workspace/project/repository access tokens (ATCTT...) only authenticate with
 * `Authorization: Bearer <token>` - Basic auth returns 401 for them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSettings, resetSettings } from '../src/settings.js';

const AUTH_ENV_VARS = [
  'BITBUCKET_WORKSPACE',
  'BITBUCKET_EMAIL',
  'BITBUCKET_API_TOKEN',
  'BITBUCKET_OAUTH_TOKEN',
  'BITBUCKET_AUTH_TYPE',
];

function setEnv(values: Record<string, string>): void {
  for (const key of AUTH_ENV_VARS) {
    delete process.env[key];
  }
  Object.assign(process.env, values);
  resetSettings();
}

describe('auth type resolution', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetSettings();
  });

  afterEach(() => {
    for (const key of AUTH_ENV_VARS) {
      delete process.env[key];
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      }
    }
    resetSettings();
  });

  it('defaults to basic with email + API token', () => {
    setEnv({
      BITBUCKET_WORKSPACE: 'test-workspace',
      BITBUCKET_EMAIL: 'test@example.com',
      BITBUCKET_API_TOKEN: 'ATATT-personal',
    });

    const settings = getSettings();

    expect(settings.bitbucketAuthType).toBe('basic');
    expect(settings.bitbucketApiToken).toBe('ATATT-personal');
  });

  it('switches to bearer when BITBUCKET_OAUTH_TOKEN is set, preferring that token', () => {
    setEnv({
      BITBUCKET_WORKSPACE: 'test-workspace',
      BITBUCKET_EMAIL: 'test@example.com',
      BITBUCKET_API_TOKEN: 'ATATT-personal',
      BITBUCKET_OAUTH_TOKEN: 'ATCTT-workspace',
    });

    const settings = getSettings();

    expect(settings.bitbucketAuthType).toBe('bearer');
    expect(settings.bitbucketApiToken).toBe('ATCTT-workspace');
  });

  it('uses bearer when a token is configured without an email', () => {
    setEnv({
      BITBUCKET_WORKSPACE: 'test-workspace',
      BITBUCKET_API_TOKEN: 'ATCTT-workspace',
    });

    expect(getSettings().bitbucketAuthType).toBe('bearer');
  });

  it('honours an explicit BITBUCKET_AUTH_TYPE', () => {
    setEnv({
      BITBUCKET_WORKSPACE: 'test-workspace',
      BITBUCKET_EMAIL: 'test@example.com',
      BITBUCKET_API_TOKEN: 'ATCTT-workspace',
      BITBUCKET_AUTH_TYPE: 'Bearer',
    });

    expect(getSettings().bitbucketAuthType).toBe('bearer');
  });

  it('rejects basic auth without an email', () => {
    setEnv({
      BITBUCKET_WORKSPACE: 'test-workspace',
      BITBUCKET_API_TOKEN: 'ATATT-personal',
      BITBUCKET_AUTH_TYPE: 'basic',
    });

    expect(() => getSettings()).toThrow(/BITBUCKET_EMAIL is required/);
  });

  it('rejects a missing token', () => {
    setEnv({
      BITBUCKET_WORKSPACE: 'test-workspace',
      BITBUCKET_EMAIL: 'test@example.com',
    });

    expect(() => getSettings()).toThrow(/BITBUCKET_API_TOKEN/);
  });
});
