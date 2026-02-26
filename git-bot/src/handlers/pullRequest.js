import PullRequest from "../models/PullRequest.js";

const VALID_TYPES = ["FIX", "FEAT", "CHORE", "DOCS", "REFACTOR", "TEST"];
const PR_TITLE_REGEX = new RegExp(`^\\[(${VALID_TYPES.join("|")})\\] .+$`);

async function safeUpsert(Model, filter, update, log, label) {
  try {
    return await Model.findOneAndUpdate(
      filter,
      { $set: update },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );
  } catch (err) {
    log.error({ err }, `[pr] DB error – ${label}`);
    return null;
  }
}

export function registerPullRequestHandlers(app) {
  // ─── PR title validation (existing behaviour preserved) ────────────────────
  app.on(
    ["pull_request.opened", "pull_request.edited", "pull_request.reopened"],
    async (context) => {
      const { pull_request, repository } = context.payload;
      const title = pull_request.title;
      const sha = pull_request.head.sha;
      const isValid = PR_TITLE_REGEX.test(title);

      app.log.info(
        `[pr] #${pull_request.number} ${repository.full_name} ` +
          `title="${title}" valid=${isValid}`,
      );

      await context.octokit.checks.create(
        context.repo({
          name: "PR Title Format",
          head_sha: sha,
          status: "completed",
          conclusion: isValid ? "success" : "failure",
          output: {
            title: isValid ? "Título correcto" : "Formato de título incorrecto",
            summary: isValid
              ? "El título cumple el formato requerido."
              : [
                  `El título **"${title}"** no cumple el formato requerido.`,
                  "",
                  "**Formato:** `[TIPO] Descripción [JIRA-NNN]`",
                  `**Tipos válidos:** ${VALID_TYPES.map((t) => `\`${t}\``).join(", ")}`,
                  "",
                  "**Ejemplo válido:** `[FEAT] Add login button [PROJ-123]`",
                ].join("\n"),
          },
        }),
      );
    },
  );

  // ─── PR closed: capture lifetime + line metrics ────────────────────────────
  app.on("pull_request.closed", async (context) => {
    const { pull_request, repository } = context.payload;

    app.log.debug(
      { pr: pull_request.number, merged: pull_request.merged },
      "[pr] pull_request.closed",
    );

    const createdAt = new Date(pull_request.created_at);
    const mergedAt = pull_request.merged_at
      ? new Date(pull_request.merged_at)
      : null;
    const closedAt = pull_request.closed_at
      ? new Date(pull_request.closed_at)
      : null;
    const lifetime_ms = mergedAt
      ? mergedAt - createdAt
      : closedAt
        ? closedAt - createdAt
        : null;

    await safeUpsert(
      PullRequest,
      { pr_id: pull_request.id },
      {
        pr_id: pull_request.id,
        pr_number: pull_request.number,
        repo_id: repository.id,
        repo_full_name: repository.full_name,
        author: pull_request.user?.login,
        title: pull_request.title,
        state: pull_request.state,
        created_at: createdAt,
        merged_at: mergedAt,
        closed_at: closedAt,
        lifetime_ms,
        commits: pull_request.commits,
        additions: pull_request.additions,
        deletions: pull_request.deletions,
        changed_files: pull_request.changed_files,
        head_sha: pull_request.head?.sha,
        base_branch: pull_request.base?.ref,
        labels: pull_request.labels?.map((l) => l.name) ?? [],
      },
      app.log,
      `PullRequest.closed #${pull_request.number}`,
    );

    app.log.info(
      `[pr] #${pull_request.number} ${pull_request.merged ? "merged" : "closed"} ` +
        `lifetime=${lifetime_ms}ms`,
    );
  });
}
