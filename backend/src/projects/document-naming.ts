import * as path from 'path';

/**
 * Renaming a project document without letting the extension change.
 *
 * The extension is not decoration: it is what the browser uses to decide
 * whether to preview or download a file, and what every reader uses to pick a
 * parser. A "rename" that turns report.pdf into report.exe produces a file the
 * system can no longer open, and the stored bytes have not changed at all.
 *
 * So the user names the file and the extension is carried over from what was
 * actually uploaded. Anything extension-shaped they type is discarded.
 */

/** Characters no file name should carry, plus anything path-like. */
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/g;

export const MAX_DOCUMENT_NAME_LENGTH = 180;

export class InvalidDocumentName extends Error {}

/**
 * The new stored name for a document, given what it is called now and what the
 * user typed.
 *
 * @throws InvalidDocumentName when nothing usable is left after cleaning.
 */
export function renameKeepingExtension(currentName: string, requestedName: string): string {
  const extension = path.extname(currentName || '');

  // basename() first: a name like "../../etc/passwd" must not escape anywhere,
  // and on a rename the directory part is never meaningful.
  let base = path.basename(String(requestedName ?? '').trim());
  base = base.replace(UNSAFE, '').trim();

  // Strip whatever extension they typed, but only when it is the real one --
  // compared case-insensitively so "REPORT.PDF" does not become
  // "REPORT.PDF.pdf". A different extension is left in place as ordinary text,
  // which is what makes "scope.exe" land as "scope.exe.pdf" rather than
  // silently becoming an executable name.
  if (extension) {
    const typed = path.extname(base);
    if (typed && typed.toLowerCase() === extension.toLowerCase()) {
      base = base.slice(0, -typed.length);
    }
  }

  // A leading dot would make the file hidden; a name of only dots is not a name.
  base = base.replace(/^\.+/, '').replace(/\.+$/, '').trim();

  if (!base) throw new InvalidDocumentName('A file name is required');

  const room = MAX_DOCUMENT_NAME_LENGTH - extension.length;
  if (room <= 0) throw new InvalidDocumentName('That file name is too long');
  if (base.length > room) base = base.slice(0, room).trim();

  return `${base}${extension}`;
}
