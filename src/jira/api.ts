import { jiraFetch } from './client.js';
import type {
  JiraBoard,
  JiraBoardSearchResponse,
  JiraComment,
  JiraCreatedIssue,
  JiraIssueType,
  JiraPriority,
  JiraProject,
  JiraProjectSearchResponse,
  JiraSprint,
  JiraSprintSearchResponse,
  JiraUser,
} from './types.js';

// Builds a minimal Atlassian Document Format body from plain text.
export function createJiraDescription(text: string) {
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

export async function getCurrentJiraUser(): Promise<JiraUser> {
  return jiraFetch<JiraUser>(
      '/rest/api/3/myself',
      {
        errorContext: 'Unable to retrieve current Jira user',
      },
  );
}

export async function getJiraProjects(
    query?: string,
): Promise<JiraProject[]> {
  const params = new URLSearchParams({
    maxResults: '50',
  });

  if (query) {
    params.set('query', query);
  }

  const result = await jiraFetch<JiraProjectSearchResponse>(
      `/rest/api/3/project/search?${params.toString()}`,
      {
        errorContext: 'Unable to retrieve Jira projects',
      },
  );

  return result.values;
}

export async function getJiraPriorities(): Promise<JiraPriority[]> {
  return jiraFetch<JiraPriority[]>(
      '/rest/api/3/priority',
      {
        errorContext: 'Unable to retrieve Jira priorities',
      },
  );
}

export async function getJiraIssueTypes(
    projectKey: string,
): Promise<JiraIssueType[]> {
  const project = await jiraFetch<{ issueTypes?: JiraIssueType[] }>(
      `/rest/api/3/project/${projectKey}?expand=issueTypes`,
      {
        errorContext: `Unable to retrieve issue types for project "${projectKey}"`,
      },
  );

  return (project.issueTypes ?? []).filter(
      (issueType) => !issueType.subtask,
  );
}

export async function getJiraBoards(
    projectKey: string,
): Promise<JiraBoard[]> {
  const params = new URLSearchParams({
    projectKeyOrId: projectKey,
    type: 'scrum',
    maxResults: '50',
  });

  const result = await jiraFetch<JiraBoardSearchResponse>(
      `/rest/agile/1.0/board?${params.toString()}`,
      {
        errorContext: 'Unable to retrieve Jira boards',
      },
  );

  return result.values;
}

export async function getActiveSprints(
    boardId: number,
): Promise<JiraSprint[]> {
  const params = new URLSearchParams({
    state: 'active',
    maxResults: '50',
  });

  const result = await jiraFetch<JiraSprintSearchResponse>(
      `/rest/agile/1.0/board/${boardId}/sprint?${params.toString()}`,
      {
        errorContext: `Unable to retrieve active sprints for board ${boardId}`,
      },
  );

  return result.values;
}

export async function createJiraIssue(
    fields: Record<string, unknown>,
): Promise<JiraCreatedIssue> {
  return jiraFetch<JiraCreatedIssue>(
      '/rest/api/3/issue',
      {
        method: 'POST',
        body: { fields },
        errorContext: 'Unable to create Jira issue',
      },
  );
}

export async function addIssueToSprint(
    issueKey: string,
    sprintId: number,
): Promise<void> {
  await jiraFetch<void>(
      `/rest/agile/1.0/sprint/${sprintId}/issue`,
      {
        method: 'POST',
        body: { issues: [issueKey] },
        errorContext: `Unable to add ${issueKey} to sprint ${sprintId}`,
      },
  );
}

export async function addJiraComment(
    issueKey: string,
    text: string,
): Promise<JiraComment> {
  return jiraFetch<JiraComment>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
      {
        method: 'POST',
        body: { body: createJiraDescription(text) },
        errorContext: `Unable to add comment to ${issueKey}`,
      },
  );
}
