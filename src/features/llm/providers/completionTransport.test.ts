import { requestJson } from '../../../lib/http';
import { COMPLETION_TIMEOUT_MS } from '../contract';
import type { CompletionInput } from '../types';
import { anthropicProvider } from './anthropic';
import { openaiProvider } from './openai';

jest.mock('../../../lib/http', () => ({
  ...jest.requireActual('../../../lib/http'),
  requestJson: jest.fn(),
}));

const mockedRequestJson = requestJson as jest.MockedFunction<typeof requestJson>;

const input: CompletionInput = {
  apiKey: 'k',
  model: 'm',
  system: 's',
  user: 'u',
  maxTokens: 10,
  json: true,
};

describe.each([
  ['openai', openaiProvider],
  ['anthropic', anthropicProvider],
])('%s complete()', (_name, provider) => {
  beforeEach(() => {
    mockedRequestJson.mockReset();
    mockedRequestJson.mockResolvedValue({ data: {}, headers: new Headers(), status: 200 });
  });

  it('uses the generation timeout and default retries when the caller sets neither', async () => {
    await provider.complete(input);
    const options = mockedRequestJson.mock.calls[0][1];
    expect(options?.timeoutMs).toBe(COMPLETION_TIMEOUT_MS);
    expect(options?.retries).toBeUndefined();
  });

  it('passes a caller’s shorter timeout and retry count through to the request', async () => {
    await provider.complete({ ...input, timeoutMs: 8_000, retries: 0 });
    const options = mockedRequestJson.mock.calls[0][1];
    expect(options?.timeoutMs).toBe(8_000);
    expect(options?.retries).toBe(0);
  });
});
