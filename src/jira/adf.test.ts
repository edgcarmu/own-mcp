import assert from 'node:assert/strict';
import { test } from 'node:test';

import { adfToText, createJiraDescription, type AdfNode } from './adf.js';

function paragraph(text: string): AdfNode {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

test('createJiraDescription wraps text in a single paragraph document', () => {
  const doc = createJiraDescription('hello');

  assert.equal(doc.type, 'doc');
  assert.deepEqual(doc.content, [paragraph('hello')]);
});

test('adfToText handles null and plain strings', () => {
  assert.equal(adfToText(null), '');
  assert.equal(adfToText(undefined), '');
  assert.equal(adfToText('already plain'), 'already plain');
});

test('adfToText separates blocks with blank lines', () => {
  const doc: AdfNode = {
    type: 'doc',
    content: [paragraph('first'), paragraph('second')],
  };

  assert.equal(adfToText(doc), 'first\n\nsecond');
});

test('adfToText renders headings, code blocks and quotes', () => {
  const doc: AdfNode = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Steps' }] },
      { type: 'codeBlock', attrs: { language: 'sql' }, content: [{ type: 'text', text: 'SELECT 1;' }] },
      { type: 'blockquote', content: [paragraph('quoted')] },
    ],
  };

  assert.equal(
      adfToText(doc),
      '## Steps\n\n```sql\nSELECT 1;\n```\n\n> quoted',
  );
});

test('adfToText renders nested lists with indentation', () => {
  const doc: AdfNode = {
    type: 'doc',
    content: [
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [paragraph('one')] },
          {
            type: 'listItem',
            content: [
              paragraph('two'),
              {
                type: 'orderedList',
                attrs: { order: 3 },
                content: [{ type: 'listItem', content: [paragraph('sub')] }],
              },
            ],
          },
        ],
      },
    ],
  };

  assert.equal(adfToText(doc), '- one\n- two\n  3. sub');
});

test('adfToText keeps link targets, mentions and line breaks', () => {
  const doc: AdfNode = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'see ' },
          { type: 'text', text: 'PR', marks: [{ type: 'link', attrs: { href: 'https://x/pr/1' } }] },
          { type: 'hardBreak' },
          { type: 'mention', attrs: { text: '@Fabian' } },
        ],
      },
    ],
  };

  assert.equal(adfToText(doc), 'see PR (https://x/pr/1)\n@Fabian');
});

test('adfToText renders tables row by row and marks attachments', () => {
  const cell = (text: string): AdfNode => ({ type: 'tableCell', content: [paragraph(text)] });

  const doc: AdfNode = {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('a'), cell('b')] },
          { type: 'tableRow', content: [cell('1'), cell('2')] },
        ],
      },
      { type: 'mediaSingle', content: [{ type: 'media', attrs: {} }] },
    ],
  };

  assert.equal(adfToText(doc), '| a | b |\n| 1 | 2 |\n\n[attachment]');
});

test('adfToText keeps text of unknown block types', () => {
  const doc: AdfNode = {
    type: 'doc',
    content: [{ type: 'somethingNew', content: [paragraph('kept')] }],
  };

  assert.equal(adfToText(doc), 'kept');
});
