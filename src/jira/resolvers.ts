import {
  getActiveSprints,
  getAssignableJiraUsers,
  getJiraBoards,
  getJiraProjects,
} from './api.js';
import type {
  JiraBoard,
  JiraIssueLinkType,
  JiraProject,
  JiraSprint,
  JiraTransition,
  JiraUser,
} from './types.js';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function formatOptions(
    items: { name: string; id: number | string }[],
): string {
  return items
      .map((item) => `${item.name} (${item.id})`)
      .join(', ');
}

// Matches a board or sprint by exact name or numeric ID.
function findByNameOrId<T extends { name: string; id: number }>(
    items: T[],
    query: string,
): T | undefined {
  const normalizedQuery = normalize(query);

  return items.find(
      (candidate) =>
          candidate.name.toLowerCase() === normalizedQuery ||
          String(candidate.id) === normalizedQuery,
  );
}

export async function resolveJiraProject(
    project: string,
): Promise<JiraProject> {
  const projects = await getJiraProjects(project);

  const normalizedProject = normalize(project);

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

export async function resolveJiraBoard(
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
    const exactMatch = findByNameOrId(boards, board);

    if (!exactMatch) {
      throw new Error(
          `Board "${board}" was not found. Available Scrum boards: ${formatOptions(boards)}`,
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

  throw new Error(
      `Multiple Scrum boards found for project "${projectKey}". Specify the board. Available boards: ${formatOptions(boards)}`,
  );
}

export function sprintMatchesProject(
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

export async function resolveActiveSprint(
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

  const availableSprints = formatOptions(activeSprints);

  if (sprint) {
    const exactMatch = findByNameOrId(activeSprints, sprint);

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

export function formatTransitions(
    transitions: JiraTransition[],
): string {
  return transitions
      .map(
          (transition) =>
              `${transition.name} -> ${transition.to.name} (${transition.id})`,
      )
      .join(', ');
}

// Matches a transition by its own name, by the name of the status it leads
// to, or by its numeric ID. Users usually think in target statuses
// ("In Progress") while Jira names transitions by action ("Start work").
export function resolveJiraTransition(
    transitions: JiraTransition[],
    target: string,
): JiraTransition {
  if (transitions.length === 0) {
    throw new Error(
        'No transitions are available for this issue with the current user',
    );
  }

  const normalizedTarget = normalize(target);

  const byId = transitions.find(
      (candidate) => candidate.id === normalizedTarget,
  );

  if (byId) {
    return byId;
  }

  const byName = transitions.filter(
      (candidate) => normalize(candidate.name) === normalizedTarget,
  );

  if (byName.length === 1) {
    return byName[0];
  }

  const byStatus = transitions.filter(
      (candidate) => normalize(candidate.to.name) === normalizedTarget,
  );

  if (byStatus.length === 1) {
    return byStatus[0];
  }

  const available = formatTransitions(transitions);

  if (byName.length > 1 || byStatus.length > 1) {
    throw new Error(
        `Transition "${target}" is ambiguous. Specify the transition ID. Available transitions: ${available}`,
    );
  }

  throw new Error(
      `Transition "${target}" was not found. Available transitions: ${available}`,
  );
}

// Resolves a person by display name, email, or account ID among the users
// that can be assigned to the issue.
export async function resolveAssignableJiraUser(
    issueKey: string,
    query: string,
): Promise<JiraUser> {
  const users = (await getAssignableJiraUsers(issueKey, query)).filter(
      (candidate) => candidate.active,
  );

  const normalizedQuery = normalize(query);

  const exactMatch = users.find(
      (candidate) =>
          candidate.accountId === query.trim() ||
          normalize(candidate.displayName) === normalizedQuery ||
          (candidate.emailAddress !== undefined &&
              normalize(candidate.emailAddress) === normalizedQuery),
  );

  if (exactMatch) {
    return exactMatch;
  }

  if (users.length === 1) {
    return users[0];
  }

  if (users.length === 0) {
    throw new Error(
        `No assignable user found matching "${query}" for ${issueKey}`,
    );
  }

  const matches = users
      .map((candidate) => candidate.displayName)
      .join(', ');

  throw new Error(
      `Multiple assignable users match "${query}": ${matches}. Use a full name, email, or account ID`,
  );
}

export function formatLinkTypes(linkTypes: JiraIssueLinkType[]): string {
  return linkTypes
      .map(
          (linkType) =>
              `${linkType.name} ("${linkType.outward}" / "${linkType.inward}")`,
      )
      .join(', ');
}

export type ResolvedLink = {
  linkType: JiraIssueLinkType;
  // True when the relation was given in the inward direction
  // ("is blocked by"), meaning the source issue is the inward one.
  sourceIsInward: boolean;
};

// Matches a relation by link type name ("Blocks"), outward description
// ("blocks") or inward description ("is blocked by").
export function resolveJiraLinkType(
    linkTypes: JiraIssueLinkType[],
    relation: string,
): ResolvedLink {
  const normalizedRelation = normalize(relation);

  const byOutward = linkTypes.find(
      (candidate) =>
          normalize(candidate.outward) === normalizedRelation ||
          normalize(candidate.name) === normalizedRelation,
  );

  if (byOutward) {
    return { linkType: byOutward, sourceIsInward: false };
  }

  const byInward = linkTypes.find(
      (candidate) => normalize(candidate.inward) === normalizedRelation,
  );

  if (byInward) {
    return { linkType: byInward, sourceIsInward: true };
  }

  throw new Error(
      `Relation "${relation}" was not found. Available link types: ${formatLinkTypes(linkTypes)}`,
  );
}
