import path from 'path';

import { spawnAsync } from './Utils';
import { EXPO_DIR } from './Constants';

export type GitLogOptions = {
  fromCommit?: string;
  toCommit?: string;
  paths?: string[];
};

export type GitLog = {
  hash: string;
  parent: string;
  title: string;
  authorName: string;
  committerRelativeDate: string;
};

export type GitFileLog = {
  path: string;
  relativePath: string;
  status: GitFileStatus;
};

export enum GitFileStatus {
  M = 'modified',
  C = 'copy',
  R = 'rename',
  A = 'added',
  D = 'deleted',
  U = 'unmerged',
}

/**
 * Helper class that stores the directory inside the repository so we don't have to pass it many times.
 * This directory path doesn't have to be the repo's root path,
 * it's just like current working directory for all other commands.
 */
export class GitDirectory {
  readonly path: string;
  readonly Directory = GitDirectory;

  constructor(path) {
    this.path = path;
  }

  /**
   * Returns repository's branch name that you're checked out on.
   */
  async getCurrentBranchNameAsync(): Promise<string> {
    const { stdout } = await spawnAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: this.path,
    });
    return stdout.replace(/\n+$/, '');
  }

  /**
   * Tries to deduce the SDK version from branch name. Returns null if the branch name is not a release branch.
   */
  async getSDKVersionFromBranchNameAsync(): Promise<string | null> {
    const currentBranch = await this.getCurrentBranchNameAsync();
    const match = currentBranch.match(/\bsdk-(\d+)$/);

    if (match) {
      const sdkMajorNumber = match[1];
      return `${sdkMajorNumber}.0.0`;
    }
    return null;
  }

  /**
   * Returns full head commit hash.
   */
  async getHeadCommitHashAsync(): Promise<string> {
    const { stdout } = await spawnAsync('git', ['rev-parse', 'HEAD'], {
      cwd: this.path,
    });
    return stdout.trim();
  }

  /**
   * Returns formatted results of `git log` command.
   */
  async logAsync(options: GitLogOptions = {}): Promise<GitLog[]> {
    const fromCommit = options.fromCommit ?? '';
    const toCommit = options.toCommit ?? 'head';
    const paths = options.paths ?? ['.'];

    const template = {
      hash: '%H',
      parent: '%P',
      title: '%s',
      authorName: '%aN',
      committerRelativeDate: '%cr',
    };

    // We use random \u200b character (zero-width space) instead of double quotes
    // because we need to know which quotes to escape before we pass it to `JSON.parse`.
    // Otherwise, double quotes in commits message would cause this function to throw JSON exceptions.
    const format =
      ',{' +
      Object.entries(template)
        .map(([key, value]) => `\u200b${key}\u200b:\u200b${value}\u200b`)
        .join(',') +
      '}';

    const { stdout } = await spawnAsync(
      'git',
      ['log', `--pretty=format:${format}`, `${fromCommit}..${toCommit}`, '--', ...paths],
      { cwd: this.path }
    );

    // Remove comma at the beginning, escape double quotes and replace \u200b with unescaped double quotes.
    const jsonItemsString = stdout
      .slice(1)
      .replace(/"/g, '\\"')
      .replace(/\u200b/gu, '"');

    return JSON.parse(`[${jsonItemsString}]`);
  }

  /**
   * Returns a list of files that have been modified, deleted or added between specified commits.
   */
  async logFilesAsync(options: GitLogOptions): Promise<GitFileLog[]> {
    const fromCommit = options.fromCommit ?? '';
    const toCommit = options.toCommit ?? 'head';

    // This diff command returns a list of relative paths of files that have changed preceded by their status.
    // Status is just a letter, which is also a key of `GitFileStatus` enum.
    const { stdout } = await spawnAsync(
      'git',
      ['diff', '--name-status', `${fromCommit}..${toCommit}`, '--relative', '--', '.'],
      { cwd: this.path }
    );

    return stdout
      .split(/\n/g)
      .filter(Boolean)
      .map((line) => {
        const [status, relativePath] = line.split(/\s+/);

        return {
          relativePath,
          path: path.join(this.path, relativePath),
          status: GitFileStatus[status] ?? status,
        };
      });
  }

  /**
   * Simply spawns `git add` for given glob path patterns.
   */
  async addFilesAsync(paths: string[], options?: object): Promise<void> {
    if (paths.length === 0) {
      return;
    }
    await spawnAsync('git', ['add', '--', ...paths], {
      cwd: this.path,
      ...options,
    });
  }

  /**
   * Discards changes at given file paths.
   */
  async discardFilesAsync(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }
    await spawnAsync('git', ['checkout', '--', ...paths], { cwd: this.path });
    await spawnAsync('git', ['clean', '-df', '--', ...paths], { cwd: this.path });
  }

  /**
   * Commits staged changes with given message.
   */
  async commitAsync(message: string | string[]): Promise<void> {
    const messages = Array.isArray(message) ? message : [message];
    const args = ['commit'].concat(...messages.map((message) => ['--message', message]));

    await spawnAsync('git', args, { cwd: this.path });
  }

  /**
   * Resolves to boolean value meaning whether the repository contains any unstaged changes.
   */
  async hasUnstagedChangesAsync(paths: string[] = []): Promise<boolean> {
    return !(await trySpawnAsync('git', ['diff', '--quiet', '--', ...paths], { cwd: this.path }));
  }

  /**
   * Checks whether given commit is an ancestor of head commit.
   */
  async isAncestorAsync(commit: string): Promise<boolean> {
    return trySpawnAsync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {
      cwd: this.path,
    });
  }
}

async function trySpawnAsync(command: string, args: string[], options = {}): Promise<boolean> {
  try {
    await spawnAsync(command, args, options);
    return true;
  } catch (error) {
    return false;
  }
}

export default new GitDirectory(EXPO_DIR);
