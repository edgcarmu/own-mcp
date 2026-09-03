import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildJql, jqlString } from './jql.js';

test('jqlString quotes and escapes backslashes and double quotes', () => {
  assert.equal(jqlString('plain'), '"plain"');
  assert.equal(jqlString('say "hi"'), '"say \\"hi\\""');
  assert.equal(jqlString('a\\b'), '"a\\\\b"');
});

test('buildJql returns null when no explicit filter is given', () => {
  assert.equal(buildJql({}), null);
  assert.equal(buildJql({ onlyOpen: true }), null);
  assert.equal(buildJql({ onlyOpen: false }), null);
});

test('buildJql excludes done issues by default', () => {
  assert.equal(
      buildJql({ assignedToMe: true }),
      'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC',
  );
});

test('buildJql drops the open clause when onlyOpen is false', () => {
  assert.equal(
      buildJql({ projectKey: 'DEV', onlyOpen: false }),
      'project = "DEV" ORDER BY updated DESC',
  );
});

test('buildJql prefers an explicit status over the open clause', () => {
  assert.equal(
      buildJql({ projectKey: 'DEV', status: 'In Progress' }),
      'project = "DEV" AND status = "In Progress" ORDER BY updated DESC',
  );
});

test('buildJql combines every filter in a stable order', () => {
  assert.equal(
      buildJql({
        projectKey: 'PP',
        assignedToMe: true,
        issueType: 'Bug',
        inActiveSprint: true,
        text: 'login "page"',
      }),
      'project = "PP" AND assignee = currentUser() AND statusCategory != Done AND issuetype = "Bug" AND sprint in openSprints() AND text ~ "login \\"page\\"" ORDER BY updated DESC',
  );
});
