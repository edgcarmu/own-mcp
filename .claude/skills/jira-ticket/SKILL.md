---
name: jira-ticket
description: Guided wizard to create a Jira ticket step by step. Gathers project, issue type, priority, summary, description, assignment, sprint and labels interactively, shows a preview, and only creates the ticket after explicit confirmation via the fabi-local-mcp MCP server. After creation, offers to add a follow-up comment to the new ticket.
---

# /jira-ticket — guided Jira ticket creation wizard

You are the UX/orchestration layer ONLY. All Jira access goes through the `fabi-local-mcp` MCP tools (`mcp__fabi-local-mcp__*`). Never call the Jira REST API directly from this wizard, and never hardcode project keys, board IDs, sprint IDs, user IDs, priorities, or credentials — always use what the MCP tools return.

Interact in the language the user is using in the conversation. If the `fabi-local-mcp` tools are unavailable, say so and stop (suggest checking `/mcp`).

## Flow

Use AskUserQuestion for every choice — it renders an interactive picker, and its built-in "Other" option lets the user type a free-form value. It supports at most 4 questions per call and 2–4 options per question, so bundle steps as described below to keep the wizard snappy. Mark defaults with "(Recommended)" as the first option.

### 1. Project
- Call `list-jira-projects` — never assume the project list.
- Ask for the project with AskUserQuestion: offer the most likely 3–4 projects (prioritize any project mentioned in the current conversation, then frequently used ones). The user can pick any other via "Other" — match their free text against the real list before continuing.

### 2. Fetch project data
After the project is chosen, call in parallel:
- `list-jira-issue-types` with the chosen project
- `list-jira-priorities`
- `list-jira-active-sprints` with the chosen project

### 3. Issue type, priority, assignment, sprint — ONE AskUserQuestion call with 4 questions
- **Issue Type**: offer up to 4 of the real issue types, ordering Task, Bug, Story first when they exist. Recommend Task unless the conversation clearly describes a defect (then Bug).
- **Priority**: offer up to 4 of the real priority names (drop the least likely one if there are 5). If the user thinks in Highest/High/Medium/Low/Lowest but the instance uses Blocker/Critical/Major/Minor/Trivial, map: Highest→Blocker, High→Critical, Medium→Major, Low→Minor, Lowest→Trivial. Recommend a priority from the conversation's severity; otherwise the middle one.
- **Assign**: "Me (Recommended)" / "Unassigned".
- **Sprint**: "Current sprint (Recommended)" / "Backlog". Put the actual active sprint name (the one with `matchesProject: true`, or the only one) in the option description so the user sees where it will land.

If `list-jira-active-sprints` shows multiple boards, or multiple active sprints none/several of which have `matchesProject: true`, ask a follow-up AskUserQuestion listing the actual boards/sprints so the user picks one. Remember the chosen board/sprint for the creation call.

### 4. Summary
- If the conversation already provides context, propose a concise summary (imperative mood, ≤ ~80 chars) as the recommended option; the user can edit or replace it via "Other".
- With no prior context, ask the user to type the title (via "Other").

### 5. Description
- Draft a professional, Jira-ready description from the conversation. Preserve technical details verbatim when available: SQL queries, error messages, endpoints, table names, reproduction steps, expected outcomes. Structure it (context/objective, scope or steps, expected outcome).
- Show the full draft in the chat, then ask: "Use this description?" → "Use as is (Recommended)" / "Edit". If Edit, apply the requested changes and re-confirm.

### 6. Labels (optional)
- AskUserQuestion with multiSelect: offer "No labels (Recommended)" plus 2–3 labels suggested from context if any make sense; custom labels via "Other".

### 7. Preview
Print a clean summary block in the chat before creating anything:

> **Project:** … · **Type:** … · **Priority:** …
> **Assignee:** … · **Sprint:** … · **Labels:** …
> **Summary:** …
> **Description:** (full text)

### 8. Confirmation
AskUserQuestion: "Create this Jira ticket?" → "Create" / "Edit" / "Cancel".
- **Edit**: ask which field to change, redo that step only, then show the preview again.
- **Cancel**: stop; create nothing.

### 9. Creation
Only after an explicit "Create": call `create-jira-ticket` exactly once with the collected values — `project`, `summary`, `description`, `issueType`, `priority`, `labels` (omit if empty), `assignToMe`, `addToCurrentSprint` (false for Backlog), and `board`/`sprint` only when step 3 required disambiguation. Never create more than one ticket per run.

### 10. Result
Report concisely: ticket key linked to its Jira URL, project, assignee, sprint. If the result contains a `warning` (ticket created but sprint assignment failed), state it and offer to fix the sprint.

### 11. Follow-up comment (optional)
Right after reporting the result, offer to add a comment to the new ticket with a single AskUserQuestion: "Add a comment to <KEY>?" → "No comment (Recommended)" / "Add a comment".
- Only suggest "Add a comment" as the recommended option when the conversation contains material that clearly belongs in a comment rather than the description: links to PRs/branches/commits, a first status update, findings gathered while drafting, or notes for the assignee.
- If the user chooses to add one: draft the comment from the conversation (plain text; keep technical details verbatim), show the full draft in the chat, then confirm with "Post this comment?" → "Post (Recommended)" / "Edit" / "Skip". If Edit, apply the changes and re-confirm.
- Only after an explicit "Post": call `add-jira-comment` with `issueKey` set to the key returned by `create-jira-ticket` and `comment` set to the confirmed text. Never post more than one comment per run without asking again.
- Report the result with the comment URL (`url` from the tool response). If the call fails, show the error and leave the ticket as is — do not retry automatically.

## Extension notes
- `/jira-bug`, `/jira-task`, `/jira-story`: same flow with the issue type pre-selected (skip that question).
- Comments use `add-jira-comment` (step 11). It also works standalone: if the user invokes this skill only to comment on an existing ticket (e.g. `/jira-ticket comment DEV-123 …`), skip steps 1–10 and run step 11 with the given key, still confirming the draft before posting.
- New Jira capabilities (field updates, transitions, assignee search) belong in `fabi-local-mcp` as new tools; this skill stays orchestration-only.
