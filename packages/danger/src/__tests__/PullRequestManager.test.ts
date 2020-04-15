import { GithubApiWrapper } from '../GithubApiWrapper';
import { PullRequestManager } from '../PullRequestManager';

var global;

const pullRequestManager = new PullRequestManager(
  global.danger,
  new GithubApiWrapper(global.danger.api, 'danger-test-bot', 'danger-test')
);

describe('parseChangelogSuggestionFromDescription', () => {});
