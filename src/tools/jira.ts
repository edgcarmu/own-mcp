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
  getJiraIssueLinkTypes,
  getJiraIssueSprint,
  getJiraIssueTypes,
  getJiraPriorities,
  getJiraProjects,
  getJiraTransitions,
  linkJiraIssues,
  moveIssuesToBacklog,
  searchJiraIssues,
  transitionJiraIssue,
  updateJiraIssue,
} from '../jira/api.js';
import { getJiraBaseUrl } from '../jira/client.js';
import { buildJql } from '../jira/jql.js';
import {
  resolveActiveSprint,
  resolveAssignableJiraUser,
  resolveJiraBoard,
  resolveJiraLinkType,
  resolveJiraProject,
  resolveJiraTransition,
  sprintMatchesProject,
} from '../jira/resolvers.js';
import type {
  JiraBoard,
  JiraIssue,
  JiraIssueLink,
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

// Describes a link from the point of view of `issueKey`,
// e.g. { relation: "blocks", key: "DEV-2" } or { relation: "is blocked by", key: "DEV-1" }.
function formatLink(link: JiraIssueLink) {
  const other = link.outwardIssue ?? link.inwardIssue;
  const relation = link.outwardIssue ? link.type.outward : link.type.inward;

  return {
    id: link.id,
    type: link.type.name,
    relation,
    key: other?.key ?? null,
    summary: other?.fields?.summary ?? null,
    status: other?.fields?.status?.name ?? null,
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

export function registerJiraTools(server: McpServer): void {
  server.registerTool(
      'get-jira-current-user',
      {
        title: 'Get Jira Current User',
        description:
            'Returns the authenticated Jira user and the instance base URL. Useful to confirm the connection and to know who "me" refers to.',
        inputSchema: z.object({}),
      },
      async () =>
          runTool('Unable to get Jira current user', async () => {
            const user = await getCurrentJiraUser();

            return jsonResult({
              accountId: user.accountId,
              displayName: user.displayName,
              emailAddress: user.emailAddress ?? null,
              baseUrl: getJiraBaseUrl(),
            });
          }),
  );

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
              links: (fields.issuelinks ?? []).map(formatLink),
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
              .describe('Maximum number of issues to return per page (default 20)'),

          pageToken: z
              .string()
              .optional()
              .describe(
                  'Continues a previous search: pass the nextPageToken returned by the prior call together with the same query or filters',
              ),
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
               pageToken,
             }) =>
          runTool('Unable to search Jira issues', async () => {
            let query = jql?.trim();

            if (!query) {
              const resolvedProject = project
                  ? await resolveJiraProject(project)
                  : null;

              query = buildJql({
                projectKey: resolvedProject?.key,
                assignedToMe,
                onlyOpen,
                status,
                issueType,
                inActiveSprint,
                text,
              }) ?? undefined;
            }

            if (!query) {
              throw new Error('Provide a JQL query or at least one filter');
            }

            const page = await searchJiraIssues(query, maxResults ?? 20, pageToken);

            return jsonResult({
              jql: query,
              count: page.issues.length,
              nextPageToken: page.nextPageToken,
              issues: page.issues.map(summarizeIssue),
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

          resolution: z
              .string()
              .optional()
              .describe(
                  'Resolution name, for example Done, Fixed, or Won\'t Do. Only needed when the transition screen requires a resolution',
              ),
        }),
      },
      async ({ issueKey, transition, comment, resolution }) =>
          runTool('Unable to transition Jira issue', async () => {
            const normalizedKey = normalizeIssueKey(issueKey);
            const trimmedComment = comment?.trim() || undefined;
            const fields = resolution?.trim()
                ? { resolution: { name: resolution.trim() } }
                : undefined;

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
                fields,
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
              resolution: issueAfter.fields.resolution?.name ?? null,
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
  server.registerTool(
      'add-jira-issue-to-sprint',
      {
        title: 'Add Jira Issue To Sprint',
        description:
            'Moves an existing Jira issue into the active sprint of its project Scrum board, or back to the backlog. The board and sprint are inferred from the issue project the same way create-jira-ticket does.',
        inputSchema: z.object({
          issueKey: z
              .string()
              .describe('Jira issue key, for example DEV-123'),

          toBacklog: z
              .boolean()
              .optional()
              .describe('When true, removes the issue from its sprint and sends it to the backlog'),

          board: z
              .string()
              .optional()
              .describe(
                  'Optional Jira Scrum board name or ID. Only needed when the project has multiple boards',
              ),

          sprint: z
              .string()
              .optional()
              .describe(
                  'Optional active sprint name or ID. Only needed when the board has multiple active sprints',
              ),
        }),
      },
      async ({ issueKey, toBacklog, board, sprint }) =>
          runTool('Unable to move Jira issue', async () => {
            const normalizedKey = normalizeIssueKey(issueKey);

            const [issue, currentSprint] = await Promise.all([
              getJiraIssue(normalizedKey),
              getJiraIssueSprint(normalizedKey),
            ]);

            const previousSprint = currentSprint
                ? { id: currentSprint.id, name: currentSprint.name }
                : null;

            if (toBacklog) {
              if (!currentSprint) {
                return jsonResult({
                  issueKey: normalizedKey,
                  url: issueUrl(normalizedKey),
                  previousSprint,
                  sprint: null,
                  changed: false,
                  message: `${normalizedKey} is already in the backlog`,
                });
              }

              await moveIssuesToBacklog([normalizedKey]);

              return jsonResult({
                issueKey: normalizedKey,
                url: issueUrl(normalizedKey),
                previousSprint,
                sprint: null,
                changed: true,
              });
            }

            const projectKey = issue.fields.project?.key;

            if (!projectKey) {
              throw new Error(`Unable to determine the project of ${normalizedKey}`);
            }

            const resolvedProject = await resolveJiraProject(projectKey);
            const resolvedBoard = await resolveJiraBoard(resolvedProject.key, board);
            const activeSprint = await resolveActiveSprint(
                resolvedBoard,
                resolvedProject,
                sprint,
            );

            const sprintResult = {
              id: activeSprint.id,
              name: activeSprint.name,
              board: { id: resolvedBoard.id, name: resolvedBoard.name },
            };

            if (currentSprint?.id === activeSprint.id) {
              return jsonResult({
                issueKey: normalizedKey,
                url: issueUrl(normalizedKey),
                previousSprint,
                sprint: sprintResult,
                changed: false,
                message: `${normalizedKey} is already in sprint "${activeSprint.name}"`,
              });
            }

            await addIssueToSprint(normalizedKey, activeSprint.id);

            return jsonResult({
              issueKey: normalizedKey,
              url: issueUrl(normalizedKey),
              previousSprint,
              sprint: sprintResult,
              changed: true,
            });
          }),
  );

  server.registerTool(
      'link-jira-issues',
      {
        title: 'Link Jira Issues',
        description:
            'Creates a relation between two Jira issues, read as "<issueKey> <relation> <targetIssueKey>", for example DEV-1 "blocks" DEV-2 or DEV-1 "is blocked by" DEV-2. The relation can be a link type name (Blocks, Cloners, Duplicate, Relates) or either of its directional phrases.',
        inputSchema: z.object({
          issueKey: z
              .string()
              .describe('Source issue key, for example DEV-123'),

          relation: z
              .string()
              .describe(
                  'Relation phrase or link type, for example "blocks", "is blocked by", "relates to", "duplicates", "clones"',
              ),

          targetIssueKey: z
              .string()
              .describe('Target issue key, for example DEV-456'),

          comment: z
              .string()
              .optional()
              .describe('Optional plain-text comment added to the source issue with the link'),
        }),
      },
      async ({ issueKey, relation, targetIssueKey, comment }) =>
          runTool('Unable to link Jira issues', async () => {
            const sourceKey = normalizeIssueKey(issueKey);
            const targetKey = normalizeIssueKey(targetIssueKey);

            if (sourceKey === targetKey) {
              throw new Error('An issue cannot be linked to itself');
            }

            const [linkTypes, sourceIssue] = await Promise.all([
              getJiraIssueLinkTypes(),
              getJiraIssue(sourceKey),
            ]);

            const { linkType, sourceIsInward } = resolveJiraLinkType(
                linkTypes,
                relation,
            );

            const outwardKey = sourceIsInward ? targetKey : sourceKey;
            const inwardKey = sourceIsInward ? sourceKey : targetKey;

            const alreadyLinked = (sourceIssue.fields.issuelinks ?? []).some(
                (link) =>
                    link.type.id === linkType.id &&
                    (sourceIsInward
                        ? link.inwardIssue?.key === targetKey
                        : link.outwardIssue?.key === targetKey),
            );

            const description = `${outwardKey} ${linkType.outward} ${inwardKey}`;

            if (alreadyLinked) {
              return jsonResult({
                link: description,
                type: linkType.name,
                outwardIssue: outwardKey,
                inwardIssue: inwardKey,
                changed: false,
                message: `Link already exists: ${description}`,
              });
            }

            await linkJiraIssues(
                linkType.name,
                outwardKey,
                inwardKey,
                comment?.trim() || undefined,
            );

            return jsonResult({
              link: description,
              type: linkType.name,
              outwardIssue: outwardKey,
              inwardIssue: inwardKey,
              url: issueUrl(sourceKey),
              changed: true,
            });
          }),
  );

  server.registerTool(
      'create-jira-subtask',
      {
        title: 'Create Jira Subtask',
        description:
            'Creates a subtask under an existing Jira issue. The project and subtask issue type are taken from the parent; the subtask inherits the parent sprint automatically.',
        inputSchema: z.object({
          parentKey: z
              .string()
              .describe('Key of the parent issue, for example DEV-123'),

          summary: z
              .string()
              .describe('Short title of the subtask'),

          description: z
              .string()
              .optional()
              .describe('Optional detailed description'),

          priority: z
              .string()
              .optional()
              .describe('Optional Jira priority name'),

          labels: z
              .array(z.string())
              .optional()
              .describe('Optional Jira labels'),

          assignToMe: z
              .boolean()
              .optional()
              .describe('When true, assigns the subtask to the authenticated Jira user'),

          issueType: z
              .string()
              .optional()
              .describe(
                  'Optional subtask type name, for example Sub-task or Technical task. Defaults to Sub-task',
              ),
        }),
      },
      async ({
               parentKey,
               summary,
               description,
               priority,
               labels,
               assignToMe,
               issueType,
             }) =>
          runTool('Unable to create Jira subtask', async () => {
            const normalizedParent = normalizeIssueKey(parentKey);

            const parent = await getJiraIssue(normalizedParent);

            if (parent.fields.issuetype?.subtask) {
              throw new Error(
                  `${normalizedParent} is itself a subtask; subtasks cannot be nested`,
              );
            }

            const projectKey = parent.fields.project?.key;

            if (!projectKey) {
              throw new Error(`Unable to determine the project of ${normalizedParent}`);
            }

            const [subtaskTypes, currentUser] = await Promise.all([
              getJiraIssueTypes(projectKey, true),
              assignToMe ? getCurrentJiraUser() : Promise.resolve(null),
            ]);

            if (subtaskTypes.length === 0) {
              throw new Error(`Project "${projectKey}" has no subtask issue type`);
            }

            let subtaskType = subtaskTypes[0];

            if (issueType) {
              const match = subtaskTypes.find(
                  (candidate) => normalize(candidate.name) === normalize(issueType),
              );

              if (!match) {
                throw new Error(
                    `Subtask type "${issueType}" was not found. Available: ${subtaskTypes.map((t) => t.name).join(', ')}`,
                );
              }

              subtaskType = match;
            } else if (subtaskTypes.length > 1) {
              // Prefer Jira's standard subtask type when a project defines several.
              const standard = subtaskTypes.find((candidate) =>
                  ['sub-task', 'subtask'].includes(normalize(candidate.name)),
              );

              if (!standard) {
                throw new Error(
                    `Project "${projectKey}" has several subtask types. Specify issueType: ${subtaskTypes.map((t) => t.name).join(', ')}`,
                );
              }

              subtaskType = standard;
            }

            const fields: Record<string, unknown> = {
              project: { key: projectKey },
              parent: { key: normalizedParent },
              issuetype: { id: subtaskType.id },
              summary: summary.trim(),
            };

            if (description?.trim()) {
              fields.description = createJiraDescription(description.trim());
            }

            if (priority) {
              fields.priority = { name: priority };
            }

            if (labels?.length) {
              fields.labels = labels;
            }

            if (currentUser) {
              fields.assignee = { accountId: currentUser.accountId };
            }

            const created = await createJiraIssue(fields);

            return jsonResult({
              id: created.id,
              key: created.key,
              url: issueUrl(created.key),
              issueType: subtaskType.name,
              parent: {
                key: normalizedParent,
                summary: parent.fields.summary,
              },
              assignee: formatUser(currentUser),
            });
          }),
  );
}
