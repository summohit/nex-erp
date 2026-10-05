import sanitizeHtml from 'sanitize-html';

/**
 * HTML from the rich text editor (Quill), as stored and shown to other
 * people. Only what the editor produces is kept: no scripts, no handlers, no
 * styles beyond the editor's own classes. Used for notice bodies and ticket
 * comments.
 */
export function cleanRichHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'h1', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
      'blockquote', 'pre', 'code', 'ol', 'ul', 'li', 'a', 'span', 'sub', 'sup',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      '*': ['class', 'data-list', 'data-row'],
      td: ['colspan', 'rowspan', 'data-row'],
      th: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
    },
  }).trim();
}

/** The words alone, for notifications, excerpts and emptiness checks. */
export function richTextToPlain(html: string): string {
  return sanitizeHtml(
    (html || '').replace(/<\/(p|li|h\d|tr|blockquote)>|<br\s*\/?>/gi, ' '),
    { allowedTags: [], allowedAttributes: {} },
  ).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/** Whether the HTML has anything a person would read, not just empty paragraphs. */
export function hasRichText(html: string): boolean {
  return richTextToPlain(html).length > 0;
}
