---
name: jira-work
description: Single entry point for Jira via the own-mcp MCP server. Creates tickets with a guided wizard, works on existing tickets end to end (brief, In Progress, assignment, sprint, wrap-up comment and transition), comments on a ticket, and lists what you are working on. Use for "create a ticket", "work on DEV-123", "pick up a ticket", "what am I working on", "comment on DEV-123", or "close/finish DEV-123".
---

# /jira-work — create and work on Jira tickets

You are the UX/orchestration layer ONLY. All Jira access goes through the `own-mcp` MCP tools (`mcp__own-mcp__*`). Never call the Jira REST API directly, and never hardcode project keys, board IDs, sprint IDs, user IDs, statuses, or credentials — always use what the tools return.

Interact in the language the user is using. If the `own-mcp` tools are unavailable, say so and stop (suggest checking `/mcp`).

## Common rules

- Use AskUserQuestion for every choice — it renders an interactive picker and its built-in "Other" option lets the user type a free-form value. It supports at most 4 questions per call and 2–4 options per question, so bundle related questions. Mark defaults with "(Recommended)" as the first option.
- Every write to Jira (create, comment, status change, assignment, sprint, subtask, link, field update) happens only after an explicit confirmation. Reads are free: call them whenever they help.
- Never create more than one ticket, post more than one comment, or transition more than once per run without asking again.
- If a Jira call fails, show the tool error (it usually lists the valid options) and offer to retry with a corrected value; never retry silently.

## Modes

Pick the mode from the arguments and the conversation, then read the file for that mode and follow it.

| Mode | Triggers | File |
| --- | --- | --- |
| **New** | `/jira-work new …`, "create a ticket", "open a bug for this", or any request to file something that does not exist yet | `create.md` |
| **Work** | `/jira-work DEV-123`, `/jira-work` with no arguments, "let's work on …", "pick up a ticket" | `work.md` (Phases 1–3) |
| **Finish** | `/jira-work done`, `/jira-work close DEV-123`, "I'm done with the ticket" | `work.md` (Phase 4) |
| **Status** | "what am I working on", "my tickets", `/jira-work status` | `work.md` (Phases 1–2, then stop) |
| **Comment** | `/jira-work comment DEV-123 …`, "add a note to DEV-123" | inline, below |

When the request is ambiguous between New and Work (e.g. "handle the login bug"), search first with `search-jira-issues` (`text`, `assignedToMe`) and offer the matches; only propose creating a new ticket when nothing fits.

### Comment mode
1. Draft the comment from the conversation and any text given after the key. Plain text; keep technical details verbatim. Show the full draft.
2. AskUserQuestion: "Post this comment on <KEY>?" → "Post (Recommended)" / "Edit" / "Cancel". If Edit, apply the changes and show the draft again.
3. Only after "Post": call `add-jira-comment`. Report the comment URL.

## Extension notes
- New Jira capabilities belong in `own-mcp` as tools; this skill stays orchestration-only.
- Keep `SKILL.md` short: it is loaded on every invocation. Mode details go in the mode files.
