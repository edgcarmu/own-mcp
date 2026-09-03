# own-mcp

A local [MCP](https://modelcontextprotocol.io) server that exposes Jira Cloud to Claude Code and other MCP clients, so a developer or an agent can read, create, and work on tickets in natural language.

Tools resolve projects, boards, sprints, transitions, users, and link types by **name**, return Jira descriptions and comments as **plain text**, and report **what Jira actually stored** after every write. Failed calls include Jira's own error message and, where it helps, the list of valid options.

## Setup

Requirements: Node 22+ and a Jira Cloud account with an API token.

```bash
git clone git@github.com:edgcarmu/own-mcp.git own-mcp
cd own-mcp
npm install
cp .env.example .env   # then fill in JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
npm run check          # typecheck + unit tests
```

The server reads `.env` from its own directory, so it works no matter where the MCP client launches it from.

### Register in Claude Code

```bash
claude mcp add own-mcp -- /absolute/path/to/own-mcp/node_modules/.bin/tsx /absolute/path/to/own-mcp/src/index.ts
```

Check with `/mcp` inside Claude Code. Restart the server after pulling changes that add tools.

For other clients, use the same command and arguments in their MCP configuration. The server speaks stdio; STDOUT is reserved for the protocol and diagnostics go to STDERR.

## Tools

### Discovery

| Tool | What it does |
| --- | --- |
| `get-jira-current-user` | Authenticated user and base URL. Confirms the connection. |
| `list-jira-projects` | Projects visible to the user, optionally filtered by name or key. |
| `list-jira-issue-types` | Standard issue types of a project. |
| `list-jira-priorities` | Priority names of the instance. |
| `list-jira-active-sprints` | Scrum boards of a project and their active sprints. |
| `list-jira-transitions` | Transitions currently available for an issue and the status each leads to. |

### Reading

| Tool | What it does |
| --- | --- |
| `get-jira-issue` | Full detail of one issue: description as text, status, assignee, sprint, links, subtasks, recent comments. |
| `search-jira-issues` | Raw JQL, or filters (`project`, `assignedToMe`, `onlyOpen`, `status`, `issueType`, `inActiveSprint`, `text`) turned into JQL. Paginates with `nextPageToken`. |

### Writing

| Tool | What it does |
| --- | --- |
| `create-jira-ticket` | Create an issue by project name or key, optionally self-assigned and added to the active sprint. |
| `create-jira-subtask` | Create a subtask under an issue; project and subtask type come from the parent. |
| `update-jira-issue` | Change summary, description, priority, issue type, or labels (replace, add, remove). |
| `add-jira-comment` | Add a plain-text comment. |
| `transition-jira-issue` | Move an issue to another status by target status name, transition name, or ID. Optional comment and resolution in the same call. |
| `assign-jira-issue` | Assign by display name, email, or account ID; also `me` and `unassigned`. |
| `add-jira-issue-to-sprint` | Move an existing issue into the active sprint, or back to the backlog. |
| `link-jira-issues` | Relate two issues as `<issue> <relation> <target>`, e.g. `DEV-1 "is blocked by" DEV-2`. |

Write tools are idempotent where it makes sense: transitioning to the current status, assigning the current assignee, or re-creating an existing link reports `changed: false` instead of erroring.

There are also two small system tools, `get-system-info` and `get-git-status`.

## Skill

One Claude Code skill in `.claude/skills/jira-work/` drives the tools with a confirmation before every write. `SKILL.md` is a short router; each mode lives in its own file so only what is needed gets loaded.

| Mode | Example | What happens |
| --- | --- | --- |
| New | `/jira-work new` or "create a bug for this" | Step-by-step wizard (`create.md`): project, type, priority, summary, description, assignment, sprint, labels, preview, create, optional comment, optional hand-off to Work. |
| Work | `/jira-work DEV-123` or `/jira-work` | Brief of the ticket, then offers In Progress, self-assignment, sprint and a git branch (`work.md`). |
| Finish | `/jira-work done` | Wrap-up comment and transition in one confirmed call. |
| Status | "what am I working on" | Lists your open tickets. |
| Comment | `/jira-work comment DEV-123 …` | Drafts, confirms and posts a comment. |

To use it from any project, symlink it into your global skills directory:

```bash
ln -sfn /absolute/path/to/own-mcp/.claude/skills/jira-work ~/.claude/skills/jira-work
```

## Development

```bash
npm run dev         # run the server on stdio
npm run typecheck   # tsc --noEmit
npm test            # node:test unit tests (*.test.ts next to the code)
npm run check       # both
```

Set `JIRA_DEBUG=1` to log every Jira request to STDERR. `JIRA_TIMEOUT_MS` changes the per-request timeout (default 30 s).

Layout:

```
src/
  index.ts          stdio entry point
  server.ts         registers tools; version comes from package.json
  env.ts            loads the project .env
  jira/
    client.ts       authenticated fetch with timeout and error formatting
    api.ts          one function per Jira endpoint
    resolvers.ts    name -> entity resolution with helpful errors
    adf.ts          Atlassian Document Format <-> plain text
    jql.ts          JQL builder for search filters
    types.ts        Jira response types
  tools/
    jira.ts         MCP tool definitions (schemas, orchestration, output shape)
    system.ts       local machine tools
    results.ts      MCP result helpers
```

Adding a Jira capability follows the same path: endpoint in `api.ts`, resolver if names are involved, tool in `tools/jira.ts`, unit tests for anything pure, then read the entity back in the tool so the response reflects Jira's state.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for planned areas: project registry, read-only database access, logs, Confluence, sprint summaries and more.

## Smoke test against a real instance

The unit tests never touch the network. To verify credentials, run:

```bash
npx tsx src/test-jira.ts
```
