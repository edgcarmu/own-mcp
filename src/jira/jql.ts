// Escapes a value for use inside a double-quoted JQL string.
export function jqlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export type JqlFilters = {
  projectKey?: string;
  assignedToMe?: boolean;
  onlyOpen?: boolean;
  status?: string;
  issueType?: string;
  inActiveSprint?: boolean;
  text?: string;
};

// Builds a JQL query from simple filters. Returns null when no filter is set.
// `onlyOpen` defaults to true unless an explicit status is requested.
export function buildJql(filters: JqlFilters): string | null {
  const clauses: string[] = [];

  if (filters.projectKey) {
    clauses.push(`project = ${jqlString(filters.projectKey)}`);
  }

  if (filters.assignedToMe) {
    clauses.push('assignee = currentUser()');
  }

  if (filters.status) {
    clauses.push(`status = ${jqlString(filters.status)}`);
  } else if (filters.onlyOpen ?? true) {
    clauses.push('statusCategory != Done');
  }

  if (filters.issueType) {
    clauses.push(`issuetype = ${jqlString(filters.issueType)}`);
  }

  if (filters.inActiveSprint) {
    clauses.push('sprint in openSprints()');
  }

  if (filters.text) {
    clauses.push(`text ~ ${jqlString(filters.text)}`);
  }

  // A query made only of the implicit "open" clause is not a real filter.
  const explicitFilters = [
    filters.projectKey,
    filters.assignedToMe,
    filters.status,
    filters.issueType,
    filters.inActiveSprint,
    filters.text,
  ].some(Boolean);

  if (!explicitFilters) {
    return null;
  }

  return `${clauses.join(' AND ')} ORDER BY updated DESC`;
}
