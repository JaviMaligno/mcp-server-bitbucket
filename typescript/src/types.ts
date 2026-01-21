/**
 * Type definitions for Bitbucket MCP Server
 */

// ==================== CONFIGURATION ====================

export interface BitbucketConfig {
  workspace: string;
  email: string;
  apiToken: string;
  timeout?: number;
  maxRetries?: number;
}

// ==================== API RESPONSE TYPES ====================

export interface BitbucketUser {
  display_name: string;
  uuid: string;
  account_id?: string;
  links?: {
    avatar?: { href: string };
    html?: { href: string };
  };
}

export interface BitbucketProject {
  key: string;
  name: string;
  description?: string;
  uuid?: string;
  links?: {
    html?: { href: string };
  };
}

export interface CloneLink {
  name: string;
  href: string;
}

export interface BitbucketRepository {
  uuid: string;
  name: string;
  full_name: string;
  description?: string;
  is_private: boolean;
  project?: BitbucketProject;
  mainbranch?: { name: string };
  links?: {
    clone?: CloneLink[];
    html?: { href: string };
  };
  created_on?: string;
  updated_on?: string;
}

export interface BitbucketBranch {
  name: string;
  target?: {
    hash: string;
    message?: string;
    author?: {
      raw?: string;
      user?: BitbucketUser;
    };
    date?: string;
  };
}

export interface BitbucketCommit {
  hash: string;
  message?: string;
  author?: {
    raw?: string;
    user?: BitbucketUser;
  };
  date?: string;
  parents?: { hash: string }[];
}

export interface BitbucketPullRequest {
  id: number;
  title: string;
  description?: string;
  state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
  author?: BitbucketUser;
  source?: {
    branch?: { name: string };
    commit?: { hash: string };
  };
  destination?: {
    branch?: { name: string };
    commit?: { hash: string };
  };
  reviewers?: BitbucketUser[];
  participants?: {
    user: BitbucketUser;
    approved: boolean;
    role: string;
  }[];
  close_source_branch?: boolean;
  merge_commit?: { hash: string };
  created_on?: string;
  updated_on?: string;
  links?: {
    html?: { href: string };
    diff?: { href: string };
  };
}

export interface BitbucketPipeline {
  uuid: string;
  build_number?: number;
  state?: {
    name: string;
    result?: { name: string };
  };
  target?: {
    ref_name?: string;
    ref_type?: string;
  };
  created_on?: string;
  completed_on?: string;
  duration_in_seconds?: number;
}

export interface BitbucketPipelineStep {
  uuid: string;
  name?: string;
  state?: {
    name: string;
    result?: { name: string };
  };
  started_on?: string;
  completed_on?: string;
  duration_in_seconds?: number;
}

export interface BitbucketPipelineVariable {
  uuid: string;
  key: string;
  value?: string;
  secured: boolean;
}

// ==================== PIPELINE TRIGGER OPTIONS ====================

export interface PipelineTriggerVariable {
  key: string;
  value: string;
  secured?: boolean;
}

export interface TriggerPipelineOptions {
  branch?: string;
  commit?: string;
  customPipeline?: string;
  variables?: PipelineTriggerVariable[] | Record<string, string>;
}

export interface BitbucketEnvironment {
  uuid: string;
  name: string;
  environment_type?: { name: string };
  rank?: number;
  restrictions?: unknown;
  lock?: unknown;
}

export interface BitbucketDeployment {
  uuid: string;
  environment?: BitbucketEnvironment;
  state?: {
    name: string;
    started_on?: string;
    completed_on?: string;
  };
  release?: {
    commit?: { hash: string };
    pipeline?: { uuid: string };
  };
}

export interface BitbucketWebhook {
  uuid: string;
  url: string;
  description?: string;
  events: string[];
  active: boolean;
  created_at?: string;
}

export interface BitbucketTag {
  name: string;
  message?: string;
  target?: {
    hash: string;
    date?: string;
  };
  tagger?: {
    raw?: string;
    date?: string;
  };
}

export interface BitbucketBranchRestriction {
  id: number;
  kind: string;
  pattern?: string;
  branch_match_kind?: string;
  branch_type?: string;
  value?: number;
  users?: BitbucketUser[];
  groups?: BitbucketGroup[];
}

export interface BitbucketGroup {
  slug: string;
  name: string;
}

export interface BitbucketComment {
  id: number;
  content?: {
    raw?: string;
    markup?: string;
    html?: string;
  };
  user?: BitbucketUser;
  created_on?: string;
  updated_on?: string;
  inline?: {
    path?: string;
    from?: number;
    to?: number;
  };
}

export interface BitbucketCommitStatus {
  key: string;
  state: 'SUCCESSFUL' | 'FAILED' | 'INPROGRESS' | 'STOPPED';
  name?: string;
  description?: string;
  url?: string;
  created_on?: string;
  updated_on?: string;
}

export interface DirectoryEntry {
  path: string;
  type: 'commit_file' | 'commit_directory';
  size?: number;
}

export interface UserPermission {
  user: BitbucketUser;
  permission: 'read' | 'write' | 'admin';
}

export interface GroupPermission {
  group: BitbucketGroup;
  permission: 'read' | 'write' | 'admin';
}

// ==================== PAGINATED RESPONSE ====================

export interface PaginatedResponse<T> {
  values: T[];
  page?: number;
  pagelen?: number;
  size?: number;
  next?: string;
  previous?: string;
}

// ==================== TOOL RESPONSE TYPES ====================

export interface RepositorySummary {
  name: string;
  full_name: string;
  private: boolean;
  project?: string;
  description?: string;
}

export interface RepositoryDetail extends RepositorySummary {
  clone_urls: {
    https?: string;
    ssh?: string;
    html?: string;
  };
  main_branch?: string;
  created?: string;
  updated?: string;
}

export interface PullRequestSummary {
  id: number;
  title: string;
  state: string;
  author?: string;
  source_branch?: string;
  destination_branch?: string;
  url?: string;
}

export interface PullRequestDetail extends PullRequestSummary {
  description?: string;
  reviewers?: string[];
  approvals?: number;
  created?: string;
  updated?: string;
}

export interface PipelineSummary {
  uuid: string;
  build_number?: number;
  state?: string;
  result?: string;
  branch?: string;
  created?: string;
}

export interface PipelineDetail extends PipelineSummary {
  duration?: number;
  completed?: string;
}

export interface BranchSummary {
  name: string;
  commit?: string;
  message?: string;
  date?: string;
}

export interface CommitSummary {
  hash: string;
  message?: string;
  author?: string;
  date?: string;
}

export interface CommitDetail extends CommitSummary {
  parents?: string[];
}

// ==================== ENUMS ====================

export enum PRState {
  OPEN = 'OPEN',
  MERGED = 'MERGED',
  DECLINED = 'DECLINED',
  SUPERSEDED = 'SUPERSEDED',
}

export enum MergeStrategy {
  MERGE_COMMIT = 'merge_commit',
  SQUASH = 'squash',
  FAST_FORWARD = 'fast_forward',
}

export enum CommitStatusState {
  SUCCESSFUL = 'SUCCESSFUL',
  FAILED = 'FAILED',
  INPROGRESS = 'INPROGRESS',
  STOPPED = 'STOPPED',
}

