// Checks API example
// See: https://developer.github.com/v3/checks/ to learn more

/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Probot} app
 */
export default (app) => {
  app.on(["check_suite.requested", "check_run.rerequested"], check);

  async function check(context) {
    const startTime = new Date();

    // Do stuff
    const { head_branch: headBranch, head_sha: headSha } =
      context.payload.check_suite;
    // Probot API note: context.repo() => {username: 'hiimbex', repo: 'testing-things'}
    return context.octokit.checks.create(
      context.repo({
        name: "My app!",
        head_branch: headBranch,
        head_sha: headSha,
        status: "completed",
        started_at: startTime,
        conclusion: "success",
        completed_at: new Date(),
        output: {
          title: "Probot check!",
          summary: "The check has passed!",
        },
      }),
    );
  }

  app.on("workflow_run", async (context) => {
    const { action, workflow_run, workflow, repository } = context.payload;
    app.log.info(
      `workflow_run [${action}] - ${workflow.name} en ${repository.full_name}`,
    );
    app.log.info({
      id: workflow_run.id,
      name: workflow_run.name,
      status: workflow_run.status,
      conclusion: workflow_run.conclusion,
      branch: workflow_run.head_branch,
      sha: workflow_run.head_sha,
      url: workflow_run.html_url,
      actor: workflow_run.actor?.login,
      created_at: workflow_run.created_at,
      updated_at: workflow_run.updated_at,
    });
  });

  app.on("workflow_job", async (context) => {
    const { action, workflow_job, repository } = context.payload;
    app.log.info(
      `workflow_job [${action}] - ${workflow_job.name} en ${repository.full_name}`,
    );
    app.log.info({
      id: workflow_job.id,
      name: workflow_job.name,
      status: workflow_job.status,
      conclusion: workflow_job.conclusion,
      runner_name: workflow_job.runner_name,
      started_at: workflow_job.started_at,
      completed_at: workflow_job.completed_at,
      steps: workflow_job.steps?.map((s) => ({
        name: s.name,
        status: s.status,
        conclusion: s.conclusion,
      })),
    });
  });

  const VALID_TYPES = ["FIX", "FEAT", "CHORE", "DOCS", "REFACTOR", "TEST"];
  const PR_TITLE_REGEX = new RegExp(
    `^\\[(${VALID_TYPES.join("|")})\\] .+ \\[[A-Z]+-\\d+\\]$`,
  );

  app.on(
    ["pull_request.opened", "pull_request.edited", "pull_request.reopened"],
    async (context) => {
      const { pull_request, repository } = context.payload;
      const title = pull_request.title;
      const sha = pull_request.head.sha;
      const isValid = PR_TITLE_REGEX.test(title);

      app.log.info(
        `PR #${pull_request.number} en ${repository.full_name} - título: "${title}" - válido: ${isValid}`,
      );

      await context.octokit.checks.create(
        context.repo({
          name: "PR Title Format",
          head_sha: sha,
          status: "completed",
          conclusion: isValid ? "success" : "failure",
          output: {
            title: isValid
              ? "Título correcto"
              : "Formato de título incorrecto",
            summary: isValid
              ? `El título cumple el formato requerido.`
              : [
                  `El título **"${title}"** no cumple el formato requerido.`,
                  ``,
                  `**Formato:** \`[TIPO] Descripción [JIRA-NNN]\``,
                  `**Tipos válidos:** ${VALID_TYPES.map((t) => `\`${t}\``).join(", ")}`,
                  ``,
                  `**Ejemplo válido:** \`[FEAT] Add login button [PROJ-123]\``,
                ].join("\n"),
          },
        }),
      );
    },
  );

  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
};
