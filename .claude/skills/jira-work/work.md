# Work mode

Phases for working on an existing ticket. Loaded by `/jira-work` SKILL.md; the common rules there apply.

## Phase 1. Pick the ticket

- If a key like `DEV-123` is given (case-insensitive), call `get-jira-issue` with it.
- Otherwise call `search-jira-issues` with `assignedToMe: true`, `onlyOpen: true`, `maxResults: 10`. Ask which ticket to work on with AskUserQuestion: offer up to 4 issues as options, preferring ones in an active sprint (`inActiveSprint` search first if the list is long) and those whose status is In Progress. Put `KEY — summary` in the label and `status · type · priority` in the description. Free text via "Other" is matched against the results; if it names another key, load it directly.
- If the search is empty, say so and offer to create a ticket (New mode).

## Phase 2. Brief

Call `get-jira-issue` (default comments) and print a compact brief before anything else:

> **KEY** — summary (linked to `url`)
> **Status:** … · **Type:** … · **Priority:** … · **Assignee:** … · **Sprint:** … or Backlog
> **Links:** relation → KEY (summary) … · **Subtasks:** KEY status … (omit empty lines)
> **Description:** full text
> **Recent comments:** author, date, first lines (skip if none)

Then summarize in 2–4 lines what the ticket asks for and anything unclear or missing (acceptance criteria, environment, reproduction). In **Status** mode stop here.

## Phase 3. Set up — ONE AskUserQuestion call with only the questions that apply

When entering here right after creating a ticket in New mode, skip Phase 2 and use the values returned by `create-jira-ticket` (it may already be assigned and in the sprint).

Skip any question whose answer is already true. Use the real values from the brief and from `list-jira-transitions` (call it first to know the exact status names available).

- **Status** (if `statusCategory` is not "In Progress"): "Move to <In Progress-like status> (Recommended)" / "Keep <current status>". Use the transition whose target status category is In Progress and whose name is closest to "In Progress"; if several exist (e.g. Code Review, Testing In Progress), offer the 2–3 most plausible.
- **Assignee** (if unassigned or assigned to someone else): "Assign to me (Recommended)" / "Keep <name>".
- **Sprint** (if the ticket has no sprint and the project has an active sprint per `list-jira-active-sprints`): "Add to <sprint name> (Recommended)" / "Leave in backlog".
- **Branch** (only when the current working directory is a git repository and the user is about to write code): "Create branch <key>-<short-slug> (Recommended)" / "Stay on current branch". The slug is 3–5 lowercase words from the summary joined by hyphens.

Apply the confirmed choices with `transition-jira-issue`, `assign-jira-issue`, `add-jira-issue-to-sprint`, and `git checkout -b` respectively. Report each result in one line; if any Jira call fails, show the error and continue with the rest.

Then help with the actual work in the normal conversation. Use the ticket description as the source of truth; when the work turns out to have separable parts, offer `create-jira-subtask` (parent = this ticket, one confirmation per subtask). When the user mentions a related ticket, offer `link-jira-issues` with the right relation. Do not post progress comments unprompted; if the user asks to leave a note, draft it, confirm, then `add-jira-comment`.

## Phase 4. Finish

1. Call `get-jira-issue` again (fresh status) and `list-jira-transitions`.
2. Draft a wrap-up comment from the conversation: what was done, decisions taken, links to PRs/branches/commits if they exist, anything left pending or for QA. Plain text, technical details verbatim. Show the full draft.
3. ONE AskUserQuestion with two questions:
   - **Comment**: "Post as is (Recommended)" / "Edit" / "No comment". If Edit, apply the changes and show the draft again before continuing.
   - **Status**: offer up to 4 real transitions. Recommend, in order of fit: a review status (Code Review, Quality Assurance, Ready for Stage) when a PR was opened; Done/Deployed only when the user said the work is fully complete; otherwise "Keep <current status>". Put the target status name in the label.
4. Apply with a single `transition-jira-issue` call passing `comment` when both were confirmed (they land together), or `add-jira-comment` alone when the status stays. If the transition fails because a resolution is required, retry once with `resolution` set to the obvious value (Done for completed work, Won't Do for cancelled) after telling the user. Never post more than one comment per finish, and never transition twice on success.
5. Report: key linked to its URL, previous → new status, and the comment URL if one was posted.
