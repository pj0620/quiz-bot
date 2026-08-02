import { isNotePath, noteFolder, noteStem } from './paths';

describe('isNotePath', () => {
  it('accepts markdown anywhere in the vault', () => {
    expect(isNotePath('History of America 40 First Year.md')).toBe(true);
    expect(isNotePath('History/Civil War/Fort Sumter.mdx')).toBe(true);
  });

  it('rejects everything that is not markdown', () => {
    // The whole reason this exists: a vault is full of pasted screenshots.
    expect(isNotePath('History/Pasted image 20260707210812.png')).toBe(false);
    expect(isNotePath('src/index.ts')).toBe(false);
    expect(isNotePath('notes.pdf')).toBe(false);
  });

  it('skips vault machinery', () => {
    expect(isNotePath('.obsidian/workspace.md')).toBe(false);
    expect(isNotePath('.trash/Deleted Note.md')).toBe(false);
    expect(isNotePath('Templates/Daily Note.md')).toBe(false);
    expect(isNotePath('attachments/clip.md')).toBe(false);
  });

  it('skips repository housekeeping that happens to be markdown', () => {
    expect(isNotePath('README.md')).toBe(false);
    expect(isNotePath('docs/LICENSE.md')).toBe(false);
  });
});

describe('noteStem', () => {
  it('strips directories and the extension', () => {
    expect(noteStem('History/History of America 40 First Year.md')).toBe(
      'History of America 40 First Year',
    );
  });

  it('leaves dots inside a name alone', () => {
    expect(noteStem('Notes/Ch. 4 Anchoring.md')).toBe('Ch. 4 Anchoring');
  });
});

describe('noteFolder', () => {
  it('returns the subject folder', () => {
    expect(noteFolder('History/Civil War/Fort Sumter.md')).toBe('Civil War');
  });

  it('returns null at the vault root', () => {
    expect(noteFolder('Fort Sumter.md')).toBeNull();
  });

  it('ignores hidden folders', () => {
    expect(noteFolder('.obsidian/plugins/note.md')).toBe('plugins');
    expect(noteFolder('.hidden/note.md')).toBeNull();
  });
});
