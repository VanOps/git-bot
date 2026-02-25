/**
 * Comment command registry.
 *
 * Allows any module to register a handler for an @mention trigger.
 * The comment handler dispatches to the appropriate command based on
 * the @mentions found in the comment body.
 *
 * Usage (add a new command):
 *   import { registry } from './index.js';
 *   registry.register('mybot', async (context) => { ... });
 */
class CommandRegistry {
  constructor() {
    /** @type {Map<string, (context: import('probot').Context) => Promise<void>>} */
    this._commands = new Map();
  }

  /**
   * Register a handler for the given @mention trigger.
   * @param {string} trigger   - the mention keyword (e.g. 'copilot')
   * @param {(context: import('probot').Context) => Promise<void>} handler
   */
  register(trigger, handler) {
    this._commands.set(trigger.toLowerCase(), handler);
  }

  /**
   * Dispatch to the handler registered for `trigger`, if any.
   * @param {string} trigger
   * @param {import('probot').Context} context
   */
  async dispatch(trigger, context) {
    const handler = this._commands.get(trigger.toLowerCase());
    if (handler) {
      await handler(context);
    }
  }

  /** Returns all registered trigger names. */
  getRegistered() {
    return [...this._commands.keys()];
  }
}

export const registry = new CommandRegistry();
