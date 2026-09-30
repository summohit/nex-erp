import { sanitiseRichText, hasVisibleText } from './rich-text';

/**
 * The body is HTML a browser produced and a browser will render. Angular
 * sanitises on the way out; this is the second line, so a stored payload never
 * reaches a consumer that forgets.
 */
describe('what survives sanitising', () => {
  it('keeps ordinary formatting', () => {
    const html = '<p>We think this is <strong>out of scope</strong>.</p><ul><li>One</li></ul>';
    expect(sanitiseRichText(html)).toBe(html);
  });

  it('keeps a normal link', () => {
    const html = '<p><a href="https://example.com/spec">the spec</a></p>';
    expect(sanitiseRichText(html)).toContain('href="https://example.com/spec"');
  });
});

describe('what does not', () => {
  it('removes a script tag and its contents', () => {
    const out = sanitiseRichText('<p>hi</p><script>alert(1)</script>');
    expect(out).toBe('<p>hi</p>');
    expect(out).not.toContain('alert');
  });

  it('removes an iframe', () => {
    expect(sanitiseRichText('<iframe src="http://evil"></iframe><p>x</p>')).toBe('<p>x</p>');
  });

  it('removes inline event handlers, quoted or not', () => {
    expect(sanitiseRichText('<img src="x" onerror="alert(1)">')).not.toContain('onerror');
    expect(sanitiseRichText("<div onclick='go()'>x</div>")).not.toContain('onclick');
    expect(sanitiseRichText('<div onmouseover=go()>x</div>')).not.toContain('onmouseover');
  });

  it('removes javascript: and data: urls', () => {
    expect(sanitiseRichText('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
    expect(sanitiseRichText('<a href="data:text/html,<script>">x</a>')).not.toContain('data:');
  });

  it('is not fooled by capitals', () => {
    expect(sanitiseRichText('<SCRIPT>alert(1)</SCRIPT>')).toBe('');
    expect(sanitiseRichText('<IMG SRC=x ONERROR="alert(1)">')).not.toContain('ONERROR');
  });
});

describe('whether anything was actually written', () => {
  it('sees real text', () => {
    expect(hasVisibleText('<p>Something</p>')).toBe(true);
  });

  /** Quill leaves this behind when the editor is emptied. */
  it('sees through an empty editor', () => {
    expect(hasVisibleText('<p><br></p>')).toBe(false);
    expect(hasVisibleText('<p>&nbsp;</p>')).toBe(false);
    expect(hasVisibleText('')).toBe(false);
  });
});
