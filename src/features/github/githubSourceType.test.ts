import { AppError } from '../../lib/errors';
import type { GitHubRepoSource } from '../../sources/types';
import { githubRepoSourceType } from './githubSourceType';

jest.mock('./api/git', () => ({
  createBlob: jest.fn(),
  createTree: jest.fn(),
  createCommit: jest.fn(),
  updateRef: jest.fn(),
  createRef: jest.fn(),
}));
jest.mock('./api/repos', () => ({
  getBranchHead: jest.fn(),
  getRepo: jest.fn(),
  getTreeRecursive: jest.fn(),
}));
jest.mock('./api/installations', () => ({ listUserInstallations: jest.fn() }));
jest.mock('./api/contents', () => ({ getFileRaw: jest.fn() }));
jest.mock('../../config/env', () => ({ getGitHubConfig: () => ({ clientId: 'id', appSlug: 'quizbot-app' }) }));

const git = jest.requireMock('./api/git') as Record<string, jest.Mock>;
const repos = jest.requireMock('./api/repos') as Record<string, jest.Mock>;
const installations = jest.requireMock('./api/installations') as Record<string, jest.Mock>;

const source: GitHubRepoSource = {
  id: 'github-repo:1',
  type: 'github-repo',
  addedAt: 0,
  repoId: 1,
  owner: 'pj',
  name: 'quizzes',
  fullName: 'pj/quizzes',
  defaultBranch: 'main',
  private: true,
  installationId: 42,
  accountLogin: 'pj',
};

const provider = githubRepoSourceType.provider;

beforeEach(() => {
  for (const mock of [...Object.values(git), ...Object.values(repos), ...Object.values(installations)]) mock.mockReset();
  git.createBlob.mockImplementation(async (_o: string, _r: string, content: string) => `blob-${content.length}`);
  git.createTree.mockResolvedValue('tree1');
  git.createCommit.mockResolvedValue('commit1');
});

describe('writeFiles', () => {
  it('commits on top of the branch head and fast-forwards it', async () => {
    repos.getBranchHead.mockResolvedValue({ commitSha: 'head', treeSha: 'headtree' });
    const result = await provider.writeFiles!(
      source,
      [{ path: 'quizzes/a.md', content: 'abc' }, { path: 'quizzes/old.md', delete: true }],
      'QuizBot sync',
    );
    expect(git.createTree).toHaveBeenCalledWith('pj', 'quizzes', 'headtree', [
      { path: 'quizzes/a.md', sha: 'blob-3' },
      { path: 'quizzes/old.md', sha: null },
    ]);
    expect(git.createCommit).toHaveBeenCalledWith('pj', 'quizzes', { message: 'QuizBot sync', tree: 'tree1', parents: ['head'] });
    expect(git.updateRef).toHaveBeenCalledWith('pj', 'quizzes', 'main', 'commit1');
    expect(git.createRef).not.toHaveBeenCalled();
    expect(result).toEqual({ revision: 'commit1', contentHashes: { 'quizzes/a.md': 'blob-3' } });
  });

  it('makes a root commit and creates the branch in an empty repository', async () => {
    // GitHub's answer for a repository with no commits yet.
    repos.getBranchHead.mockRejectedValue(new AppError('github_repo_empty'));
    await provider.writeFiles!(
      source,
      [{ path: 'quizzes/a.md', content: 'abc' }, { path: 'quizzes/gone.md', delete: true }],
      'QuizBot sync',
    );
    expect(git.createTree).toHaveBeenCalledWith('pj', 'quizzes', null, [{ path: 'quizzes/a.md', sha: 'blob-3' }]);
    expect(git.createCommit).toHaveBeenCalledWith('pj', 'quizzes', { message: 'QuizBot sync', tree: 'tree1', parents: [] });
    expect(git.createRef).toHaveBeenCalledWith('pj', 'quizzes', 'main', 'commit1');
    expect(git.updateRef).not.toHaveBeenCalled();
  });

  it('lets any other branch lookup failure through', async () => {
    repos.getBranchHead.mockRejectedValue(new AppError('github_not_found'));
    await expect(provider.writeFiles!(source, [{ path: 'a.md', content: 'x' }], 'm')).rejects.toMatchObject({
      code: 'github_not_found',
    });
    expect(git.createBlob).not.toHaveBeenCalled();
  });
});

describe('canWrite', () => {
  it('reads the installation, not the token', async () => {
    installations.listUserInstallations.mockResolvedValue([
      { id: 42, permissions: { contents: 'write' }, html_url: 'https://github.com/settings/installations/42' },
    ]);
    await expect(provider.canWrite!(source)).resolves.toEqual({ ok: true });

    installations.listUserInstallations.mockResolvedValue([
      { id: 42, permissions: { contents: 'read' }, html_url: 'https://github.com/settings/installations/42' },
    ]);
    await expect(provider.canWrite!(source)).resolves.toMatchObject({
      ok: false,
      manageUrl: 'https://github.com/settings/installations/42',
    });
  });

  it('reports a missing installation', async () => {
    installations.listUserInstallations.mockResolvedValue([]);
    await expect(provider.canWrite!(source)).resolves.toMatchObject({ ok: false });
  });
});
