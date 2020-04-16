// import { mockProperty, unmockProperty, unmockAllProperties } from 'jest-expo';

import { GithubApiWrapper } from '../GithubApiWrapper';
import { PullRequestManager } from '../PullRequestManager';

let danger: any;

describe('parseChangelogSuggestionFromDescription', () => {
  it('parse tags from title', () => {
    danger = {
      github: {
        pr: {
          title: '[expo][expo-image-picker]',
          body: '',
        },
      },
    };

    const pullRequestManager = new PullRequestManager(
      danger.github.pr,
      new GithubApiWrapper(danger.github.api, 'danger-test-bot', 'danger-test')
    );

    console.log(pullRequestManager.parseChangelogSuggestionFromDescription());
  });
});
