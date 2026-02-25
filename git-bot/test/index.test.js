import { describe, beforeEach, test } from 'node:test';
import assert from 'node:assert';

import { registerCheckHandlers } from '../src/handlers/check.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeApp() {
  const handlers = {};
  return {
    _handlers: handlers,
    on(event, fn) { handlers[event] = fn; },
    log: { info: () => {}, error: () => {}, debug: () => {}, warn: () => {} },
  };
}

function makeCheckSuiteContext(sha = 'abc123def456', branch = 'main') {
  let capturedCall = null;
  return {
    payload: {
      check_suite: {
        id: 1,
        head_sha: sha,
        head_branch: branch,
        status: 'requested',
        conclusion: null,
        pull_requests: [],
      },
      repository: {
        id: 100,
        name: 'testing-things',
        full_name: 'hiimbex/testing-things',
        owner: { login: 'hiimbex' },
      },
      installation: { id: 2 },
    },
    repo(params) {
      return { owner: 'hiimbex', repo: 'testing-things', ...params };
    },
    octokit: {
      checks: {
        async create(params) {
          capturedCall = params;
          return {};
        },
      },
    },
    _getCaptured() { return capturedCall; },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('My Probot app', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    registerCheckHandlers(app);
  });

  test('creates a passing check on check_suite.requested', async () => {
    const ctx = makeCheckSuiteContext('deadbeef1234', 'main');

    await app._handlers['check_suite.requested'](ctx);

    const call = ctx._getCaptured();
    assert.ok(call, 'Se esperaba una llamada a checks.create');
    assert.strictEqual(call.name, 'My app!');
    assert.strictEqual(call.conclusion, 'success');
    assert.strictEqual(call.status, 'completed');
    assert.strictEqual(call.head_sha, 'deadbeef1234');
    assert.strictEqual(call.head_branch, 'main');
    assert.strictEqual(call.output.title, 'Probot check!');
    assert.strictEqual(call.output.summary, 'The check has passed!');
  });
});
