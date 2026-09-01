import {
  getActiveSprints,
  getJiraBoards,
  getJiraProjects,
} from './api.js';
import type {
  JiraBoard,
  JiraProject,
  JiraSprint,
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
