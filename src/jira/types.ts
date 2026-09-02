export type JiraProject = {
  id: string;
  key: string;
  name: string;
};

export type JiraProjectSearchResponse = {
  values: JiraProject[];
};

export type JiraUser = {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  active: boolean;
};

export type JiraBoard = {
  id: number;
  name: string;
  type: string;
};

export type JiraBoardSearchResponse = {
  values: JiraBoard[];
};

export type JiraSprint = {
  id: number;
  name: string;
  state: string;
  originBoardId: number;
};

export type JiraSprintSearchResponse = {
  values: JiraSprint[];
};

export type JiraCreatedIssue = {
  id: string;
  key: string;
  self: string;
};

export type JiraPriority = {
  id: string;
  name: string;
};

export type JiraIssueType = {
  id: string;
  name: string;
  subtask: boolean;
};

export type JiraComment = {
  id: string;
  self: string;
  created: string;
  author?: {
    accountId: string;
    displayName: string;
  };
};

export type JiraNamedEntity = {
  id: string;
  name: string;
};

export type JiraStatus = {
  id: string;
  name: string;
  statusCategory?: {
    key: string;
    name: string;
  };
};

export type JiraIssueFields = {
  summary: string;
  description?: unknown;
  status?: JiraStatus;
  issuetype?: JiraNamedEntity & { subtask?: boolean };
  priority?: JiraNamedEntity;
  assignee?: JiraUser | null;
  reporter?: JiraUser | null;
  labels?: string[];
  created?: string;
  updated?: string;
  resolutiondate?: string | null;
  project?: JiraProject;
  parent?: {
    id: string;
    key: string;
    fields?: { summary?: string };
  };
  subtasks?: {
    id: string;
    key: string;
    fields?: { summary?: string; status?: JiraStatus };
  }[];
  // Populated by the Agile API (/rest/agile/1.0/issue/{key}).
  sprint?: JiraSprint | null;
  closedSprint?: JiraSprint[];
};

export type JiraIssue = {
  id: string;
  key: string;
  self: string;
  fields: JiraIssueFields;
};

export type JiraIssueComment = JiraComment & {
  body?: unknown;
  updated?: string;
};

export type JiraCommentPage = {
  comments: JiraIssueComment[];
  total: number;
};

export type JiraSearchResponse = {
  issues: JiraIssue[];
  isLast?: boolean;
  nextPageToken?: string;
};
