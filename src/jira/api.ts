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
  JiraIssueLinkType,
  JiraIssueLinkTypesResponse,
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

// Returns the standard issue types of a project, or only the subtask
// types when `subtasks` is true.
export async function getJiraIssueTypes(
    projectKey: string,
    subtasks = false,
): Promise<JiraIssueType[]> {
  const project = await jiraFetch<{ issueTypes?: JiraIssueType[] }>(
      `/rest/api/3/project/${projectKey}?expand=issueTypes`,
      {
        errorContext: `Unable to retrieve issue types for project "${projectKey}"`,
      },
  );

  return (project.issueTypes ?? []).filter(
      (issueType) => Boolean(issueType.subtask) === subtasks,
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
  'resolution',
  'subtasks',
  'issuelinks',
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

export type JiraSearchPage = {
  issues: JiraIssue[];
  nextPageToken: string | null;
};

// `pageToken` continues a previous search; Jira returns `nextPageToken`
// until the last page.
export async function searchJiraIssues(
    jql: string,
    maxResults: number,
    pageToken?: string,
): Promise<JiraSearchPage> {
  const body: Record<string, unknown> = {
    jql,
    maxResults,
    fields: ISSUE_SUMMARY_FIELDS,
  };

  if (pageToken) {
    body.nextPageToken = pageToken;
  }

  const result = await jiraFetch<JiraSearchResponse>(
      '/rest/api/3/search/jql',
      {
        method: 'POST',
        body,
        errorContext: 'Unable to search Jira issues',
      },
  );

  return {
    issues: result.issues,
    nextPageToken: result.isLast === false && result.nextPageToken
        ? result.nextPageToken
        : null,
  };
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
    fields?: Record<string, unknown>,
): Promise<void> {
  const body: Record<string, unknown> = {
    transition: { id: transitionId },
  };

  if (fields && Object.keys(fields).length > 0) {
    body.fields = fields;
  }

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

export async function updateJiraIssue(
    issueKey: string,
    fields: Record<string, unknown>,
    update?: Record<string, unknown>,
): Promise<void> {
  const body: Record<string, unknown> = { fields };

  if (update && Object.keys(update).length > 0) {
    body.update = update;
  }

  await jiraFetch<void>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
      {
        method: 'PUT',
        body,
        errorContext: `Unable to update ${issueKey}`,
      },
  );
}

// Returns users who can be assigned to the issue, optionally filtered by
// name or email. Unlike /user/search this respects project permissions.
export async function getAssignableJiraUsers(
    issueKey: string,
    query?: string,
): Promise<JiraUser[]> {
  const params = new URLSearchParams({
    issueKey,
    maxResults: '50',
  });

  if (query) {
    params.set('query', query);
  }

  return jiraFetch<JiraUser[]>(
      `/rest/api/3/user/assignable/search?${params.toString()}`,
      {
        errorContext: `Unable to search assignable users for ${issueKey}`,
      },
  );
}

// Pass null to unassign.
export async function assignJiraIssue(
    issueKey: string,
    accountId: string | null,
): Promise<void> {
  await jiraFetch<void>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/assignee`,
      {
        method: 'PUT',
        body: { accountId },
        errorContext: `Unable to assign ${issueKey}`,
      },
  );
}

export async function moveIssuesToBacklog(
    issueKeys: string[],
): Promise<void> {
  await jiraFetch<void>(
      '/rest/agile/1.0/backlog/issue',
      {
        method: 'POST',
        body: { issues: issueKeys },
        errorContext: `Unable to move ${issueKeys.join(', ')} to the backlog`,
      },
  );
}

export async function getJiraIssueLinkTypes(): Promise<JiraIssueLinkType[]> {
  const result = await jiraFetch<JiraIssueLinkTypesResponse>(
      '/rest/api/3/issueLinkType',
      {
        errorContext: 'Unable to retrieve Jira issue link types',
      },
  );

  return result.issueLinkTypes;
}

// Creates "<outwardKey> <type.outward> <inwardKey>", e.g. for the Blocks
// type: outward DEV-1 "blocks" inward DEV-2.
export async function linkJiraIssues(
    linkTypeName: string,
    outwardKey: string,
    inwardKey: string,
    comment?: string,
): Promise<void> {
  const body: Record<string, unknown> = {
    type: { name: linkTypeName },
    outwardIssue: { key: outwardKey },
    inwardIssue: { key: inwardKey },
  };

  if (comment) {
    body.comment = { body: createJiraDescription(comment) };
  }

  await jiraFetch<void>(
      '/rest/api/3/issueLink',
      {
        method: 'POST',
        body,
        errorContext: `Unable to link ${outwardKey} and ${inwardKey}`,
      },
  );
}
