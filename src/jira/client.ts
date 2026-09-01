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

  const response = await fetch(
      `${getJiraBaseUrl()}${path}`,
      {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
  );

  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(
        `${errorContext} (${response.status}): ${responseBody}`,
    );
  }

  return (responseBody ? JSON.parse(responseBody) : undefined) as T;
}
