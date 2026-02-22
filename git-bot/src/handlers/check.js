import CheckSuite from '../models/CheckSuite.js';
import CheckRun from '../models/CheckRun.js';
import Deployment from '../models/Deployment.js';

/** Workflow names that indicate a deployment (case-insensitive substring match). */
const DEPLOY_PATTERNS = ['deploy', 'release', 'publish', ' cd', '-cd'];

const isDeployWorkflow = (name = '') => {
  const lower = name.toLowerCase();
  return DEPLOY_PATTERNS.some((p) => lower.includes(p));
};

const calcDurationMs = (start, end) => {
  if (!start || !end) return null;
  const ms = new Date(end) - new Date(start);
  return ms >= 0 ? ms : null;
};

/** Safe DB upsert – logs errors without crashing the handler. */
async function safeUpsert(Model, filter, update, log, label) {
  try {
    return await Model.findOneAndUpdate(filter, { $set: update }, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
  } catch (err) {
    log.error({ err }, `[check] DB error – ${label}`);
    return null;
  }
}

export function registerCheckHandlers(app) {
  // ─── check_suite.requested ─────────────────────────────────────────────────
  // Preserve original behaviour: create a "My app!" check run on GitHub.
  // Also upsert the suite into MongoDB for DORA tracking.
  app.on('check_suite.requested', async (context) => {
    const { check_suite, repository, installation } = context.payload;
    const startTime = new Date();

    app.log.debug(
      { suite_id: check_suite.id, repo: repository.full_name },
      '[check] check_suite.requested',
    );

    // ── GitHub Checks API (original behaviour) ──
    try {
      await context.octokit.checks.create(
        context.repo({
          name: 'My app!',
          head_branch: check_suite.head_branch,
          head_sha: check_suite.head_sha,
          status: 'completed',
          started_at: startTime,
          conclusion: 'success',
          completed_at: new Date(),
          output: {
            title: 'Probot check!',
            summary: 'The check has passed!',
          },
        }),
      );
    } catch (err) {
      app.log.error({ err }, '[check] checks.create failed on suite.requested');
    }

    // ── DORA: upsert suite ──
    // Nota: workflow_name se asigna en workflow_run.completed (check_suite.app.name
    // siempre es "GitHub Actions", no el nombre real del workflow).
    await safeUpsert(
      CheckSuite,
      { suite_id: check_suite.id },
      {
        suite_id:        check_suite.id,
        repo_id:         repository.id,
        installation_id: installation?.id,
        repo_full_name:  repository.full_name,
        status:          check_suite.status,
        conclusion:      check_suite.conclusion,
        head_sha:        check_suite.head_sha,
        head_branch:     check_suite.head_branch,
        pr_numbers:      check_suite.pull_requests?.map((pr) => pr.number) ?? [],
        started_at:      startTime,
      },
      app.log,
      `CheckSuite.requested ${check_suite.id}`,
    );

    app.log.info(
      `[check] suite.requested upserted suite=${check_suite.id} repo=${repository.full_name}`,
    );
  });

  // ─── check_suite.completed ─────────────────────────────────────────────────
  app.on('check_suite.completed', async (context) => {
    const { check_suite, repository, installation } = context.payload;

    app.log.debug(
      { suite_id: check_suite.id, conclusion: check_suite.conclusion },
      '[check] check_suite.completed',
    );

    // Nota: workflow_name e is_deploy se fijan en workflow_run.completed,
    // donde tenemos el nombre real del workflow. Aquí solo actualizamos
    // status/conclusion/duration para que CFR funcione con todos los suites.
    const completedAt = new Date(check_suite.updated_at ?? Date.now());
    const existing    = await CheckSuite.findOne({ suite_id: check_suite.id }).lean().catch(() => null);
    const startedAt   = existing?.started_at ?? new Date(check_suite.created_at ?? completedAt);
    const duration_ms = calcDurationMs(startedAt, completedAt);
    const pr_numbers  = check_suite.pull_requests?.map((pr) => pr.number)
      ?? existing?.pr_numbers
      ?? [];

    await safeUpsert(
      CheckSuite,
      { suite_id: check_suite.id },
      {
        suite_id:        check_suite.id,
        repo_id:         repository.id,
        installation_id: installation?.id,
        repo_full_name:  repository.full_name,
        status:          check_suite.status,
        conclusion:      check_suite.conclusion,
        head_sha:        check_suite.head_sha,
        head_branch:     check_suite.head_branch,
        pr_numbers,
        duration_ms,
        completed_at:    completedAt,
      },
      app.log,
      `CheckSuite.completed ${check_suite.id}`,
    );

    app.log.info(
      `[check] suite.completed suite=${check_suite.id} conclusion=${check_suite.conclusion} ` +
      `duration=${duration_ms}ms`,
    );
  });

  // ─── workflow_run.completed ────────────────────────────────────────────────
  // Única fuente fiable del nombre real del workflow (workflow_run.name).
  // check_suite.app.name siempre devuelve "GitHub Actions" y no sirve para
  // detectar deploys. Aquí actualizamos workflow_name + is_deploy en el
  // CheckSuite y creamos el Deployment cuando corresponde.
  app.on('workflow_run.completed', async (context) => {
    const { workflow_run, repository, installation } = context.payload;

    const workflowName = workflow_run.name;
    const is_deploy    = isDeployWorkflow(workflowName ?? '');
    const completedAt  = new Date(workflow_run.updated_at ?? Date.now());
    const startedAt    = new Date(workflow_run.run_started_at ?? workflow_run.created_at ?? completedAt);
    const duration_ms  = calcDurationMs(startedAt, completedAt);

    app.log.debug(
      { run_id: workflow_run.id, name: workflowName, conclusion: workflow_run.conclusion, is_deploy },
      '[check] workflow_run.completed',
    );

    // ── Fijar workflow_name e is_deploy en el CheckSuite asociado ──
    await safeUpsert(
      CheckSuite,
      { suite_id: workflow_run.check_suite_id },
      {
        workflow_name: workflowName,
        is_deploy,
        duration_ms,
        completed_at:  completedAt,
      },
      app.log,
      `CheckSuite.workflow_name ${workflow_run.check_suite_id}`,
    );

    app.log.info(
      `[check] workflow_run.completed run=${workflow_run.id} name="${workflowName}" ` +
      `conclusion=${workflow_run.conclusion} deploy=${is_deploy}`,
    );

    // ── DORA: registrar Deployment si es un workflow de deploy ──
    if (is_deploy) {
      await safeUpsert(
        Deployment,
        { suite_id: workflow_run.check_suite_id },
        {
          suite_id:       workflow_run.check_suite_id,
          repo_id:        repository.id,
          installation_id: installation?.id,
          repo_full_name: repository.full_name,
          sha:            workflow_run.head_sha,
          branch:         workflow_run.head_branch,
          status:         workflow_run.status,
          conclusion:     workflow_run.conclusion,
          duration_ms,
          workflow_name:  workflowName,
          deployed_at:    completedAt,
        },
        app.log,
        `Deployment.workflow_run ${workflow_run.check_suite_id}`,
      );
      app.log.info(
        `[check] deployment recorded workflow_run=${workflow_run.id} sha=${workflow_run.head_sha}`,
      );
    }
  });

  // ─── check_run.rerequested ─────────────────────────────────────────────────
  // Preserve original behaviour: re-create the check run.
  app.on('check_run.rerequested', async (context) => {
    const { check_run, check_suite, repository } = context.payload;
    const startTime = new Date();

    app.log.debug(
      { run_id: check_run.id },
      '[check] check_run.rerequested',
    );

    // ── GitHub Checks API ──
    try {
      await context.octokit.checks.create(
        context.repo({
          name:         check_run.name ?? 'My app!',
          head_branch:  check_suite?.head_branch ?? check_run.check_suite?.head_branch,
          head_sha:     check_suite?.head_sha    ?? check_run.head_sha,
          status:       'completed',
          started_at:   startTime,
          conclusion:   'success',
          completed_at: new Date(),
          output: {
            title:   'Probot re-check passed',
            summary: 'The re-requested check has passed.',
          },
        }),
      );
    } catch (err) {
      app.log.error({ err }, '[check] checks.create failed on run.rerequested');
    }
  });

  // ─── check_run.completed ──────────────────────────────────────────────────
  app.on('check_run.completed', async (context) => {
    const { check_run, repository, installation } = context.payload;

    app.log.debug(
      { run_id: check_run.id, name: check_run.name },
      '[check] check_run.completed',
    );

    const startedAt   = check_run.started_at   ? new Date(check_run.started_at)   : null;
    const completedAt = check_run.completed_at  ? new Date(check_run.completed_at) : new Date();
    const duration_ms = calcDurationMs(startedAt, completedAt);

    await safeUpsert(
      CheckRun,
      { run_id: check_run.id },
      {
        run_id:       check_run.id,
        suite_id:     check_run.check_suite.id,
        repo_id:      repository.id,
        name:         check_run.name,
        status:       check_run.status,
        conclusion:   check_run.conclusion,
        duration_ms,
        started_at:   startedAt,
        completed_at: completedAt,
        steps:        [], // populated via workflow_job handler if needed
      },
      app.log,
      `CheckRun.completed ${check_run.id}`,
    );

    app.log.info(
      `[check] run.completed run=${check_run.id} name="${check_run.name}" ` +
      `conclusion=${check_run.conclusion} duration=${duration_ms}ms`,
    );
  });
}
