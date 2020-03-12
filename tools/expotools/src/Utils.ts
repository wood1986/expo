import fs from 'fs-extra';
import basicSpawnAsync from '@expo/spawn-async';

import { EXPO_DIR } from './Constants';

/**
 * Asynchronously spawns a process with given command, args and options. Working directory is set to repo's root by default.
 */
export async function spawnAsync(
  command: string,
  args: Readonly<string[]> = [],
  options: object = {}
) {
  return await basicSpawnAsync(command, args, {
    env: { ...process.env },
    cwd: EXPO_DIR,
    ...options,
  });
}

/**
 * Does the same as `spawnAsync` but parses the output to JSON object.
 */
export async function spawnJSONCommandAsync(
  command: string,
  args: Readonly<string[]> = [],
  options: object = {}
) {
  const child = await spawnAsync(command, args, options);
  return JSON.parse(child.stdout);
}

/**
 * Deeply clones an object. It's used to make a backup of home's `app.json` file.
 */
export function deepCloneObject<ObjectType extends object = object>(
  object: ObjectType
): ObjectType {
  return JSON.parse(JSON.stringify(object));
}

/**
 * Type of allowed transform rules used by `transformFileAsync`.
 */
export type FileTransformRule = {
  pattern: string | RegExp;
  replaceWith: string | ((substring: string, ...args: any[]) => string);
};

/**
 * Handy method transforming file's content according to given transform rules.
 */
export async function transformFileAsync(
  filePath: string,
  transforms: FileTransformRule[]
): Promise<void> {
  fs.access(filePath, fs.constants.R_OK | fs.constants.W_OK);

  const fileContent = transforms.reduce(
    // @ts-ignore @tsapeta: I don't really know why, but TS gets crazy on `replaceWith`.
    (acc, transform) => acc.replace(transform.pattern, transform.replaceWith),
    await fs.readFile(filePath, 'utf8')
  );

  await fs.writeFile(filePath, fileContent);
}

/**
 * Waits given amount of time (in milliseconds).
 */
export function sleepAsync(duration: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
}
