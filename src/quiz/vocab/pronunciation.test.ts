import { HttpError } from '../../lib/http';
import {
  audioFromDictionaryPayload,
  candidateAudioUrls,
  pronunciationToken,
  resolvePronunciationUrl,
} from './pronunciation';

/*
  Resolution caches per token for the life of the process, so every resolve
  test uses its own word — sharing one would let a cache hit from an earlier
  test satisfy a later one and hide a broken transport chain.
*/

describe('pronunciationToken', () => {
  it('lowercases and trims', () => {
    expect(pronunciationToken('  Desultory ')).toBe('desultory');
  });

  it('joins phrases with underscores, as the sound filenames do', () => {
    expect(pronunciationToken('Ad Hoc')).toBe('ad_hoc');
    expect(pronunciationToken('beg  the question')).toBe('beg_the_question');
  });

  it('strips accents to ASCII', () => {
    expect(pronunciationToken('naïve')).toBe('naive');
  });

  it('drops punctuation but keeps hyphens', () => {
    expect(pronunciationToken("o'clock")).toBe('oclock');
    expect(pronunciationToken('well-being')).toBe('well-being');
  });

  it('reduces a non-word to nothing', () => {
    expect(pronunciationToken('!!!')).toBe('');
  });
});

describe('candidateAudioUrls', () => {
  it('offers each gstatic generation, newest first', () => {
    expect(candidateAudioUrls('hello')).toEqual([
      'https://ssl.gstatic.com/dictionary/static/sounds/20200429/hello--_us_1.mp3',
      'https://ssl.gstatic.com/dictionary/static/sounds/oxford/hello--_us_1.mp3',
    ]);
  });

  it('offers nothing for a word with no token', () => {
    expect(candidateAudioUrls('???')).toEqual([]);
  });
});

describe('audioFromDictionaryPayload', () => {
  const entry = (...audio: (string | undefined)[]) => [
    { phonetics: audio.map((url) => ({ text: '/x/', audio: url })) },
  ];

  it('returns undefined for shapes that are not the API answer', () => {
    expect(audioFromDictionaryPayload(undefined)).toBeUndefined();
    expect(audioFromDictionaryPayload({ title: 'No Definitions Found' })).toBeUndefined();
    expect(audioFromDictionaryPayload([])).toBeUndefined();
    expect(audioFromDictionaryPayload([{ phonetics: 'nope' }])).toBeUndefined();
    expect(audioFromDictionaryPayload([{ phonetics: [{ audio: 42 }, {}] }])).toBeUndefined();
  });

  it('prefers an American recording when one is offered', () => {
    const payload = entry(
      'https://api.dictionaryapi.dev/media/pronunciations/en/hello-uk.mp3',
      'https://api.dictionaryapi.dev/media/pronunciations/en/hello-us.mp3',
    );
    expect(audioFromDictionaryPayload(payload)).toBe(
      'https://api.dictionaryapi.dev/media/pronunciations/en/hello-us.mp3',
    );
  });

  it('falls back to whatever recording exists', () => {
    const payload = entry('', 'https://api.dictionaryapi.dev/media/pronunciations/en/hello-uk.mp3');
    expect(audioFromDictionaryPayload(payload)).toBe(
      'https://api.dictionaryapi.dev/media/pronunciations/en/hello-uk.mp3',
    );
  });

  it('completes protocol-relative gstatic URLs', () => {
    const payload = entry('//ssl.gstatic.com/dictionary/static/sounds/20200429/hello--_us_1.mp3');
    expect(audioFromDictionaryPayload(payload)).toBe(
      'https://ssl.gstatic.com/dictionary/static/sounds/20200429/hello--_us_1.mp3',
    );
  });

  it('refuses plain-http recordings rather than fixing them up', () => {
    expect(
      audioFromDictionaryPayload(entry('http://example.com/hello.mp3')),
    ).toBeUndefined();
  });
});

describe('resolvePronunciationUrl', () => {
  const notFound = () => new HttpError(404, new Headers(), '', undefined);

  it('answers with the first gstatic hit and never asks the dictionary', async () => {
    const probe = jest.fn().mockResolvedValue(true);
    const lookup = jest.fn();

    await expect(resolvePronunciationUrl('laconic', { probe, lookup })).resolves.toBe(
      'https://ssl.gstatic.com/dictionary/static/sounds/20200429/laconic--_us_1.mp3',
    );
    expect(probe).toHaveBeenCalledTimes(1);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('falls through the generations to the dictionary', async () => {
    const probe = jest.fn().mockResolvedValue(false);
    const lookup = jest.fn().mockResolvedValue([
      { phonetics: [{ audio: 'https://example.com/media/perfunctory-us.mp3' }] },
    ]);

    await expect(resolvePronunciationUrl('perfunctory', { probe, lookup })).resolves.toBe(
      'https://example.com/media/perfunctory-us.mp3',
    );
    expect(probe).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('remembers a hit, so replays cost nothing', async () => {
    const probe = jest.fn().mockResolvedValue(true);
    const lookup = jest.fn();

    await resolvePronunciationUrl('sinecure', { probe, lookup });
    await resolvePronunciationUrl('Sinecure', { probe, lookup });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('remembers a definitive miss — every source answered no', async () => {
    const probe = jest.fn().mockResolvedValue(false);
    const lookup = jest.fn().mockRejectedValue(notFound());

    await expect(resolvePronunciationUrl('brackish', { probe, lookup })).resolves.toBeUndefined();
    await expect(resolvePronunciationUrl('brackish', { probe, lookup })).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('does not remember a failure to ask — the next tap may be back online', async () => {
    const probe = jest.fn().mockRejectedValue(new Error('offline'));
    const lookup = jest.fn().mockRejectedValue(new Error('offline'));

    await expect(resolvePronunciationUrl('elide', { probe, lookup })).resolves.toBeUndefined();
    await expect(resolvePronunciationUrl('elide', { probe, lookup })).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(4);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('still resolves through the dictionary when the probes cannot get out', async () => {
    const probe = jest.fn().mockRejectedValue(new Error('blocked'));
    const lookup = jest.fn().mockResolvedValue([
      { phonetics: [{ audio: 'https://example.com/media/apocryphal-us.mp3' }] },
    ]);

    await expect(resolvePronunciationUrl('apocryphal', { probe, lookup })).resolves.toBe(
      'https://example.com/media/apocryphal-us.mp3',
    );
  });

  it('declines a word with no token without asking anyone', async () => {
    const probe = jest.fn();
    const lookup = jest.fn();

    await expect(resolvePronunciationUrl('   ', { probe, lookup })).resolves.toBeUndefined();
    expect(probe).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });
});
