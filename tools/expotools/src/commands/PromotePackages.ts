import chalk from 'chalk';
import inquirer from 'inquirer';
import { Command } from '@expo/commander';
import spawnAsync from '@expo/spawn-async';

import { Package, getListOfPackagesAsync } from '../Packages';

type ActionOptions = {
  fromTag: string | null;
  toTag: string;
  scope?: string;
  exclude?: string;
};

async function getPackageViewAsync(pkg: Package): Promise<{ [key: string]: any }> {
  const { stdout } = await spawnAsync('npm', ['view', `${pkg.packageName}@${pkg.packageVersion}`, '--json']);
  return JSON.parse(stdout);
}

async function promptAsync(message, defaultValue = true): Promise<boolean> {
  const result = await inquirer.prompt<{ result: boolean }>([
    {
      type: 'confirm',
      name: 'result',
      message,
      default: defaultValue,
    },
  ]);
  return result.result;
}

async function promotePackageAsync(packageName: string, packageVersion: string, toTag: string): Promise<void> {
  await spawnAsync(
    'npm',
    [
      'dist-tag',
      'add',
      `${packageName}@${packageVersion}`,
      toTag
    ],
  );
}

function parseCommaSeparatedList(arg?: string): string[] {
  return arg ? arg.split(/\s*,\s*/g) : [];
}

async function action(options: ActionOptions) {
  const { fromTag, toTag } = options;
  const scope = parseCommaSeparatedList(options.scope);
  const exclude = parseCommaSeparatedList(options.exclude);

  const packages = await getListOfPackagesAsync();
  const filteredPackages = packages.filter(pkg => {
    return !pkg.packageJson.private
      && (scope.length === 0 || scope.includes(pkg.packageName))
      && !exclude.includes(pkg.packageName);
  });

  const packagesToPromote = new Map();

  console.log('Looking for packages to promote...');

  for (const pkg of filteredPackages) {
    try {
      const packageView = await getPackageViewAsync(pkg);
      const distTags = packageView['dist-tags'];
      const versionToPromote = fromTag ? distTags[fromTag] : pkg.packageVersion;

      if (versionToPromote) {
        packagesToPromote.set(pkg.packageName, pkg.packageVersion);
      } else if (fromTag) {
        console.log(`Tag ${chalk.cyan(fromTag)} doesn't exist for package ${chalk.green(pkg.packageName)} - skipping...`);
      }
    } catch (error) {
      console.log(`Cannot get package view for ${chalk.green(pkg.packageName)} - skipping...`);
    }
  }

  console.log('\nFollowing packages will be promoted:');

  for (const [packageName, packageVersion] of packagesToPromote) {
    console.log(`${chalk.green(packageName)}: ${chalk.cyan(packageVersion)} ${chalk.yellow('->')} ${chalk.cyan(toTag)}`);
  }

  if (await promptAsync('\nDo you want to proceed?')) {
    for (const [packageName, packageVersion] of packagesToPromote) {
      console.log(`Promoting ${chalk.green(packageName)} package...`);
      await promotePackageAsync(packageName, packageVersion, toTag);
    }
    console.log(chalk.green('Success!'));
  } else {
    console.log(chalk.yellow('Exited without promoting.'));
  }
}

export default (program: Command) => {
  program
    .command('promote-packages')
    .alias('promote-pkg')
    .description('Promotes packages from given NPM tag to another.')
    .option('-f, --from-tag [string]', 'Specifies NPM tag that we want to promote from. Promotes the current version if not specified.', null)
    .option('-t, --to-tag [string]', 'Specifies NPM tag that we want to promote to.', 'latest')
    .option('-s, --scope [string]', 'Comma-separated names of packages to promote.', '')
    .option('-e, --exclude [string]', 'Comma-separated names of packages to exclude from promoting. It has a higher precedence than `scope` flag.', '')
    .asyncAction(action);
};
