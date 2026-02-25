/**
 * @copilot command – adds GitHub Copilot as a PR reviewer.
 *
 * Triggered when a PR comment contains `@copilot`.
 *
 * Configuration (env vars):
 *   COPILOT_REVIEWER_LOGIN  – GitHub login of the Copilot reviewer bot.
 *                             Defaults to 'copilot-pull-request-reviewer[bot]'.
 */
import { registry } from './index.js';

const COPILOT_LOGIN =
  process.env.COPILOT_REVIEWER_LOGIN ?? 'copilot-pull-request-reviewer[bot]';

registry.register('copilot', async (context) => {
  const { payload, log } = context;
  const { repository, issue } = payload;

  const owner      = repository.owner.login;
  const repo       = repository.name;
  const pullNumber = issue.number;

  try {
    await context.octokit.pulls.requestReviewers({
      owner,
      repo,
      pull_number: pullNumber,
      reviewers: [COPILOT_LOGIN],
    });

    log.info(`@copilot added as reviewer on ${owner}/${repo}#${pullNumber}`);
  } catch (err) {
    log.error({ err }, `@copilot: failed to add reviewer on ${owner}/${repo}#${pullNumber}`);
  }
});
