import { parseLinkHeader } from './http';
import { buildQuery, encodeFilePath, encodePathSegment } from './query';
import { encodeForm } from './form';
import { formatCountdown } from './time';

describe('parseLinkHeader', () => {
  it('returns an empty object for absent headers', () => {
    expect(parseLinkHeader(null)).toEqual({});
    expect(parseLinkHeader(undefined)).toEqual({});
    expect(parseLinkHeader('')).toEqual({});
  });

  it('parses next and last', () => {
    const header =
      '<https://api.github.com/user/installations?page=2>; rel="next", ' +
      '<https://api.github.com/user/installations?page=5>; rel="last"';
    expect(parseLinkHeader(header)).toEqual({
      next: 'https://api.github.com/user/installations?page=2',
      last: 'https://api.github.com/user/installations?page=5',
    });
  });

  it('tolerates unquoted rel values', () => {
    expect(parseLinkHeader('<https://example.com/x>; rel=next')).toEqual({
      next: 'https://example.com/x',
    });
  });

  it('preserves query strings containing commas', () => {
    const header = '<https://api.github.com/x?a=1&b=2>; rel="next"';
    expect(parseLinkHeader(header).next).toBe('https://api.github.com/x?a=1&b=2');
  });
});

describe('buildQuery', () => {
  it('returns an empty string when nothing is set', () => {
    expect(buildQuery({})).toBe('');
    expect(buildQuery({ a: undefined, b: null })).toBe('');
  });

  it('skips undefined and null but keeps falsy values', () => {
    expect(buildQuery({ a: 1, b: undefined, c: 0, d: false })).toBe('?a=1&c=0&d=false');
  });

  it('encodes keys and values', () => {
    expect(buildQuery({ q: 'a b&c' })).toBe('?q=a%20b%26c');
  });
});

describe('path encoding', () => {
  it('escapes a single segment including slashes', () => {
    expect(encodePathSegment('feature/branch')).toBe('feature%2Fbranch');
  });

  it('preserves separators but escapes each file path segment', () => {
    expect(encodeFilePath('src/a b.ts')).toBe('src/a%20b.ts');
  });

  it('drops empty segments from leading or doubled slashes', () => {
    expect(encodeFilePath('/src//index.ts')).toBe('src/index.ts');
  });
});

describe('encodeForm', () => {
  it('encodes fields and skips undefined', () => {
    expect(encodeForm({ client_id: 'Iv23li', grant_type: 'refresh_token', extra: undefined })).toBe(
      'client_id=Iv23li&grant_type=refresh_token',
    );
  });

  it('escapes reserved characters', () => {
    expect(encodeForm({ code: 'a+b/c=d' })).toBe('code=a%2Bb%2Fc%3Dd');
  });
});

describe('formatCountdown', () => {
  it('formats mm:ss', () => {
    expect(formatCountdown(900_000)).toBe('15:00');
    expect(formatCountdown(61_000)).toBe('1:01');
    expect(formatCountdown(9_000)).toBe('0:09');
  });

  it('clamps at zero', () => {
    expect(formatCountdown(-5_000)).toBe('0:00');
  });
});
