import { describe, beforeEach, test } from 'node:test';
import assert from 'node:assert';

import { hasReleaseNotes, registerReleaseNotesHandlers } from '../src/handlers/releaseNotes.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Crea una instancia mínima de Probot app para capturar handlers registrados.
 */
function makeApp() {
  const handlers = {};
  return {
    _handlers: handlers,
    on(events, fn) {
      const list = Array.isArray(events) ? events : [events];
      list.forEach((e) => { handlers[e] = fn; });
    },
    log: { info: () => {}, error: () => {}, debug: () => {}, warn: () => {} },
  };
}

/**
 * Crea un contexto de Probot simulado para un evento pull_request.
 */
function makeContext({ body = '', sha = 'abc123' } = {}) {
  let capturedCall = null;
  return {
    payload: {
      pull_request: {
        id: 1,
        number: 42,
        title: '[FEAT] Test PR [PROJ-123]',
        body,
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

// ── Unidad: hasReleaseNotes ───────────────────────────────────────────────────

describe('hasReleaseNotes – función pura', () => {
  test('retorna false para body null', () => {
    assert.strictEqual(hasReleaseNotes(null), false);
  });

  test('retorna false para body vacío', () => {
    assert.strictEqual(hasReleaseNotes(''), false);
  });

  test('retorna false cuando la sección no existe', () => {
    assert.strictEqual(hasReleaseNotes('# Descripción\n\nAlgún contenido.'), false);
  });

  test('retorna false cuando la sección existe pero está vacía', () => {
    assert.strictEqual(hasReleaseNotes('## Release Notes\n\n## Otro heading'), false);
  });

  test('retorna false cuando la sección solo tiene líneas en blanco', () => {
    assert.strictEqual(hasReleaseNotes('## Release Notes\n\n\n'), false);
  });

  test('retorna true con un bullet point', () => {
    assert.strictEqual(hasReleaseNotes('## Release Notes\n- Se añadió la feature X'), true);
  });

  test('retorna true con texto plano', () => {
    assert.strictEqual(hasReleaseNotes('## Release Notes\nCorregido bug Y'), true);
  });

  test('retorna true cuando la sección aparece después de otro contenido', () => {
    const body = [
      '## Descripción',
      'Algo aquí.',
      '',
      '## Release Notes',
      '- Feature X añadida',
      '- Bug Y corregido',
    ].join('\n');
    assert.strictEqual(hasReleaseNotes(body), true);
  });

  test('retorna false cuando el contenido está solo en el siguiente heading', () => {
    assert.strictEqual(hasReleaseNotes('## Release Notes\n## Otro heading\nContenido aquí'), false);
  });
});

// ── Integración: lógica del handler ──────────────────────────────────────────

describe('registerReleaseNotesHandlers – check runs', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    registerReleaseNotesHandlers(app);
  });

  test('registra handlers para los cuatro eventos de PR esperados', () => {
    const events = [
      'pull_request.opened',
      'pull_request.edited',
      'pull_request.reopened',
      'pull_request.synchronize',
    ];
    for (const evt of events) {
      assert.ok(
        typeof app._handlers[evt] === 'function',
        `Handler no registrado para ${evt}`,
      );
    }
  });

  test('crea check failure cuando el PR no tiene release notes', async () => {
    const ctx = makeContext({ body: 'Sin sección de release notes', sha: 'deadbeef' });

    await app._handlers['pull_request.synchronize'](ctx);

    const call = ctx._getCaptured();
    assert.ok(call, 'Se esperaba una llamada a checks.create');
    assert.strictEqual(call.name, 'Release Notes');
    assert.strictEqual(call.conclusion, 'failure');
    assert.strictEqual(call.head_sha, 'deadbeef');
    assert.ok(call.output.summary.includes('## Release Notes'), 'El summary debe mostrar el header esperado');
  });

  test('crea check success cuando el PR incluye release notes con contenido', async () => {
    const body = '## Descripción\nAlgo.\n\n## Release Notes\n- Feature añadida.';
    const ctx = makeContext({ body, sha: 'cafebabe' });

    await app._handlers['pull_request.opened'](ctx);

    const call = ctx._getCaptured();
    assert.ok(call, 'Se esperaba una llamada a checks.create');
    assert.strictEqual(call.name, 'Release Notes');
    assert.strictEqual(call.conclusion, 'success');
    assert.strictEqual(call.head_sha, 'cafebabe');
  });

  test('el check run incluye siempre el head_sha correcto', async () => {
    const ctx = makeContext({ body: '', sha: '1234abc' });

    await app._handlers['pull_request.edited'](ctx);

    assert.strictEqual(ctx._getCaptured().head_sha, '1234abc');
  });
});
