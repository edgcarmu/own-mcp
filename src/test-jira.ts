import 'dotenv/config';

const {
    JIRA_BASE_URL,
    JIRA_EMAIL,
    JIRA_API_TOKEN,
} = process.env;

if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    throw new Error('Missing Jira environment variables');
}

const credentials = Buffer.from(
    `${JIRA_EMAIL}:${JIRA_API_TOKEN}`,
).toString('base64');

const response = await fetch(
    `${JIRA_BASE_URL}/rest/api/3/myself`,
    {
        headers: {
            Authorization: `Basic ${credentials}`,
            Accept: 'application/json',
        },
    },
);

if (!response.ok) {
    const body = await response.text();

    throw new Error(
        `Jira authentication failed (${response.status}): ${body}`,
    );
}

const user = await response.json();

console.log(JSON.stringify(user, null, 2));