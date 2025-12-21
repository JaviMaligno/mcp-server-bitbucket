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

import axios, { AxiosInstance, AxiosError } from 'axios';
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

/**
 * Bitbucket API client with connection pooling and retry logic
 */
export class BitbucketClient {
  private static readonly BASE_URL = 'https://api.bitbucket.org/2.0';
  private static readonly INITIAL_BACKOFF = 1000; // ms

  public readonly workspace: string;
  private readonly client: AxiosInstance;
  private readonly maxRetries: number;

  constructor() {
    const settings = getSettings();
    
    this.workspace = settings.bitbucketWorkspace;
    this.maxRetries = settings.maxRetries;

    this.client = axios.create({
      baseURL: BitbucketClient.BASE_URL,
      timeout: settings.apiTimeout * 1000,
      auth: {
        username: settings.bitbucketEmail,
        password: settings.bitbucketApiToken,
      },
      headers: {
        'Content-Type': 'application/json',
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

  /**
   * Make an API request with retry logic for rate limiting
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    data?: unknown,
    params?: Record<string, unknown>
  ): Promise<T | null> {
    let backoff = BitbucketClient.INITIAL_BACKOFF;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.request<T>({
          method,
          url: path,
          data,
          params,
        });

        return response.data;
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError;
          
          // Handle 404 as null (not found)
          if (axiosError.response?.status === 404) {
            return null;
          }

          // Handle rate limiting (429)
          if (axiosError.response?.status === 429) {
            if (attempt < this.maxRetries) {
              const retryAfter = axiosError.response.headers['retry-after'];
              const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : backoff;
              await sleep(waitTime);
              backoff *= 2;
              continue;
            }
            throw new BitbucketError(
              `Rate limited after ${this.maxRetries} retries`,
              429,
              method,
              path
            );
          }

          // Other errors
          const statusCode = axiosError.response?.status;
          const errorText = JSON.stringify(axiosError.response?.data || axiosError.message).substring(0, 500);
          throw new BitbucketError(
            `API error ${statusCode}: ${errorText}`,
            statusCode,
            method,
            path
          );
        }
        throw error;
      }
    }

    throw new BitbucketError(`Unexpected error in request`, undefined, method, path);
  }

  /**
   * Make a request that returns plain text
   */
  private async requestText(path: string): Promise<string | null> {
    let backoff = BitbucketClient.INITIAL_BACKOFF;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.get(path, {
          responseType: 'text',
        });
        return response.data;
      } catch (error) {
        if (axios.isAxiosError(error)) {
          if (error.response?.status === 404) {
            return null;
          }
          if (error.response?.status === 429) {
            if (attempt < this.maxRetries) {
              const retryAfter = error.response.headers['retry-after'];
              const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : backoff;
              await sleep(waitTime);
              backoff *= 2;
              continue;
            }
          }
          throw new BitbucketError(`Request failed: ${error.response?.status}`);
        }
        throw error;
      }
    }
    return null;
  }

  /**
   * Helper for paginated list endpoints
   */
  private async paginatedList<T>(
    endpoint: string,
    options: { limit?: number; maxPage?: number } & Record<string, unknown> = {}
  ): Promise<T[]> {
    const { limit = 50, maxPage = 100, ...extraParams } = options;
    const params: Record<string, unknown> = {
      pagelen: Math.min(limit, maxPage),
      ...extraParams,
    };

    // Filter out undefined values
    Object.keys(params).forEach(key => {
      if (params[key] === undefined) {
        delete params[key];
      }
    });

    const result = await this.request<PaginatedResponse<T>>('GET', endpoint, undefined, params);
    return result?.values || [];
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

  async triggerPipeline(
    repoSlug: string,
    options: { branch?: string; variables?: Record<string, string> } = {}
  ): Promise<BitbucketPipeline> {
    const payload: Record<string, unknown> = {
      target: {
        ref_type: 'branch',
        type: 'pipeline_ref_target',
        ref_name: options.branch || 'main',
      },
    };
    if (options.variables) {
      payload.variables = Object.entries(options.variables).map(([key, value]) => ({
        key,
        value,
      }));
    }

    const result = await this.request<BitbucketPipeline>(
      'POST',
      `${this.repoPath(repoSlug, 'pipelines')}/`,
      payload
    );
    if (!result) {
      throw new BitbucketError(`Failed to trigger pipeline on ${options.branch || 'main'}`);
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
    return this.request('GET', this.repoPath(repoSlug, 'refs', 'branches', branchName));
  }

  // ==================== COMMITS ====================

  async listCommits(
    repoSlug: string,
    options: { branch?: string; path?: string; limit?: number } = {}
  ): Promise<BitbucketCommit[]> {
    return this.paginatedList(this.repoPath(repoSlug, 'commits'), {
      limit: options.limit || 20,
      include: options.branch,
      path: options.path,
    });
  }

  async getCommit(repoSlug: string, commit: string): Promise<BitbucketCommit | null> {
    return this.request('GET', this.repoPath(repoSlug, 'commit', commit));
  }

  async compareCommits(
    repoSlug: string,
    base: string,
    head: string
  ): Promise<Record<string, unknown> | null> {
    return this.request('GET', this.repoPath(repoSlug, 'diffstat', `${base}..${head}`));
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

  async listTags(repoSlug: string, options: { limit?: number } = {}): Promise<BitbucketTag[]> {
    return this.paginatedList(this.repoPath(repoSlug, 'refs', 'tags'), {
      limit: options.limit || 50,
      sort: '-target.date',
    });
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
    await this.request('DELETE', this.repoPath(repoSlug, 'refs', 'tags', tagName));
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
    return this.requestText(this.repoPath(repoSlug, 'src', ref, path));
  }

  async listDirectory(
    repoSlug: string,
    path: string = '',
    options: { ref?: string; limit?: number } = {}
  ): Promise<DirectoryEntry[]> {
    const endpoint = path
      ? this.repoPath(repoSlug, 'src', options.ref || 'main', path)
      : this.repoPath(repoSlug, 'src', options.ref || 'main');
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

