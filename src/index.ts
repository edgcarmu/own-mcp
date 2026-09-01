import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

// Load the .env that belongs to this project.
// MCP clients may spawn the server from a different working directory.
dotenv.config({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
  // STDOUT is reserved for MCP protocol messages; keep dotenv's banner out.
  quiet: true,
});

const execFileAsync = promisify(execFile);

const {
  JIRA_BASE_URL,
  JIRA_EMAIL,
  JIRA_API_TOKEN,
} = process.env;

type JiraProject = {
  id: string;
  key: string;
  name: string;
};

type JiraProjectSearchResponse = {
  values: JiraProject[];
};

type JiraUser = {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  active: boolean;
};

type JiraBoard = {
  id: number;
  name: string;
  type: string;
};

type JiraBoardSearchResponse = {
  values: JiraBoard[];
};

type JiraSprint = {
  id: number;
  name: string;
  state: string;
  originBoardId: number;
};

type JiraSprintSearchResponse = {
  values: JiraSprint[];
};

type JiraCreatedIssue = {
  id: string;
  key: string;
  self: string;
};

type JiraPriority = {
  id: string;
  name: string;
};

type JiraIssueType = {
  id: string;
  name: string;
  subtask: boolean;
};

function getJiraBaseUrl(): string {
  if (!JIRA_BASE_URL) {
    throw new Error('Missing JIRA_BASE_URL');
  }

  return JIRA_BASE_URL.replace(/\/$/, '');
}

function getJiraAuthorization(): string {
  if (!JIRA_EMAIL || !JIRA_API_TOKEN) {
    throw new Error('Missing JIRA_EMAIL or JIRA_API_TOKEN');
  }

  const credentials = Buffer.from(
      `${JIRA_EMAIL}:${JIRA_API_TOKEN}`,
  ).toString('base64');

  return `Basic ${credentials}`;
}

async function jiraRequest(
    path: string,
    options: RequestInit = {},
): Promise<Response> {
  return fetch(
      `${getJiraBaseUrl()}${path}`,
      {
        ...options,
        headers: {
          Authorization: getJiraAuthorization(),
          Accept: 'application/json',
          ...options.headers,
        },
      },
  );
}

function createJiraDescription(text: string) {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text,
          },
        ],
      },
    ],
  };
}

async function getCurrentJiraUser(): Promise<JiraUser> {
  const response = await jiraRequest(
      '/rest/api/3/myself',
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
        `Unable to retrieve current Jira user (${response.status}): ${body}`,
    );
  }

  return JSON.parse(body) as JiraUser;
}

async function getJiraProjects(
    query?: string,
): Promise<JiraProject[]> {
  const params = new URLSearchParams({
    maxResults: '50',
  });

  if (query) {
    params.set('query', query);
  }

  const response = await jiraRequest(
      `/rest/api/3/project/search?${params.toString()}`,
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
        `Unable to retrieve Jira projects (${response.status}): ${body}`,
    );
  }

  const result = JSON.parse(body) as JiraProjectSearchResponse;

  return result.values;
}

async function resolveJiraProject(
    project: string,
): Promise<JiraProject> {
  const projects = await getJiraProjects(project);

  const normalizedProject = project.trim().toLowerCase();

  const exactMatch = projects.find(
      (candidate) =>
          candidate.key.toLowerCase() === normalizedProject ||
          candidate.name.toLowerCase() === normalizedProject,
  );

  if (exactMatch) {
    return exactMatch;
  }

  if (projects.length === 1) {
    return projects[0];
  }

  if (projects.length === 0) {
    throw new Error(
        `No Jira project found matching "${project}"`,
    );
  }

  const matches = projects
      .map(
          (candidate) =>
              `${candidate.name} (${candidate.key})`,
      )
      .join(', ');

  throw new Error(
      `Multiple Jira projects match "${project}": ${matches}`,
  );
}

async function getJiraPriorities(): Promise<JiraPriority[]> {
  const response = await jiraRequest(
      '/rest/api/3/priority',
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
        `Unable to retrieve Jira priorities (${response.status}): ${body}`,
    );
  }

  return JSON.parse(body) as JiraPriority[];
}

async function getJiraIssueTypes(
    projectKey: string,
): Promise<JiraIssueType[]> {
  const response = await jiraRequest(
      `/rest/api/3/project/${projectKey}?expand=issueTypes`,
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
        `Unable to retrieve issue types for project "${projectKey}" (${response.status}): ${body}`,
    );
  }

  const project = JSON.parse(body) as {
    issueTypes?: JiraIssueType[];
  };

  return (project.issueTypes ?? []).filter(
      (issueType) => !issueType.subtask,
  );
}

async function getJiraBoards(
    projectKey: string,
): Promise<JiraBoard[]> {
  const params = new URLSearchParams({
    projectKeyOrId: projectKey,
    type: 'scrum',
    maxResults: '50',
  });

  const response = await jiraRequest(
      `/rest/agile/1.0/board?${params.toString()}`,
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
        `Unable to retrieve Jira boards (${response.status}): ${body}`,
    );
  }

  const result = JSON.parse(body) as JiraBoardSearchResponse;

  return result.values;
}

async function resolveJiraBoard(
    projectKey: string,
    board?: string,
): Promise<JiraBoard> {
  const boards = await getJiraBoards(projectKey);

  if (boards.length === 0) {
    throw new Error(
        `No Scrum board found for project "${projectKey}"`,
    );
  }

  if (board) {
    const normalizedBoard = board.trim().toLowerCase();

    const exactMatch = boards.find(
        (candidate) =>
            candidate.name.toLowerCase() === normalizedBoard ||
            String(candidate.id) === normalizedBoard,
    );

    if (!exactMatch) {
      const availableBoards = boards
          .map(
              (candidate) =>
                  `${candidate.name} (${candidate.id})`,
          )
          .join(', ');

      throw new Error(
          `Board "${board}" was not found. Available Scrum boards: ${availableBoards}`,
      );
    }

    return exactMatch;
  }

  if (boards.length === 1) {
    return boards[0];
  }

  // If multiple boards exist, prefer the one that currently has an active sprint.
  const boardsWithActiveSprint: JiraBoard[] = [];

  for (const candidate of boards) {
    const sprints = await getActiveSprints(candidate.id);

    if (sprints.length > 0) {
      boardsWithActiveSprint.push(candidate);
    }
  }

  if (boardsWithActiveSprint.length === 1) {
    return boardsWithActiveSprint[0];
  }

  const availableBoards = boards
      .map(
          (candidate) =>
              `${candidate.name} (${candidate.id})`,
      )
      .join(', ');

  throw new Error(
      `Multiple Scrum boards found for project "${projectKey}". Specify the board. Available boards: ${availableBoards}`,
  );
}

async function getActiveSprints(
    boardId: number,
): Promise<JiraSprint[]> {
  const params = new URLSearchParams({
    state: 'active',
    maxResults: '50',
  });

  const response = await jiraRequest(
      `/rest/agile/1.0/board/${boardId}/sprint?${params.toString()}`,
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
        `Unable to retrieve active sprints for board ${boardId} (${response.status}): ${body}`,
    );
  }

  const result = JSON.parse(body) as JiraSprintSearchResponse;

  return result.values;
}

function sprintMatchesProject(
    sprint: JiraSprint,
    project: JiraProject,
): boolean {
  // Match the project name or key as a whole word inside the sprint name,
  // e.g. "Support Sprint 48" ~ project "Support", "PP - Sprint 48" ~ key "PP".
  // Word boundaries prevent short keys from matching inside other words
  // (the key "PP" must not match "Support Sprint 48").
  return [project.name, project.key].some((term) => {
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return new RegExp(`\\b${escapedTerm}\\b`, 'i').test(sprint.name);
  });
}

async function resolveActiveSprint(
    board: JiraBoard,
    project: JiraProject,
    sprint?: string,
): Promise<JiraSprint> {
  const activeSprints = await getActiveSprints(board.id);

  if (activeSprints.length === 0) {
    throw new Error(
        `No active sprint found for board "${board.name}"`,
    );
  }

  const availableSprints = activeSprints
      .map(
          (candidate) =>
              `${candidate.name} (${candidate.id})`,
      )
      .join(', ');

  if (sprint) {
    const normalizedSprint = sprint.trim().toLowerCase();

    const exactMatch = activeSprints.find(
        (candidate) =>
            candidate.name.toLowerCase() === normalizedSprint ||
            String(candidate.id) === normalizedSprint,
    );

    if (!exactMatch) {
      throw new Error(
          `Sprint "${sprint}" is not an active sprint of board "${board.name}". Active sprints: ${availableSprints}`,
      );
    }

    return exactMatch;
  }

  if (activeSprints.length === 1) {
    return activeSprints[0];
  }

  // Multiple active sprints: infer the project's own sprint from its name.
  const projectSprints = activeSprints.filter(
      (candidate) => sprintMatchesProject(candidate, project),
  );

  if (projectSprints.length === 1) {
    return projectSprints[0];
  }

  throw new Error(
      `Multiple active sprints found for board "${board.name}" and none matches project "${project.name}" unambiguously. Specify the sprint. Active sprints: ${availableSprints}`,
  );
}

async function addIssueToSprint(
    issueKey: string,
    sprintId: number,
): Promise<void> {
  const response = await jiraRequest(
      `/rest/agile/1.0/sprint/${sprintId}/issue`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          issues: [issueKey],
        }),
      },
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
        `Unable to add ${issueKey} to sprint ${sprintId} (${response.status}): ${body}`,
    );
  }
}

function createServer(): McpServer {
  const server = new McpServer({
    name: 'fabi-local-mcp',
    version: '0.6.0',
  });

  server.registerTool(
      'get-system-info',
      {
        title: 'Get System Info',
        description: 'Returns basic information about the local machine.',
        inputSchema: z.object({}),
      },
      async () => {
        const info = {
          hostname: os.hostname(),
          platform: os.platform(),
          architecture: os.arch(),
          homeDirectory: os.homedir(),
          cpuCount: os.cpus().length,
          totalMemoryGB: Math.round(os.totalmem() / 1024 ** 3),
          nodeVersion: process.version,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(info, null, 2),
            },
          ],
        };
      },
  );

  server.registerTool(
      'get-git-status',
      {
        title: 'Get Git Status',
        description: 'Returns the Git status of a local repository.',
        inputSchema: z.object({
          path: z
              .string()
              .describe('Absolute path to the local Git repository'),
        }),
      },
      async ({ path }) => {
        try {
          const { stdout } = await execFileAsync(
              'git',
              ['status', '--short', '--branch'],
              {
                cwd: path,
              },
          );

          return {
            content: [
              {
                type: 'text',
                text: stdout.trim() || 'Working tree clean',
              },
            ],
          };
        } catch (error) {
          const message =
              error instanceof Error ? error.message : String(error);

          return {
            content: [
              {
                type: 'text',
                text: `Unable to read Git repository: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
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
      async ({ query }) => {
        try {
          const projects = await getJiraProjects(query);

          const result = projects.map((project) => ({
            id: project.id,
            key: project.key,
            name: project.name,
          }));

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          const message =
              error instanceof Error ? error.message : String(error);

          return {
            content: [
              {
                type: 'text',
                text: `Unable to list Jira projects: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  );

  server.registerTool(
      'list-jira-priorities',
      {
        title: 'List Jira Priorities',
        description:
            'Returns the priority names available on the Jira instance.',
        inputSchema: z.object({}),
      },
      async () => {
        try {
          const priorities = await getJiraPriorities();

          const result = priorities.map((priority) => ({
            id: priority.id,
            name: priority.name,
          }));

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          const message =
              error instanceof Error ? error.message : String(error);

          return {
            content: [
              {
                type: 'text',
                text: `Unable to list Jira priorities: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
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
      async ({ project }) => {
        try {
          const resolvedProject = await resolveJiraProject(project);

          const issueTypes = await getJiraIssueTypes(
              resolvedProject.key,
          );

          const result = {
            project: {
              id: resolvedProject.id,
              key: resolvedProject.key,
              name: resolvedProject.name,
            },
            issueTypes: issueTypes.map((issueType) => ({
              id: issueType.id,
              name: issueType.name,
            })),
          };

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          const message =
              error instanceof Error ? error.message : String(error);

          return {
            content: [
              {
                type: 'text',
                text: `Unable to list Jira issue types: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
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
      async ({ project, board }) => {
        try {
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

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          const message =
              error instanceof Error ? error.message : String(error);

          return {
            content: [
              {
                type: 'text',
                text: `Unable to list Jira active sprints: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
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
             }) => {
        try {
          const resolvedProject = await resolveJiraProject(project);

          let currentUser: JiraUser | null = null;
          let resolvedBoard: JiraBoard | null = null;
          let activeSprint: JiraSprint | null = null;

          if (assignToMe) {
            currentUser = await getCurrentJiraUser();
          }

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

          const response = await jiraRequest(
              '/rest/api/3/issue',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  fields,
                }),
              },
          );

          const body = await response.text();

          if (!response.ok) {
            throw new Error(
                `Jira API returned ${response.status}: ${body}`,
            );
          }

          const issue = JSON.parse(body) as JiraCreatedIssue;

          if (activeSprint) {
            try {
              await addIssueToSprint(
                  issue.key,
                  activeSprint.id,
              );
            } catch (error) {
              const message =
                  error instanceof Error
                      ? error.message
                      : String(error);

              // The issue already exists, so return it with a warning instead of
              // reporting the entire operation as a failed creation.
              const result = {
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
                sprint: null,
                warning: message,
              };

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                  },
                ],
              };
            }
          }

          const result = {
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
                activeSprint && resolvedBoard
                    ? {
                      id: activeSprint.id,
                      name: activeSprint.name,
                      board: {
                        id: resolvedBoard.id,
                        name: resolvedBoard.name,
                      },
                    }
                    : null,
          };

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          const message =
              error instanceof Error ? error.message : String(error);

          return {
            content: [
              {
                type: 'text',
                text: `Unable to create Jira ticket: ${message}`,
              },
            ],
            isError: true,
          };
        }
      },
  );

  return server;
}

void serveStdio(createServer);

// STDOUT is reserved exclusively for MCP protocol messages.
console.error('fabi-local-mcp running on stdio');