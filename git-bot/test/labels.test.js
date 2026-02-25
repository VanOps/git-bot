import { describe, beforeEach, test } from 'node:test';
import assert from 'node:assert';

import { registerLabelsHandlers } from '../src/handlers/labels.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeApp() {
  const handlers = {};
  return {
    _handlers: handlers,
    on(event, fn) { handlers[event] = fn; },
    log: { info: () => {}, error: () => {}, debug: () => {}, warn: () => {} },
  };
}

function makeContext(labelName, action = 'labeled', sha = 'cafebabe') {
  let capturedCall = null;
  return {
    payload: {
      action,
      label: { name: labelName },
      pull_request: {
        id: 1,
        number: 42,
        title: '[FEAT] Test PR [PROJ-123]',
        body: '## Release Notes\n- Feature X',
        head: { sha },
        base: { ref: 'main' },
        state: 'open',
        user: { login: 'testuser' },
        created_at: new Date().toISOString(),
        merged_at: null,
        closed_at: null,
      },
      repository: {
        id: 100,
        name: 'testing-things',
        full_name: 'hiimbex/testing-things',
        owner: { login: 'hiimbex' },
      },
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

describe('registerLabelsHandlers – DONTMERGE', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    registerLabelsHandlers(app);
  });

  test('registra handlers para labeled y unlabeled', () => {
    assert.strictEqual(typeof app._handlers['pull_request.labeled'], 'function');
    assert.strictEqual(typeof app._handlers['pull_request.unlabeled'], 'function');
  });

  test('bloquea el merge (failure) al añadir DONTMERGE', async () => {
    const ctx = makeContext('DONTMERGE', 'labeled', 'sha-block');

    await app._handlers['pull_request.labeled'](ctx);

    const call = ctx._getCaptured();
    assert.ok(call, 'Se esperaba una llamada a checks.create');
    assert.strictEqual(call.name, 'Label: DONTMERGE');
    assert.strictEqual(call.conclusion, 'failure');
    assert.strictEqual(call.head_sha, 'sha-block');
    assert.ok(call.output.title.includes('DONTMERGE'), 'El título debe mencionar la label');
  });

  test('desbloquea el merge (success) al retirar DONTMERGE', async () => {
    const ctx = makeContext('DONTMERGE', 'unlabeled', 'sha-unblock');

    await app._handlers['pull_request.unlabeled'](ctx);

    const call = ctx._getCaptured();
    assert.ok(call, 'Se esperaba una llamada a checks.create');
    assert.strictEqual(call.name, 'Label: DONTMERGE');
    assert.strictEqual(call.conclusion, 'success');
    assert.strictEqual(call.head_sha, 'sha-unblock');
  });

  test('la etiqueta DONTMERGE en minúsculas también bloquea', async () => {
    const ctx = makeContext('dontmerge', 'labeled');

    await app._handlers['pull_request.labeled'](ctx);

    const call = ctx._getCaptured();
    assert.ok(call, 'La comparación debe ser case-insensitive');
    assert.strictEqual(call.conclusion, 'failure');
  });

  test('no crea check run para etiquetas desconocidas al añadir', async () => {
    const ctx = makeContext('enhancement', 'labeled');

    await app._handlers['pull_request.labeled'](ctx);

    assert.strictEqual(ctx._getCaptured(), null, 'No debe crear check run para etiquetas no registradas');
  });

  test('no crea check run para etiquetas desconocidas al retirar', async () => {
    const ctx = makeContext('bug', 'unlabeled');

    await app._handlers['pull_request.unlabeled'](ctx);

    assert.strictEqual(ctx._getCaptured(), null, 'No debe crear check run para etiquetas no registradas');
  });

  test('el summary del bloqueo menciona cómo desbloquearlo', async () => {
    const ctx = makeContext('DONTMERGE', 'labeled');

    await app._handlers['pull_request.labeled'](ctx);

    const summary = ctx._getCaptured().output.summary;
    assert.ok(summary.toLowerCase().includes('retira'), 'El summary debe explicar cómo desbloquear');
  });
});
