import Incident from '../models/Incident.js';

const INCIDENT_LABEL = process.env.INCIDENT_LABEL ?? 'incident';

export function registerIncidentHandlers(app) {
  // ─── Issue labeled "incident" → open incident record ──────────────────────
  app.on('issues.labeled', async (context) => {
    const { issue, label, repository } = context.payload;

    if (label.name !== INCIDENT_LABEL) return;

    app.log.debug(
      { issue: issue.number, label: label.name },
      '[incident] issues.labeled',
    );

    try {
      await Incident.findOneAndUpdate(
        { issue_id: issue.id },
        {
          $setOnInsert: {
            issue_id:       issue.id,
            issue_number:   issue.number,
            repo_id:        repository.id,
            repo_full_name: repository.full_name,
            title:          issue.title,
            labeled_at:     new Date(),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      app.log.info(
        `[incident] opened issue=#${issue.number} repo=${repository.full_name}`,
      );
    } catch (err) {
      app.log.error({ err }, '[incident] DB error on issues.labeled');
    }
  });

  // ─── Issue closed → resolve incident, compute TTR ─────────────────────────
  app.on('issues.closed', async (context) => {
    const { issue } = context.payload;

    app.log.debug({ issue: issue.number }, '[incident] issues.closed');

    try {
      const incident = await Incident.findOne({ issue_id: issue.id });
      if (!incident || incident.resolved_at) return;

      const resolvedAt        = new Date();
      const time_to_restore_ms = incident.labeled_at
        ? resolvedAt - incident.labeled_at
        : null;

      await Incident.findOneAndUpdate(
        { issue_id: issue.id },
        { $set: { resolved_at: resolvedAt, time_to_restore_ms } },
      );

      app.log.info(
        `[incident] resolved issue=#${issue.number} TTR=${time_to_restore_ms}ms`,
      );
    } catch (err) {
      app.log.error({ err }, '[incident] DB error on issues.closed');
    }
  });

  // ─── PR merged with fix/incident label → link to open incidents ───────────
  app.on('pull_request.closed', async (context) => {
    const { pull_request, repository } = context.payload;
    if (!pull_request.merged) return;

    const labels = pull_request.labels?.map((l) => l.name.toLowerCase()) ?? [];
    const isFix  = labels.some((l) => l.includes('fix') || l === INCIDENT_LABEL);
    if (!isFix) return;

    app.log.debug(
      { pr: pull_request.number },
      '[incident] fix PR merged, linking to open incidents',
    );

    try {
      const openIncidents = await Incident.find({
        repo_id:     repository.id,
        resolved_at: null,
        fix_pr_number: null,
      });

      for (const incident of openIncidents) {
        await Incident.findByIdAndUpdate(incident._id, {
          $set: {
            fix_pr_number: pull_request.number,
            fix_pr_sha:    pull_request.merge_commit_sha,
          },
        });
        app.log.info(
          `[incident] linked fix PR #${pull_request.number} → incident #${incident.issue_number}`,
        );
      }
    } catch (err) {
      app.log.error({ err }, '[incident] DB error linking fix PR');
    }
  });
}
