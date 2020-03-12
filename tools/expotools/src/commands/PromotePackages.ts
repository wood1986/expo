import { Command } from '@expo/commander';

import { TaskRunner } from '../TasksRunner';
import { promotePackages } from '../promote-packages/tasks';
import { CommandOptions, TaskArgs } from '../promote-packages/types';

export default (program: Command) => {
  program
    .command('promote-packages [packageNames...]')
    .alias('promote-pkgs')
    .option(
      '-e, --exclude <packageName>',
      'Name of the package to be excluded from promoting. Can be passed multiple times to exclude more than one package. It has higher priority than the list of package names to promote.',
      (value, previous) => previous.concat(value),
      []
    )
    .option(
      '-t, --tag <tag>',
      'Tag to which packages should be promoted. Defaults to `latest`.',
      'latest'
    )
    .option('-d, --dry', 'Whether to skip `npm dist-tag add` command.', false)
    .option(
      '-l, --list',
      'Lists packages with unpublished changes since the previous version.',
      false
    )
    .description('Promotes current versions of monorepo packages to given tag on NPM repository.')
    .asyncAction(async (packageNames: string[], options: CommandOptions) => {
      // Commander doesn't put arguments to options object, let's add it for convenience. In fact, this is an option.
      options.packageNames = packageNames;

      const taskRunner = new TaskRunner<TaskArgs>({
        tasks: [promotePackages],
      });

      await taskRunner.runAndExitAsync([], options);
    });
};
