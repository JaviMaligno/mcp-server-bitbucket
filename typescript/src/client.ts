/**
 * Bitbucket API client for MCP server.
 * 
 * Provides all Bitbucket API operations needed by the MCP tools:
 * - Repositories: get, create, delete, list, update
 * - Pull Requests: create, get, list, merge, approve, decline, comments, diff
 * - Pipelines: trigger, get, list, logs, stop
 * - Branches: list, get
 * - Commits: list, get, compare, statuses
 * - Deployments: environments, deployment history
 * - Webhooks: list, create, get, delete
 * - Tags: list, create, delete
 * - Branch Restrictions: list, create, delete
 * - Source: file content, directory listing
 * - Permissions: user and group permissions
 */

import axios, { AxiosInstance } from 'axios';
import { getSettings } from './settings.js';
import { ensureUuidBraces, sleep } from './utils.js';
import type {
  BitbucketRepository,
  BitbucketBranch,
  BitbucketCommit,
  BitbucketPullRequest,
  BitbucketPipeline,
  BitbucketPipelineStep,
  BitbucketPipelineVariable,
  BitbucketEnvironment,
  BitbucketDeployment,
  BitbucketWebhook,
  BitbucketTag,
  BitbucketBranchRestriction,
  BitbucketComment,
  BitbucketCommitStatus,
  BitbucketProject,
  DirectoryEntry,
  UserPermission,
  GroupPermission,
  PaginatedResponse,
  TriggerPipelineOptions,
  PipelineTriggerVariable,
  BitbucketPipelineConfig,
} from './types.js';

/**
 * Error class for Bitbucket API errors
 */
export class BitbucketError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public method?: string,
    public path?: string
  ) {
    super(message);
    this.name = 'BitbucketError';
  }
}

export interface HistoryPage<T> {
  values: T[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface FileHistoryEntry {
  path: string;
  commit: { hash: string };
}

export interface CommitHistoryOptions {
  branch?: string;
  include?: string[];
  exclude?: string[];
  path?: string;
  limit?: number;
  cursor?: string;
}

/** Bitbucket API client with bounded retries and resumable history. */
export class BitbucketClient {
  private static readonly BASE_URL = 'https://api.bitbucket.org/2.0';
  private static readonly INITIAL_BACKOFF = 1000; // ms

  public readonly workspace: string;
  private readonly client: AxiosInstance;
  private readonly maxRetries: number;
  private readonly requestTimeout: number;

  constructor() {
    const settings = getSettings();
    
    this.workspace = settings.bitbucketWorkspace;
    this.maxRetries = settings.maxRetries;
    this.requestTimeout = settings.apiTimeout * 1000;

    // Access tokens (workspace/project/repository) only authenticate with
    // `Authorization: Bearer`; Atlassian API tokens use Basic email:token.
    const useBearer = settings.bitbucketAuthType === 'bearer';

    this.client = axios.create({
      baseURL: BitbucketClient.BASE_URL,
      timeout: this.requestTimeout,
      paramsSerializer: { indexes: null },
      ...(useBearer
        ? {}
        : {
            auth: {
              username: settings.bitbucketEmail,
              password: settings.bitbucketApiToken,
            },
          }),
      headers: {
        'Content-Type': 'application/json',
        ...(useBearer ? { Authorization: `Bearer ${settings.bitbucketApiToken}` } : {}),
      },
    });
  }

  /**
   * Build repository endpoint path
   */
  private repoPath(repoSlug: string, ...parts: string[]): string {
    const base = `repositories/${this.workspace}/${repoSlug}`;
    return parts.length > 0 ? `${base}/${parts.join('/')}` : base;
  }

  private encodeRef(ref: string): string {
    if (!ref || ref.split('/').some(part => part === '.' || part === '..')) throw new BitbucketError('Invalid revision name');
    return encodeURIComponent(ref);
  }

  private encodeFilePath(path: string): string {
    if (path.startsWith('/') || path.split('/').some(part => part === '.' || part === '..')) {
      throw new BitbucketError('Invalid repository file path');
    }
    return path.split('/').map(encodeURIComponent).join('/');
  }

  /** Retry only reads after ambiguous network/server failures; writes may retry 429. */
  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    data?: unknown,
    params?: Record<string, unknown>,
    text = false
  ): Promise<T | null> {
    let backoff = BitbucketClient.INITIAL_BACKOFF;
    let slept = 0;
    const deadline = performance.now() + this.requestTimeout;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new BitbucketError('Request retry budget exhausted', undefined, method, path);
      try {
        const response = await this.client.request<T>({
          method, url: path, data, params, timeout: Math.max(1, Math.floor(remaining)),
          ...(text ? { responseType: 'text', transformResponse: [(value: unknown) => value] } : {}),
        });
        return response.data;
      } catch (error) {
        if (!axios.isAxiosError(error)) throw error;
        const status = error.response?.status;
        if (status === 404) return null;
        // Axios can retain the 200 response headers when the body is aborted.
        // Match this specific transport failure, not generic ERR_BAD_RESPONSE
        // errors such as size limits or invalid JSON.
        const abortedBody = error.code === 'ERR_BAD_RESPONSE' && error.message === 'stream has been aborted';
        const network = abortedBody || (!error.response && ['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND', 'ERR_NETWORK'].includes(error.code || ''));
        const retryable = status === 429 || (method === 'GET' && (network || [502, 503, 504].includes(status ?? 0)));
        if (retryable && attempt < this.maxRetries) {
          const header = error.response?.headers['retry-after'];
          let wait = backoff;
          if (typeof header === 'string' && header.trim()) {
            const numeric = Number(header);
            const dated = /[a-z]/i.test(header) && !['nan', 'inf', 'infinity'].includes(header.toLowerCase())
              ? Date.parse(header) - Date.now() : NaN;
            const parsed = Number.isFinite(numeric) && numeric >= 0 ? numeric * 1000 : dated;
            if (Number.isFinite(parsed) && parsed >= 0) wait = parsed;
          }
          if (wait > 15000 - slept || wait >= deadline - performance.now()) {
            throw new BitbucketError('Retry-After exceeds request retry budget; retry later', status, method, path);
          }
          await sleep(wait);
          slept += wait;
          backoff *= 2;
          continue;
        }
        // Do not include request config, credentials, or arbitrary upstream error bodies.
        throw new BitbucketError(
          network ? `Network request failed after ${attempt + 1} attempt(s)` : `API error ${status ?? 'unknown'}`,
          status, method, path
        );
      }
    }
    throw new BitbucketError('Request retry budget exhausted', undefined, method, path);
  }

  private requestText(path: string, params?: Record<string, unknown>): Promise<string | null> {
    return this.request<string>('GET', path, undefined, params, true);
  }

  /** A next link can change only query parameters, never the authenticated endpoint. */
  private validateCursor(cursor: string, endpoint: string): string {
    const expected = new URL(endpoint, BitbucketClient.BASE_URL + '/');
    let parsed: URL;
    try { parsed = new URL(cursor); } catch { throw new BitbucketError('Invalid pagination cursor'); }
    const rawPath = cursor.split(/[?#]/, 1)[0].replace(/^https:\/\/[^/]+/, '');
    const segments = rawPath.split('/');
    const unsafeSegments = segments.some(segment => {
      let decoded: string;
      try { decoded = decodeURIComponent(segment); } catch { return true; }
      return decoded === '.' || decoded === '..' || decoded.includes('\\');
    });
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.bitbucket.org' ||
        (parsed.port && parsed.port !== '443') || parsed.username || parsed.password || parsed.hash ||
        cursor.includes('\\') || unsafeSegments ||
        parsed.pathname.replace(/\/$/, '') !== expected.pathname.replace(/\/$/, '')) {
      throw new BitbucketError('Invalid pagination cursor for this endpoint');
    }
    return cursor;
  }

  private async historyPage<T>(
    endpoint: string,
    options: { limit?: number; cursor?: string; maxPage?: number } & Record<string, unknown> = {},
    allowMissing = false
  ): Promise<HistoryPage<T>> {
    const { limit = 50, cursor, maxPage = 100, ...filters } = options;
    const params: Record<string, unknown> = { pagelen: Math.min(Math.max(1, Math.floor(limit)), maxPage), ...filters };
    for (const key of Object.keys(params)) if (params[key] === undefined) delete params[key];
    const result = await this.request<PaginatedResponse<T>>('GET', cursor ? this.validateCursor(cursor, endpoint) : endpoint,
      undefined, cursor ? undefined : params);
    if (result === null && !allowMissing) {
      throw new BitbucketError('History resource or revision not found (404)', 404, 'GET', endpoint);
    }
    const next = result?.next ? this.validateCursor(result.next, endpoint) : null;
    // Never slice a server page: a resumed cursor retains the original page size.
    return { values: result?.values ?? [], has_more: next !== null, next_cursor: next };
  }

  private async paginatedList<T>(
    endpoint: string,
    options: { limit?: number; maxPage?: number } & Record<string, unknown> = {}
  ): Promise<T[]> {
    const limit = Math.max(1, Math.floor(options.limit ?? 50));
    const values: T[] = [];
    const visited = new Set<string>();
    let cursor: string | undefined;
    // Bounded even if an upstream endpoint produces empty or cyclic pages.
    for (let pageCount = 0; pageCount < 1000; pageCount++) {
      const page = await this.historyPage<T>(endpoint, { ...options, cursor }, true);
      values.push(...page.values);
      if (values.length >= limit || !page.next_cursor) return values.slice(0, limit);
      if (visited.has(page.next_cursor)) throw new BitbucketError('Repeated pagination cursor');
      visited.add(page.next_cursor);
      cursor = page.next_cursor;
    }
    throw new BitbucketError('Pagination page budget exhausted');
  }

  // ==================== REPOSITORIES ====================

  async getRepository(repoSlug: string): Promise<BitbucketRepository | null> {
    return this.request('GET', this.repoPath(repoSlug));
  }

  async createRepository(
    repoSlug: string,
    options: {
      projectKey?: string;
      isPrivate?: boolean;
      description?: string;
    } = {}
  ): Promise<BitbucketRepository> {
    const payload: Record<string, unknown> = {
      scm: 'git',
      is_private: options.isPrivate ?? true,
    };
    if (options.projectKey) {
      payload.project = { key: options.projectKey };
    }
    if (options.description) {
      payload.description = options.description;
    }

    const result = await this.request<BitbucketRepository>('POST', this.repoPath(repoSlug), payload);
    if (!result) {
      throw new BitbucketError(`Failed to create repository: ${repoSlug}`);
    }
    return result;
  }

  async deleteRepository(repoSlug: string): Promise<void> {
    await this.request('DELETE', this.repoPath(repoSlug));
  }

  async listRepositories(
    options: {
      projectKey?: string;
      query?: string;
      limit?: number;
    } = {}
  ): Promise<BitbucketRepository[]> {
    const params: Record<string, unknown> = {
      pagelen: Math.min(options.limit || 50, 100),
    };

    const qParts: string[] = [];
    if (options.projectKey) {
      qParts.push(`project.key="${options.projectKey}"`);
    }
    if (options.query) {
      qParts.push(options.query);
    }
    if (qParts.length > 0) {
      params.q = qParts.join(' AND ');
    }

    const result = await this.request<PaginatedResponse<BitbucketRepository>>(
      'GET',
      `repositories/${this.workspace}`,
      undefined,
      params
    );
    return result?.values || [];
  }

  async updateRepository(
    repoSlug: string,
    options: {
      projectKey?: string;
      isPrivate?: boolean;
      description?: string;
      name?: string;
    }
  ): Promise<BitbucketRepository> {
    const payload: Record<string, unknown> = {};
    if (options.projectKey !== undefined) {
      payload.project = { key: options.projectKey };
    }
    if (options.isPrivate !== undefined) {
      payload.is_private = options.isPrivate;
    }
    if (options.description !== undefined) {
      payload.description = options.description;
    }
    if (options.name !== undefined) {
      payload.name = options.name;
    }

    if (Object.keys(payload).length === 0) {
      throw new BitbucketError('No fields to update');
    }

    const result = await this.request<BitbucketRepository>('PUT', this.repoPath(repoSlug), payload);
    if (!result) {
      throw new BitbucketError(`Failed to update repository: ${repoSlug}`);
    }
    return result;
  }

  // ==================== PULL REQUESTS ====================

  async createPullRequest(
    repoSlug: string,
    options: {
      title: string;
      sourceBranch: string;
      destinationBranch?: string;
      description?: string;
      closeSourceBranch?: boolean;
      reviewers?: string[];
    }
  ): Promise<BitbucketPullRequest> {
    const payload: Record<string, unknown> = {
      title: options.title,
      source: { branch: { name: options.sourceBranch } },
      destination: { branch: { name: options.destinationBranch || 'main' } },
      close_source_branch: options.closeSourceBranch ?? true,
    };
    if (options.description) {
      payload.description = options.description;
    }
    if (options.reviewers && options.reviewers.length > 0) {
      payload.reviewers = options.reviewers.map(r =>
        r.startsWith('{') ? { uuid: r } : { account_id: r }
      );
    }

    const result = await this.request<BitbucketPullRequest>(
      'POST',
      this.repoPath(repoSlug, 'pullrequests'),
      payload
    );
    if (!result) {
      throw new BitbucketError(`Failed to create PR: ${options.sourceBranch} -> ${options.destinationBranch || 'main'}`);
    }
    return result;
  }

  async getPullRequest(repoSlug: string, prId: number): Promise<BitbucketPullRequest | null> {
    return this.request('GET', this.repoPath(repoSlug, 'pullrequests', String(prId)));
  }

  async listPullRequests(
    repoSlug: string,
    options: { state?: string; limit?: number } = {}
  ): Promise<BitbucketPullRequest[]> {
    return this.paginatedList(this.repoPath(repoSlug, 'pullrequests'), {
      limit: options.limit || 50,
      maxPage: 50,
      state: options.state || 'OPEN',
    });
  }

  async mergePullRequest(
    repoSlug: string,
    prId: number,
    options: {
      mergeStrategy?: string;
      closeSourceBranch?: boolean;
      message?: string;
    } = {}
  ): Promise<BitbucketPullRequest> {
    const payload: Record<string, unknown> = {
      type: options.mergeStrategy || 'merge_commit',
      close_source_branch: options.closeSourceBranch ?? true,
    };
    if (options.message) {
      payload.message = options.message;
    }

    const result = await this.request<BitbucketPullRequest>(
      'POST',
      this.repoPath(repoSlug, 'pullrequests', String(prId), 'merge'),
      payload
    );
    if (!result) {
      throw new BitbucketError(`Failed to merge PR #${prId}`);
    }
    return result;
  }

  async listPrComments(
    repoSlug: string,
    prId: number,
    options: { limit?: number } = {}
  ): Promise<BitbucketComment[]> {
    return this.paginatedList(
      this.repoPath(repoSlug, 'pullrequests', String(prId), 'comments'),
      { limit: options.limit || 50 }
    );
  }

  async addPrComment(
    repoSlug: string,
    prId: number,
    content: string,
    inline?: { path: string; to: number }
  ): Promise<BitbucketComment> {
    const payload: Record<string, unknown> = {
      content: { raw: content },
    };
    if (inline) {
      payload.inline = inline;
    }

    const result = await this.request<BitbucketComment>(
      'POST',
      this.repoPath(repoSlug, 'pullrequests', String(prId), 'comments'),
      payload
    );
    if (!result) {
      throw new BitbucketError(`Failed to add comment to PR #${prId}`);
    }
    return result;
  }

  async approvePr(repoSlug: string, prId: number): Promise<Record<string, unknown>> {
    const result = await this.request<Record<string, unknown>>(
      'POST',
      this.repoPath(repoSlug, 'pullrequests', String(prId), 'approve')
    );
    if (!result) {
      throw new BitbucketError(`Failed to approve PR #${prId}`);
    }
    return result;
  }

  async unapprovePr(repoSlug: string, prId: number): Promise<void> {
    await this.request('DELETE', this.repoPath(repoSlug, 'pullrequests', String(prId), 'approve'));
  }

  async requestChangesPr(repoSlug: string, prId: number): Promise<Record<string, unknown>> {
    const result = await this.request<Record<string, unknown>>(
      'POST',
      this.repoPath(repoSlug, 'pullrequests', String(prId), 'request-changes')
    );
    if (!result) {
      throw new BitbucketError(`Failed to request changes on PR #${prId}`);
    }
    return result;
  }

  async declinePr(repoSlug: string, prId: number): Promise<BitbucketPullRequest> {
    const result = await this.request<BitbucketPullRequest>(
      'POST',
      this.repoPath(repoSlug, 'pullrequests', String(prId), 'decline')
    );
    if (!result) {
      throw new BitbucketError(`Failed to decline PR #${prId}`);
    }
    return result;
  }

  async getPrDiff(repoSlug: string, prId: number): Promise<string> {
    return (await this.requestText(this.repoPath(repoSlug, 'pullrequests', String(prId), 'diff'))) || '';
  }

  // ==================== PIPELINES ====================

  /**
   * Build the pipeline target object based on options.
   * Supports branch triggers, commit triggers, and custom pipelines.
   */
  private buildPipelineTarget(options: TriggerPipelineOptions): Record<string, unknown> {
    // Validate mutual exclusivity of branch and commit
    if (options.branch && options.commit) {
      throw new BitbucketError('Cannot specify both branch and commit - they are mutually exclusive');
    }

    // Build target based on trigger type
    if (options.commit) {
      // Commit-based trigger
      const target: Record<string, unknown> = {
        type: 'pipeline_commit_target',
        commit: { hash: options.commit },
      };
      // Add selector for custom pipeline if specified
      if (options.customPipeline) {
        target.selector = {
          type: 'custom',
          pattern: options.customPipeline,
        };
      }
      return target;
    }

    // Branch-based trigger (default)
    const target: Record<string, unknown> = {
      type: 'pipeline_ref_target',
      ref_type: 'branch',
      ref_name: options.branch || 'main',
    };
    // Add selector for custom pipeline if specified
    if (options.customPipeline) {
      target.selector = {
        type: 'custom',
        pattern: options.customPipeline,
      };
    }
    return target;
  }

  /**
   * Normalize pipeline variables to the array format expected by the API.
   * Supports both array format (with secured flag) and simple object format.
   */
  private normalizePipelineVariables(
    variables?: PipelineTriggerVariable[] | Record<string, string>
  ): { key: string; value: string; secured?: boolean }[] | undefined {
    if (!variables) {
      return undefined;
    }

    // If already an array, return as-is (with secured flag preserved)
    if (Array.isArray(variables)) {
      return variables.map(v => ({
        key: v.key,
        value: v.value,
        ...(v.secured !== undefined && { secured: v.secured }),
      }));
    }

    // Convert object format to array format (without secured flag)
    return Object.entries(variables).map(([key, value]) => ({
      key,
      value,
    }));
  }

  async triggerPipeline(
    repoSlug: string,
    options: TriggerPipelineOptions = {}
  ): Promise<BitbucketPipeline> {
    const payload: Record<string, unknown> = {
      target: this.buildPipelineTarget(options),
    };

    const normalizedVariables = this.normalizePipelineVariables(options.variables);
    if (normalizedVariables && normalizedVariables.length > 0) {
      payload.variables = normalizedVariables;
    }

    const result = await this.request<BitbucketPipeline>(
      'POST',
      `${this.repoPath(repoSlug, 'pipelines')}/`,
      payload
    );

    const targetDesc = options.commit
      ? `commit ${options.commit}`
      : (options.branch || 'main');
    const pipelineDesc = options.customPipeline
      ? `custom:${options.customPipeline}`
      : 'default';

    if (!result) {
      throw new BitbucketError(`Failed to trigger ${pipelineDesc} pipeline on ${targetDesc}`);
    }
    return result;
  }

  async getPipeline(repoSlug: string, pipelineUuid: string): Promise<BitbucketPipeline | null> {
    return this.request('GET', this.repoPath(repoSlug, 'pipelines', ensureUuidBraces(pipelineUuid)));
  }

  async listPipelines(
    repoSlug: string,
    options: { limit?: number } = {}
  ): Promise<BitbucketPipeline[]> {
    return this.paginatedList(`${this.repoPath(repoSlug, 'pipelines')}/`, {
      limit: options.limit || 10,
      sort: '-created_on',
    });
  }

  async getPipelineSteps(
    repoSlug: string,
    pipelineUuid: string
  ): Promise<BitbucketPipelineStep[]> {
    return this.paginatedList(
      `${this.repoPath(repoSlug, 'pipelines', ensureUuidBraces(pipelineUuid), 'steps')}/`
    );
  }

  async getPipelineLogs(
    repoSlug: string,
    pipelineUuid: string,
    stepUuid: string
  ): Promise<string> {
    const path = this.repoPath(
      repoSlug,
      'pipelines',
      ensureUuidBraces(pipelineUuid),
      'steps',
      ensureUuidBraces(stepUuid),
      'log'
    );
    return (await this.requestText(path)) || '';
  }

  async stopPipeline(repoSlug: string, pipelineUuid: string): Promise<BitbucketPipeline> {
    await this.request(
      'POST',
      this.repoPath(repoSlug, 'pipelines', ensureUuidBraces(pipelineUuid), 'stopPipeline')
    );
    const result = await this.getPipeline(repoSlug, pipelineUuid);
    return result || { uuid: pipelineUuid, state: { name: 'STOPPED' } };
  }

  // ==================== PIPELINE CONFIG ====================

  async getPipelineConfig(repoSlug: string): Promise<BitbucketPipelineConfig> {
    const result = await this.request<BitbucketPipelineConfig>(
      'GET',
      this.repoPath(repoSlug, 'pipelines_config')
    );
    if (!result) {
      throw new BitbucketError(`Failed to get pipeline config for: ${repoSlug}`);
    }
    return result;
  }

  async updatePipelineConfig(
    repoSlug: string,
    options: { enabled?: boolean }
  ): Promise<BitbucketPipelineConfig> {
    const payload: Record<string, unknown> = {};
    if (options.enabled !== undefined) {
      payload.enabled = options.enabled;
    }

    if (Object.keys(payload).length === 0) {
      throw new BitbucketError('No fields to update');
    }

    const result = await this.request<BitbucketPipelineConfig>(
      'PUT',
      this.repoPath(repoSlug, 'pipelines_config'),
      payload
    );
    if (!result) {
      throw new BitbucketError(`Failed to update pipeline config for: ${repoSlug}`);
    }
    return result;
  }

  // ==================== PIPELINE VARIABLES ====================

  async listPipelineVariables(
    repoSlug: string,
    options: { limit?: number } = {}
  ): Promise<BitbucketPipelineVariable[]> {
    return this.paginatedList(
      this.repoPath(repoSlug, 'pipelines_config', 'variables'),
      { limit: options.limit || 50 }
    );
  }

  async getPipelineVariable(
    repoSlug: string,
    variableUuid: string
  ): Promise<BitbucketPipelineVariable | null> {
    return this.request(
      'GET',
      this.repoPath(repoSlug, 'pipelines_config', 'variables', ensureUuidBraces(variableUuid))
    );
  }

  async createPipelineVariable(
    repoSlug: string,
    key: string,
    value: string,
    secured: boolean = false
  ): Promise<BitbucketPipelineVariable> {
    const result = await this.request<BitbucketPipelineVariable>(
      'POST',
      `${this.repoPath(repoSlug, 'pipelines_config', 'variables')}/`,
      { key, value, secured }
    );
    if (!result) {
      throw new BitbucketError('Failed to create pipeline variable');
    }
    return result;
  }

  async updatePipelineVariable(
    repoSlug: string,
    variableUuid: string,
    value: string
  ): Promise<BitbucketPipelineVariable> {
    const result = await this.request<BitbucketPipelineVariable>(
      'PUT',
      this.repoPath(repoSlug, 'pipelines_config', 'variables', ensureUuidBraces(variableUuid)),
      { value }
    );
    if (!result) {
      throw new BitbucketError('Failed to update pipeline variable');
    }
    return result;
  }

  async deletePipelineVariable(repoSlug: string, variableUuid: string): Promise<void> {
    await this.request(
      'DELETE',
      this.repoPath(repoSlug, 'pipelines_config', 'variables', ensureUuidBraces(variableUuid))
    );
  }

  // ==================== BRANCHES ====================

  async listBranches(
    repoSlug: string,
    options: { limit?: number } = {}
  ): Promise<BitbucketBranch[]> {
    return this.paginatedList(this.repoPath(repoSlug, 'refs', 'branches'), {
      limit: options.limit || 50,
    });
  }

  async getBranch(repoSlug: string, branchName: string): Promise<BitbucketBranch | null> {
    return this.request('GET', this.repoPath(repoSlug, 'refs', 'branches', this.encodeRef(branchName)));
  }

  // ==================== COMMITS ====================

  async listCommits(repoSlug: string, options: CommitHistoryOptions = {}): Promise<BitbucketCommit[]> {
    return this.paginatedList(this.repoPath(repoSlug, 'commits'), {
      limit: options.limit ?? 20,
      include: [...(options.branch ? [options.branch] : []), ...(options.include ?? [])],
      exclude: options.exclude, path: options.path,
    });
  }

  listCommitsPage(repoSlug: string, options: CommitHistoryOptions = {}): Promise<HistoryPage<BitbucketCommit>> {
    return this.historyPage(this.repoPath(repoSlug, 'commits'), {
      limit: options.limit ?? 20, cursor: options.cursor,
      include: [...(options.branch ? [options.branch] : []), ...(options.include ?? [])],
      exclude: options.exclude, path: options.path,
    });
  }

  async getCommit(repoSlug: string, commit: string): Promise<BitbucketCommit | null> {
    return this.request('GET', this.repoPath(repoSlug, 'commit', this.encodeRef(commit)));
  }

  compareCommits(repoSlug: string, base: string, head: string): Promise<Record<string, unknown> | null> {
    return this.request('GET', this.repoPath(repoSlug, 'diffstat', this.revisionRange(base, head)), undefined, { topic: false });
  }

  private async resolveComparisonRef(repoSlug: string, ref: string): Promise<string> {
    this.encodeRef(ref);
    // Bitbucket rewrites diffstat next links to 12-character commit hashes.
    // Canonicalize before validating the cursor so it remains endpoint-bound.
    // Resolve even hexadecimal names: they may be legal branch/tag names,
    // and an invalid full SHA must not become valid by truncating its prefix.
    const commit = await this.getCommit(repoSlug, ref);
    if (!commit) throw new BitbucketError('Commit or revision not found (404)', 404, 'GET');
    if (!/^[a-fA-F0-9]{12,40}$/.test(commit.hash)) throw new BitbucketError('Invalid commit hash returned by Bitbucket');
    return commit.hash.slice(0, 12).toLowerCase();
  }

  async compareCommitsPage(repoSlug: string, base: string, head: string,
    options: { path?: string; limit?: number; cursor?: string } = {}): Promise<HistoryPage<Record<string, unknown>>> {
    const canonicalBase = await this.resolveComparisonRef(repoSlug, base);
    const canonicalHead = await this.resolveComparisonRef(repoSlug, head);
    return this.historyPage(this.repoPath(repoSlug, 'diffstat', this.revisionRange(canonicalBase, canonicalHead)), {
      limit: options.limit ?? 50, cursor: options.cursor, path: options.path, topic: false,
    });
  }

  /** Bitbucket takes the source first, the opposite of git diff base head. */
  private revisionRange(base: string, head: string): string {
    return `${this.encodeRef(head)}..${this.encodeRef(base)}`;
  }

  getCommitDiff(repoSlug: string, base: string, head: string, options: { path?: string } = {}): Promise<string | null> {
    return this.requestText(this.repoPath(repoSlug, 'diff', this.revisionRange(base, head)), { topic: false, path: options.path });
  }

  getMergeBase(repoSlug: string, base: string, head: string): Promise<BitbucketCommit | null> {
    return this.request('GET', this.repoPath(repoSlug, 'merge-base', this.revisionRange(base, head)));
  }

  getFileHistory(repoSlug: string, path: string, ref = 'main', options: { limit?: number; cursor?: string } = {}): Promise<HistoryPage<FileHistoryEntry>> {
    if (!path) throw new BitbucketError('File history requires a file path');
    return this.historyPage(this.repoPath(repoSlug, 'filehistory', this.encodeRef(ref), this.encodeFilePath(path)), {
      limit: options.limit ?? 20, cursor: options.cursor,
    });
  }

  async getCommitStatuses(
    repoSlug: string,
    commit: string,
    options: { limit?: number } = {}
  ): Promise<BitbucketCommitStatus[]> {
    return this.paginatedList(this.repoPath(repoSlug, 'commit', commit, 'statuses'), {
      limit: options.limit || 20,
    });
  }

  async createCommitStatus(
    repoSlug: string,
    commit: string,
    options: {
      state: string;
      key: string;
      url?: string;
      name?: string;
      description?: string;
    }
  ): Promise<BitbucketCommitStatus> {
    const payload: Record<string, unknown> = {
      state: options.state,
      key: options.key,
    };
    if (options.url) payload.url = options.url;
    if (options.name) payload.name = options.name;
    if (options.description) payload.description = options.description;

    const result = await this.request<BitbucketCommitStatus>(
      'POST',
      this.repoPath(repoSlug, 'commit', commit, 'statuses', 'build'),
      payload
    );
    if (!result) {
      throw new BitbucketError(`Failed to create status for commit ${commit}`);
    }
    return result;
  }

  // ==================== PROJECTS ====================

  async listProjects(options: { limit?: number } = {}): Promise<BitbucketProject[]> {
    return this.paginatedList(`workspaces/${this.workspace}/projects`, {
      limit: options.limit || 50,
    });
  }

  async getProject(projectKey: string): Promise<BitbucketProject | null> {
    return this.request('GET', `workspaces/${this.workspace}/projects/${projectKey}`);
  }

  // ==================== DEPLOYMENTS ====================

  async listEnvironments(
    repoSlug: string,
    options: { limit?: number } = {}
  ): Promise<BitbucketEnvironment[]> {
    return this.paginatedList(this.repoPath(repoSlug, 'environments'), {
      limit: options.limit || 20,
    });
  }

  async getEnvironment(
    repoSlug: string,
    environmentUuid: string
  ): Promise<BitbucketEnvironment | null> {
    return this.request(
      'GET',
      this.repoPath(repoSlug, 'environments', ensureUuidBraces(environmentUuid))
    );
  }

  async listDeploymentHistory(
    repoSlug: string,
    environmentUuid: string,
    options: { limit?: number } = {}
  ): Promise<BitbucketDeployment[]> {
    return this.paginatedList(this.repoPath(repoSlug, 'deployments'), {
      limit: options.limit || 20,
      environment: ensureUuidBraces(environmentUuid),
      sort: '-state.started_on',
    });
  }

  // ==================== WEBHOOKS ====================

  async listWebhooks(
    repoSlug: string,
    options: { limit?: number } = {}
  ): Promise<BitbucketWebhook[]> {
    return this.paginatedList(this.repoPath(repoSlug, 'hooks'), {
      limit: options.limit || 50,
    });
  }

  async createWebhook(
    repoSlug: string,
    options: {
      url: string;
      events: string[];
      description?: string;
      active?: boolean;
    }
  ): Promise<BitbucketWebhook> {
    const payload: Record<string, unknown> = {
      url: options.url,
      events: options.events,
      active: options.active ?? true,
    };
    if (options.description) {
      payload.description = options.description;
    }

    const result = await this.request<BitbucketWebhook>(
      'POST',
      this.repoPath(repoSlug, 'hooks'),
      payload
    );
    if (!result) {
      throw new BitbucketError('Failed to create webhook');
    }
    return result;
  }

  async getWebhook(repoSlug: string, webhookUid: string): Promise<BitbucketWebhook | null> {
    return this.request('GET', this.repoPath(repoSlug, 'hooks', ensureUuidBraces(webhookUid)));
  }

  async deleteWebhook(repoSlug: string, webhookUid: string): Promise<void> {
    await this.request('DELETE', this.repoPath(repoSlug, 'hooks', ensureUuidBraces(webhookUid)));
  }

  // ==================== TAGS ====================

  async listTags(repoSlug: string, options: { limit?: number; query?: string; sort?: string } = {}): Promise<BitbucketTag[]> {
    return this.paginatedList(this.repoPath(repoSlug, 'refs', 'tags'), {
      limit: options.limit ?? 50, sort: options.sort ?? '-target.date', q: options.query,
    });
  }

  listTagsPage(repoSlug: string, options: { limit?: number; query?: string; sort?: string; cursor?: string } = {}): Promise<HistoryPage<BitbucketTag>> {
    return this.historyPage(this.repoPath(repoSlug, 'refs', 'tags'), {
      limit: options.limit ?? 50, cursor: options.cursor, sort: options.sort ?? '-target.date', q: options.query,
    });
  }

  getTag(repoSlug: string, tagName: string): Promise<(BitbucketTag & { date?: string }) | null> {
    return this.request('GET', this.repoPath(repoSlug, 'refs', 'tags', this.encodeRef(tagName)));
  }

  async createTag(
    repoSlug: string,
    name: string,
    target: string,
    message?: string
  ): Promise<BitbucketTag> {
    const payload: Record<string, unknown> = {
      name,
      target: { hash: target },
    };
    if (message) {
      payload.message = message;
    }

    const result = await this.request<BitbucketTag>(
      'POST',
      this.repoPath(repoSlug, 'refs', 'tags'),
      payload
    );
    if (!result) {
      throw new BitbucketError(`Failed to create tag ${name}`);
    }
    return result;
  }

  async deleteTag(repoSlug: string, tagName: string): Promise<void> {
    await this.request('DELETE', this.repoPath(repoSlug, 'refs', 'tags', this.encodeRef(tagName)));
  }

  // ==================== BRANCH RESTRICTIONS ====================

  async listBranchRestrictions(
    repoSlug: string,
    options: { limit?: number } = {}
  ): Promise<BitbucketBranchRestriction[]> {
    return this.paginatedList(this.repoPath(repoSlug, 'branch-restrictions'), {
      limit: options.limit || 50,
    });
  }

  async createBranchRestriction(
    repoSlug: string,
    options: {
      kind: string;
      pattern?: string;
      branchMatchKind?: string;
      branchType?: string;
      value?: number;
    }
  ): Promise<BitbucketBranchRestriction> {
    const payload: Record<string, unknown> = {
      kind: options.kind,
      branch_match_kind: options.branchMatchKind || 'glob',
    };
    if (options.branchMatchKind === 'glob' && options.pattern) {
      payload.pattern = options.pattern;
    }
    if (options.branchMatchKind === 'branching_model' && options.branchType) {
      payload.branch_type = options.branchType;
    }
    if (options.value !== undefined) {
      payload.value = options.value;
    }

    const result = await this.request<BitbucketBranchRestriction>(
      'POST',
      this.repoPath(repoSlug, 'branch-restrictions'),
      payload
    );
    if (!result) {
      throw new BitbucketError(`Failed to create branch restriction ${options.kind}`);
    }
    return result;
  }

  async deleteBranchRestriction(repoSlug: string, restrictionId: number): Promise<void> {
    await this.request(
      'DELETE',
      this.repoPath(repoSlug, 'branch-restrictions', String(restrictionId))
    );
  }

  // ==================== SOURCE ====================

  async getFileContent(
    repoSlug: string,
    path: string,
    ref: string = 'main'
  ): Promise<string | null> {
    return this.requestText(this.repoPath(repoSlug, 'src', this.encodeRef(ref), this.encodeFilePath(path)));
  }

  async listDirectory(
    repoSlug: string,
    path: string = '',
    options: { ref?: string; limit?: number } = {}
  ): Promise<DirectoryEntry[]> {
    const endpoint = path
      ? this.repoPath(repoSlug, 'src', this.encodeRef(options.ref || 'main'), this.encodeFilePath(path))
      : this.repoPath(repoSlug, 'src', this.encodeRef(options.ref || 'main'));
    return this.paginatedList(endpoint, { limit: options.limit || 100 });
  }

  // ==================== PERMISSIONS ====================

  async listUserPermissions(
    repoSlug: string,
    options: { limit?: number } = {}
  ): Promise<UserPermission[]> {
    return this.paginatedList(this.repoPath(repoSlug, 'permissions-config', 'users'), {
      limit: options.limit || 50,
    });
  }

  async getUserPermission(
    repoSlug: string,
    selectedUser: string
  ): Promise<UserPermission | null> {
    return this.request(
      'GET',
      this.repoPath(repoSlug, 'permissions-config', 'users', selectedUser)
    );
  }

  async updateUserPermission(
    repoSlug: string,
    selectedUser: string,
    permission: string
  ): Promise<UserPermission> {
    const result = await this.request<UserPermission>(
      'PUT',
      this.repoPath(repoSlug, 'permissions-config', 'users', selectedUser),
      { permission }
    );
    if (!result) {
      throw new BitbucketError(`Failed to update permission for user ${selectedUser}`);
    }
    return result;
  }

  async deleteUserPermission(repoSlug: string, selectedUser: string): Promise<void> {
    await this.request(
      'DELETE',
      this.repoPath(repoSlug, 'permissions-config', 'users', selectedUser)
    );
  }

  async listGroupPermissions(
    repoSlug: string,
    options: { limit?: number } = {}
  ): Promise<GroupPermission[]> {
    return this.paginatedList(this.repoPath(repoSlug, 'permissions-config', 'groups'), {
      limit: options.limit || 50,
    });
  }

  async getGroupPermission(
    repoSlug: string,
    groupSlug: string
  ): Promise<GroupPermission | null> {
    return this.request(
      'GET',
      this.repoPath(repoSlug, 'permissions-config', 'groups', groupSlug)
    );
  }

  async updateGroupPermission(
    repoSlug: string,
    groupSlug: string,
    permission: string
  ): Promise<GroupPermission> {
    const result = await this.request<GroupPermission>(
      'PUT',
      this.repoPath(repoSlug, 'permissions-config', 'groups', groupSlug),
      { permission }
    );
    if (!result) {
      throw new BitbucketError(`Failed to update permission for group ${groupSlug}`);
    }
    return result;
  }

  async deleteGroupPermission(repoSlug: string, groupSlug: string): Promise<void> {
    await this.request(
      'DELETE',
      this.repoPath(repoSlug, 'permissions-config', 'groups', groupSlug)
    );
  }

  // ==================== UTILITIES ====================

  extractPrUrl(pr: BitbucketPullRequest): string {
    return pr.links?.html?.href || '';
  }

  extractCloneUrls(repo: BitbucketRepository): Record<string, string> {
    const urls: Record<string, string> = {};
    for (const link of repo.links?.clone || []) {
      const name = (link.name || '').toLowerCase();
      if (name === 'https' || name === 'ssh') {
        urls[name] = link.href || '';
      }
    }
    urls.html = repo.links?.html?.href || '';
    return urls;
  }
}

// Singleton instance
let clientInstance: BitbucketClient | null = null;

/**
 * Get or create the BitbucketClient singleton
 */
export function getClient(): BitbucketClient {
  if (!clientInstance) {
    clientInstance = new BitbucketClient();
  }
  return clientInstance;
}

/**
 * Reset the client singleton (useful for testing)
 */
export function resetClient(): void {
  clientInstance = null;
}

