/**
 * Comment event handler.
 *
 * Listens for `issue_comment.created` events on Pull Requests and
 * dispatches @mention triggers to the command registry.
 *
 * Adding a new @mention command:
 *   1. Create a file in src/handlers/commands/<name>.js
 *   2. Import the registry and call registry.register('<name>', handler)
 *   3. Import the new file in this module (see imports below)
 */
import { registry } from './commands/index.js';

// ── Import commands (each self-registers with the registry) ───────────────────
import './commands/copilot.js';
// import './commands/my-new-command.js';  ← add new commands here

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract all @mention names from a comment body.
 * Returns lowercase names without the leading @.
 * @param {string} body
 * @returns {string[]}
 */
function extractMentions(body) {
  const matches = body.match(/@([\w][\w-]*)/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
}

// ── Handler registration ──────────────────────────────────────────────────────

/**
 * @param {import('probot').Probot} app
 */
export function registerCommentHandlers(app) {
  app.on('issue_comment.created', async (context) => {
    const { issue, comment } = context.payload;

    // Only act on PR comments (issues don't have pull_request field)
    if (!issue.pull_request) return;

    const mentions = extractMentions(comment.body);
    if (mentions.length === 0) return;

    const known = registry.getRegistered();
    const toDispatch = mentions.filter((m) => known.includes(m));
    if (toDispatch.length === 0) return;

    context.log.info(
      { pr: issue.number, triggers: toDispatch },
      'comment command(s) detected',
    );

    for (const trigger of toDispatch) {
      await registry.dispatch(trigger, context);
    }
  });
}
