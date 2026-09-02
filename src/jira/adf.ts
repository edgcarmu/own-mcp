// Helpers for Atlassian Document Format (ADF), the rich-text format Jira
// Cloud uses for descriptions and comments.

export type AdfNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: AdfNode[];
};

// Builds a minimal ADF body from plain text.
export function createJiraDescription(text: string): AdfNode {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text,
          },
        ],
      },
    ],
  } as AdfNode;
}

function renderChildren(node: AdfNode, separator = ''): string {
  return (node.content ?? [])
      .map((child) => adfNodeToText(child))
      .join(separator);
}

function renderListItems(node: AdfNode, marker: (index: number) => string): string {
  return (node.content ?? [])
      .map((item, index) => {
        const body = renderChildren(item, '\n').trim();
        const [first = '', ...rest] = body.split('\n');
        const indented = rest.map((line) => `  ${line}`);

        return [`${marker(index)}${first}`, ...indented].join('\n');
      })
      .join('\n');
}

function adfNodeToText(node: AdfNode): string {
  switch (node.type) {
    case 'text': {
      const text = node.text ?? '';
      const link = node.marks?.find((mark) => mark.type === 'link');
      const href = link?.attrs?.href;

      return typeof href === 'string' && href !== text
          ? `${text} (${href})`
          : text;
    }
    case 'hardBreak':
      return '\n';
    case 'mention':
      return String(node.attrs?.text ?? '@user');
    case 'emoji':
      return String(node.attrs?.text ?? node.attrs?.shortName ?? '');
    case 'inlineCard':
    case 'blockCard':
    case 'embedCard':
      return String(node.attrs?.url ?? '');
    case 'date':
      return String(node.attrs?.timestamp ?? '');
    case 'status':
      return `[${String(node.attrs?.text ?? '')}]`;
    case 'rule':
      return '---';
    case 'media':
    case 'mediaSingle':
    case 'mediaGroup':
    case 'mediaInline':
      return '[attachment]';
    case 'paragraph':
      return renderChildren(node);
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1);

      return `${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${renderChildren(node)}`;
    }
    case 'codeBlock':
      return `\`\`\`${String(node.attrs?.language ?? '')}\n${renderChildren(node)}\n\`\`\``;
    case 'blockquote':
      return renderChildren(node, '\n')
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n');
    case 'panel':
    case 'expand':
    case 'nestedExpand': {
      const title = node.attrs?.title;
      const body = renderChildren(node, '\n');

      return typeof title === 'string' ? `${title}\n${body}` : body;
    }
    case 'bulletList':
      return renderListItems(node, () => '- ');
    case 'orderedList': {
      const start = Number(node.attrs?.order ?? 1);

      return renderListItems(node, (index) => `${start + index}. `);
    }
    case 'taskList':
      return renderListItems(node, () => '- ');
    case 'taskItem':
      return `[${node.attrs?.state === 'DONE' ? 'x' : ' '}] ${renderChildren(node)}`;
    case 'decisionList':
      return renderListItems(node, () => '- ');
    case 'table':
      return renderChildren(node, '\n');
    case 'tableRow':
      return `| ${renderChildren(node, ' | ')} |`;
    case 'tableHeader':
    case 'tableCell':
      return renderChildren(node, ' ').trim();
    default:
      // Block-level nodes we do not know: keep their text content.
      return renderChildren(node, '\n');
  }
}

// Converts an ADF document (or null) to readable plain text.
// Block nodes are separated by blank lines, inline nodes are concatenated.
export function adfToText(doc: AdfNode | string | null | undefined): string {
  if (doc == null) {
    return '';
  }

  // Some Jira endpoints (Agile API, older instances) return plain strings.
  if (typeof doc === 'string') {
    return doc;
  }

  const blocks = (doc.content ?? []).map((node) => adfNodeToText(node));

  // Consecutive inline nodes at the top level are rare; block nodes get a blank line.
  return blocks
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
}
