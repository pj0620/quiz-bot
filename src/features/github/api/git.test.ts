import { AppError } from '../../../lib/errors';
import { createBlob, createCommit, createRef, createTree, updateRef } from './git';

jest.mock('./client', () => ({ githubRequest: jest.fn() }));

const { githubRequest } = jest.requireMock('./client') as { githubRequest: jest.Mock };

beforeEach(() => githubRequest.mockReset());

describe('git data api', () => {
  it('creates utf-8 blobs, never base64', async () => {
    githubRequest.mockResolvedValue({ sha: 'blob1', url: '' });
    await expect(createBlob('pj', 'notes', '# Héllo —')).resolves.toBe('blob1');
    const [path, options] = githubRequest.mock.calls[0];
    expect(path).toBe('/repos/pj/notes/git/blobs');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ content: '# Héllo —', encoding: 'utf-8' });
  });

  it('builds a tree on the base with deletions as null shas', async () => {
    githubRequest.mockResolvedValue({ sha: 'tree1' });
    await createTree('pj', 'notes', 'base', [
      { path: 'quizzes/a.md', sha: 'blob1' },
      { path: 'quizzes/b.md', sha: null },
    ]);
    expect(JSON.parse(githubRequest.mock.calls[0][1].body)).toEqual({
      base_tree: 'base',
      tree: [
        { path: 'quizzes/a.md', mode: '100644', type: 'blob', sha: 'blob1' },
        { path: 'quizzes/b.md', mode: '100644', type: 'blob', sha: null },
      ],
    });
  });

  it('builds a root tree with no base for an empty repository', async () => {
    githubRequest.mockResolvedValue({ sha: 'tree1' });
    await createTree('pj', 'quizzes', null, [{ path: 'quizzes/a.md', sha: 'blob1' }]);
    expect(JSON.parse(githubRequest.mock.calls[0][1].body)).toEqual({
      tree: [{ path: 'quizzes/a.md', mode: '100644', type: 'blob', sha: 'blob1' }],
    });
  });

  it('creates the branch for a first commit', async () => {
    githubRequest.mockResolvedValue({});
    await createRef('pj', 'quizzes', 'main', 'commit1');
    const [path, options] = githubRequest.mock.calls[0];
    expect(path).toBe('/repos/pj/quizzes/git/refs');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ ref: 'refs/heads/main', sha: 'commit1' });
  });

  it('commits with the parent and fast-forwards the branch', async () => {
    githubRequest.mockResolvedValueOnce({ sha: 'commit1' }).mockResolvedValueOnce({});
    await expect(createCommit('pj', 'notes', { message: 'm', tree: 'tree1', parents: ['head'] })).resolves.toBe('commit1');
    await updateRef('pj', 'notes', 'main', 'commit1');
    const [path, options] = githubRequest.mock.calls[1];
    expect(path).toBe('/repos/pj/notes/git/refs/heads/main');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body)).toEqual({ sha: 'commit1', force: false });
  });

  it('reports a moved branch as a write conflict', async () => {
    githubRequest.mockRejectedValue(new AppError('unknown', { message: 'Update is not a fast forward' }));
    await expect(updateRef('pj', 'notes', 'main', 'x')).rejects.toMatchObject({ code: 'github_write_conflict' });
  });
});
