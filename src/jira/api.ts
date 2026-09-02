import { createJiraDescription } from './adf.js';
import { jiraFetch } from './client.js';
import type {
  JiraBoard,
  JiraBoardSearchResponse,
  JiraComment,
  JiraCommentPage,
  JiraCreatedIssue,
  JiraIssue,
  JiraIssueComment,
  JiraIssueType,
  JiraPriority,
  JiraProject,
  JiraProjectSearchResponse,
  JiraSearchResponse,
  JiraSprint,
  JiraSprintSearchResponse,
  JiraTransition,
  JiraTransitionsResponse,
  JiraUser,
} from './types.js';

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

export const ISSUE_SUMMARY_FIELDS = [
  'summary',
  'status',
  'issuetype',
  'priority',
  'assignee',
  'reporter',
  'labels',
  'created',
  'updated',
  'project',
  'parent',
];

export const ISSUE_DETAIL_FIELDS = [
  ...ISSUE_SUMMARY_FIELDS,
  'description',
  'resolutiondate',
  'subtasks',
];

export async function getJiraIssue(
    issueKey: string,
): Promise<JiraIssue> {
  const params = new URLSearchParams({
    fields: ISSUE_DETAIL_FIELDS.join(','),
  });

  return jiraFetch<JiraIssue>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}?${params.toString()}`,
      {
        errorContext: `Unable to retrieve Jira issue ${issueKey}`,
      },
  );
}

// The sprint is only exposed as a named field by the Agile API. The REST v3
// endpoint is still used for the rest because the Agile one returns the
// description as wiki markup instead of ADF.
export async function getJiraIssueSprint(
    issueKey: string,
): Promise<JiraSprint | null> {
  const params = new URLSearchParams({
    fields: 'sprint',
  });

  const issue = await jiraFetch<JiraIssue>(
      `/rest/agile/1.0/issue/${encodeURIComponent(issueKey)}?${params.toString()}`,
      {
        errorContext: `Unable to retrieve sprint for ${issueKey}`,
      },
  );

  return issue.fields.sprint ?? null;
}

export async function getJiraIssueComments(
    issueKey: string,
    maxResults: number,
): Promise<JiraCommentPage> {
  const params = new URLSearchParams({
    orderBy: '-created',
    maxResults: String(maxResults),
  });

  const page = await jiraFetch<JiraCommentPage>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?${params.toString()}`,
      {
        errorContext: `Unable to retrieve comments for ${issueKey}`,
      },
  );

  // Return oldest first so the thread reads top to bottom.
  const comments: JiraIssueComment[] = [...page.comments].reverse();

  return { comments, total: page.total };
}

export async function searchJiraIssues(
    jql: string,
    maxResults: number,
): Promise<JiraIssue[]> {
  const result = await jiraFetch<JiraSearchResponse>(
      '/rest/api/3/search/jql',
      {
        method: 'POST',
        body: {
          jql,
          maxResults,
          fields: ISSUE_SUMMARY_FIELDS,
        },
        errorContext: 'Unable to search Jira issues',
      },
  );

  return result.issues;
}

export async function getJiraTransitions(
    issueKey: string,
): Promise<JiraTransition[]> {
  const result = await jiraFetch<JiraTransitionsResponse>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
      {
        errorContext: `Unable to retrieve transitions for ${issueKey}`,
      },
  );

  return result.transitions;
}

// Applies a workflow transition. When a comment is given it is added in the
// same request, so the status change and the note land together or not at all.
export async function transitionJiraIssue(
    issueKey: string,
    transitionId: string,
    comment?: string,
): Promise<void> {
  const body: Record<string, unknown> = {
    transition: { id: transitionId },
  };

  if (comment) {
    body.update = {
      comment: [{ add: { body: createJiraDescription(comment) } }],
    };
  }

  await jiraFetch<void>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
      {
        method: 'POST',
        body,
        errorContext: `Unable to transition ${issueKey}`,
      },
  );
}
