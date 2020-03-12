import { Parcel as BaseParcel } from '../publish-packages/types';

/**
 * Command's options.
 */
export type CommandOptions = {
  packageNames: string[];
  exclude: string[];
  tag: string;
  dry: boolean;
  list: boolean;
};

/**
 * Type of parcel's state.
 */
export type PromoteState = {
  distTag?: string | null;
  versionToReplace?: string | null;
  canPromote?: boolean;
  isDegrading?: boolean;
  isSelectedToPromote?: boolean;
};

export type Parcel = BaseParcel<PromoteState>;

export type TaskArgs = [Parcel[], CommandOptions];
