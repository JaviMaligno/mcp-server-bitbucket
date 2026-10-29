# Repository history without a local Git checkout

Python and TypeScript expose the same history tools. All operations on this page
are read-only and use the caller's Bitbucket repository permissions.

| Question | Tool and arguments |
| --- | --- |
| What changed recently on a branch? | `list_commits(repo_slug, branch="main")` |
| What commits are in v2 but not v1? | `list_commits(repo_slug, include=["v2"], exclude=["v1"])` |
| What changed under a directory? | `list_commits(repo_slug, branch="main", path="src/")` |
| Who changed a file? | `list_commits(repo_slug, branch="main", path="src/app.py")` |
| Follow a file's revisions and older paths | `get_file_history(repo_slug, path="src/app.py", ref="main")`, then `get_commit` for author/message/date |
| What does a commit contain? | `get_commit(repo_slug, commit="<hash>")` |
| Which files differ between releases? | `compare_commits(repo_slug, base="v1", head="v2")` |
| Show the changed lines | `get_commit_diff(repo_slug, base="v1", head="v2", path="src/app.py")` |
| Where did branches diverge? | `get_merge_base(repo_slug, base="main", head="feature")` |
| Which commit does a tag identify? | `get_tag(repo_slug, tag_name="v2")` |
| Find tags by name | `list_tags(repo_slug, query='name ~ "v2"', sort="-name")` |
| Read a file at an old version | `get_file_content(repo_slug, path="README.md", ref="v1")` |

## Read every page

`list_commits`, `list_tags`, `compare_commits` and `get_file_history` return
`has_more` and `next_cursor` alongside their records. `limit` is the requested
page size (1–100), not a maximum history depth. Bitbucket can return smaller pages.

When `has_more` is true, repeat the same tool and required arguments with
`cursor=next_cursor`. Continue until `has_more` is false. Treat the cursor as
opaque: its original filters and page size are retained, and new optional
filters/limits are ignored while resuming. Never infer that a commit or tag does
not exist from its absence in one page. `get_tag` resolves a known tag directly.

Pagination links are restricted to the same Bitbucket API endpoint. A link to
another host, repository or resource is rejected before credentials are sent.
For file comparisons, each exact revision is resolved before using the 12-character hashes in
Bitbucket's continuation links. Pin `base` and `head` to hashes while paging;
if a branch moves between calls, its old cursor may be rejected rather than
silently changing the comparison.
Old low-level list methods also follow API pages up to their requested result
limit, while retaining their list return type.

## Comparisons and large diffs

Both comparison tools mean **base → head**, as in `git diff base head`. They set
Bitbucket's `topic=false` explicitly to compare those two snapshots, rather than
implicitly comparing against a merge base. `compare_commits` returns file
statistics; `get_commit_diff` returns the raw patch text.

Diff responses default to 20,000 characters per chunk (`max_chars` can be 1–100,000).
If `truncated` is true, call again with `offset=next_offset` and the same arguments.
`total_chars` describes the text returned by Bitbucket. Each chunk request fetches
the upstream diff again, so pin both revisions to commit hashes when reading
multiple chunks. Offsets are implementation-local string positions; pass the
returned offset unchanged to the same server implementation. Filtering by `path`
reduces upstream work and response size.

Bitbucket can reject an oversized diff with HTTP 555; pagination/chunking cannot
bypass that upstream limit. Restrict the comparison to a file in that case. Binary
changes may not contain a text patch. `get_merge_base` returns one best common
ancestor as provided by Bitbucket, even when several best ancestors exist.

Tags default to descending **target commit date**, which is not tag creation
order, semantic version precedence or proof of ancestry. `sort="name"` or
`sort="-name"` asks Bitbucket for natural name ordering. Use commit ancestry when
deciding which revision contains another.

## Transient failures

Both clients retry transient GET transport failures and HTTP 502/503/504, as well
as HTTP 429. Ambiguous write failures are never automatically replayed on network
errors or 5xx responses. `MAX_RETRIES` defaults to 3 and can be set to 0 to disable
retries. `API_TIMEOUT` defaults to 30 seconds and is shared across retry attempts;
remaining time caps subsequent attempts. HTTPX applies socket-operation timeouts,
so a continuously streaming Python response is not a hard wall-clock deadline.

Backoff sleeps total at most 15 seconds per request and must fit the remaining
timeout budget. Valid `Retry-After` values (seconds or HTTP dates) are honored;
an excessive wait returns an error promptly so the caller can retry later.
Malformed values use exponential backoff. A failed tool call does not require
restarting the MCP server. This improves recovery but does not diagnose unrelated
client shutdowns or guarantee uninterrupted transport.

The REST API does not expose a user's unpushed commits, working-tree changes or
local reflog. Long history scans consume API quota. See the official
[commits API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-commits/),
[refs API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-refs/),
[source API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-source/)
and [request limits](https://support.atlassian.com/bitbucket-cloud/docs/api-request-limits/).
