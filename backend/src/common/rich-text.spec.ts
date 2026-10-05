import { cleanRichHtml, hasRichText, richTextToPlain } from './rich-text';

describe('rich text from the editor', () => {
  it('keeps formatting and drops anything that runs', () => {
    const out = cleanRichHtml('<p><strong>a</strong><img src=x onerror="x()"><script>y()</script></p><a href="javascript:z">l</a>');
    expect(out).toContain('<strong>a</strong>');
    expect(out).not.toMatch(/script|onerror|javascript|<img/);
  });

  it('reads as words for a notification', () => {
    expect(richTextToPlain('<p>Fixed it.</p><ol><li data-list="bullet">Restarted &amp; checked</li></ol>'))
      .toBe('Fixed it. Restarted & checked');
  });

  it('counts empty paragraphs as nothing', () => {
    expect(hasRichText('<p><br></p><p> </p>')).toBe(false);
    expect(hasRichText('plain old text')).toBe(true);
  });
});
