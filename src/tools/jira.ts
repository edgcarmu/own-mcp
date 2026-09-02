import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import {
  addIssueToSprint,
  addJiraComment,
  createJiraDescription,
  createJiraIssue,
  getActiveSprints,
  getCurrentJiraUser,
  getJiraBoards,
  getJiraIssueTypes,
  getJiraPriorities,
  getJiraProjects,
} from '../jira/api.js';
import { getJiraBaseUrl } from '../jira/client.js';
import {
  resolveActiveSprint,
  resolveJiraBoard,
  resolveJiraProject,
  sprintMatchesProject,
} from '../jira/resolvers.js';
import type { JiraBoard, JiraSprint } from '../jira/types.js';
import { jsonResult, runTool } from './results.js';

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
            const normalizedKey = issueKey.trim().toUpperCase();

            if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(normalizedKey)) {
              throw new Error(
                  `"${issueKey}" is not a valid Jira issue key (expected something like DEV-123)`,
              );
            }

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
              url: `${getJiraBaseUrl()}/browse/${normalizedKey}?focusedCommentId=${created.id}`,
            });
          }),
  );
}
