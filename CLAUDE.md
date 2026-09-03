# fabi-local-mcp

Local MCP server (TypeScript, Node 22, stdio) exposing Jira Cloud tools. See README.md for the tool list and setup.

## Commands

- `npm run check` before committing: typecheck plus unit tests.
- `npm test` runs `node:test` files matching `src/**/*.test.ts`. Tests never call the network; they stub `globalThis.fetch`.
- `npx tsx src/test-jira.ts` is a manual credential check against the real instance.

## Conventions

- STDOUT is the MCP transport. Never `console.log` in server code; use `console.error` (or `JIRA_DEBUG=1` logging in `src/jira/client.ts`).
- One Jira endpoint per function in `src/jira/api.ts`; tools in `src/tools/jira.ts` only orchestrate and shape output.
- Anything that takes a human-facing name (project, board, sprint, transition, user, link type) goes through a resolver in `src/jira/resolvers.ts` that throws an error listing the valid options.
- Write tools read the entity back and report Jira's stored state. They return `changed: false` instead of failing when the requested state is already true.
- Issue keys are validated and normalized with `normalizeIssueKey` in `src/tools/jira.ts`.
- Descriptions and comments are sent as ADF via `createJiraDescription` and read back as plain text via `adfToText`.
- Server version comes from `package.json`; bump it there when adding tools.

## Verifying against real Jira

Read-only tools can be exercised live over stdio (see the JSON-RPC snippets in git history). Do not run write tools against real tickets to test them; verify the request shape with types and unit tests instead.

## Skills

`.claude/skills/jira-ticket` and `.claude/skills/jira-work` are the canonical copies; `~/.claude/skills/*` are symlinks to them. Edit here and commit.
