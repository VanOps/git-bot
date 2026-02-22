// Checks API + DORA Metrics – Probot entry point
// See: https://developer.github.com/v3/checks/

import { connectDB }                  from './src/db.js';
import { registerCheckHandlers }       from './src/handlers/check.js';
import { registerPullRequestHandlers } from './src/handlers/pullRequest.js';
import { registerIncidentHandlers }    from './src/handlers/incident.js';

/**
 * Main Probot app.
 * @param {import('probot').Probot} app
 */
export default async (app) => {
  // ── MongoDB (non-fatal: app runs without persistence if Mongo is down) ──
  await connectDB(app.log);

  // ── Event handlers ──────────────────────────────────────────────────────
  registerCheckHandlers(app);
  registerPullRequestHandlers(app);
  registerIncidentHandlers(app);

  // ── Workflow run / job – structured logging ──────────────────────────────
  app.on('workflow_run', async (context) => {
    const { action, workflow_run, workflow, repository } = context.payload;
    app.log.info(
      `workflow_run [${action}] - ${workflow.name} en ${repository.full_name}`,
    );
    app.log.debug({
      id:         workflow_run.id,
      name:       workflow_run.name,
      status:     workflow_run.status,
      conclusion: workflow_run.conclusion,
      branch:     workflow_run.head_branch,
      sha:        workflow_run.head_sha,
      url:        workflow_run.html_url,
      actor:      workflow_run.actor?.login,
      created_at: workflow_run.created_at,
      updated_at: workflow_run.updated_at,
    });
  });

  app.on('workflow_job', async (context) => {
    const { action, workflow_job, repository } = context.payload;
    app.log.info(
      `workflow_job [${action}] - ${workflow_job.name} en ${repository.full_name}`,
    );
    app.log.debug({
      id:           workflow_job.id,
      name:         workflow_job.name,
      status:       workflow_job.status,
      conclusion:   workflow_job.conclusion,
      runner_name:  workflow_job.runner_name,
      started_at:   workflow_job.started_at,
      completed_at: workflow_job.completed_at,
      steps: workflow_job.steps?.map((s) => ({
        name:       s.name,
        status:     s.status,
        conclusion: s.conclusion,
      })),
    });
  });

  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
};
