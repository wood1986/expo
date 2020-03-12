import { GitDirectory } from '../Git';
import { PackageGitLogs } from './types';

export async function getPackageGitLogsAsync(
  gitDir: GitDirectory,
  fromCommit?: string
): Promise<PackageGitLogs> {
  if (!fromCommit || !(await gitDir.isAncestorAsync(fromCommit))) {
    return null;
  }

  const commits = await gitDir.logAsync({
    fromCommit,
    toCommit: 'head',
  });

  const files = await gitDir.logFilesAsync({
    fromCommit: commits[commits.length - 1]?.hash,
    toCommit: commits[0]?.hash,
  });

  // Remove last commit from logs if `gitHead` is present.
  // @tsapeta: Actually we should check whether last's commit parent is equal to `gitHead`,
  // but that wasn't true prior to publish-packages v2 - let's add it later.
  if (fromCommit) {
    commits.pop();
  }

  return {
    commits,
    files,
  };
}
