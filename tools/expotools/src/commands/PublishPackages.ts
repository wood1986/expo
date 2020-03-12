import { Command } from '@expo/commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import * as jsondiffpatch from 'jsondiffpatch';
import path from 'path';

import { EXPO_DIR } from '../Constants';
import Git from '../Git';
import logger from '../Logger';
import { TaskRunner, Task } from '../TasksRunner';
import { BACKUP_PATH, BACKUP_EXPIRATION_TIME } from '../publish-packages/constants';
import { pickBackupableOptions } from '../publish-packages/helpers';
import {
  publishPackages,
  listUnpublishedPackages,
  grantTeamAccessToPackages,
} from '../publish-packages/tasks';
import { CommandOptions, Parcel, TaskArgs, PublishBackupData } from '../publish-packages/types';

const { cyan, magenta } = chalk;

export default (program: Command) => {
  program
    .command('publish-packages [packageNames...]')
    .alias('pub-pkg', 'publish', 'pp')
    .option(
      '-i, --prerelease [prereleaseIdentifier]',
      'If used, suggested release type will be a prerelease with given prerelease identifier or `rc` if value is not provided.',
      false
    )
    .option(
      '-e, --exclude <packageName>',
      'Name of the package to be excluded from publish. Can be passed multiple times to exclude more than one package. It has higher priority than the list of package names to publish.',
      (value, previous) => previous.concat(value),
      []
    )
    .option(
      '-t, --tag <tag>',
      'Tag to pass to `npm publish` command. Defaults to `next`. Use `latest` only if you are fully sure to start distributing packages immediately.',
      'next'
    )
    .option(
      '-r, --retry',
      `Retries previous call from the state saved before the phase at which the process has stopped. Some other options and arguments must stay the same.`,
      false
    )
    .option(
      '-m, --commit-message <commitMessage>',
      'Customizes publish commit message.',
      'Publish packages'
    )
    .option('--exclude-deps', 'Whether to not include dependencies of suggested packages.', false)
    .option(
      '-S, --skip-repo-checks',
      'Skips checking whether the command is run on master branch and there are no unstaged changes.',
      false
    )
    .option(
      '-d, --dry',
      'Whether to skip `npm publish` command. Despite this, some files might be changed after running this script.',
      false
    )

    /* options below are exclusive */

    .option(
      '-l, --list-unpublished',
      'Lists packages with unpublished changes since the previous version.',
      false
    )
    .option(
      '-b, --backport <version>',
      'Creates a new branch for backporting changes to the single package from given package version.',
      false
    )
    .option(
      '-g, --grant-access',
      'Grants organization team access to packages in which someone from the team is not included in the maintainers list.',
      false
    )

    .description(
      // prettier-ignore
      `This script publishes packages within the monorepo and takes care of bumping version numbers,
updating other workspace projects, committing and pushing changes to remote repo.

As it's prone to errors due to its complexity and the fact it sometimes may take some time, we made it stateful.
It's been splitted into a few phases after each a backup is saved under ${magenta.bold(path.relative(EXPO_DIR, BACKUP_PATH))} file
and all file changes it made are added to Git's index as part of the backup. Due to its stateful nature,
your local repo must be clear (without unstaged changes) and you shouldn't make any changes in the repo when the command is running.

In case of any errors or mistakes you can always go back to the previous phase with ${magenta.italic('--retry')} flag,
but remember to leave staged changes as they were because they're also part of the backup.`
    )
    .asyncAction(main);
};

/**
 * Main action of the command. Goes through appropriate tasks, based on command options.
 */
async function main(packageNames: string[], options: CommandOptions): Promise<void> {
  // Commander doesn't put arguments to options object, let's add it for convenience. In fact, this is an option.
  options.packageNames = packageNames;

  const tasks = tasksForOptions(options);
  const headCommitHash = await Git.getHeadCommitHashAsync();

  const taskRunner = new TaskRunner<[Parcel[], CommandOptions], PublishBackupData>({
    tasks,
    backupFilePath: BACKUP_PATH,
    backupExpirationTime: BACKUP_EXPIRATION_TIME,

    /**
     * Backup is valid if current head commit hash is the same as from the time where the backup was saved,
     * and if the time difference is no longer than `BACKUP_EXPIRATION_TIME`.
     */
    validateBackup(backup): boolean {
      return (
        backup.data &&
        headCommitHash === backup.data.head &&
        !jsondiffpatch.diff(pickBackupableOptions(options), backup.data.options)
      );
    },

    /**
     * At this point a backup is valid but we can discard it if we want to.
     */
    async shouldUseBackup(): Promise<boolean> {
      if (options.retry) {
        return true;
      }
      const { restore } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'restore',
          prefix: '❔',
          message: cyan('Found valid backup file. Would you like to use it?'),
        },
      ]);
      logger.log();
      return restore;
    },

    createBackupData(task, parcels, options): PublishBackupData {
      const data = {
        options: pickBackupableOptions(options),
        head: headCommitHash,
        state: {},
      };

      for (const { pkg, state } of parcels) {
        data.state[pkg.packageName] = JSON.parse(JSON.stringify(state));
      }
      return data;
    },

    /**
     * Applies given backup to parcels. Returns an index of phase at which the backup was saved.
     */
    restoreBackup(backup, parcels): void {
      const dateString = new Date(backup.timestamp).toLocaleString();

      logger.info(`♻️  Restoring from backup saved on ${magenta(dateString)}...\n`);

      for (const item of parcels) {
        const restoredState = backup.data.state[item.pkg.packageName];

        if (restoredState) {
          item.state = { ...item.state, ...restoredState };
        }
      }
    },

    /**
     * Method that is called once existing backup is no longer valid.
     */
    backupValidationFailed() {
      logger.warn(
        `⚠️  Found backup file but you've run the command with different options. Continuing from scratch...\n`
      );
    },
  });

  await taskRunner.runAndExitAsync([], options);
}

/**
 * Returns target task instances based on provided command options.
 */
function tasksForOptions(options: CommandOptions): Task<TaskArgs>[] {
  if (options.listUnpublished) {
    return [listUnpublishedPackages];
  }
  if (options.backport) {
    // return backportPackage;
  }
  if (options.grantAccess) {
    return [grantTeamAccessToPackages];
  }
  return [publishPackages, grantTeamAccessToPackages];
}
