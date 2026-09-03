import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { formatJiraErrorBody, getJiraBaseUrl, jiraFetch } from './client.js';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.JIRA_BASE_URL = 'https://example.atlassian.net/';
  process.env.JIRA_EMAIL = 'me@example.com';
  process.env.JIRA_API_TOKEN = 'token';
  delete process.env.JIRA_TIMEOUT_MS;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

test('getJiraBaseUrl strips the trailing slash and requires the variable', () => {
  assert.equal(getJiraBaseUrl(), 'https://example.atlassian.net');

  delete process.env.JIRA_BASE_URL;
  assert.throws(() => getJiraBaseUrl(), /Missing JIRA_BASE_URL/);
});

test('formatJiraErrorBody flattens Jira error JSON', () => {
  const body = JSON.stringify({
    errorMessages: ['Issue does not exist'],
    errors: { summary: 'Field required' },
  });

  assert.equal(
      formatJiraErrorBody(body),
      'Issue does not exist; summary: Field required',
  );
  assert.equal(formatJiraErrorBody('{"message":"Unauthorized"}'), 'Unauthorized');
  assert.equal(formatJiraErrorBody('   '), '');
});

test('formatJiraErrorBody truncates non-JSON bodies', () => {
  const html = '<html>'.padEnd(5000, 'x');
  const formatted = formatJiraErrorBody(html);

  assert.ok(formatted.length < 1600);
  assert.ok(formatted.endsWith('…'));
});

test('jiraFetch sends auth headers and parses JSON', async () => {
  let captured: { url: string; init: RequestInit } | null = null;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), init: init ?? {} };

    return new Response('{"ok":true}', { status: 200 });
  }) as typeof fetch;

  const result = await jiraFetch<{ ok: boolean }>('/rest/api/3/myself', {
    errorContext: 'Unable to get user',
  });

  assert.deepEqual(result, { ok: true });
  assert.ok(captured);

  const { url, init } = captured as { url: string; init: RequestInit };
  const headers = init.headers as Record<string, string>;

  assert.equal(url, 'https://example.atlassian.net/rest/api/3/myself');
  assert.equal(init.method, 'GET');
  assert.match(headers.Authorization, /^Basic /);
  assert.equal(headers['Content-Type'], undefined);
  assert.ok(init.signal instanceof AbortSignal);
});

test('jiraFetch serializes the body and returns undefined on empty responses', async () => {
  let sentBody: string | undefined;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sentBody = init?.body as string;

    return new Response(null, { status: 204 });
  }) as typeof fetch;

  const result = await jiraFetch<void>('/x', {
    method: 'POST',
    body: { issues: ['DEV-1'] },
    errorContext: 'ctx',
  });

  assert.equal(result, undefined);
  assert.equal(sentBody, '{"issues":["DEV-1"]}');
});

test('jiraFetch wraps non-2xx responses with context, status and details', async () => {
  globalThis.fetch = (async () =>
      new Response('{"errorMessages":["Issue does not exist"]}', { status: 404 })) as typeof fetch;

  await assert.rejects(
      jiraFetch('/x', { errorContext: 'Unable to get DEV-1' }),
      /^Error: Unable to get DEV-1 \(404\): Issue does not exist$/,
  );
});

test('jiraFetch reports a timeout when Jira does not answer in time', async () => {
  process.env.JIRA_TIMEOUT_MS = '20';

  // AbortSignal.timeout does not keep the event loop alive, so the stub
  // holds a real timer until the abort arrives.
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const guard = setTimeout(
            () => reject(new Error('stub was never aborted')),
            1_000,
        );

        init?.signal?.addEventListener('abort', () => {
          clearTimeout(guard);
          reject(init.signal?.reason);
        });
      })) as typeof fetch;

  await assert.rejects(
      jiraFetch('/slow', { errorContext: 'Unable to search' }),
      /Unable to search: Jira did not respond within 20ms/,
  );
});

test('jiraFetch reports network failures', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;

  await assert.rejects(
      jiraFetch('/x', { errorContext: 'Unable to search' }),
      /Unable to search: network error \(fetch failed\)/,
  );
});
