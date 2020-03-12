import chalk from 'chalk';
import inquirer from 'inquirer';
import readline from 'readline';
import semver from 'semver';
import stripAnsi from 'strip-ansi';

import logger from '../Logger';
import * as Npm from '../Npm';
import { Task } from '../TasksRunner';
import { CommandOptions, Parcel, TaskArgs } from './types';

const { green, yellow, cyan, red } = chalk;

/**
 * Finds packages whose current version is not tagged as `targetTag` command option (defaults to `latest`).
 */
export const findPackagesToPromote = new Task<TaskArgs>(
  {
    name: 'findPackagesToPromote',
  },
  async (parcels: Parcel[], options: CommandOptions): Promise<void | symbol> => {
    logger.info('👀 Searching for packages to promote...');

    for (const { pkg, pkgView, state } of parcels) {
      const currentVersion = pkg.packageVersion;
      const currentDistTag = await pkg.getDistTagAsync();
      const versionToReplace = pkgView?.['dist-tags']?.[options.tag] ?? null;

      state.distTag = currentDistTag;
      state.versionToReplace = versionToReplace;
      state.canPromote = pkgView ? !!state.distTag && state.distTag !== options.tag : false;
      state.isDegrading = versionToReplace ? semver.lt(currentVersion, versionToReplace) : false;
    }

    if (parcels.filter(({ state }) => state.canPromote).length === 0) {
      logger.success('\n✅ No packages to promote.\n');
      return Task.STOP;
    }
  }
);

/**
 * Prompts the user to select packages to promote.
 * Packages whose the current version is not assigned to any tags are skipped.
 */
export const selectPackagesToPromote = new Task<TaskArgs>(
  {
    name: 'selectPackagesToPromote',
    dependsOn: [findPackagesToPromote],
  },
  async (parcels: Parcel[], options: CommandOptions): Promise<void> => {
    logger.info('👉 Selecting packages to promote...\n');

    const toPromote = parcels.filter(({ state }) => state.canPromote);
    const maxLength = toPromote.reduce((acc, { pkg }) => Math.max(acc, pkg.packageName.length), 0);

    const choices = toPromote.map(({ pkg, state }) => {
      const from = cyan.bold(pkg.packageVersion);
      const to = `${yellow(options.tag)} (${cyan.bold(state.versionToReplace ?? 'none')})`;
      const actionStr = state.isDegrading ? red.bold('degrading') : 'promoting';

      return {
        name: `${green(pkg.packageName.padEnd(maxLength))} ${actionStr} ${from} to ${to}`,
        value: pkg.packageName,
        checked: !state.isDegrading,
      };
    });

    const { selectedPackageNames } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedPackageNames',
        message: 'Which packages do you want to promote?\n',
        choices: [
          // Choices unchecked by default (these being degraded) should be on top.
          // We could sort them, but JS sorting algorithm is unstable :/
          ...choices.filter((choice) => !choice.checked),
          ...choices.filter((choice) => choice.checked),
        ],
        pageSize: Math.min(15, process.stdout.rows ?? 15),
      },
    ]);

    // Inquirer shows all those selected choices by name and that looks so ugly due to line wrapping.
    // If possible, we clear everything that has been printed after the prompt.
    if (process.stdout.columns) {
      const bufferLength = choices.reduce(
        (acc, choice) => acc + stripAnsi(choice.name).length + 2,
        0
      );
      readline.moveCursor(process.stdout, 0, -Math.ceil(bufferLength / process.stdout.columns));
      readline.clearScreenDown(process.stdout);
    }

    logger.log(yellow(' >'), `Selected ${cyan(selectedPackageNames.length)} packages to promote.`);

    for (const { pkg, state } of parcels) {
      state.isSelectedToPromote = selectedPackageNames.includes(pkg.packageName);
    }
  }
);

/**
 * Promotes selected packages from the current tag to the tag passed as an option.
 */
export const promotePackages = new Task<TaskArgs>(
  {
    name: 'promotePackages',
    dependsOn: [findPackagesToPromote, selectPackagesToPromote],
  },
  async (parcels: Parcel[], options: CommandOptions): Promise<void> => {
    const toPromote = parcels.filter(({ state }) => state.isSelectedToPromote);

    logger.info(`🚀 Promoting packages to ${yellow(options.tag)} tag...`);

    for (const { pkg, state } of toPromote) {
      const currentVersion = pkg.packageVersion;

      logger.log(yellow(' >'), green.bold(pkg.packageName));
      logger.log(yellow('  -'), `Setting ${cyan(currentVersion)} as ${yellow(options.tag)}`);

      if (!options.dry) {
        await Npm.addTagAsync(pkg.packageName, pkg.packageVersion, options.tag);
      }

      // If the current version had any tag assigned, can we remove this old tag?
      if (state.distTag) {
        logger.log(
          yellow('  -'),
          `Dropping ${yellow(state.distTag)} tag (${cyan(currentVersion)})...`
        );
        if (!options.dry) {
          await Npm.removeTagAsync(pkg.packageName, state.distTag);
        }
      }
    }

    logger.success(`\n✅ Successfully promoted ${cyan(toPromote.length + '')} packages.`);
  }
);
