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
