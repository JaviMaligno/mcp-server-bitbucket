#!/usr/bin/env node

// src/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

// src/settings.ts
import { z } from "zod";
var settingsSchema = z.object({
  bitbucketWorkspace: z.string().min(1, "BITBUCKET_WORKSPACE is required"),
  bitbucketEmail: z.string().min(1, "BITBUCKET_EMAIL is required"),
  bitbucketApiToken: z.string().min(1, "BITBUCKET_API_TOKEN is required"),
  apiTimeout: z.number().min(1).max(300).default(30),
  maxRetries: z.number().min(0).max(10).default(3),
  outputFormat: z.enum(["json", "toon"]).default("json")
});
var cachedSettings = null;
function getSettings() {
  if (cachedSettings) {
    return cachedSettings;
  }
  const rawSettings = {
    bitbucketWorkspace: process.env.BITBUCKET_WORKSPACE || "",
    bitbucketEmail: process.env.BITBUCKET_EMAIL || "",
    bitbucketApiToken: process.env.BITBUCKET_API_TOKEN || "",
    apiTimeout: parseInt(process.env.API_TIMEOUT || "30", 10),
    maxRetries: parseInt(process.env.MAX_RETRIES || "3", 10),
    outputFormat: process.env.OUTPUT_FORMAT || "json"
  };
  const result = settingsSchema.safeParse(rawSettings);
  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
    throw new Error(`Configuration error: ${errors}`);
  }
  cachedSettings = result.data;
  return cachedSettings;
}

// src/client.ts
import axios from "axios";

// src/utils.ts
function ensureUuidBraces(uuid) {
  if (!uuid) return uuid;
  if (uuid.startsWith("{") && uuid.endsWith("}")) {
    return uuid;
  }
  return `{${uuid}}`;
}
function truncateHash(hash) {
  if (!hash) return "";
  return hash.substring(0, 7);
}
function sanitizeSearchTerm(term) {
  return term.replace(/["\\]/g, "").trim();
}
function validateLimit(limit, maxLimit = 100) {
  if (limit < 1) return 1;
  if (limit > maxLimit) return maxLimit;
  return limit;
}
function notFoundResponse(type, identifier) {
  return {
    error: `${type} '${identifier}' not found`,
    found: false
  };
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/client.ts
var BitbucketError = class extends Error {
  constructor(message, statusCode, method, path) {
    super(message);
    this.statusCode = statusCode;
    this.method = method;
    this.path = path;
    this.name = "BitbucketError";
  }
};
var BitbucketClient = class _BitbucketClient {
  static BASE_URL = "https://api.bitbucket.org/2.0";
  static INITIAL_BACKOFF = 1e3;
  // ms
  workspace;
  client;
  maxRetries;
  constructor() {
    const settings = getSettings();
    this.workspace = settings.bitbucketWorkspace;
    this.maxRetries = settings.maxRetries;
    this.client = axios.create({
      baseURL: _BitbucketClient.BASE_URL,
      timeout: settings.apiTimeout * 1e3,
      auth: {
        username: settings.bitbucketEmail,
        password: settings.bitbucketApiToken
      },
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  /**
   * Build repository endpoint path
   */
  repoPath(repoSlug, ...parts) {
    const base = `repositories/${this.workspace}/${repoSlug}`;
    return parts.length > 0 ? `${base}/${parts.join("/")}` : base;
  }
  /**
   * Make an API request with retry logic for rate limiting
   */
  async request(method, path, data, params) {
    let backoff = _BitbucketClient.INITIAL_BACKOFF;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.request({
          method,
          url: path,
          data,
          params
        });
        return response.data;
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const axiosError = error;
          if (axiosError.response?.status === 404) {
            return null;
          }
          if (axiosError.response?.status === 429) {
            if (attempt < this.maxRetries) {
              const retryAfter = axiosError.response.headers["retry-after"];
              const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1e3 : backoff;
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
    throw new BitbucketError(`Unexpected error in request`, void 0, method, path);
  }
  /**
   * Make a request that returns plain text
   */
  async requestText(path) {
    let backoff = _BitbucketClient.INITIAL_BACKOFF;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.get(path, {
          responseType: "text"
        });
        return response.data;
      } catch (error) {
        if (axios.isAxiosError(error)) {
          if (error.response?.status === 404) {
            return null;
          }
          if (error.response?.status === 429) {
            if (attempt < this.maxRetries) {
              const retryAfter = error.response.headers["retry-after"];
              const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1e3 : backoff;
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
  async paginatedList(endpoint, options = {}) {
    const { limit = 50, maxPage = 100, ...extraParams } = options;
    const params = {
      pagelen: Math.min(limit, maxPage),
      ...extraParams
    };
    Object.keys(params).forEach((key) => {
      if (params[key] === void 0) {
        delete params[key];
      }
    });
    const result = await this.request("GET", endpoint, void 0, params);
    return result?.values || [];
  }
  // ==================== REPOSITORIES ====================
  async getRepository(repoSlug) {
    return this.request("GET", this.repoPath(repoSlug));
  }
  async createRepository(repoSlug, options = {}) {
    const payload = {
      scm: "git",
      is_private: options.isPrivate ?? true
    };
    if (options.projectKey) {
      payload.project = { key: options.projectKey };
    }
    if (options.description) {
      payload.description = options.description;
    }
    const result = await this.request("POST", this.repoPath(repoSlug), payload);
    if (!result) {
      throw new BitbucketError(`Failed to create repository: ${repoSlug}`);
    }
    return result;
  }
  async deleteRepository(repoSlug) {
    await this.request("DELETE", this.repoPath(repoSlug));
  }
  async listRepositories(options = {}) {
    const params = {
      pagelen: Math.min(options.limit || 50, 100)
    };
    const qParts = [];
    if (options.projectKey) {
      qParts.push(`project.key="${options.projectKey}"`);
    }
    if (options.query) {
      qParts.push(options.query);
    }
    if (qParts.length > 0) {
      params.q = qParts.join(" AND ");
    }
    const result = await this.request(
      "GET",
      `repositories/${this.workspace}`,
      void 0,
      params
    );
    return result?.values || [];
  }
  async updateRepository(repoSlug, options) {
    const payload = {};
    if (options.projectKey !== void 0) {
      payload.project = { key: options.projectKey };
    }
    if (options.isPrivate !== void 0) {
      payload.is_private = options.isPrivate;
    }
    if (options.description !== void 0) {
      payload.description = options.description;
    }
    if (options.name !== void 0) {
      payload.name = options.name;
    }
    if (Object.keys(payload).length === 0) {
      throw new BitbucketError("No fields to update");
    }
    const result = await this.request("PUT", this.repoPath(repoSlug), payload);
    if (!result) {
      throw new BitbucketError(`Failed to update repository: ${repoSlug}`);
    }
    return result;
  }
  // ==================== PULL REQUESTS ====================
  async createPullRequest(repoSlug, options) {
    const payload = {
      title: options.title,
      source: { branch: { name: options.sourceBranch } },
      destination: { branch: { name: options.destinationBranch || "main" } },
      close_source_branch: options.closeSourceBranch ?? true
    };
    if (options.description) {
      payload.description = options.description;
    }
    if (options.reviewers && options.reviewers.length > 0) {
      payload.reviewers = options.reviewers.map(
        (r) => r.startsWith("{") ? { uuid: r } : { account_id: r }
      );
    }
    const result = await this.request(
      "POST",
      this.repoPath(repoSlug, "pullrequests"),
      payload
    );
    if (!result) {
      throw new BitbucketError(`Failed to create PR: ${options.sourceBranch} -> ${options.destinationBranch || "main"}`);
    }
    return result;
  }
  async getPullRequest(repoSlug, prId) {
    return this.request("GET", this.repoPath(repoSlug, "pullrequests", String(prId)));
  }
  async listPullRequests(repoSlug, options = {}) {
    return this.paginatedList(this.repoPath(repoSlug, "pullrequests"), {
      limit: options.limit || 50,
      maxPage: 50,
      state: options.state || "OPEN"
    });
  }
  async mergePullRequest(repoSlug, prId, options = {}) {
    const payload = {
      type: options.mergeStrategy || "merge_commit",
      close_source_branch: options.closeSourceBranch ?? true
    };
    if (options.message) {
      payload.message = options.message;
    }
    const result = await this.request(
      "POST",
      this.repoPath(repoSlug, "pullrequests", String(prId), "merge"),
      payload
    );
    if (!result) {
      throw new BitbucketError(`Failed to merge PR #${prId}`);
    }
    return result;
  }
  async listPrComments(repoSlug, prId, options = {}) {
    return this.paginatedList(
      this.repoPath(repoSlug, "pullrequests", String(prId), "comments"),
      { limit: options.limit || 50 }
    );
  }
  async addPrComment(repoSlug, prId, content, inline) {
    const payload = {
      content: { raw: content }
    };
    if (inline) {
      payload.inline = inline;
    }
    const result = await this.request(
      "POST",
      this.repoPath(repoSlug, "pullrequests", String(prId), "comments"),
      payload
    );
    if (!result) {
      throw new BitbucketError(`Failed to add comment to PR #${prId}`);
    }
    return result;
  }
  async approvePr(repoSlug, prId) {
    const result = await this.request(
      "POST",
      this.repoPath(repoSlug, "pullrequests", String(prId), "approve")
    );
    if (!result) {
      throw new BitbucketError(`Failed to approve PR #${prId}`);
    }
    return result;
  }
  async unapprovePr(repoSlug, prId) {
    await this.request("DELETE", this.repoPath(repoSlug, "pullrequests", String(prId), "approve"));
  }
  async requestChangesPr(repoSlug, prId) {
    const result = await this.request(
      "POST",
      this.repoPath(repoSlug, "pullrequests", String(prId), "request-changes")
    );
    if (!result) {
      throw new BitbucketError(`Failed to request changes on PR #${prId}`);
    }
    return result;
  }
  async declinePr(repoSlug, prId) {
    const result = await this.request(
      "POST",
      this.repoPath(repoSlug, "pullrequests", String(prId), "decline")
    );
    if (!result) {
      throw new BitbucketError(`Failed to decline PR #${prId}`);
    }
    return result;
  }
  async getPrDiff(repoSlug, prId) {
    return await this.requestText(this.repoPath(repoSlug, "pullrequests", String(prId), "diff")) || "";
  }
  // ==================== PIPELINES ====================
  /**
   * Build the pipeline target object based on options.
   * Supports branch triggers, commit triggers, and custom pipelines.
   */
  buildPipelineTarget(options) {
    if (options.branch && options.commit) {
      throw new BitbucketError("Cannot specify both branch and commit - they are mutually exclusive");
    }
    if (options.commit) {
      const target2 = {
        type: "pipeline_commit_target",
        commit: { hash: options.commit }
      };
      if (options.customPipeline) {
        target2.selector = {
          type: "custom",
          pattern: options.customPipeline
        };
      }
      return target2;
    }
    const target = {
      type: "pipeline_ref_target",
      ref_type: "branch",
      ref_name: options.branch || "main"
    };
    if (options.customPipeline) {
      target.selector = {
        type: "custom",
        pattern: options.customPipeline
      };
    }
    return target;
  }
  /**
   * Normalize pipeline variables to the array format expected by the API.
   * Supports both array format (with secured flag) and simple object format.
   */
  normalizePipelineVariables(variables) {
    if (!variables) {
      return void 0;
    }
    if (Array.isArray(variables)) {
      return variables.map((v) => ({
        key: v.key,
        value: v.value,
        ...v.secured !== void 0 && { secured: v.secured }
      }));
    }
    return Object.entries(variables).map(([key, value]) => ({
      key,
      value
    }));
  }
  async triggerPipeline(repoSlug, options = {}) {
    const payload = {
      target: this.buildPipelineTarget(options)
    };
    const normalizedVariables = this.normalizePipelineVariables(options.variables);
    if (normalizedVariables && normalizedVariables.length > 0) {
      payload.variables = normalizedVariables;
    }
    const result = await this.request(
      "POST",
      `${this.repoPath(repoSlug, "pipelines")}/`,
      payload
    );
    const targetDesc = options.commit ? `commit ${options.commit}` : options.branch || "main";
    const pipelineDesc = options.customPipeline ? `custom:${options.customPipeline}` : "default";
    if (!result) {
      throw new BitbucketError(`Failed to trigger ${pipelineDesc} pipeline on ${targetDesc}`);
    }
    return result;
  }
  async getPipeline(repoSlug, pipelineUuid) {
    return this.request("GET", this.repoPath(repoSlug, "pipelines", ensureUuidBraces(pipelineUuid)));
  }
  async listPipelines(repoSlug, options = {}) {
    return this.paginatedList(`${this.repoPath(repoSlug, "pipelines")}/`, {
      limit: options.limit || 10,
      sort: "-created_on"
    });
  }
  async getPipelineSteps(repoSlug, pipelineUuid) {
    return this.paginatedList(
      `${this.repoPath(repoSlug, "pipelines", ensureUuidBraces(pipelineUuid), "steps")}/`
    );
  }
  async getPipelineLogs(repoSlug, pipelineUuid, stepUuid) {
    const path = this.repoPath(
      repoSlug,
      "pipelines",
      ensureUuidBraces(pipelineUuid),
      "steps",
      ensureUuidBraces(stepUuid),
      "log"
    );
    return await this.requestText(path) || "";
  }
  async stopPipeline(repoSlug, pipelineUuid) {
    await this.request(
      "POST",
      this.repoPath(repoSlug, "pipelines", ensureUuidBraces(pipelineUuid), "stopPipeline")
    );
    const result = await this.getPipeline(repoSlug, pipelineUuid);
    return result || { uuid: pipelineUuid, state: { name: "STOPPED" } };
  }
  // ==================== PIPELINE VARIABLES ====================
  async listPipelineVariables(repoSlug, options = {}) {
    return this.paginatedList(
      this.repoPath(repoSlug, "pipelines_config", "variables"),
      { limit: options.limit || 50 }
    );
  }
  async getPipelineVariable(repoSlug, variableUuid) {
    return this.request(
      "GET",
      this.repoPath(repoSlug, "pipelines_config", "variables", ensureUuidBraces(variableUuid))
    );
  }
  async createPipelineVariable(repoSlug, key, value, secured = false) {
    const result = await this.request(
      "POST",
      `${this.repoPath(repoSlug, "pipelines_config", "variables")}/`,
      { key, value, secured }
    );
    if (!result) {
      throw new BitbucketError("Failed to create pipeline variable");
    }
    return result;
  }
  async updatePipelineVariable(repoSlug, variableUuid, value) {
    const result = await this.request(
      "PUT",
      this.repoPath(repoSlug, "pipelines_config", "variables", ensureUuidBraces(variableUuid)),
      { value }
    );
    if (!result) {
      throw new BitbucketError("Failed to update pipeline variable");
    }
    return result;
  }
  async deletePipelineVariable(repoSlug, variableUuid) {
    await this.request(
      "DELETE",
      this.repoPath(repoSlug, "pipelines_config", "variables", ensureUuidBraces(variableUuid))
    );
  }
  // ==================== BRANCHES ====================
  async listBranches(repoSlug, options = {}) {
    return this.paginatedList(this.repoPath(repoSlug, "refs", "branches"), {
      limit: options.limit || 50
    });
  }
  async getBranch(repoSlug, branchName) {
    return this.request("GET", this.repoPath(repoSlug, "refs", "branches", branchName));
  }
  // ==================== COMMITS ====================
  async listCommits(repoSlug, options = {}) {
    return this.paginatedList(this.repoPath(repoSlug, "commits"), {
      limit: options.limit || 20,
      include: options.branch,
      path: options.path
    });
  }
  async getCommit(repoSlug, commit) {
    return this.request("GET", this.repoPath(repoSlug, "commit", commit));
  }
  async compareCommits(repoSlug, base, head) {
    return this.request("GET", this.repoPath(repoSlug, "diffstat", `${base}..${head}`));
  }
  async getCommitStatuses(repoSlug, commit, options = {}) {
    return this.paginatedList(this.repoPath(repoSlug, "commit", commit, "statuses"), {
      limit: options.limit || 20
    });
  }
  async createCommitStatus(repoSlug, commit, options) {
    const payload = {
      state: options.state,
      key: options.key
    };
    if (options.url) payload.url = options.url;
    if (options.name) payload.name = options.name;
    if (options.description) payload.description = options.description;
    const result = await this.request(
      "POST",
      this.repoPath(repoSlug, "commit", commit, "statuses", "build"),
      payload
    );
    if (!result) {
      throw new BitbucketError(`Failed to create status for commit ${commit}`);
    }
    return result;
  }
  // ==================== PROJECTS ====================
  async listProjects(options = {}) {
    return this.paginatedList(`workspaces/${this.workspace}/projects`, {
      limit: options.limit || 50
    });
  }
  async getProject(projectKey) {
    return this.request("GET", `workspaces/${this.workspace}/projects/${projectKey}`);
  }
  // ==================== DEPLOYMENTS ====================
  async listEnvironments(repoSlug, options = {}) {
    return this.paginatedList(this.repoPath(repoSlug, "environments"), {
      limit: options.limit || 20
    });
  }
  async getEnvironment(repoSlug, environmentUuid) {
    return this.request(
      "GET",
      this.repoPath(repoSlug, "environments", ensureUuidBraces(environmentUuid))
    );
  }
  async listDeploymentHistory(repoSlug, environmentUuid, options = {}) {
    return this.paginatedList(this.repoPath(repoSlug, "deployments"), {
      limit: options.limit || 20,
      environment: ensureUuidBraces(environmentUuid),
      sort: "-state.started_on"
    });
  }
  // ==================== WEBHOOKS ====================
  async listWebhooks(repoSlug, options = {}) {
    return this.paginatedList(this.repoPath(repoSlug, "hooks"), {
      limit: options.limit || 50
    });
  }
  async createWebhook(repoSlug, options) {
    const payload = {
      url: options.url,
      events: options.events,
      active: options.active ?? true
    };
    if (options.description) {
      payload.description = options.description;
    }
    const result = await this.request(
      "POST",
      this.repoPath(repoSlug, "hooks"),
      payload
    );
    if (!result) {
      throw new BitbucketError("Failed to create webhook");
    }
    return result;
  }
  async getWebhook(repoSlug, webhookUid) {
    return this.request("GET", this.repoPath(repoSlug, "hooks", ensureUuidBraces(webhookUid)));
  }
  async deleteWebhook(repoSlug, webhookUid) {
    await this.request("DELETE", this.repoPath(repoSlug, "hooks", ensureUuidBraces(webhookUid)));
  }
  // ==================== TAGS ====================
  async listTags(repoSlug, options = {}) {
    return this.paginatedList(this.repoPath(repoSlug, "refs", "tags"), {
      limit: options.limit || 50,
      sort: "-target.date"
    });
  }
  async createTag(repoSlug, name, target, message) {
    const payload = {
      name,
      target: { hash: target }
    };
    if (message) {
      payload.message = message;
    }
    const result = await this.request(
      "POST",
      this.repoPath(repoSlug, "refs", "tags"),
      payload
    );
    if (!result) {
      throw new BitbucketError(`Failed to create tag ${name}`);
    }
    return result;
  }
  async deleteTag(repoSlug, tagName) {
    await this.request("DELETE", this.repoPath(repoSlug, "refs", "tags", tagName));
  }
  // ==================== BRANCH RESTRICTIONS ====================
  async listBranchRestrictions(repoSlug, options = {}) {
    return this.paginatedList(this.repoPath(repoSlug, "branch-restrictions"), {
      limit: options.limit || 50
    });
  }
  async createBranchRestriction(repoSlug, options) {
    const payload = {
      kind: options.kind,
      branch_match_kind: options.branchMatchKind || "glob"
    };
    if (options.branchMatchKind === "glob" && options.pattern) {
      payload.pattern = options.pattern;
    }
    if (options.branchMatchKind === "branching_model" && options.branchType) {
      payload.branch_type = options.branchType;
    }
    if (options.value !== void 0) {
      payload.value = options.value;
    }
    const result = await this.request(
      "POST",
      this.repoPath(repoSlug, "branch-restrictions"),
      payload
    );
    if (!result) {
      throw new BitbucketError(`Failed to create branch restriction ${options.kind}`);
    }
    return result;
  }
  async deleteBranchRestriction(repoSlug, restrictionId) {
    await this.request(
      "DELETE",
      this.repoPath(repoSlug, "branch-restrictions", String(restrictionId))
    );
  }
  // ==================== SOURCE ====================
  async getFileContent(repoSlug, path, ref = "main") {
    return this.requestText(this.repoPath(repoSlug, "src", ref, path));
  }
  async listDirectory(repoSlug, path = "", options = {}) {
    const endpoint = path ? this.repoPath(repoSlug, "src", options.ref || "main", path) : this.repoPath(repoSlug, "src", options.ref || "main");
    return this.paginatedList(endpoint, { limit: options.limit || 100 });
  }
  // ==================== PERMISSIONS ====================
  async listUserPermissions(repoSlug, options = {}) {
    return this.paginatedList(this.repoPath(repoSlug, "permissions-config", "users"), {
      limit: options.limit || 50
    });
  }
  async getUserPermission(repoSlug, selectedUser) {
    return this.request(
      "GET",
      this.repoPath(repoSlug, "permissions-config", "users", selectedUser)
    );
  }
  async updateUserPermission(repoSlug, selectedUser, permission) {
    const result = await this.request(
      "PUT",
      this.repoPath(repoSlug, "permissions-config", "users", selectedUser),
      { permission }
    );
    if (!result) {
      throw new BitbucketError(`Failed to update permission for user ${selectedUser}`);
    }
    return result;
  }
  async deleteUserPermission(repoSlug, selectedUser) {
    await this.request(
      "DELETE",
      this.repoPath(repoSlug, "permissions-config", "users", selectedUser)
    );
  }
  async listGroupPermissions(repoSlug, options = {}) {
    return this.paginatedList(this.repoPath(repoSlug, "permissions-config", "groups"), {
      limit: options.limit || 50
    });
  }
  async getGroupPermission(repoSlug, groupSlug) {
    return this.request(
      "GET",
      this.repoPath(repoSlug, "permissions-config", "groups", groupSlug)
    );
  }
  async updateGroupPermission(repoSlug, groupSlug, permission) {
    const result = await this.request(
      "PUT",
      this.repoPath(repoSlug, "permissions-config", "groups", groupSlug),
      { permission }
    );
    if (!result) {
      throw new BitbucketError(`Failed to update permission for group ${groupSlug}`);
    }
    return result;
  }
  async deleteGroupPermission(repoSlug, groupSlug) {
    await this.request(
      "DELETE",
      this.repoPath(repoSlug, "permissions-config", "groups", groupSlug)
    );
  }
  // ==================== UTILITIES ====================
  extractPrUrl(pr) {
    return pr.links?.html?.href || "";
  }
  extractCloneUrls(repo) {
    const urls = {};
    for (const link of repo.links?.clone || []) {
      const name = (link.name || "").toLowerCase();
      if (name === "https" || name === "ssh") {
        urls[name] = link.href || "";
      }
    }
    urls.html = repo.links?.html?.href || "";
    return urls;
  }
};
var clientInstance = null;
function getClient() {
  if (!clientInstance) {
    clientInstance = new BitbucketClient();
  }
  return clientInstance;
}

// src/tools/repositories.ts
var definitions = [
  {
    name: "get_repository",
    description: "Get information about a Bitbucket repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: {
          type: "string",
          description: 'Repository slug (e.g., "anzsic_classifier")'
        }
      },
      required: ["repo_slug"]
    }
  },
  {
    name: "create_repository",
    description: "Create a new Bitbucket repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: {
          type: "string",
          description: "Repository slug (lowercase, no spaces)"
        },
        project_key: {
          type: "string",
          description: "Project key to create repo under (optional)"
        },
        is_private: {
          type: "boolean",
          description: "Whether repository is private (default: true)",
          default: true
        },
        description: {
          type: "string",
          description: "Repository description",
          default: ""
        }
      },
      required: ["repo_slug"]
    }
  },
  {
    name: "delete_repository",
    description: "Delete a Bitbucket repository. WARNING: This action is irreversible!",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: {
          type: "string",
          description: "Repository slug to delete"
        }
      },
      required: ["repo_slug"]
    }
  },
  {
    name: "list_repositories",
    description: "List and search repositories in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        project_key: {
          type: "string",
          description: "Filter by project key (optional)"
        },
        search: {
          type: "string",
          description: "Simple search term for repository name (optional). Uses fuzzy matching."
        },
        query: {
          type: "string",
          description: 'Advanced Bitbucket query syntax (optional). Examples: name ~ "api", is_private = false'
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 50, max: 100)",
          default: 50
        }
      },
      required: []
    }
  },
  {
    name: "update_repository",
    description: "Update repository settings (project, visibility, description, name).",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: {
          type: "string",
          description: "Repository slug"
        },
        project_key: {
          type: "string",
          description: "Move to different project (optional)"
        },
        is_private: {
          type: "boolean",
          description: "Change visibility (optional)"
        },
        description: {
          type: "string",
          description: "Update description (optional)"
        },
        name: {
          type: "string",
          description: "Rename repository (optional)"
        }
      },
      required: ["repo_slug"]
    }
  }
];
var handlers = {
  get_repository: async (args) => {
    const client = getClient();
    const result = await client.getRepository(args.repo_slug);
    if (!result) {
      return notFoundResponse("Repository", args.repo_slug);
    }
    return {
      name: result.name,
      full_name: result.full_name,
      private: result.is_private,
      project: result.project?.key,
      description: result.description || "",
      main_branch: result.mainbranch?.name,
      clone_urls: client.extractCloneUrls(result),
      created: result.created_on,
      updated: result.updated_on
    };
  },
  create_repository: async (args) => {
    const client = getClient();
    const result = await client.createRepository(args.repo_slug, {
      projectKey: args.project_key,
      isPrivate: args.is_private,
      description: args.description
    });
    return {
      name: result.name,
      full_name: result.full_name,
      clone_urls: client.extractCloneUrls(result)
    };
  },
  delete_repository: async (args) => {
    const client = getClient();
    await client.deleteRepository(args.repo_slug);
    return {};
  },
  list_repositories: async (args) => {
    const client = getClient();
    let effectiveQuery = args.query;
    if (args.search && !args.query) {
      const safeSearch = sanitizeSearchTerm(args.search);
      effectiveQuery = `name ~ "${safeSearch}"`;
    }
    const repos = await client.listRepositories({
      projectKey: args.project_key,
      query: effectiveQuery,
      limit: validateLimit(args.limit || 50)
    });
    return {
      repositories: repos.map((r) => ({
        name: r.name,
        full_name: r.full_name,
        private: r.is_private,
        project: r.project?.key,
        description: r.description || ""
      }))
    };
  },
  update_repository: async (args) => {
    const client = getClient();
    const result = await client.updateRepository(args.repo_slug, {
      projectKey: args.project_key,
      isPrivate: args.is_private,
      description: args.description,
      name: args.name
    });
    return {
      name: result.name,
      full_name: result.full_name,
      project: result.project?.key,
      private: result.is_private,
      description: result.description || ""
    };
  }
};

// src/types.ts
var PRState = /* @__PURE__ */ ((PRState2) => {
  PRState2["OPEN"] = "OPEN";
  PRState2["MERGED"] = "MERGED";
  PRState2["DECLINED"] = "DECLINED";
  PRState2["SUPERSEDED"] = "SUPERSEDED";
  return PRState2;
})(PRState || {});
var MergeStrategy = /* @__PURE__ */ ((MergeStrategy2) => {
  MergeStrategy2["MERGE_COMMIT"] = "merge_commit";
  MergeStrategy2["SQUASH"] = "squash";
  MergeStrategy2["FAST_FORWARD"] = "fast_forward";
  return MergeStrategy2;
})(MergeStrategy || {});
var CommitStatusState = /* @__PURE__ */ ((CommitStatusState2) => {
  CommitStatusState2["SUCCESSFUL"] = "SUCCESSFUL";
  CommitStatusState2["FAILED"] = "FAILED";
  CommitStatusState2["INPROGRESS"] = "INPROGRESS";
  CommitStatusState2["STOPPED"] = "STOPPED";
  return CommitStatusState2;
})(CommitStatusState || {});

// src/tools/pull-requests.ts
var definitions2 = [
  {
    name: "create_pull_request",
    description: "Create a pull request in a Bitbucket repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        title: { type: "string", description: "PR title" },
        source_branch: { type: "string", description: "Source branch name" },
        destination_branch: { type: "string", description: "Target branch (default: main)", default: "main" },
        description: { type: "string", description: "PR description in markdown", default: "" },
        close_source_branch: { type: "boolean", description: "Delete source branch after merge", default: true }
      },
      required: ["repo_slug", "title", "source_branch"]
    }
  },
  {
    name: "get_pull_request",
    description: "Get information about a pull request.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        pr_id: { type: "number", description: "Pull request ID" }
      },
      required: ["repo_slug", "pr_id"]
    }
  },
  {
    name: "list_pull_requests",
    description: "List pull requests in a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        state: { type: "string", description: "Filter by state: OPEN, MERGED, DECLINED, SUPERSEDED", default: "OPEN" },
        limit: { type: "number", description: "Maximum results (default: 20, max: 100)", default: 20 }
      },
      required: ["repo_slug"]
    }
  },
  {
    name: "merge_pull_request",
    description: "Merge a pull request.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        pr_id: { type: "number", description: "Pull request ID" },
        merge_strategy: { type: "string", description: "merge_commit, squash, or fast_forward", default: "merge_commit" },
        close_source_branch: { type: "boolean", description: "Delete source branch after merge", default: true },
        message: { type: "string", description: "Optional merge commit message" }
      },
      required: ["repo_slug", "pr_id"]
    }
  },
  {
    name: "list_pr_comments",
    description: "List comments on a pull request.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        pr_id: { type: "number", description: "Pull request ID" },
        limit: { type: "number", description: "Maximum results (default: 50)", default: 50 }
      },
      required: ["repo_slug", "pr_id"]
    }
  },
  {
    name: "add_pr_comment",
    description: "Add a comment to a pull request. Can add general or inline comments.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        pr_id: { type: "number", description: "Pull request ID" },
        content: { type: "string", description: "Comment content (markdown supported)" },
        file_path: { type: "string", description: "File path for inline comment (optional)" },
        line: { type: "number", description: "Line number for inline comment (optional, requires file_path)" }
      },
      required: ["repo_slug", "pr_id", "content"]
    }
  },
  {
    name: "approve_pr",
    description: "Approve a pull request.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        pr_id: { type: "number", description: "Pull request ID" }
      },
      required: ["repo_slug", "pr_id"]
    }
  },
  {
    name: "unapprove_pr",
    description: "Remove your approval from a pull request.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        pr_id: { type: "number", description: "Pull request ID" }
      },
      required: ["repo_slug", "pr_id"]
    }
  },
  {
    name: "request_changes_pr",
    description: "Request changes on a pull request.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        pr_id: { type: "number", description: "Pull request ID" }
      },
      required: ["repo_slug", "pr_id"]
    }
  },
  {
    name: "decline_pr",
    description: "Decline (close without merging) a pull request.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        pr_id: { type: "number", description: "Pull request ID" }
      },
      required: ["repo_slug", "pr_id"]
    }
  },
  {
    name: "get_pr_diff",
    description: "Get the diff of a pull request.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        pr_id: { type: "number", description: "Pull request ID" }
      },
      required: ["repo_slug", "pr_id"]
    }
  }
];
var handlers2 = {
  create_pull_request: async (args) => {
    const client = getClient();
    const result = await client.createPullRequest(args.repo_slug, {
      title: args.title,
      sourceBranch: args.source_branch,
      destinationBranch: args.destination_branch || "main",
      description: args.description,
      closeSourceBranch: args.close_source_branch ?? true
    });
    return {
      id: result.id,
      title: result.title,
      state: result.state,
      url: client.extractPrUrl(result)
    };
  },
  get_pull_request: async (args) => {
    const client = getClient();
    const result = await client.getPullRequest(args.repo_slug, args.pr_id);
    if (!result) {
      return notFoundResponse("PR", `#${args.pr_id}`);
    }
    return {
      id: result.id,
      title: result.title,
      description: result.description,
      state: result.state,
      author: result.author?.display_name,
      source_branch: result.source?.branch?.name,
      destination_branch: result.destination?.branch?.name,
      reviewers: result.reviewers?.map((r) => r.display_name) || [],
      url: client.extractPrUrl(result),
      created: result.created_on,
      updated: result.updated_on
    };
  },
  list_pull_requests: async (args) => {
    const client = getClient();
    const state = (args.state || "OPEN").toUpperCase();
    const validState = Object.values(PRState).includes(state) ? state : "OPEN";
    const prs = await client.listPullRequests(args.repo_slug, {
      state: validState,
      limit: validateLimit(args.limit || 20)
    });
    return {
      pull_requests: prs.map((pr) => ({
        id: pr.id,
        title: pr.title,
        state: pr.state,
        author: pr.author?.display_name,
        source_branch: pr.source?.branch?.name,
        destination_branch: pr.destination?.branch?.name,
        url: client.extractPrUrl(pr)
      }))
    };
  },
  merge_pull_request: async (args) => {
    const client = getClient();
    const strategy = (args.merge_strategy || "merge_commit").toLowerCase();
    const validStrategy = Object.values(MergeStrategy).includes(strategy) ? strategy : "merge_commit";
    const result = await client.mergePullRequest(args.repo_slug, args.pr_id, {
      mergeStrategy: validStrategy,
      closeSourceBranch: args.close_source_branch ?? true,
      message: args.message
    });
    return {
      id: result.id,
      state: result.state,
      merge_commit: result.merge_commit?.hash,
      url: client.extractPrUrl(result)
    };
  },
  list_pr_comments: async (args) => {
    const client = getClient();
    const comments = await client.listPrComments(args.repo_slug, args.pr_id, {
      limit: validateLimit(args.limit || 50)
    });
    return {
      pr_id: args.pr_id,
      comments: comments.map((c) => ({
        id: c.id,
        content: c.content?.raw || "",
        author: c.user?.display_name,
        created: c.created_on,
        inline: c.inline ? { path: c.inline.path, line: c.inline.to } : void 0
      }))
    };
  },
  add_pr_comment: async (args) => {
    const client = getClient();
    let inline;
    if (args.file_path && args.line) {
      inline = { path: args.file_path, to: args.line };
    }
    const result = await client.addPrComment(
      args.repo_slug,
      args.pr_id,
      args.content,
      inline
    );
    return {
      id: result.id,
      content: result.content?.raw || "",
      inline
    };
  },
  approve_pr: async (args) => {
    const client = getClient();
    const result = await client.approvePr(args.repo_slug, args.pr_id);
    return {
      pr_id: args.pr_id,
      approved_by: result.user?.display_name
    };
  },
  unapprove_pr: async (args) => {
    const client = getClient();
    await client.unapprovePr(args.repo_slug, args.pr_id);
    return { pr_id: args.pr_id };
  },
  request_changes_pr: async (args) => {
    const client = getClient();
    const result = await client.requestChangesPr(args.repo_slug, args.pr_id);
    return {
      pr_id: args.pr_id,
      requested_by: result.user?.display_name
    };
  },
  decline_pr: async (args) => {
    const client = getClient();
    const result = await client.declinePr(args.repo_slug, args.pr_id);
    return {
      pr_id: args.pr_id,
      state: result.state
    };
  },
  get_pr_diff: async (args) => {
    const client = getClient();
    const diff = await client.getPrDiff(args.repo_slug, args.pr_id);
    if (!diff) {
      return { error: `PR #${args.pr_id} not found or has no diff` };
    }
    const maxLength = 5e4;
    const truncated = diff.length > maxLength;
    return {
      pr_id: args.pr_id,
      diff: truncated ? diff.substring(0, maxLength) : diff,
      truncated,
      total_length: diff.length
    };
  }
};

// src/tools/pipelines.ts
var definitions3 = [
  {
    name: "trigger_pipeline",
    description: 'Trigger a pipeline run. Supports custom pipelines (from "custom:" section in bitbucket-pipelines.yml) and commit-based triggers.',
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        branch: { type: "string", description: "Branch to run pipeline on (default: main). Mutually exclusive with commit.", default: "main" },
        commit: { type: "string", description: "Commit hash to run pipeline on. Mutually exclusive with branch." },
        custom_pipeline: { type: "string", description: 'Name of custom pipeline from "custom:" section (e.g., "deploy-staging", "dry-run")' },
        variables: {
          type: "array",
          description: "Pipeline variables. Can be array of {key, value, secured?} or simple {key: value} object for backwards compatibility.",
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: "Variable name" },
              value: { type: "string", description: "Variable value" },
              secured: { type: "boolean", description: "Whether to mark as secured (encrypted)", default: false }
            },
            required: ["key", "value"]
          }
        }
      },
      required: ["repo_slug"]
    }
  },
  {
    name: "get_pipeline",
    description: "Get status of a pipeline run.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        pipeline_uuid: { type: "string", description: "Pipeline UUID" }
      },
      required: ["repo_slug", "pipeline_uuid"]
    }
  },
  {
    name: "list_pipelines",
    description: "List recent pipeline runs for a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        limit: { type: "number", description: "Maximum results (default: 10)", default: 10 }
      },
      required: ["repo_slug"]
    }
  },
  {
    name: "get_pipeline_logs",
    description: "Get logs for a pipeline run. If step_uuid is not provided, returns list of steps.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        pipeline_uuid: { type: "string", description: "Pipeline UUID" },
        step_uuid: { type: "string", description: "Step UUID (optional, get from steps list first)" }
      },
      required: ["repo_slug", "pipeline_uuid"]
    }
  },
  {
    name: "stop_pipeline",
    description: "Stop a running pipeline.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        pipeline_uuid: { type: "string", description: "Pipeline UUID" }
      },
      required: ["repo_slug", "pipeline_uuid"]
    }
  },
  {
    name: "list_pipeline_variables",
    description: "List pipeline variables for a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        limit: { type: "number", description: "Maximum results (default: 50)", default: 50 }
      },
      required: ["repo_slug"]
    }
  },
  {
    name: "get_pipeline_variable",
    description: "Get details about a specific pipeline variable.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        variable_uuid: { type: "string", description: "Variable UUID" }
      },
      required: ["repo_slug", "variable_uuid"]
    }
  },
  {
    name: "create_pipeline_variable",
    description: "Create a pipeline variable.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        key: { type: "string", description: "Variable name" },
        value: { type: "string", description: "Variable value" },
        secured: { type: "boolean", description: "Encrypt the value (secured variables cannot be read back)", default: false }
      },
      required: ["repo_slug", "key", "value"]
    }
  },
  {
    name: "update_pipeline_variable",
    description: "Update a pipeline variable's value.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        variable_uuid: { type: "string", description: "Variable UUID" },
        value: { type: "string", description: "New variable value" }
      },
      required: ["repo_slug", "variable_uuid", "value"]
    }
  },
  {
    name: "delete_pipeline_variable",
    description: "Delete a pipeline variable.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        variable_uuid: { type: "string", description: "Variable UUID" }
      },
      required: ["repo_slug", "variable_uuid"]
    }
  }
];
var handlers3 = {
  trigger_pipeline: async (args) => {
    const client = getClient();
    const result = await client.triggerPipeline(args.repo_slug, {
      branch: args.branch,
      commit: args.commit,
      customPipeline: args.custom_pipeline,
      variables: args.variables
    });
    return {
      uuid: result.uuid,
      build_number: result.build_number,
      state: result.state?.name
    };
  },
  get_pipeline: async (args) => {
    const client = getClient();
    const result = await client.getPipeline(args.repo_slug, args.pipeline_uuid);
    if (!result) {
      return notFoundResponse("Pipeline", args.pipeline_uuid);
    }
    return {
      uuid: result.uuid,
      build_number: result.build_number,
      state: result.state?.name,
      result: result.state?.result?.name,
      branch: result.target?.ref_name,
      created: result.created_on,
      completed: result.completed_on,
      duration: result.duration_in_seconds
    };
  },
  list_pipelines: async (args) => {
    const client = getClient();
    const pipelines = await client.listPipelines(args.repo_slug, {
      limit: validateLimit(args.limit || 10)
    });
    return {
      pipelines: pipelines.map((p) => ({
        uuid: p.uuid,
        build_number: p.build_number,
        state: p.state?.name,
        result: p.state?.result?.name,
        branch: p.target?.ref_name,
        created: p.created_on
      }))
    };
  },
  get_pipeline_logs: async (args) => {
    const client = getClient();
    const pipelineUuid = args.pipeline_uuid;
    const stepUuid = args.step_uuid;
    if (!stepUuid) {
      const steps = await client.getPipelineSteps(args.repo_slug, pipelineUuid);
      return {
        message: "Provide step_uuid to get logs for a specific step",
        steps: steps.map((s) => ({
          uuid: s.uuid,
          name: s.name,
          state: s.state?.name,
          result: s.state?.result?.name,
          duration: s.duration_in_seconds
        }))
      };
    }
    const logs = await client.getPipelineLogs(args.repo_slug, pipelineUuid, stepUuid);
    return {
      step_uuid: stepUuid,
      logs: logs || "(no logs available)"
    };
  },
  stop_pipeline: async (args) => {
    const client = getClient();
    const result = await client.stopPipeline(args.repo_slug, args.pipeline_uuid);
    return {
      uuid: result.uuid,
      state: result.state?.name
    };
  },
  list_pipeline_variables: async (args) => {
    const client = getClient();
    const variables = await client.listPipelineVariables(args.repo_slug, {
      limit: validateLimit(args.limit || 50)
    });
    return {
      variables: variables.map((v) => ({
        uuid: v.uuid,
        key: v.key,
        secured: v.secured,
        value: v.secured ? void 0 : v.value
      }))
    };
  },
  get_pipeline_variable: async (args) => {
    const client = getClient();
    const result = await client.getPipelineVariable(args.repo_slug, args.variable_uuid);
    if (!result) {
      return notFoundResponse("Pipeline variable", args.variable_uuid);
    }
    return {
      uuid: result.uuid,
      key: result.key,
      secured: result.secured,
      value: result.secured ? void 0 : result.value
    };
  },
  create_pipeline_variable: async (args) => {
    const client = getClient();
    const result = await client.createPipelineVariable(
      args.repo_slug,
      args.key,
      args.value,
      args.secured ?? false
    );
    return {
      uuid: result.uuid,
      key: result.key,
      secured: result.secured
    };
  },
  update_pipeline_variable: async (args) => {
    const client = getClient();
    const result = await client.updatePipelineVariable(
      args.repo_slug,
      args.variable_uuid,
      args.value
    );
    return {
      uuid: result.uuid,
      key: result.key,
      secured: result.secured
    };
  },
  delete_pipeline_variable: async (args) => {
    const client = getClient();
    await client.deletePipelineVariable(args.repo_slug, args.variable_uuid);
    return {};
  }
};

// src/tools/branches.ts
var definitions4 = [
  {
    name: "list_branches",
    description: "List branches in a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        limit: { type: "number", description: "Maximum results (default: 50)", default: 50 }
      },
      required: ["repo_slug"]
    }
  },
  {
    name: "get_branch",
    description: "Get information about a specific branch.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        branch_name: { type: "string", description: "Branch name" }
      },
      required: ["repo_slug", "branch_name"]
    }
  }
];
var handlers4 = {
  list_branches: async (args) => {
    const client = getClient();
    const branches = await client.listBranches(args.repo_slug, {
      limit: validateLimit(args.limit || 50)
    });
    return {
      branches: branches.map((b) => ({
        name: b.name,
        commit: b.target?.hash?.substring(0, 7),
        message: b.target?.message,
        date: b.target?.date
      }))
    };
  },
  get_branch: async (args) => {
    const client = getClient();
    const result = await client.getBranch(args.repo_slug, args.branch_name);
    if (!result) {
      return notFoundResponse("Branch", args.branch_name);
    }
    return {
      name: result.name,
      latest_commit: {
        hash: result.target?.hash,
        message: result.target?.message || "",
        author: result.target?.author?.raw,
        date: result.target?.date
      }
    };
  }
};

// src/tools/commits.ts
var definitions5 = [
  {
    name: "list_commits",
    description: "List commits in a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        branch: { type: "string", description: "Filter by branch name (optional)" },
        path: { type: "string", description: "Filter by file path - only commits that modified this path (optional)" },
        limit: { type: "number", description: "Maximum results (default: 20)", default: 20 }
      },
      required: ["repo_slug"]
    }
  },
  {
    name: "get_commit",
    description: "Get detailed information about a specific commit.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        commit: { type: "string", description: "Commit hash (full or short)" }
      },
      required: ["repo_slug", "commit"]
    }
  },
  {
    name: "compare_commits",
    description: "Compare two commits or branches and see files changed.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        base: { type: "string", description: "Base commit hash or branch name" },
        head: { type: "string", description: "Head commit hash or branch name" }
      },
      required: ["repo_slug", "base", "head"]
    }
  },
  {
    name: "get_commit_statuses",
    description: "Get build/CI statuses for a commit.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        commit: { type: "string", description: "Commit hash" },
        limit: { type: "number", description: "Maximum results (default: 20)", default: 20 }
      },
      required: ["repo_slug", "commit"]
    }
  },
  {
    name: "create_commit_status",
    description: "Create a build status for a commit. Use this to report CI/CD status from external systems.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        commit: { type: "string", description: "Commit hash" },
        state: { type: "string", description: "Status state: SUCCESSFUL, FAILED, INPROGRESS, STOPPED" },
        key: { type: "string", description: "Unique identifier for this status" },
        url: { type: "string", description: "URL to the build details (optional)" },
        name: { type: "string", description: "Display name for the status (optional)" },
        description: { type: "string", description: "Status description (optional)" }
      },
      required: ["repo_slug", "commit", "state", "key"]
    }
  }
];
var handlers5 = {
  list_commits: async (args) => {
    const client = getClient();
    const commits = await client.listCommits(args.repo_slug, {
      branch: args.branch,
      path: args.path,
      limit: validateLimit(args.limit || 20)
    });
    return {
      commits: commits.map((c) => ({
        hash: truncateHash(c.hash),
        message: c.message,
        author: c.author?.raw,
        date: c.date
      }))
    };
  },
  get_commit: async (args) => {
    const client = getClient();
    const result = await client.getCommit(args.repo_slug, args.commit);
    if (!result) {
      return notFoundResponse("Commit", args.commit);
    }
    return {
      hash: result.hash,
      message: result.message,
      author: result.author?.raw,
      date: result.date,
      parents: result.parents?.map((p) => truncateHash(p.hash))
    };
  },
  compare_commits: async (args) => {
    const client = getClient();
    const result = await client.compareCommits(
      args.repo_slug,
      args.base,
      args.head
    );
    if (!result) {
      return { error: `Could not compare ${args.base}..${args.head}` };
    }
    const files = result.values || [];
    return {
      files: files.slice(0, 50).map((f) => ({
        path: f.new?.path || f.old?.path,
        status: f.status,
        "+": f.lines_added || 0,
        "-": f.lines_removed || 0
      }))
    };
  },
  get_commit_statuses: async (args) => {
    const client = getClient();
    const statuses = await client.getCommitStatuses(args.repo_slug, args.commit, {
      limit: validateLimit(args.limit || 20)
    });
    return {
      commit: truncateHash(args.commit),
      statuses: statuses.map((s) => ({
        key: s.key,
        state: s.state,
        name: s.name,
        description: s.description,
        url: s.url,
        created: s.created_on
      }))
    };
  },
  create_commit_status: async (args) => {
    const state = args.state.toUpperCase();
    const validStates = Object.values(CommitStatusState);
    if (!validStates.includes(state)) {
      return {
        success: false,
        error: `Invalid state '${args.state}'. Must be one of: ${validStates.join(", ")}`
      };
    }
    const client = getClient();
    const result = await client.createCommitStatus(args.repo_slug, args.commit, {
      state,
      key: args.key,
      url: args.url,
      name: args.name,
      description: args.description
    });
    return {
      key: result.key,
      state: result.state,
      name: result.name,
      url: result.url
    };
  }
};

// src/tools/deployments.ts
var definitions6 = [
  {
    name: "list_environments",
    description: "List deployment environments for a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        limit: { type: "number", description: "Maximum results (default: 20)", default: 20 }
      },
      required: ["repo_slug"]
    }
  },
  {
    name: "get_environment",
    description: "Get details about a specific deployment environment.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        environment_uuid: { type: "string", description: "Environment UUID" }
      },
      required: ["repo_slug", "environment_uuid"]
    }
  },
  {
    name: "list_deployment_history",
    description: "Get deployment history for a specific environment.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        environment_uuid: { type: "string", description: "Environment UUID" },
        limit: { type: "number", description: "Maximum results (default: 20)", default: 20 }
      },
      required: ["repo_slug", "environment_uuid"]
    }
  }
];
var handlers6 = {
  list_environments: async (args) => {
    const client = getClient();
    const environments = await client.listEnvironments(args.repo_slug, {
      limit: validateLimit(args.limit || 20)
    });
    return {
      environments: environments.map((e) => ({
        uuid: e.uuid,
        name: e.name,
        type: e.environment_type?.name,
        rank: e.rank
      }))
    };
  },
  get_environment: async (args) => {
    const client = getClient();
    const result = await client.getEnvironment(args.repo_slug, args.environment_uuid);
    if (!result) {
      return notFoundResponse("Environment", args.environment_uuid);
    }
    return {
      uuid: result.uuid,
      name: result.name,
      environment_type: result.environment_type?.name,
      rank: result.rank,
      restrictions: result.restrictions,
      lock: result.lock
    };
  },
  list_deployment_history: async (args) => {
    const client = getClient();
    const deployments = await client.listDeploymentHistory(
      args.repo_slug,
      args.environment_uuid,
      { limit: validateLimit(args.limit || 20) }
    );
    return {
      deployments: deployments.map((d) => ({
        uuid: d.uuid,
        state: d.state?.name,
        started: d.state?.started_on,
        completed: d.state?.completed_on,
        commit: d.release?.commit?.hash?.substring(0, 7),
        pipeline_uuid: d.release?.pipeline?.uuid
      }))
    };
  }
};

// src/tools/webhooks.ts
var definitions7 = [
  {
    name: "list_webhooks",
    description: "List webhooks configured for a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        limit: { type: "number", description: "Maximum results (default: 50)", default: 50 }
      },
      required: ["repo_slug"]
    }
  },
  {
    name: "create_webhook",
    description: "Create a webhook for a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        url: { type: "string", description: "URL to call when events occur" },
        events: {
          type: "array",
          items: { type: "string" },
          description: "List of events (e.g., repo:push, pullrequest:created, pullrequest:merged)"
        },
        description: { type: "string", description: "Webhook description (optional)", default: "" },
        active: { type: "boolean", description: "Whether webhook is active (default: true)", default: true }
      },
      required: ["repo_slug", "url", "events"]
    }
  },
  {
    name: "get_webhook",
    description: "Get details about a specific webhook.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        webhook_uuid: { type: "string", description: "Webhook UUID" }
      },
      required: ["repo_slug", "webhook_uuid"]
    }
  },
  {
    name: "delete_webhook",
    description: "Delete a webhook.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        webhook_uuid: { type: "string", description: "Webhook UUID" }
      },
      required: ["repo_slug", "webhook_uuid"]
    }
  }
];
var handlers7 = {
  list_webhooks: async (args) => {
    const client = getClient();
    const webhooks = await client.listWebhooks(args.repo_slug, {
      limit: validateLimit(args.limit || 50)
    });
    return {
      webhooks: webhooks.map((w) => ({
        uuid: w.uuid,
        url: w.url,
        description: w.description,
        events: w.events,
        active: w.active
      }))
    };
  },
  create_webhook: async (args) => {
    const client = getClient();
    const result = await client.createWebhook(args.repo_slug, {
      url: args.url,
      events: args.events,
      description: args.description,
      active: args.active ?? true
    });
    return {
      uuid: result.uuid,
      url: result.url,
      events: result.events,
      active: result.active
    };
  },
  get_webhook: async (args) => {
    const client = getClient();
    const result = await client.getWebhook(args.repo_slug, args.webhook_uuid);
    if (!result) {
      return notFoundResponse("Webhook", args.webhook_uuid);
    }
    return {
      uuid: result.uuid,
      url: result.url,
      description: result.description,
      events: result.events,
      active: result.active
    };
  },
  delete_webhook: async (args) => {
    const client = getClient();
    await client.deleteWebhook(args.repo_slug, args.webhook_uuid);
    return {};
  }
};

// src/tools/tags.ts
var definitions8 = [
  {
    name: "list_tags",
    description: "List tags in a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        limit: { type: "number", description: "Maximum results (default: 50)", default: 50 }
      },
      required: ["repo_slug"]
    }
  },
  {
    name: "create_tag",
    description: "Create a new tag in a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        name: { type: "string", description: 'Tag name (e.g., "v1.0.0")' },
        target: { type: "string", description: "Commit hash or branch name to tag" },
        message: { type: "string", description: "Optional tag message (for annotated tags)", default: "" }
      },
      required: ["repo_slug", "name", "target"]
    }
  },
  {
    name: "delete_tag",
    description: "Delete a tag from a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        tag_name: { type: "string", description: "Tag name to delete" }
      },
      required: ["repo_slug", "tag_name"]
    }
  }
];
var handlers8 = {
  list_tags: async (args) => {
    const client = getClient();
    const tags = await client.listTags(args.repo_slug, {
      limit: validateLimit(args.limit || 50)
    });
    return {
      tags: tags.map((t) => ({
        name: t.name,
        target: truncateHash(t.target?.hash),
        message: t.message,
        date: t.target?.date,
        tagger: t.tagger?.raw
      }))
    };
  },
  create_tag: async (args) => {
    const client = getClient();
    const result = await client.createTag(
      args.repo_slug,
      args.name,
      args.target,
      args.message || void 0
    );
    return {
      name: result.name,
      target: truncateHash(result.target?.hash),
      message: result.message || ""
    };
  },
  delete_tag: async (args) => {
    const client = getClient();
    await client.deleteTag(args.repo_slug, args.tag_name);
    return {};
  }
};

// src/tools/restrictions.ts
var definitions9 = [
  {
    name: "list_branch_restrictions",
    description: "List branch restrictions (protection rules) in a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        limit: { type: "number", description: "Maximum results (default: 50)", default: 50 }
      },
      required: ["repo_slug"]
    }
  },
  {
    name: "create_branch_restriction",
    description: "Create a branch restriction (protection rule).",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        kind: {
          type: "string",
          description: "Type of restriction: push, force, delete, restrict_merges, require_passing_builds_to_merge, require_approvals_to_merge, etc."
        },
        pattern: { type: "string", description: 'Branch pattern (e.g., "main", "release/*"). Required for glob match.', default: "" },
        branch_match_kind: { type: "string", description: 'How to match branches: "glob" or "branching_model"', default: "glob" },
        branch_type: { type: "string", description: "Branch type when using branching_model: development, production, feature, etc.", default: "" },
        value: { type: "number", description: "Numeric value (e.g., number of required approvals)", default: 0 }
      },
      required: ["repo_slug", "kind"]
    }
  },
  {
    name: "delete_branch_restriction",
    description: "Delete a branch restriction.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        restriction_id: { type: "number", description: "Restriction ID" }
      },
      required: ["repo_slug", "restriction_id"]
    }
  }
];
var handlers9 = {
  list_branch_restrictions: async (args) => {
    const client = getClient();
    const restrictions = await client.listBranchRestrictions(args.repo_slug, {
      limit: validateLimit(args.limit || 50)
    });
    return {
      restrictions: restrictions.map((r) => ({
        id: r.id,
        kind: r.kind,
        pattern: r.pattern,
        branch_match_kind: r.branch_match_kind,
        branch_type: r.branch_type,
        value: r.value
      }))
    };
  },
  create_branch_restriction: async (args) => {
    const client = getClient();
    const result = await client.createBranchRestriction(args.repo_slug, {
      kind: args.kind,
      pattern: args.pattern,
      branchMatchKind: args.branch_match_kind || "glob",
      branchType: args.branch_type || void 0,
      value: args.value || void 0
    });
    return {
      id: result.id,
      kind: result.kind
    };
  },
  delete_branch_restriction: async (args) => {
    const client = getClient();
    await client.deleteBranchRestriction(args.repo_slug, args.restriction_id);
    return {};
  }
};

// src/tools/source.ts
var definitions10 = [
  {
    name: "get_file_content",
    description: "Get the content of a file from a repository. Read file contents without cloning.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        path: { type: "string", description: 'File path (e.g., "src/main.py", "README.md")' },
        ref: { type: "string", description: 'Branch, tag, or commit hash (default: "main")', default: "main" }
      },
      required: ["repo_slug", "path"]
    }
  },
  {
    name: "list_directory",
    description: "List contents of a directory in a repository. Browse repository structure without cloning.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        path: { type: "string", description: "Directory path (empty string for root)", default: "" },
        ref: { type: "string", description: 'Branch, tag, or commit hash (default: "main")', default: "main" },
        limit: { type: "number", description: "Maximum entries (default: 100)", default: 100 }
      },
      required: ["repo_slug"]
    }
  }
];
var handlers10 = {
  get_file_content: async (args) => {
    const client = getClient();
    const ref = args.ref || "main";
    const content = await client.getFileContent(args.repo_slug, args.path, ref);
    if (content === null) {
      return { error: `File '${args.path}' not found at ref '${ref}'` };
    }
    return {
      path: args.path,
      ref,
      content,
      size: content.length
    };
  },
  list_directory: async (args) => {
    const client = getClient();
    const ref = args.ref || "main";
    const path = args.path || "";
    const entries = await client.listDirectory(args.repo_slug, path, {
      ref,
      limit: validateLimit(args.limit || 100)
    });
    return {
      path: path || "/",
      ref,
      entries: entries.map((e) => ({
        path: e.path,
        type: e.type === "commit_directory" ? "directory" : "file",
        size: e.size
      }))
    };
  }
};

// src/tools/permissions.ts
var definitions11 = [
  // User permissions
  {
    name: "list_user_permissions",
    description: "List user permissions for a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        limit: { type: "number", description: "Maximum results (default: 50)", default: 50 }
      },
      required: ["repo_slug"]
    }
  },
  {
    name: "get_user_permission",
    description: "Get a specific user's permission for a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        selected_user: { type: "string", description: "User's account_id or UUID" }
      },
      required: ["repo_slug", "selected_user"]
    }
  },
  {
    name: "update_user_permission",
    description: "Update or add a user's permission for a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        selected_user: { type: "string", description: "User's account_id or UUID" },
        permission: { type: "string", description: 'Permission level: "read", "write", or "admin"' }
      },
      required: ["repo_slug", "selected_user", "permission"]
    }
  },
  {
    name: "delete_user_permission",
    description: "Remove a user's explicit permission from a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        selected_user: { type: "string", description: "User's account_id or UUID" }
      },
      required: ["repo_slug", "selected_user"]
    }
  },
  // Group permissions
  {
    name: "list_group_permissions",
    description: "List group permissions for a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        limit: { type: "number", description: "Maximum results (default: 50)", default: 50 }
      },
      required: ["repo_slug"]
    }
  },
  {
    name: "get_group_permission",
    description: "Get a specific group's permission for a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        group_slug: { type: "string", description: "Group slug" }
      },
      required: ["repo_slug", "group_slug"]
    }
  },
  {
    name: "update_group_permission",
    description: "Update or add a group's permission for a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        group_slug: { type: "string", description: "Group slug" },
        permission: { type: "string", description: 'Permission level: "read", "write", or "admin"' }
      },
      required: ["repo_slug", "group_slug", "permission"]
    }
  },
  {
    name: "delete_group_permission",
    description: "Remove a group's explicit permission from a repository.",
    inputSchema: {
      type: "object",
      properties: {
        repo_slug: { type: "string", description: "Repository slug" },
        group_slug: { type: "string", description: "Group slug" }
      },
      required: ["repo_slug", "group_slug"]
    }
  }
];
var handlers11 = {
  list_user_permissions: async (args) => {
    const client = getClient();
    const permissions = await client.listUserPermissions(args.repo_slug, {
      limit: validateLimit(args.limit || 50)
    });
    return {
      users: permissions.map((p) => ({
        user: p.user?.display_name,
        account_id: p.user?.account_id,
        permission: p.permission
      }))
    };
  },
  get_user_permission: async (args) => {
    const client = getClient();
    const result = await client.getUserPermission(args.repo_slug, args.selected_user);
    if (!result) {
      return notFoundResponse("User permission", args.selected_user);
    }
    return {
      user: result.user?.display_name,
      account_id: result.user?.account_id,
      permission: result.permission
    };
  },
  update_user_permission: async (args) => {
    const client = getClient();
    const result = await client.updateUserPermission(
      args.repo_slug,
      args.selected_user,
      args.permission
    );
    return {
      user: result.user?.display_name,
      permission: result.permission
    };
  },
  delete_user_permission: async (args) => {
    const client = getClient();
    await client.deleteUserPermission(args.repo_slug, args.selected_user);
    return {};
  },
  list_group_permissions: async (args) => {
    const client = getClient();
    const permissions = await client.listGroupPermissions(args.repo_slug, {
      limit: validateLimit(args.limit || 50)
    });
    return {
      groups: permissions.map((p) => ({
        group: p.group?.name,
        slug: p.group?.slug,
        permission: p.permission
      }))
    };
  },
  get_group_permission: async (args) => {
    const client = getClient();
    const result = await client.getGroupPermission(args.repo_slug, args.group_slug);
    if (!result) {
      return notFoundResponse("Group permission", args.group_slug);
    }
    return {
      group: result.group?.name,
      slug: result.group?.slug,
      permission: result.permission
    };
  },
  update_group_permission: async (args) => {
    const client = getClient();
    const result = await client.updateGroupPermission(
      args.repo_slug,
      args.group_slug,
      args.permission
    );
    return {
      group: result.group?.name,
      permission: result.permission
    };
  },
  delete_group_permission: async (args) => {
    const client = getClient();
    await client.deleteGroupPermission(args.repo_slug, args.group_slug);
    return {};
  }
};

// src/tools/projects.ts
var definitions12 = [
  {
    name: "list_projects",
    description: "List projects in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum results (default: 50)", default: 50 }
      },
      required: []
    }
  },
  {
    name: "get_project",
    description: "Get information about a specific project.",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string", description: 'Project key (e.g., "DS", "PROJ")' }
      },
      required: ["project_key"]
    }
  }
];
var handlers12 = {
  list_projects: async (args) => {
    const client = getClient();
    const projects = await client.listProjects({
      limit: validateLimit(args.limit || 50)
    });
    return {
      projects: projects.map((p) => ({
        key: p.key,
        name: p.name,
        description: p.description
      }))
    };
  },
  get_project: async (args) => {
    const client = getClient();
    const result = await client.getProject(args.project_key);
    if (!result) {
      return notFoundResponse("Project", args.project_key);
    }
    return {
      key: result.key,
      name: result.name,
      description: result.description,
      uuid: result.uuid
    };
  }
};

// src/tools/index.ts
var toolDefinitions = [
  // Repository tools
  ...definitions,
  // Pull request tools
  ...definitions2,
  // Pipeline tools
  ...definitions3,
  // Branch tools
  ...definitions4,
  // Commit tools
  ...definitions5,
  // Deployment tools
  ...definitions6,
  // Webhook tools
  ...definitions7,
  // Tag tools
  ...definitions8,
  // Branch restriction tools
  ...definitions9,
  // Source browsing tools
  ...definitions10,
  // Permission tools
  ...definitions11,
  // Project tools
  ...definitions12
];
async function handleToolCall(name, args) {
  if (name in handlers) {
    return await handlers[name](args);
  }
  if (name in handlers2) {
    return await handlers2[name](args);
  }
  if (name in handlers3) {
    return await handlers3[name](args);
  }
  if (name in handlers4) {
    return await handlers4[name](args);
  }
  if (name in handlers5) {
    return await handlers5[name](args);
  }
  if (name in handlers6) {
    return await handlers6[name](args);
  }
  if (name in handlers7) {
    return await handlers7[name](args);
  }
  if (name in handlers8) {
    return await handlers8[name](args);
  }
  if (name in handlers9) {
    return await handlers9[name](args);
  }
  if (name in handlers10) {
    return await handlers10[name](args);
  }
  if (name in handlers11) {
    return await handlers11[name](args);
  }
  if (name in handlers12) {
    return await handlers12[name](args);
  }
  throw new Error(`Unknown tool: ${name}`);
}

// src/resources.ts
var resourceDefinitions = [
  {
    uri: "bitbucket://repositories",
    name: "Repositories",
    description: "List all repositories in the workspace",
    mimeType: "text/markdown"
  },
  {
    uri: "bitbucket://repositories/{repo_slug}",
    name: "Repository Details",
    description: "Get detailed information about a specific repository",
    mimeType: "text/markdown"
  },
  {
    uri: "bitbucket://repositories/{repo_slug}/branches",
    name: "Repository Branches",
    description: "List branches in a repository",
    mimeType: "text/markdown"
  },
  {
    uri: "bitbucket://repositories/{repo_slug}/pull-requests",
    name: "Pull Requests",
    description: "List open pull requests in a repository",
    mimeType: "text/markdown"
  },
  {
    uri: "bitbucket://projects",
    name: "Projects",
    description: "List all projects in the workspace",
    mimeType: "text/markdown"
  }
];
async function handleResourceRead(uri) {
  const client = getClient();
  if (uri === "bitbucket://repositories") {
    return await resourceRepositories(client);
  }
  if (uri === "bitbucket://projects") {
    return await resourceProjects(client);
  }
  const repoMatch = uri.match(/^bitbucket:\/\/repositories\/([^/]+)$/);
  if (repoMatch) {
    return await resourceRepository(client, repoMatch[1]);
  }
  const branchesMatch = uri.match(/^bitbucket:\/\/repositories\/([^/]+)\/branches$/);
  if (branchesMatch) {
    return await resourceBranches(client, branchesMatch[1]);
  }
  const prsMatch = uri.match(/^bitbucket:\/\/repositories\/([^/]+)\/pull-requests$/);
  if (prsMatch) {
    return await resourcePullRequests(client, prsMatch[1]);
  }
  throw new Error(`Unknown resource URI: ${uri}`);
}
async function resourceRepositories(client) {
  const repos = await client.listRepositories({ limit: 50 });
  const lines = [`# Repositories in ${client.workspace}`, ""];
  for (const r of repos) {
    const name = r.name || "unknown";
    const desc = (r.description || "").substring(0, 50) || "No description";
    const icon = r.is_private ? "\u{1F512}" : "\u{1F310}";
    lines.push(`- ${icon} **${name}**: ${desc}`);
  }
  return lines.join("\n");
}
async function resourceRepository(client, repoSlug) {
  const repo = await client.getRepository(repoSlug);
  if (!repo) {
    return `Repository '${repoSlug}' not found`;
  }
  const lines = [
    `# ${repo.name || repoSlug}`,
    "",
    `**Description**: ${repo.description || "No description"}`,
    `**Private**: ${repo.is_private ? "Yes" : "No"}`,
    `**Project**: ${repo.project?.name || "None"}`,
    `**Main branch**: ${repo.mainbranch?.name || "main"}`,
    "",
    "## Clone URLs"
  ];
  for (const clone of repo.links?.clone || []) {
    lines.push(`- ${clone.name}: \`${clone.href}\``);
  }
  return lines.join("\n");
}
async function resourceBranches(client, repoSlug) {
  const branches = await client.listBranches(repoSlug, { limit: 30 });
  const lines = [`# Branches in ${repoSlug}`, ""];
  for (const b of branches) {
    const name = b.name || "unknown";
    const commit = (b.target?.hash || "").substring(0, 7);
    lines.push(`- **${name}** (${commit})`);
  }
  return lines.join("\n");
}
async function resourcePullRequests(client, repoSlug) {
  const prs = await client.listPullRequests(repoSlug, { state: "OPEN", limit: 20 });
  const lines = [`# Open Pull Requests in ${repoSlug}`, ""];
  if (prs.length === 0) {
    lines.push("No open pull requests");
  }
  for (const pr of prs) {
    const prId = pr.id;
    const title = pr.title || "Untitled";
    const author = pr.author?.display_name || "Unknown";
    lines.push(`- **#${prId}**: ${title} (by ${author})`);
  }
  return lines.join("\n");
}
async function resourceProjects(client) {
  const projects = await client.listProjects({ limit: 50 });
  const lines = [`# Projects in ${client.workspace}`, ""];
  for (const p of projects) {
    const key = p.key || "?";
    const name = p.name || "Unknown";
    const desc = (p.description || "").substring(0, 40) || "No description";
    lines.push(`- **${key}** - ${name}: ${desc}`);
  }
  return lines.join("\n");
}

// src/prompts.ts
var promptDefinitions = [
  {
    name: "code_review",
    description: "Generate a code review prompt for a pull request",
    arguments: [
      {
        name: "repo_slug",
        description: "Repository slug",
        required: true
      },
      {
        name: "pr_id",
        description: "Pull request ID",
        required: true
      }
    ]
  },
  {
    name: "release_notes",
    description: "Generate release notes from commits between two refs",
    arguments: [
      {
        name: "repo_slug",
        description: "Repository slug",
        required: true
      },
      {
        name: "base_tag",
        description: 'Base tag or commit (e.g., "v1.0.0")',
        required: true
      },
      {
        name: "head",
        description: 'Head ref (default: "main")',
        required: false
      }
    ]
  },
  {
    name: "pipeline_debug",
    description: "Debug a failed pipeline",
    arguments: [
      {
        name: "repo_slug",
        description: "Repository slug",
        required: true
      }
    ]
  },
  {
    name: "repo_summary",
    description: "Get a comprehensive summary of a repository",
    arguments: [
      {
        name: "repo_slug",
        description: "Repository slug",
        required: true
      }
    ]
  }
];
function handlePromptGet(name, args) {
  switch (name) {
    case "code_review":
      return promptCodeReview(args.repo_slug, args.pr_id);
    case "release_notes":
      return promptReleaseNotes(args.repo_slug, args.base_tag, args.head || "main");
    case "pipeline_debug":
      return promptPipelineDebug(args.repo_slug);
    case "repo_summary":
      return promptRepoSummary(args.repo_slug);
    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}
function promptCodeReview(repoSlug, prId) {
  const content = `Please review pull request #${prId} in repository '${repoSlug}'.

Use the following tools to gather information:
1. get_pull_request(repo_slug="${repoSlug}", pr_id=${prId}) - Get PR details
2. get_pr_diff(repo_slug="${repoSlug}", pr_id=${prId}) - Get the code changes
3. list_pr_comments(repo_slug="${repoSlug}", pr_id=${prId}) - See existing comments

Then provide a thorough code review covering:
- Code quality and readability
- Potential bugs or edge cases
- Security concerns
- Performance considerations
- Suggestions for improvement

If you find issues, use add_pr_comment() to leave feedback on specific lines.`;
  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: content
        }
      }
    ]
  };
}
function promptReleaseNotes(repoSlug, baseTag, head) {
  const content = `Generate release notes for repository '${repoSlug}' comparing ${baseTag} to ${head}.

Use these tools:
1. compare_commits(repo_slug="${repoSlug}", base="${baseTag}", head="${head}") - See changed files
2. list_commits(repo_slug="${repoSlug}", branch="${head}", limit=50) - Get recent commits

Organize the release notes into sections:
- **New Features**: New functionality added
- **Bug Fixes**: Issues that were resolved
- **Improvements**: Enhancements to existing features
- **Breaking Changes**: Changes that require user action

Format as markdown suitable for a GitHub/Bitbucket release.`;
  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: content
        }
      }
    ]
  };
}
function promptPipelineDebug(repoSlug) {
  const content = `Help debug pipeline failures in repository '${repoSlug}'.

Use these tools:
1. list_pipelines(repo_slug="${repoSlug}", limit=5) - Get recent pipeline runs
2. get_pipeline(repo_slug="${repoSlug}", pipeline_uuid="<uuid>") - Get pipeline details
3. get_pipeline_logs(repo_slug="${repoSlug}", pipeline_uuid="<uuid>") - Get step list
4. get_pipeline_logs(repo_slug="${repoSlug}", pipeline_uuid="<uuid>", step_uuid="<step>") - Get logs

Analyze the failures and provide:
- Root cause of the failure
- Specific error messages
- Recommended fixes
- Commands to re-run the pipeline if appropriate`;
  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: content
        }
      }
    ]
  };
}
function promptRepoSummary(repoSlug) {
  const content = `Provide a comprehensive summary of repository '${repoSlug}'.

Gather information using:
1. get_repository(repo_slug="${repoSlug}") - Basic repo info
2. list_branches(repo_slug="${repoSlug}", limit=10) - Active branches
3. list_pull_requests(repo_slug="${repoSlug}", state="OPEN") - Open PRs
4. list_pipelines(repo_slug="${repoSlug}", limit=5) - Recent CI/CD status
5. list_commits(repo_slug="${repoSlug}", limit=10) - Recent activity

Summarize:
- Repository description and purpose
- Current development activity
- Open pull requests needing attention
- CI/CD health
- Recent contributors`;
  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: content
        }
      }
    ]
  };
}

// src/index.ts
var VERSION = "0.10.0";
function createServer() {
  const server = new Server(
    {
      name: "bitbucket",
      version: VERSION
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      }
    }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolDefinitions
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleToolCall(name, args || {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: message }, null, 2)
          }
        ],
        isError: true
      };
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: resourceDefinitions
    };
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    try {
      const content = await handleResourceRead(uri);
      return {
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: content
          }
        ]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to read resource: ${message}`);
    }
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: promptDefinitions
    };
  });
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = handlePromptGet(name, args || {});
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to get prompt: ${message}`);
    }
  });
  return server;
}
async function main() {
  try {
    getSettings();
  } catch (error) {
    console.error("Configuration error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Bitbucket MCP Server v${VERSION} started`);
}
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
