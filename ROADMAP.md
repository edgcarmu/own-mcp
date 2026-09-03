# Roadmap

Where `own-mcp` goes next. The goal is a personal MCP server that lets a developer, or an agent acting for them, read and work on their projects end to end: the ticket, the code, the data, and the environments.

Status as of 2026-09-02: 18 tools (16 Jira, 2 system) and the `/jira-work` skill. The Jira lifecycle is covered: search, read, create, comment, edit, assign, transition, sprint, links, subtasks.

## Principles

- **Read-only first.** Every area starts with read tools. Write tools come later and always confirm through the skill layer.
- **Names, not IDs.** Anything a person would type by name is resolved server-side with an error that lists the valid options.
- **Secrets stay in `.env`.** Connection strings, tokens and hosts are configured on the machine, never passed through the model.
- **Report stored state.** After a write, read the entity back and return what the system actually has.
- **Small tools, one job each.** Orchestration and multi-step flows belong in skills.

Effort scale: **S** under half a day, **M** one to two days, **L** more than that.

## Phase 1 — The map: projects and activity

Give the agent a picture of what projects exist and what is happening in them. Everything later builds on the registry.

### 1.1 Project registry — S

A `projects.json` (git-ignored, with a committed example) listing each project: name, local path, repository URL, stack, run and test commands, Jira project key, environment URLs. Tools:

- `list-projects` — names, stacks, Jira keys.
- `get-project` — full entry for one project, resolved by name or Jira key.

Why: today this knowledge lives in the developer's head. With it, `/jira-work PP-1450` can know which folder to open and how to run the app, and an agent can be told "work on Percy" without a path.

Depends on: nothing. Enables: 1.2, 2.2, 2.3, and the skill hand-off from ticket to code.

### 1.2 Cross-repo git activity — S

- `list-git-activity` — commits by the current user and active branches across all registered projects since a date, optionally filtered by project or by ticket key found in branch or commit messages.

Why: combined with Jira activity it produces the standup automatically: what was touched, in which ticket, what is still open.

Depends on: 1.1.

### 1.3 Client robustness — S

- Retry with backoff on HTTP 429 (honouring `Retry-After`) and 5xx in `jiraFetch`.
- In-memory cache with a short TTL for lists that rarely change: projects, priorities, issue types, link types.

Why: resolvers hit these endpoints on every call; Jira Cloud rate-limits under load. No tool changes.

## Phase 2 — The data: databases, logs, APIs

Let the agent look at real data and behaviour while debugging, without leaving Claude Code.

### 2.1 Read-only database access — M

Connection profiles in `.env` (local, staging), each backed by a database user with read-only grants. Tools:

- `list-db-profiles`, `list-tables`, `describe-table` — schema discovery.
- `run-query` — SELECT only, enforced row limit and timeout, results as rows plus column metadata.
- `explain-query` — execution plan.

Why: most bug reports (missing notifications, wrong totals, stale data) are diagnosed by looking at rows. This is the single biggest step in what an agent can figure out on its own.

Open question: MySQL, Postgres, or both. Driver choice follows from the answer.

### 2.2 Application logs — M

- `tail-logs` — last N entries of a project's log, parsed (timestamp, level, message, context) for known formats: Laravel, Workers `wrangler tail`, plain JSON lines.
- `search-logs` — filter by level, text and time window.

Why: pairs with 2.1 for debugging; structured entries are far cheaper for the model than raw text.

Depends on: 1.1 for log locations.

### 2.3 API profiles — M

- `list-api-profiles` — configured environments (name, base URL, auth type).
- `call-api` — method, path, body, profile; host restricted to the profile's base URL; secrets injected server-side.

Why: reproduce a bug against staging, or verify a new endpoint, without pasting tokens into the chat.

Depends on: 1.1 for environment URLs.

## Phase 3 — Jira depth

Round out Jira with context and team views. All read-only except attachments and epics.

### 3.1 Confluence — M

Same Atlassian token, no new configuration.

- `search-confluence-pages`, `get-confluence-page` — page as plain text (reuse the ADF converter).
- Later: `create-confluence-page` for documenting a closed ticket.

Why: tickets link to specs, runbooks and decisions the agent cannot read today.

### 3.2 Sprint summary and activity — S

- `get-jira-sprint-summary` — active sprint grouped by status and assignee, with blocked and unassigned issues called out.
- `list-jira-activity` — issues assigned to, reported by or mentioning the user with changes or comments since a date.

Why: turns `/jira-work status` from "my tickets" into "what happened since yesterday". Combined with 1.2 it is the standup.

### 3.3 Attachments — S

- `attach-jira-file` — upload a local file (screenshot, log, command output) to an issue. Multipart endpoint; the only non-JSON call in the client.

Why: bugs filed from Claude Code can carry evidence.

### 3.4 Epics and bulk creation — M

- `parent` option on `create-jira-ticket` to file under an epic.
- `list-jira-epic-issues` — children of an epic with status.
- `create-jira-tickets` — bulk endpoint (up to 50) for breaking an epic into tasks in one confirmed call.

Why: planning larger work, not just single tickets.

## Phase 4 — Nice to have

Valuable but conditional on stack or lower marginal gain.

- **Error tracking (Sentry or similar)** — M. Recent errors per project, cross-referenced with tickets. Only if a service is in use.
- **Local services** — S. Docker and dev-process status, logs and restart. The CLI already covers most of this.
- **MCP resources and prompts** — S. Expose `jira://issue/KEY` as a resource for `@` mentions and a "standup" prompt. Polish rather than capability.
- **Worklog** — S. `log-jira-work` if the team tracks time.
- **Bitbucket or GitHub PR links** — M. Link pull requests to tickets and show review state in the brief.

## Suggested order

1. Phase 1 in one batch: registry, git activity, client robustness. All small, and 1.1 unblocks everything else.
2. 2.1 read-only database, then 3.2 sprint summary and activity. Together they change what the agent can know.
3. 3.1 Confluence and 2.2 logs.
4. The rest by demand.

## Open questions

- Which databases are in use (MySQL, Postgres) and whether staging is reachable from the workstation.
- Whether a production error-tracking service exists.
- Whether the team logs time in Jira.
- Where pull requests live (Bitbucket, GitHub) and whether linking them to tickets matters.
- Whether the registry should be one file per machine or shared in a private repo.

## Out of scope

- Jira project creation and administration.
- Write access to databases through the MCP server.
- Anything that stores credentials outside `.env` on the developer's machine.
