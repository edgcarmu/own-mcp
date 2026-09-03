export function getJiraBaseUrl(): string {
  const baseUrl = process.env.JIRA_BASE_URL;

  if (!baseUrl) {
    throw new Error('Missing JIRA_BASE_URL');
  }

  return baseUrl.replace(/\/$/, '');
}

function getJiraAuthorization(): string {
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;

  if (!email || !apiToken) {
    throw new Error('Missing JIRA_EMAIL or JIRA_API_TOKEN');
  }

  const credentials = Buffer.from(
      `${email}:${apiToken}`,
  ).toString('base64');

  return `Basic ${credentials}`;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function getTimeoutMs(): number {
  const raw = process.env.JIRA_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;

  return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_TIMEOUT_MS;
}

function isDebugEnabled(): boolean {
  return process.env.JIRA_DEBUG === '1' || process.env.JIRA_DEBUG === 'true';
}

// STDOUT carries the MCP protocol, so diagnostics always go to STDERR.
function debug(message: string): void {
  if (isDebugEnabled()) {
    console.error(`[jira] ${message}`);
  }
}

const MAX_ERROR_BODY_CHARS = 1_500;

// Turns a Jira error response into a short, readable message. Jira returns
// { errorMessages: [...], errors: { field: message } } for most failures;
// anything else (HTML error pages, proxies) is truncated.
export function formatJiraErrorBody(body: string): string {
  const trimmed = body.trim();

  if (!trimmed) {
    return '';
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      errorMessages?: unknown;
      errors?: unknown;
      message?: unknown;
    };

    const parts: string[] = [];

    if (Array.isArray(parsed.errorMessages)) {
      parts.push(...parsed.errorMessages.map(String));
    }

    if (parsed.errors && typeof parsed.errors === 'object') {
      for (const [field, message] of Object.entries(parsed.errors)) {
        parts.push(`${field}: ${String(message)}`);
      }
    }

    if (parts.length === 0 && typeof parsed.message === 'string') {
      parts.push(parsed.message);
    }

    if (parts.length > 0) {
      return parts.join('; ');
    }
  } catch {
    // Not JSON: fall through to truncation.
  }

  return trimmed.length > MAX_ERROR_BODY_CHARS
      ? `${trimmed.slice(0, MAX_ERROR_BODY_CHARS)}…`
      : trimmed;
}

type JiraFetchOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  // Prefix for the error thrown on a non-2xx response,
  // e.g. "Unable to retrieve Jira projects".
  errorContext: string;
};

export async function jiraFetch<T>(
    path: string,
    { method = 'GET', body, errorContext }: JiraFetchOptions,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: getJiraAuthorization(),
    Accept: 'application/json',
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const url = `${getJiraBaseUrl()}${path}`;
  const timeoutMs = getTimeoutMs();
  const startedAt = Date.now();

  debug(`${method} ${path}`);

  let response: Response;

  try {
    response = await fetch(
        url,
        {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        },
    );
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    const timedOut = cause.name === 'TimeoutError' || cause.name === 'AbortError';

    debug(`${method} ${path} failed after ${Date.now() - startedAt}ms: ${cause.message}`);

    throw new Error(
        timedOut
            ? `${errorContext}: Jira did not respond within ${timeoutMs}ms`
            : `${errorContext}: network error (${cause.message})`,
    );
  }

  const responseBody = await response.text();

  debug(`${method} ${path} -> ${response.status} in ${Date.now() - startedAt}ms`);

  if (!response.ok) {
    const details = formatJiraErrorBody(responseBody);

    throw new Error(
        `${errorContext} (${response.status})${details ? `: ${details}` : ''}`,
    );
  }

  return (responseBody ? JSON.parse(responseBody) : undefined) as T;
}
