import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { adfToText, createJiraDescription } from '../jira/adf.js';
import {
  addIssueToSprint,
  addJiraComment,
  assignJiraIssue,
  createJiraIssue,
  getActiveSprints,
  getCurrentJiraUser,
  getJiraBoards,
  getJiraIssue,
  getJiraIssueComments,
  getJiraIssueSprint,
  getJiraIssueTypes,
  getJiraPriorities,
  getJiraProjects,
  getJiraTransitions,
  searchJiraIssues,
  transitionJiraIssue,
  updateJiraIssue,
} from '../jira/api.js';
import { getJiraBaseUrl } from '../jira/client.js';
import {
  resolveActiveSprint,
  resolveAssignableJiraUser,
  resolveJiraBoard,
  resolveJiraProject,
  resolveJiraTransition,
  sprintMatchesProject,
} from '../jira/resolvers.js';
import type {
  JiraBoard,
  JiraIssue,
  JiraSprint,
  JiraTransition,
  JiraUser,
} from '../jira/types.js';
import { jsonResult, runTool } from './results.js';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/;

// Normalizes "dev-123" to "DEV-123" and rejects anything that is not an issue key.
function normalizeIssueKey(issueKey: string): string {
  const normalized = issueKey.trim().toUpperCase();

  if (!ISSUE_KEY_PATTERN.test(normalized)) {
    throw new Error(
        `"${issueKey}" is not a valid Jira issue key (expected something like DEV-123)`,
    );
  }

  return normalized;
}

function issueUrl(issueKey: string): string {
  return `${getJiraBaseUrl()}/browse/${issueKey}`;
}

function formatUser(user: JiraUser | null | undefined) {
  return user
      ? {
        accountId: user.accountId,
        displayName: user.displayName,
      }
      : null;
}

// Compact representation shared by search results and issue details.
function summarizeIssue(issue: JiraIssue) {
  const { fields } = issue;

  return {
    key: issue.key,
    url: issueUrl(issue.key),
    summary: fields.summary,
    status: fields.status?.name ?? null,
    statusCategory: fields.status?.statusCategory?.name ?? null,
    issueType: fields.issuetype?.name ?? null,
    priority: fields.priority?.name ?? null,
    assignee: formatUser(fields.assignee),
    labels: fields.labels ?? [],
    project: fields.project ? fields.project.key : null,
    parent: fields.parent
        ? { key: fields.parent.key, summary: fields.parent.fields?.summary ?? null }
        : null,
    created: fields.created ?? null,
    updated: fields.updated ?? null,
  };
}

function formatTransition(transition: JiraTransition) {
  return {
    id: transition.id,
    name: transition.name,
    toStatus: transition.to.name,
    toStatusCategory: transition.to.statusCategory?.name ?? null,
  };
}

// Escapes a value for use inside a double-quoted JQL string.
function jqlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function registerJiraTools(server: McpServer): void {
  server.registerTool(
      'list-jira-projects',
      {
        title: 'List Jira Projects',
        description:
            'Returns Jira projects available to the authenticated user.',
        inputSchema: z.object({
          query: z
              .string()
              .optional()
              .describe('Optional project name or key filter'),
        }),
      },
      async ({ query }) =>
          runTool('Unable to list Jira projects', async () => {
            const projects = await getJiraProjects(query);

            return jsonResult(
                projects.map((project) => ({
                  id: project.id,
                  key: project.key,
                  name: project.name,
                })),
            );
          }),
  );

  server.registerTool(
      'list-jira-priorities',
      {
        title: 'List Jira Priorities',
        description:
            'Returns the priority names available on the Jira instance.',
        inputSchema: z.object({}),
      },
      async () =>
          runTool('Unable to list Jira priorities', async () => {
            const priorities = await getJiraPriorities();

            return jsonResult(
                priorities.map((priority) => ({
                  id: priority.id,
                  name: priority.name,
                })),
            );
          }),
  );

  server.registerTool(
      'list-jira-issue-types',
      {
        title: 'List Jira Issue Types',
        description:
            'Returns the issue types available in a Jira project, excluding subtask types.',
        inputSchema: z.object({
          project: z
              .string()
              .describe('Jira project name or key'),
        }),
      },
      async ({ project }) =>
          runTool('Unable to list Jira issue types', async () => {
            const resolvedProject = await resolveJiraProject(project);

            const issueTypes = await getJiraIssueTypes(
                resolvedProject.key,
            );

            return jsonResult({
              project: {
                id: resolvedProject.id,
                key: resolvedProject.key,
                name: resolvedProject.name,
              },
              issueTypes: issueTypes.map((issueType) => ({
                id: issueType.id,
                name: issueType.name,
              })),
            });
          }),
  );

  server.registerTool(
      'list-jira-active-sprints',
      {
        title: 'List Jira Active Sprints',
        description:
            'Returns the Scrum boards of a Jira project and their active sprints. Each sprint indicates whether its name matches the project, which is how create-jira-ticket infers the current sprint.',
        inputSchema: z.object({
          project: z
              .string()
              .describe('Jira project name or key'),

          board: z
              .string()
              .optional()
              .describe('Optional Jira Scrum board name or ID filter'),
        }),
      },
      async ({ project, board }) =>
          runTool('Unable to list Jira active sprints', async () => {
            const resolvedProject = await resolveJiraProject(project);

            let boards = await getJiraBoards(resolvedProject.key);

            if (board) {
              const normalizedBoard = board.trim().toLowerCase();

              boards = boards.filter(
                  (candidate) =>
                      candidate.name.toLowerCase() === normalizedBoard ||
                      String(candidate.id) === normalizedBoard,
              );
            }

            const result = [];

            for (const candidate of boards) {
              const activeSprints = await getActiveSprints(
                  candidate.id,
              );

              result.push({
                board: {
                  id: candidate.id,
                  name: candidate.name,
                },
                activeSprints: activeSprints.map((sprint) => ({
                  id: sprint.id,
                  name: sprint.name,
                  matchesProject: sprintMatchesProject(
                      sprint,
                      resolvedProject,
                  ),
                })),
              });
            }

            return jsonResult(result);
          }),
  );

  server.registerTool(
      'create-jira-ticket',
      {
        title: 'Create Jira Ticket',
        description:
            'Creates a Jira issue using the project name or key, with optional self-assignment and automatic addition to the active sprint.',
        inputSchema: z.object({
          project: z
              .string()
              .describe(
                  'Jira project name or key, for example Support, Backend, Percy Product, DEV, or SUPPORT',
              ),

          summary: z
              .string()
              .describe('Short title of the Jira issue'),

          description: z
              .string()
              .describe('Detailed description of the issue'),

          issueType: z
              .string()
              .optional()
              .describe(
                  'Jira issue type, for example Bug, Task, or Story',
              ),

          priority: z
              .string()
              .optional()
              .describe(
                  'Jira priority name. This instance uses Blocker, Critical, Major, Minor, or Trivial (High maps to Critical)',
              ),

          labels: z
              .array(z.string())
              .optional()
              .describe('Optional Jira labels'),

          assignToMe: z
              .boolean()
              .optional()
              .describe(
                  'When true, assigns the issue to the authenticated Jira user',
              ),

          addToCurrentSprint: z
              .boolean()
              .optional()
              .describe(
                  'When true, adds the issue to the active sprint of the project Scrum board',
              ),

          board: z
              .string()
              .optional()
              .describe(
                  'Optional Jira Scrum board name or ID. Only needed when a project has multiple boards',
              ),

          sprint: z
              .string()
              .optional()
              .describe(
                  'Optional active sprint name or ID. Only needed when the board has multiple active sprints and the right one cannot be inferred from the project name',
              ),
        }),
      },
      async ({
               project,
               summary,
               description,
               issueType,
               priority,
               labels,
               assignToMe,
               addToCurrentSprint,
               board,
               sprint,
             }) =>
          runTool('Unable to create Jira ticket', async () => {
            const resolvedProject = await resolveJiraProject(project);

            const currentUser = assignToMe
                ? await getCurrentJiraUser()
                : null;

            let resolvedBoard: JiraBoard | null = null;
            let activeSprint: JiraSprint | null = null;

            // Resolve the board and sprint before creating the issue.
            // This avoids creating a ticket when the requested sprint cannot be resolved.
            if (addToCurrentSprint) {
              resolvedBoard = await resolveJiraBoard(
                  resolvedProject.key,
                  board,
              );

              activeSprint = await resolveActiveSprint(
                  resolvedBoard,
                  resolvedProject,
                  sprint,
              );
            }

            const fields: Record<string, unknown> = {
              project: {
                key: resolvedProject.key,
              },
              summary,
              description: createJiraDescription(description),
              issuetype: {
                name: issueType ?? 'Task',
              },
            };

            if (priority) {
              fields.priority = {
                name: priority,
              };
            }

            if (labels?.length) {
              fields.labels = labels;
            }

            if (currentUser) {
              fields.assignee = {
                accountId: currentUser.accountId,
              };
            }

            const issue = await createJiraIssue(fields);

            // The issue already exists at this point. If adding it to the sprint
            // fails, return the issue with a warning instead of reporting the
            // entire operation as a failed creation.
            let sprintWarning: string | null = null;

            if (activeSprint) {
              try {
                await addIssueToSprint(issue.key, activeSprint.id);
              } catch (error) {
                sprintWarning =
                    error instanceof Error
                        ? error.message
                        : String(error);
              }
            }

            const addedToSprint =
                activeSprint !== null &&
                resolvedBoard !== null &&
                sprintWarning === null;

            return jsonResult({
              id: issue.id,
              key: issue.key,
              url: `${getJiraBaseUrl()}/browse/${issue.key}`,
              project: {
                id: resolvedProject.id,
                key: resolvedProject.key,
                name: resolvedProject.name,
              },
              assignee: currentUser
                  ? {
                    accountId: currentUser.accountId,
                    displayName: currentUser.displayName,
                  }
                  : null,
              sprint:
                  addedToSprint && activeSprint && resolvedBoard
                      ? {
                        id: activeSprint.id,
                        name: activeSprint.name,
                        board: {
                          id: resolvedBoard.id,
                          name: resolvedBoard.name,
                        },
                      }
                      : null,
              ...(sprintWarning !== null
                  ? { warning: sprintWarning }
                  : {}),
            });
          }),
  );
  server.registerTool(
      'add-jira-comment',
      {
        title: 'Add Jira Comment',
        description:
            'Adds a comment to an existing Jira issue, identified by its key (for example DEV-123). Use this to update a ticket with progress, findings, or follow-up notes.',
        inputSchema: z.object({
          issueKey: z
              .string()
              .describe('Jira issue key, for example DEV-123'),

          comment: z
              .string()
              .describe('Plain-text comment body to add to the issue'),
        }),
      },
      async ({ issueKey, comment }) =>
          runTool('Unable to add Jira comment', async () => {
            const normalizedKey = normalizeIssueKey(issueKey);

            const trimmedComment = comment.trim();

            if (!trimmedComment) {
              throw new Error('Comment body must not be empty');
            }

            const created = await addJiraComment(
                normalizedKey,
                trimmedComment,
            );

            return jsonResult({
              issueKey: normalizedKey,
              commentId: created.id,
              created: created.created,
              author: created.author
                  ? {
                    accountId: created.author.accountId,
                    displayName: created.author.displayName,
                  }
                  : null,
              url: `${issueUrl(normalizedKey)}?focusedCommentId=${created.id}`,
            });
          }),
  );
  server.registerTool(
      'get-jira-issue',
      {
        title: 'Get Jira Issue',
        description:
            'Returns the details of a Jira issue by key: summary, description as plain text, status, type, priority, assignee, reporter, labels, sprint, parent, subtasks and the most recent comments.',
        inputSchema: z.object({
          issueKey: z
              .string()
              .describe('Jira issue key, for example DEV-123'),

          maxComments: z
              .number()
              .int()
              .min(0)
              .max(50)
              .optional()
              .describe(
                  'How many of the most recent comments to include (default 10, 0 to skip comments)',
              ),
        }),
      },
      async ({ issueKey, maxComments }) =>
          runTool('Unable to get Jira issue', async () => {
            const normalizedKey = normalizeIssueKey(issueKey);
            const commentLimit = maxComments ?? 10;

            const [issue, sprint, commentPage] = await Promise.all([
              getJiraIssue(normalizedKey),
              getJiraIssueSprint(normalizedKey),
              commentLimit > 0
                  ? getJiraIssueComments(normalizedKey, commentLimit)
                  : Promise.resolve(null),
            ]);

            const { fields } = issue;

            return jsonResult({
              ...summarizeIssue(issue),
              id: issue.id,
              description: adfToText(fields.description as never),
              reporter: formatUser(fields.reporter),
              resolutionDate: fields.resolutiondate ?? null,
              project: fields.project
                  ? {
                    id: fields.project.id,
                    key: fields.project.key,
                    name: fields.project.name,
                  }
                  : null,
              sprint: sprint
                  ? {
                    id: sprint.id,
                    name: sprint.name,
                    state: sprint.state,
                  }
                  : null,
              subtasks: (fields.subtasks ?? []).map((subtask) => ({
                key: subtask.key,
                summary: subtask.fields?.summary ?? null,
                status: subtask.fields?.status?.name ?? null,
              })),
              comments: commentPage
                  ? {
                    total: commentPage.total,
                    showing: commentPage.comments.length,
                    items: commentPage.comments.map((comment) => ({
                      id: comment.id,
                      author: comment.author?.displayName ?? null,
                      created: comment.created,
                      body: adfToText(comment.body as never),
                    })),
                  }
                  : null,
            });
          }),
  );

  server.registerTool(
      'search-jira-issues',
      {
        title: 'Search Jira Issues',
        description:
            'Searches Jira issues. Either pass a raw JQL query, or combine the filters (project, assignedToMe, onlyOpen, status, issueType, inActiveSprint, text) and they are turned into JQL. Results are ordered by last update, newest first.',
        inputSchema: z.object({
          jql: z
              .string()
              .optional()
              .describe(
                  'Raw JQL query. When provided, all other filters are ignored',
              ),

          project: z
              .string()
              .optional()
              .describe('Jira project name or key'),

          assignedToMe: z
              .boolean()
              .optional()
              .describe('Only issues assigned to the authenticated user'),

          onlyOpen: z
              .boolean()
              .optional()
              .describe(
                  'Exclude issues whose status category is Done (default true when no status is given)',
              ),

          status: z
              .string()
              .optional()
              .describe(
                  'Exact status name, for example "In Progress" or "To Do"',
              ),

          issueType: z
              .string()
              .optional()
              .describe('Issue type name, for example Bug or Task'),

          inActiveSprint: z
              .boolean()
              .optional()
              .describe('Only issues in a currently open sprint'),

          text: z
              .string()
              .optional()
              .describe(
                  'Free text matched against summary, description and comments',
              ),

          maxResults: z
              .number()
              .int()
              .min(1)
              .max(50)
              .optional()
              .describe('Maximum number of issues to return (default 20)'),
        }),
      },
      async ({
               jql,
               project,
               assignedToMe,
               onlyOpen,
               status,
               issueType,
               inActiveSprint,
               text,
               maxResults,
             }) =>
          runTool('Unable to search Jira issues', async () => {
            let query = jql?.trim();

            if (!query) {
              const clauses: string[] = [];

              if (project) {
                const resolvedProject = await resolveJiraProject(project);
                clauses.push(`project = ${jqlString(resolvedProject.key)}`);
              }

              if (assignedToMe) {
                clauses.push('assignee = currentUser()');
              }

              if (status) {
                clauses.push(`status = ${jqlString(status)}`);
              } else if (onlyOpen ?? true) {
                clauses.push('statusCategory != Done');
              }

              if (issueType) {
                clauses.push(`issuetype = ${jqlString(issueType)}`);
              }

              if (inActiveSprint) {
                clauses.push('sprint in openSprints()');
              }

              if (text) {
                clauses.push(`text ~ ${jqlString(text)}`);
              }

              if (clauses.length === 0) {
                throw new Error(
                    'Provide a JQL query or at least one filter',
                );
              }

              query = `${clauses.join(' AND ')} ORDER BY updated DESC`;
            }

            const issues = await searchJiraIssues(query, maxResults ?? 20);

            return jsonResult({
              jql: query,
              count: issues.length,
              issues: issues.map(summarizeIssue),
            });
          }),
  );
  server.registerTool(
      'list-jira-transitions',
      {
        title: 'List Jira Transitions',
        description:
            'Returns the workflow transitions currently available for a Jira issue, with the status each one leads to. Use it to see which statuses transition-jira-issue can move the issue to.',
        inputSchema: z.object({
          issueKey: z
              .string()
              .describe('Jira issue key, for example DEV-123'),
        }),
      },
      async ({ issueKey }) =>
          runTool('Unable to list Jira transitions', async () => {
            const normalizedKey = normalizeIssueKey(issueKey);

            const [issue, transitions] = await Promise.all([
              getJiraIssue(normalizedKey),
              getJiraTransitions(normalizedKey),
            ]);

            return jsonResult({
              issueKey: normalizedKey,
              currentStatus: issue.fields.status?.name ?? null,
              transitions: transitions.map(formatTransition),
            });
          }),
  );

  server.registerTool(
      'transition-jira-issue',
      {
        title: 'Transition Jira Issue',
        description:
            'Moves a Jira issue to another status by applying a workflow transition. The target can be the destination status name (for example "In Progress" or "Done"), the transition name, or the transition ID. Optionally adds a comment in the same operation.',
        inputSchema: z.object({
          issueKey: z
              .string()
              .describe('Jira issue key, for example DEV-123'),

          transition: z
              .string()
              .describe(
                  'Target status name, transition name, or transition ID. Use list-jira-transitions to see the options',
              ),

          comment: z
              .string()
              .optional()
              .describe(
                  'Optional plain-text comment added together with the status change',
              ),
        }),
      },
      async ({ issueKey, transition, comment }) =>
          runTool('Unable to transition Jira issue', async () => {
            const normalizedKey = normalizeIssueKey(issueKey);
            const trimmedComment = comment?.trim() || undefined;

            const [issueBefore, transitions] = await Promise.all([
              getJiraIssue(normalizedKey),
              getJiraTransitions(normalizedKey),
            ]);

            const previousStatus = issueBefore.fields.status?.name ?? null;

            const resolved = resolveJiraTransition(transitions, transition);

            if (previousStatus && normalize(resolved.to.name) === normalize(previousStatus)) {
              return jsonResult({
                issueKey: normalizedKey,
                url: issueUrl(normalizedKey),
                previousStatus,
                status: previousStatus,
                transition: formatTransition(resolved),
                changed: false,
                message: `${normalizedKey} is already in status "${previousStatus}"`,
              });
            }

            await transitionJiraIssue(
                normalizedKey,
                resolved.id,
                trimmedComment,
            );

            // Jira answers 204 to the transition; read the issue back so the
            // reported status is what Jira actually has, not what was requested.
            const issueAfter = await getJiraIssue(normalizedKey);

            return jsonResult({
              issueKey: normalizedKey,
              url: issueUrl(normalizedKey),
              previousStatus,
              status: issueAfter.fields.status?.name ?? null,
              transition: formatTransition(resolved),
              changed: true,
              commentAdded: trimmedComment !== undefined,
            });
          }),
  );
  server.registerTool(
      'update-jira-issue',
      {
        title: 'Update Jira Issue',
        description:
            'Updates fields of an existing Jira issue: summary, description (replaces the whole text), priority, issue type, and labels (replace the full set, or add/remove specific ones). Only the fields provided are changed. Use transition-jira-issue for status and assign-jira-issue for the assignee.',
        inputSchema: z.object({
          issueKey: z
              .string()
              .describe('Jira issue key, for example DEV-123'),

          summary: z
              .string()
              .optional()
              .describe('New title of the issue'),

          description: z
              .string()
              .optional()
              .describe(
                  'New description. Replaces the existing description entirely',
              ),

          priority: z
              .string()
              .optional()
              .describe(
                  'Priority name, for example Blocker, Critical, Major, Minor, or Trivial',
              ),

          issueType: z
              .string()
              .optional()
              .describe('Issue type name, for example Bug, Task, or Story'),

          labels: z
              .array(z.string())
              .optional()
              .describe(
                  'Replaces the full set of labels. Cannot be combined with addLabels or removeLabels',
              ),

          addLabels: z
              .array(z.string())
              .optional()
              .describe('Labels to add, keeping the existing ones'),

          removeLabels: z
              .array(z.string())
              .optional()
              .describe('Labels to remove, keeping the other ones'),
        }),
      },
      async ({
               issueKey,
               summary,
               description,
               priority,
               issueType,
               labels,
               addLabels,
               removeLabels,
             }) =>
          runTool('Unable to update Jira issue', async () => {
            const normalizedKey = normalizeIssueKey(issueKey);

            if (labels && (addLabels?.length || removeLabels?.length)) {
              throw new Error(
                  'Use either labels (replace all) or addLabels/removeLabels, not both',
              );
            }

            const fields: Record<string, unknown> = {};
            const update: Record<string, unknown> = {};
            const changedFields: string[] = [];

            const trimmedSummary = summary?.trim();

            if (trimmedSummary) {
              fields.summary = trimmedSummary;
              changedFields.push('summary');
            }

            if (description !== undefined) {
              fields.description = createJiraDescription(description.trim());
              changedFields.push('description');
            }

            if (priority?.trim()) {
              fields.priority = { name: priority.trim() };
              changedFields.push('priority');
            }

            if (issueType?.trim()) {
              fields.issuetype = { name: issueType.trim() };
              changedFields.push('issueType');
            }

            if (labels) {
              fields.labels = labels;
              changedFields.push('labels');
            }

            const labelOperations = [
              ...(addLabels ?? []).map((label) => ({ add: label })),
              ...(removeLabels ?? []).map((label) => ({ remove: label })),
            ];

            if (labelOperations.length > 0) {
              update.labels = labelOperations;
              changedFields.push('labels');
            }

            if (changedFields.length === 0) {
              throw new Error('Provide at least one field to update');
            }

            await updateJiraIssue(normalizedKey, fields, update);

            // Read back so the response reflects what Jira stored.
            const issue = await getJiraIssue(normalizedKey);

            return jsonResult({
              ...summarizeIssue(issue),
              changedFields,
              description: adfToText(issue.fields.description as never),
            });
          }),
  );

  server.registerTool(
      'assign-jira-issue',
      {
        title: 'Assign Jira Issue',
        description:
            'Assigns a Jira issue to a person, to the authenticated user, or removes the assignee. The person can be given by display name, email, or account ID; only users who can be assigned to the issue are considered.',
        inputSchema: z.object({
          issueKey: z
              .string()
              .describe('Jira issue key, for example DEV-123'),

          assignee: z
              .string()
              .describe(
                  'Display name, email, or account ID of the assignee. Use "me" for the authenticated user or "unassigned" to clear the assignee',
              ),
        }),
      },
      async ({ issueKey, assignee }) =>
          runTool('Unable to assign Jira issue', async () => {
            const normalizedKey = normalizeIssueKey(issueKey);
            const target = normalize(assignee);

            if (!target) {
              throw new Error('Provide an assignee');
            }

            const issueBefore = await getJiraIssue(normalizedKey);
            const previousAssignee = formatUser(issueBefore.fields.assignee);

            let user: JiraUser | null;

            if (target === 'unassigned' || target === 'none' || target === 'nobody') {
              user = null;
            } else if (target === 'me' || target === 'myself') {
              user = await getCurrentJiraUser();
            } else {
              user = await resolveAssignableJiraUser(normalizedKey, assignee.trim());
            }

            const unchanged =
                (user === null && previousAssignee === null) ||
                (user !== null && previousAssignee?.accountId === user.accountId);

            if (unchanged) {
              return jsonResult({
                issueKey: normalizedKey,
                url: issueUrl(normalizedKey),
                previousAssignee,
                assignee: formatUser(user),
                changed: false,
              });
            }

            await assignJiraIssue(normalizedKey, user ? user.accountId : null);

            const issueAfter = await getJiraIssue(normalizedKey);

            return jsonResult({
              issueKey: normalizedKey,
              url: issueUrl(normalizedKey),
              previousAssignee,
              assignee: formatUser(issueAfter.fields.assignee),
              changed: true,
            });
          }),
  );
}
