import { Inject, Injectable, Logger } from '@nestjs/common';

import { UPDATE_CHECK_GITHUB_TOKEN_ENV, UPDATES_MODULE_OPTIONS } from '../constants/updates.constants';
import type { GitHubLatestRelease } from '../interfaces/updates.interfaces';
import type { UpdatesModuleOptions } from '../interfaces/updates-module.options';
import { compareVersions } from '../utils/version.utils';

interface GitHubReleaseApiResponse {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
}

const RELEASES_PER_PAGE = 100;
const RELEASES_MAX_PAGES = 5;

@Injectable()
export class GitHubReleasesClient {
  private readonly logger = new Logger(GitHubReleasesClient.name);

  constructor(@Inject(UPDATES_MODULE_OPTIONS) private readonly options: UpdatesModuleOptions) {}

  /**
   * The newest release. GitHub's `latest` excludes prereleases; with `includePrereleases` (beta channel) the newest
   * published release or prerelease by version is taken from the release list instead.
   */
  async fetchLatestRelease(options: { includePrereleases?: boolean } = {}): Promise<GitHubLatestRelease | null> {
    if (options.includePrereleases) return await this.fetchNewestIncludingPrereleases();

    const { owner, repo } = this.resolveRepository();
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

    try {
      const response = await fetch(url, { headers: this.buildHeaders() });

      if (!response.ok) {
        this.logger.warn(`GitHub latest release request failed with status ${response.status}`);

        return null;
      }

      const payload = (await response.json()) as GitHubReleaseApiResponse;

      return this.mapRelease(payload, url);
    } catch (error) {
      this.logger.warn(`GitHub latest release request failed: ${(error as Error).message}`);

      return null;
    }
  }

  /**
   * Returns published non-prerelease releases newer than `installedVersion` (newest first).
   * Paginates until a release at or below the installed version is reached, or the page cap.
   */
  async fetchReleasesNewerThan(
    installedVersion: string,
    options: { includePrereleases?: boolean } = {},
  ): Promise<GitHubLatestRelease[] | null> {
    const { owner, repo } = this.resolveRepository();
    const collected: GitHubLatestRelease[] = [];

    try {
      for (let page = 1; page <= RELEASES_MAX_PAGES; page += 1) {
        const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=${RELEASES_PER_PAGE}&page=${page}`;
        const response = await fetch(url, { headers: this.buildHeaders() });

        if (!response.ok) {
          this.logger.warn(`GitHub releases list request failed with status ${response.status}`);

          return null;
        }

        const payload = (await response.json()) as GitHubReleaseApiResponse[];

        if (!Array.isArray(payload) || payload.length === 0) {
          break;
        }

        let reachedInstalledOrOlder = false;

        for (const item of payload) {
          if (item.draft || (item.prerelease && !options.includePrereleases)) {
            continue;
          }

          const release = this.mapRelease(item, url);

          if (!release) {
            continue;
          }

          const comparison = compareVersions(release.tagName, installedVersion);

          if (comparison === null) {
            continue;
          }

          if (comparison <= 0) {
            reachedInstalledOrOlder = true;
            break;
          }

          collected.push(release);
        }

        if (reachedInstalledOrOlder || payload.length < RELEASES_PER_PAGE) {
          break;
        }
      }

      return collected;
    } catch (error) {
      this.logger.warn(`GitHub releases list request failed: ${(error as Error).message}`);

      return null;
    }
  }

  private async fetchNewestIncludingPrereleases(): Promise<GitHubLatestRelease | null> {
    const { owner, repo } = this.resolveRepository();
    const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=${RELEASES_PER_PAGE}&page=1`;

    try {
      const response = await fetch(url, { headers: this.buildHeaders() });

      if (!response.ok) {
        this.logger.warn(`GitHub releases list request failed with status ${response.status}`);

        return null;
      }

      const payload = (await response.json()) as GitHubReleaseApiResponse[];
      let newest: GitHubLatestRelease | null = null;

      for (const item of Array.isArray(payload) ? payload : []) {
        const release = item.draft ? null : this.mapRelease(item, url);

        if (!release) {
          continue;
        }

        const comparison = newest ? compareVersions(release.tagName, newest.tagName) : 1;

        if (comparison !== null && comparison > 0) {
          newest = release;
        }
      }

      return newest;
    } catch (error) {
      this.logger.warn(`GitHub releases list request failed: ${(error as Error).message}`);

      return null;
    }
  }

  private resolveRepository(): { owner: string; repo: string } {
    return {
      owner: this.options.github?.owner?.trim() || 'forepath',
      repo: this.options.github?.repo?.trim() || 'one',
    };
  }

  private buildHeaders(): Record<string, string> {
    const tokenEnv = this.options.github?.tokenEnv?.trim() || UPDATE_CHECK_GITHUB_TOKEN_ENV;
    const token = process.env[tokenEnv]?.trim();

    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  private mapRelease(payload: GitHubReleaseApiResponse, fallbackUrl: string): GitHubLatestRelease | null {
    if (!payload.tag_name) {
      return null;
    }

    return {
      tagName: payload.tag_name,
      name: payload.name?.trim() || payload.tag_name,
      body: payload.body ?? '',
      htmlUrl: payload.html_url ?? fallbackUrl,
      publishedAt: payload.published_at ?? new Date().toISOString(),
      ...(payload.prerelease ? { prerelease: true } : {}),
    };
  }
}
