import { buildQuery } from '../../../lib/query';
import { GITHUB } from '../config';
import type {
  GitHubUser,
  Installation,
  InstallationRepositoriesResponse,
  Repository,
  UserInstallationsResponse,
} from '../types';
import { githubRequest, paginate } from './client';

/**
 * Lists the GitHub App installations this user can see.
 *
 * This is how we learn what the credential can actually reach: a user access
 * token's scope is (installation repos ∩ repos the user can access), and this
 * endpoint is the only way to inspect the first half.
 */
export async function listUserInstallations(): Promise<Installation[]> {
  return paginate<UserInstallationsResponse, Installation>(
    `/user/installations${buildQuery({ per_page: GITHUB.perPage })}`,
    (page) => page.installations ?? [],
  );
}

export async function listInstallationRepositories(installationId: number): Promise<Repository[]> {
  return paginate<InstallationRepositoriesResponse, Repository>(
    `/user/installations/${installationId}/repositories${buildQuery({ per_page: GITHUB.perPage })}`,
    (page) => page.repositories ?? [],
  );
}

export async function getAuthenticatedUser(): Promise<GitHubUser> {
  return githubRequest<GitHubUser>('/user');
}
