import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import {
  resolveJiraLinkType,
  resolveJiraProject,
  resolveJiraTransition,
  sprintMatchesProject,
} from './resolvers.js';
import type {
  JiraIssueLinkType,
  JiraProject,
  JiraSprint,
  JiraTransition,
} from './types.js';

const support: JiraProject = { id: '1', key: 'DEV', name: 'Support' };
const percy: JiraProject = { id: '2', key: 'PP', name: 'Percy Product' };

function sprint(name: string): JiraSprint {
  return { id: 1, name, state: 'active', originBoardId: 1 };
}

test('sprintMatchesProject matches the project name or key as a whole word', () => {
  assert.equal(sprintMatchesProject(sprint('Support Sprint 48'), support), true);
  assert.equal(sprintMatchesProject(sprint('PP - Sprint 48'), percy), true);
  assert.equal(sprintMatchesProject(sprint('Percy Product 48'), percy), true);
  // "PP" must not match inside "Support".
  assert.equal(sprintMatchesProject(sprint('Support Sprint 48'), percy), false);
});

function transition(id: string, name: string, toName: string): JiraTransition {
  return { id, name, to: { id: `s${id}`, name: toName } };
}

const transitions = [
  transition('1', 'Start work', 'In Progress'),
  transition('2', 'Selected for Development', 'Todo'),
  transition('3', 'Done', 'Done'),
];

test('resolveJiraTransition matches by id, transition name, or target status', () => {
  assert.equal(resolveJiraTransition(transitions, '3').id, '3');
  assert.equal(resolveJiraTransition(transitions, 'start work').id, '1');
  assert.equal(resolveJiraTransition(transitions, 'in progress').id, '1');
  assert.equal(resolveJiraTransition(transitions, 'todo').id, '2');
});

test('resolveJiraTransition lists the options when nothing matches', () => {
  assert.throws(
      () => resolveJiraTransition(transitions, 'Closed'),
      /Transition "Closed" was not found\. Available transitions: Start work -> In Progress \(1\)/,
  );
  assert.throws(
      () => resolveJiraTransition([], 'Done'),
      /No transitions are available/,
  );
});

const linkTypes: JiraIssueLinkType[] = [
  { id: '10', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
  { id: '11', name: 'Relates', inward: 'relates to', outward: 'relates to' },
];

test('resolveJiraLinkType matches names and outward phrases as outward', () => {
  assert.deepEqual(resolveJiraLinkType(linkTypes, 'Blocks'), {
    linkType: linkTypes[0],
    sourceIsInward: false,
  });
  assert.deepEqual(resolveJiraLinkType(linkTypes, 'blocks'), {
    linkType: linkTypes[0],
    sourceIsInward: false,
  });
});

test('resolveJiraLinkType flags inward phrases so the issues get swapped', () => {
  assert.deepEqual(resolveJiraLinkType(linkTypes, 'is blocked by'), {
    linkType: linkTypes[0],
    sourceIsInward: true,
  });
});

test('resolveJiraLinkType reports available types when unknown', () => {
  assert.throws(
      () => resolveJiraLinkType(linkTypes, 'depends on'),
      /Relation "depends on" was not found\. Available link types: Blocks \("blocks" \/ "is blocked by"\)/,
  );
});

// resolveJiraProject goes through the HTTP client, so fetch is replaced with
// a stub that returns a fixed project list.
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function stubProjects(projects: JiraProject[]): void {
  globalThis.fetch = (async () =>
      new Response(JSON.stringify({ values: projects }), { status: 200 })) as typeof fetch;
}

beforeEach(() => {
  process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
  process.env.JIRA_EMAIL = 'me@example.com';
  process.env.JIRA_API_TOKEN = 'token';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

test('resolveJiraProject prefers an exact key or name match', async () => {
  stubProjects([percy, support]);

  assert.equal((await resolveJiraProject('dev')).key, 'DEV');
  assert.equal((await resolveJiraProject('percy product')).key, 'PP');
});

test('resolveJiraProject accepts a single fuzzy match and rejects ambiguity', async () => {
  stubProjects([percy]);
  assert.equal((await resolveJiraProject('perc')).key, 'PP');

  stubProjects([percy, support]);
  await assert.rejects(
      resolveJiraProject('p'),
      /Multiple Jira projects match "p": Percy Product \(PP\), Support \(DEV\)/,
  );

  stubProjects([]);
  await assert.rejects(resolveJiraProject('zzz'), /No Jira project found/);
});
