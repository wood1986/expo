import JsonFile from '@expo/json-file';
import chalk from 'chalk';
import fs from 'fs-extra';
import inquirer from 'inquirer';
import { set } from 'lodash';
import path from 'path';
import semver from 'semver';

import { EXPO_DIR } from '../Constants';
import Git from '../Git';
import logger from '../Logger';
import * as Npm from '../Npm';
import { getListOfPackagesAsync } from '../Packages';
import { Task } from '../TasksRunner';
import * as Utils from '../Utils';
import * as Workspace from '../Workspace';
import { getPackageGitLogsAsync } from './gitLogs';
import {
  checkBranchNameAsync,
  createParcelAsync,
  doesSomeoneHaveNoAccessToPackage,
  getMinReleaseType,
  highestReleaseTypeReducer,
  printPackageParcel,
  recursivelyAccumulateReleaseTypes,
  recursivelyResolveDependentsAsync,
  resolveSuggestedVersion,
} from './helpers';
import { CommandOptions, Parcel, TaskArgs, ReleaseType } from './types';

const { green, yellow, cyan, magenta, gray } = chalk;

/**
 * Gets a list of public packages in the monorepo, downloads `npm view` result of them,
 * creates their Changelog instance and fills given parcels array (it's empty at the beginning).
 */
export const preparePackages = new Task<TaskArgs>(
  {
    name: 'preparePackages',
    required: true,
    backupable: false,
  },
  async (parcels: Parcel[], options: CommandOptions) => {
    logger.info('🔎 Gathering data about packages...\n');

    const { exclude, packageNames } = options;
    const allPackages = await getListOfPackagesAsync();
    const filteredPackages = allPackages.filter((pkg) => {
      const isPrivate = pkg.packageJson.private;
      const isScoped = packageNames.length === 0 || packageNames.includes(pkg.packageName);
      const isExcluded = exclude.includes(pkg.packageName);
      return !isPrivate && isScoped && !isExcluded;
    });

    parcels.push(...(await Promise.all(filteredPackages.map(createParcelAsync))));

    if (packageNames.length > 0 && !options.excludeDeps) {
      // Even if some packages have been listed as command arguments,
      // we still want to include its dependencies.

      const allPackagesObj = allPackages.reduce((acc, pkg) => {
        acc[pkg.packageName] = pkg;
        return acc;
      }, {});

      const parcelsObj = parcels.reduce((acc, parcel) => {
        acc[parcel.pkg.packageName] = parcel;
        return acc;
      }, {});

      await recursivelyResolveDependentsAsync(allPackagesObj, parcelsObj, parcels);
    }
  }
);

/**
 * Checks packages integrity - package is integral if `gitHead` in `package.json` matches `gitHead`
 * of the package published under current version specified in `package.json`.
 */
export const checkPackagesIntegrity = new Task<TaskArgs>(
  {
    name: 'checkPackagesIntegrity',
    dependsOn: [preparePackages],
  },
  async (parcels: Parcel[]) => {
    logger.info('👁  Checking packages integrity...');

    for (const { pkg, pkgView, changelog, state } of parcels) {
      if (!pkgView) {
        // If no package view, then the package hasn't been released yet - no need to check integrity.
        state.integral = true;
        continue;
      }

      const gitHead = pkg.packageJson.gitHead;
      const lastVersionInChangelog = await changelog.getLastPublishedVersionAsync();

      const gitHeadMatches = pkg.packageJson.gitHead === pkgView.gitHead;
      const versionMatches = !lastVersionInChangelog || pkgView.version === lastVersionInChangelog;

      state.integral = gitHeadMatches && versionMatches;

      if (state.integral) {
        // Checks passed.
        continue;
      }

      logger.warn(`Package integrity check failed for ${green(pkg.packageName)}.`);

      if (gitHead && !gitHeadMatches) {
        logger.warn(
          `Package head (${green(gitHead)}) doesn't match published head (${green(pkgView.gitHead)}`
        );
      }
      if (lastVersionInChangelog && !versionMatches) {
        logger.warn(
          `Package version (${cyan(
            pkg.packageVersion
          )}) doesn't match last version in its changelog (${cyan(lastVersionInChangelog)})`
        );
      }
    }
    logger.log();
  }
);

/**
 * Finds unpublished packages. Package is considered unpublished if there are
 * any new commits or changelog entries prior to previous publish on the current branch.
 */
export const findUnpublishedPackages = new Task<TaskArgs>(
  {
    name: 'findUnpublishedPackages',
    dependsOn: [preparePackages],
  },
  async (parcels: Parcel[], options: CommandOptions): Promise<void | symbol> => {
    logger.info('👀 Searching for packages with unpublished changes...');

    for (const parcel of parcels) {
      const { pkg, changelog, gitDir, state } = parcel;
      const { gitHead } = pkg.packageJson;

      const changelogChanges = await changelog.getChangesAsync();
      const logs = await getPackageGitLogsAsync(gitDir, gitHead);

      state.logs = logs;
      state.changelogChanges = changelogChanges;

      state.hasUnpublishedChanges =
        !logs || logs.commits.length > 0 || changelogChanges.totalCount > 0;

      state.minReleaseType = getMinReleaseType(parcel);
    }

    if (parcels.filter(({ state }) => state.hasUnpublishedChanges).length === 0) {
      logger.log(green('\n✅ All packages are up-to-date.'));
      return Task.STOP;
    }
    logger.log();
  }
);

/**
 * Resolves parcel's release type and version, based on its `minReleaseType` and its dependencies.
 */
export const resolveReleaseTypeAndVersion = new Task<TaskArgs>(
  {
    name: 'resolveReleaseTypeAndVersion',
    dependsOn: [findUnpublishedPackages],
  },
  async (parcels: Parcel[], options: CommandOptions) => {
    const toPublish = parcels.filter(({ state }) => state.hasUnpublishedChanges);
    const prerelease = options.prerelease === true ? 'rc' : options.prerelease || undefined;

    for (const parcel of toPublish) {
      const { pkg, pkgView, state } = parcel;

      // Find the highest release type among parcel's dependencies.
      const accumulatedTypes = recursivelyAccumulateReleaseTypes(parcel);
      const highestReleaseType = [...accumulatedTypes].reduce(
        highestReleaseTypeReducer,
        ReleaseType.PATCH
      );

      // Make it a prerelease version if `--prerelease` was passed and assign to the state.
      state.releaseType = prerelease
        ? (('pre' + highestReleaseType) as ReleaseType)
        : highestReleaseType;

      // Calculate version to should bump to.
      state.releaseVersion = resolveSuggestedVersion(
        pkg.packageVersion,
        pkgView?.versions ?? [],
        state.releaseType,
        prerelease
      );
    }
  }
);

/**
 * Lists packages that have any unpublished changes.
 */
export const listUnpublishedPackages = new Task<TaskArgs>(
  {
    name: 'listUnpublishedPackages',
    dependsOn: [checkPackagesIntegrity, findUnpublishedPackages, resolveReleaseTypeAndVersion],
  },
  async (parcels: Parcel[]) => {
    const toPublish = parcels.filter(({ state }) => state.hasUnpublishedChanges);

    logger.info('🧩 Unpublished packages:\n');
    toPublish.forEach(printPackageParcel);
  }
);

/**
 * Checks whether the current branch is correct and working dir is not dirty.
 */
export const checkRepositoryStatus = new Task<TaskArgs>(
  {
    name: 'checkRepositoryStatus',
    required: true,
    backupable: false,
  },
  async (parcels: Parcel[], options: CommandOptions): Promise<void | symbol> => {
    if (options.skipRepoChecks) {
      return;
    }
    logger.info(`🕵️‍♂️ Checking repository status...`);

    if (!(await checkBranchNameAsync())) {
      return Task.STOP;
    }
    if (await Git.hasUnstagedChangesAsync()) {
      logger.error(`🚫 Repository contains unstaged changes, please make sure to have it clear.\n`);
      return Task.STOP;
    }
  }
);

/**
 * Prompts which suggested packages are going to be published.
 */
export const selectPackagesToPublish = new Task<TaskArgs>(
  {
    name: 'selectPackagesToPublish',
    dependsOn: [findUnpublishedPackages, resolveReleaseTypeAndVersion],
  },
  async (parcels: Parcel[]): Promise<void | symbol> => {
    const unpublished = parcels.filter(({ state }) => state.hasUnpublishedChanges);

    logger.info('👉 Selecting packages to publish...\n');

    for (const parcel of unpublished) {
      const { pkg, state } = parcel;

      printPackageParcel(parcel);

      const { selected } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'selected',
          prefix: '❔',
          message: `Do you want to publish ${green.bold(pkg.packageName)} as version ${cyan.bold(
            state.releaseVersion!
          )}?`,
          default: true,
        },
      ]);
      logger.log();

      state.isSelectedToPublish = selected;
    }

    if (unpublished.filter(({ state }) => state.isSelectedToPublish).length === 0) {
      logger.log(green('🤷‍♂️ There is nothing chosen to be published.\n'));
      return Task.STOP;
    }
  }
);

/**
 * Updates versions in packages selected to be published.
 */
export const updateVersions = new Task<TaskArgs>(
  {
    name: 'updateVersions',
    dependsOn: [selectPackagesToPublish],
    filesToStage: ['packages/**/package.json'],
  },
  async (parcels: Parcel[]) => {
    const toPublish = parcels.filter(({ state }) => state.isSelectedToPublish);

    for (const { pkg, state } of toPublish) {
      const gitHead = state.logs?.[0]?.hash ?? pkg.packageJson.gitHead;

      if (!gitHead || !state.releaseVersion) {
        // TODO: do it better
        continue;
      }

      // Make a deep clone of `package.json` - `pkg.packageJson` should stay immutable.
      const packageJson = Utils.deepCloneObject(pkg.packageJson);

      logger.info(
        `📦 Updating ${magenta.bold('package.json')} in ${green.bold(pkg.packageName)} with...`
      );

      const update = {
        version: state.releaseVersion,
        gitHead,
      };

      for (const key in update) {
        logger.log(yellow(' >'), `${yellow.bold(key)}: ${cyan.bold(update[key])}`);
        set(packageJson, key, update[key]);
      }

      // Saving new contents of `package.json`.
      await JsonFile.writeAsync(path.join(pkg.path, 'package.json'), packageJson);

      logger.log();
    }
  }
);

/**
 * Updates `bundledNativeModules.json` file in `expo` package.
 * It's used internally by some `expo-cli` commands so we know which package versions are compatible with `expo` version.
 */
export const updateBundledNativeModulesFile = new Task<TaskArgs>(
  {
    name: 'updateBundledNativeModulesFile',
    dependsOn: [selectPackagesToPublish],
    filesToStage: ['packages/expo/bundledNativeModules.json'],
  },
  async (parcels: Parcel[]) => {
    const toPublish = parcels.filter(({ state }) => state.isSelectedToPublish);

    if (toPublish.length === 0) {
      return;
    }

    const bundledNativeModulesPath = path.join(EXPO_DIR, 'packages/expo/bundledNativeModules.json');
    const bundledNativeModules = await JsonFile.readAsync<{ [key: string]: string }>(
      bundledNativeModulesPath
    );

    logger.info(`✏️  Updating ${magenta.bold('bundledNativeModules.json')} file...`);

    for (const { pkg, state } of toPublish) {
      const currentRange = bundledNativeModules[pkg.packageName];
      const newRange = `~${state.releaseVersion}`;

      if (!currentRange) {
        logger.log(yellow(' >'), green.bold(pkg.packageName), gray('is not defined.'));
        continue;
      }

      logger.log(
        yellow(' >'),
        green.bold(pkg.packageName),
        `${cyan.bold(currentRange)} -> ${cyan.bold(newRange)}`
      );

      bundledNativeModules[pkg.packageName] = newRange;
    }

    await JsonFile.writeAsync(bundledNativeModulesPath, bundledNativeModules);
    logger.log();
  }
);

/**
 * Updates versions of packages to be published in other workspace projects depending on them.
 */
export const updateWorkspaceProjects = new Task<TaskArgs>(
  {
    name: 'updateWorkspaceProjects',
    filesToStage: ['**/package.json', 'yarn.lock'],
  },
  async (parcels: Parcel[]) => {
    logger.info('📤 Updating workspace projects...');

    const workspaceInfo = await Workspace.getInfoAsync();
    const dependenciesKeys = ['dependencies', 'devDependencies', 'peerDependencies'];

    const parcelsObject = parcels.reduce((acc, parcel) => {
      acc[parcel.pkg.packageName] = parcel;
      return acc;
    }, {});

    await Promise.all(
      Object.entries(workspaceInfo).map(async ([projectName, projectInfo]) => {
        const projectDependencies = [
          ...projectInfo.workspaceDependencies,
          ...projectInfo.mismatchedWorkspaceDependencies,
        ]
          .map((dependencyName) => parcelsObject[dependencyName])
          .filter(Boolean);

        // If this project doesn't depend on any package we're going to publish.
        if (projectDependencies.length === 0) {
          return;
        }

        // Get copy of project's `package.json`.
        const projectPackageJsonPath = path.join(EXPO_DIR, projectInfo.location, 'package.json');
        const projectPackageJson = await JsonFile.readAsync(projectPackageJsonPath);
        const batch = logger.batch();

        batch.log(yellow(' >'), green.bold(projectName));

        // Iterate through different dependencies types.
        for (const dependenciesKey of dependenciesKeys) {
          const dependenciesObject = projectPackageJson[dependenciesKey];

          if (!dependenciesObject) {
            continue;
          }

          for (const { pkg, state } of projectDependencies) {
            const currentVersionRange = dependenciesObject[pkg.packageName];

            if (!currentVersionRange) {
              continue;
            }

            // Leave tilde and caret as they are, just replace the version.
            const newVersionRange = currentVersionRange.replace(
              /([\^~]?).*/,
              `$1${state.releaseVersion}`
            );
            dependenciesObject[pkg.packageName] = newVersionRange;

            batch.log(
              yellow('  -'),
              `Updating ${yellow(`${dependenciesKey}.${pkg.packageName}`)}`,
              `from ${cyan(currentVersionRange)} to ${cyan(newVersionRange)}`
            );
          }
        }

        // Save project's `package.json`.
        await JsonFile.writeAsync(projectPackageJsonPath, projectPackageJson);

        // Flush batched logs.
        batch.flush();
      })
    );
    logger.log();
  }
);

/**
 * Updates version props in packages containing Android's native code.
 */
export const updateAndroidProjects = new Task<TaskArgs>(
  {
    name: 'updateAndroidProjects',
    dependsOn: [selectPackagesToPublish],
    filesToStage: ['packages/**/android/build.gradle'],
  },
  async (parcels: Parcel[]) => {
    logger.info('🤖 Updating Android projects...');

    const toPublish = parcels.filter(({ state }) => state.isSelectedToPublish);

    for (const { pkg, state } of toPublish) {
      const gradlePath = path.join(pkg.path, 'android/build.gradle');

      // Some packages don't have android code.
      if (!(await fs.pathExists(gradlePath))) {
        continue;
      }

      const relativeGradlePath = path.relative(EXPO_DIR, gradlePath);

      logger.log(
        yellow(' >'),
        `Updating ${yellow('version')} and ${yellow('versionCode')} in ${magenta(
          relativeGradlePath
        )}`
      );

      await Utils.transformFileAsync(gradlePath, [
        {
          // update version and versionName in android/build.gradle
          pattern: /\b(version\s*=\s*|versionName\s+)(['"])(.*?)\2/g,
          replaceWith: `$1$2${state.releaseVersion}$2`,
        },
        {
          pattern: /\bversionCode\s+(\d+)\b/g,
          replaceWith: (match, p1) => {
            const versionCode = parseInt(p1, 10);
            return `versionCode ${versionCode + 1}`;
          },
        },
      ]);
    }
    logger.log();
  }
);

/**
 * Updates pods in Expo client's and bare-expo.
 */
export const updateIosProjects = new Task<TaskArgs>(
  {
    name: 'updateIosProjects',
    dependsOn: [selectPackagesToPublish],
    filesToStage: ['ios', 'apps/*/ios/**'],
  },
  async (parcels: Parcel[]) => {
    logger.info('🍎 Updating iOS projects...');

    const nativeApps = Workspace.getNativeApps();
    const parcelsToPublish = parcels.filter(
      ({ pkg, state }) => state.isSelectedToPublish && pkg.podspecName
    );

    await Promise.all(
      nativeApps.map(async (nativeApp) => {
        const podspecNames = (
          await Promise.all(
            parcelsToPublish.map(
              (parcel) =>
                nativeApp.hasLocalPodDependencyAsync(parcel.pkg.podspecName) &&
                parcel.pkg.podspecName
            )
          )
        ).filter(Boolean) as string[];

        if (podspecNames.length === 0) {
          logger.log(yellow(' >'), `${green(nativeApp.packageName)}: No pods to update.`);
          return;
        }

        logger.log(
          yellow(' >'),
          `${green(nativeApp.packageName)}: updating`,
          podspecNames.map((podspecName) => green(podspecName!)).join(', ')
        );

        await Utils.spawnAsync('pod', ['update', ...podspecNames, '--no-repo-update'], {
          cwd: path.join(nativeApp.path, 'ios'),
        });
      })
    );
    logger.log();
  }
);

/**
 * Cuts off changelogs - renames unpublished section heading
 * to the new version and adds new unpublished section on top.
 */
export const cutOffChangelogs = new Task<TaskArgs>(
  {
    name: 'cutOffChangelogs',
    dependsOn: [selectPackagesToPublish],
    filesToStage: ['packages/**/CHANGELOG.md'],
  },
  async (parcels: Parcel[]) => {
    const toPublish = parcels.filter(({ state }) => state.isSelectedToPublish);

    if (toPublish.length === 0) {
      return;
    }

    logger.info('✂️  Cutting off changelogs...');

    for (const { pkg, changelog, state } of toPublish) {
      if (!(await changelog.fileExistsAsync())) {
        logger.log(
          yellow(' >'),
          green.bold(pkg.packageVersion),
          gray(`- skipped, no changelog file.`)
        );
        continue;
      }

      if (state.releaseVersion && !semver.prerelease(state.releaseVersion)) {
        logger.log(yellow(' >'), green.bold(pkg.packageName) + '...');
        await changelog.cutOffAsync(state.releaseVersion);
      } else {
        logger.log(
          yellow(' >'),
          green.bold(pkg.packageVersion),
          gray(`- skipped, it's a prerelease version.`)
        );
      }
    }
    logger.log();
  }
);

/**
 * Commits changes made by all previous phases.
 */
export const commitStagedChanges = new Task<TaskArgs>(
  {
    name: 'commitStagedChanges',
    dependsOn: [selectPackagesToPublish],
  },
  async (parcels: Parcel[], options: CommandOptions) => {
    const toPublish = parcels.filter(({ state }) => state.isSelectedToPublish);

    logger.info('📼 Committing changes...');

    const commitDescription = toPublish
      .map(({ pkg, state }) => `${pkg.packageName}@${state.releaseVersion}`)
      .join('\n');

    await Git.commitAsync([options.commitMessage, commitDescription]);
  }
);

/**
 * Publishes all packages that have been selected to publish.
 */
export const publishPackages = new Task<TaskArgs>(
  {
    name: 'publishPackages',
    dependsOn: [
      checkRepositoryStatus,
      preparePackages,
      selectPackagesToPublish,
      updateVersions,
      updateBundledNativeModulesFile,
      updateWorkspaceProjects,
      updateAndroidProjects,
      updateIosProjects,
      cutOffChangelogs,
      commitStagedChanges,
    ],
  },
  async (parcels: Parcel[], options: CommandOptions) => {
    const toPublish = parcels.filter(({ state }) => state.isSelectedToPublish);

    if (toPublish.length === 0) {
      return;
    }

    logger.info('🚀 Publishing packages...');

    for (const { pkg, state } of parcels) {
      logger.log(
        yellow(' >'),
        `${green(pkg.packageName)}@${cyan(state.releaseVersion!)} as ${yellow(options.tag)}`
      );

      await Npm.publishPackageAsync(pkg.path, options.tag, options.dry);
      state.published = true;
    }

    logger.log();
  }
);

/**
 * Grants package access to the whole team. Applies only when the package
 * wasn't published before or someone from the team is not included in maintainers list.
 */
export const grantTeamAccessToPackages = new Task<TaskArgs>(
  {
    name: 'grantTeamAccessToPackages',
    dependsOn: [preparePackages],
  },
  async (parcels: Parcel[], options: CommandOptions) => {
    // There is no good way to check whether the package is added to organization team,
    // so let's get all team members and check if they all are declared as maintainers.
    // If they aren't, we grant access for the team. Sounds reasonable?
    const teamMembers = await Npm.getTeamMembersAsync(Npm.EXPO_DEVELOPERS_TEAM_NAME);
    const packagesToGrantAccess = parcels.filter(
      ({ pkgView, state }) =>
        (pkgView || state.published) && doesSomeoneHaveNoAccessToPackage(teamMembers, pkgView)
    );

    if (packagesToGrantAccess.length === 0) {
      logger.success('🎖  Granting team access not required.');
      return;
    }

    if (!options.dry) {
      logger.info('🎖  Granting team access...');

      for (const { pkg } of packagesToGrantAccess) {
        logger.log(yellow(' >'), green(pkg.packageName));
        await Npm.grantReadWriteAccessAsync(pkg.packageName, Npm.EXPO_DEVELOPERS_TEAM_NAME);
      }
    } else {
      logger.info(
        '🎖  Team access would be granted to',
        packagesToGrantAccess.map(({ pkg }) => green(pkg.packageName)).join(', ')
      );
    }
  }
);
