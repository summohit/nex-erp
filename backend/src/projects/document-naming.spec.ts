import { renameKeepingExtension, InvalidDocumentName, MAX_DOCUMENT_NAME_LENGTH } from './document-naming';

/**
 * The rule: the user names the file, the system keeps the extension. The bytes
 * on disk never change, so neither may the thing that says how to read them.
 */
describe('renameKeepingExtension', () => {
  it('appends the original extension to a bare name', () => {
    expect(renameKeepingExtension('scope.pdf', 'Signed scope document')).toBe('Signed scope document.pdf');
  });

  // The case the whole helper exists for.
  it('refuses to let the extension be changed', () => {
    expect(renameKeepingExtension('scope.pdf', 'scope.exe')).toBe('scope.exe.pdf');
    expect(renameKeepingExtension('scope.pdf', 'scope.docx')).toBe('scope.docx.pdf');
  });

  it('does not double up when they retype the real extension', () => {
    expect(renameKeepingExtension('scope.pdf', 'Final scope.pdf')).toBe('Final scope.pdf');
  });

  it('matches the extension case-insensitively', () => {
    expect(renameKeepingExtension('scope.PDF', 'Final scope.pdf')).toBe('Final scope.PDF');
    expect(renameKeepingExtension('scope.pdf', 'Final scope.PDF')).toBe('Final scope.pdf');
  });

  it('keeps interior dots in the name', () => {
    expect(renameKeepingExtension('scope.pdf', 'v1.2 scope')).toBe('v1.2 scope.pdf');
  });

  it('leaves a file that never had an extension without one', () => {
    expect(renameKeepingExtension('README', 'Read me first')).toBe('Read me first');
  });

  describe('rejects what cannot be a name', () => {
    it.each([
      ['empty', ''],
      ['only whitespace', '   '],
      ['only dots', '...'],
      ['only unsafe characters', '///'],
      ['null', null as any],
      ['undefined', undefined as any],
    ])('%s', (_label, value) => {
      expect(() => renameKeepingExtension('scope.pdf', value)).toThrow(InvalidDocumentName);
    });
  });

  describe('cleans dangerous input', () => {
    it('strips a path and keeps only the file name', () => {
      expect(renameKeepingExtension('scope.pdf', '../../etc/passwd')).toBe('passwd.pdf');
    });

    it.each([
      ['a colon', 'sco:pe'],
      ['a pipe', 'sco|pe'],
      ['a quote', 'sco"pe'],
      ['an asterisk', 'sco*pe'],
    ])('removes %s', (_label, value) => {
      expect(renameKeepingExtension('scope.pdf', value)).toBe('scope.pdf');
    });

    it('removes a control character', () => {
      expect(renameKeepingExtension('scope.pdf', 'sco\u0000pe')).toBe('scope.pdf');
    });

    // A leading dot would hide the file.
    it('will not produce a hidden file', () => {
      expect(renameKeepingExtension('scope.pdf', '.hidden')).toBe('hidden.pdf');
    });
  });

  it('truncates a very long name but keeps the extension', () => {
    const result = renameKeepingExtension('scope.pdf', 'a'.repeat(500));

    expect(result.endsWith('.pdf')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(MAX_DOCUMENT_NAME_LENGTH);
  });
});
