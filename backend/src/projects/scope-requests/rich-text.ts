/**
 * What is safe to store from a rich-text editor.
 *
 * The body arrives as HTML the browser produced, and will be rendered back
 * into a page. Angular's `[innerHTML]` sanitises on the way out, which is the
 * real defence — this is the second one, so that a stored payload never
 * reaches a consumer that forgets. Anything reading this column later (an
 * export, a PDF, an email) inherits the guarantee without having to know.
 *
 * Deliberately a strip, not a reject: somebody pasting from Word should not
 * have their request refused because the clipboard carried a stray attribute.
 * What comes out is what they wrote, minus what could execute.
 */

/** Tags whose content is script, not text, however they are spelled. */
const EXECUTABLE_TAGS = ['script', 'iframe', 'object', 'embed', 'link', 'style', 'base', 'form'];

export function sanitiseRichText(html: string): string {
  let out = html ?? '';

  for (const tag of EXECUTABLE_TAGS) {
    // Paired form, including anything between the tags.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    // And the unpaired form, which is how <link> and <base> normally appear.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), '');
  }

  // Inline event handlers: onclick=, onerror=, onload=, quoted or not.
  out = out.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
  out = out.replace(/\son\w+\s*=\s*[^\s>]+/gi, '');

  // javascript: and data: URLs in href/src. data: is included because
  // data:text/html executes in the same origin when navigated to.
  out = out.replace(/\s(href|src)\s*=\s*"(?:javascript|data):[^"]*"/gi, '');
  out = out.replace(/\s(href|src)\s*=\s*'(?:javascript|data):[^']*'/gi, '');

  return out.trim();
}

/** Whether anything survives once the markup is gone — an empty body is not a request. */
export function hasVisibleText(html: string): boolean {
  return (html ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim().length > 0;
}
