// Label-based PR actions – realiza acciones automáticas según las etiquetas
// añadidas o retiradas de un PR.
//
// Configuración (variables de entorno):
//   DONTMERGE_LABEL  Nombre de la etiqueta que bloquea el merge (default: DONTMERGE)
//
// Para añadir nuevas etiquetas, extiende el mapa LABEL_RULES con una entrada
// que siga el mismo esquema { checkName, onAdd, onRemove }.

const DONTMERGE_LABEL = process.env.DONTMERGE_LABEL ?? 'DONTMERGE';

/**
 * Mapa de label (en minúsculas) → regla de acción.
 *
 * checkName  Nombre del check run creado por esta regla.
 * onAdd      Estado del check cuando se añade la etiqueta.
 * onRemove   Estado del check cuando se retira la etiqueta.
 */
const LABEL_RULES = {
  [DONTMERGE_LABEL.toLowerCase()]: {
    checkName: `Label: ${DONTMERGE_LABEL}`,
    onAdd: {
      conclusion: 'failure',
      title:      `🚫 Merge bloqueado — etiqueta ${DONTMERGE_LABEL}`,
      summary:    [
        `Este PR tiene la etiqueta **${DONTMERGE_LABEL}** aplicada.`,
        '',
        'Retira la etiqueta para desbloquear el merge.',
      ].join('\n'),
    },
    onRemove: {
      conclusion: 'success',
      title:      `✅ Bloqueo por ${DONTMERGE_LABEL} retirado`,
      summary:    [
        `La etiqueta **${DONTMERGE_LABEL}** fue retirada.`,
        '',
        'El PR puede mergearse si el resto de checks lo permiten.',
      ].join('\n'),
    },
  },
};

/**
 * Crea o actualiza el check run asociado a una regla de etiqueta.
 *
 * @param {import('probot').Context} context
 * @param {{ checkName: string, conclusion: string, title: string, summary: string }} opts
 * @param {string} sha
 */
async function applyLabelCheck(context, { checkName, conclusion, title, summary }, sha) {
  await context.octokit.checks.create(
    context.repo({
      name:       checkName,
      head_sha:   sha,
      status:     'completed',
      conclusion,
      output: { title, summary },
    }),
  );
}

/**
 * Registra los handlers de etiquetas en la instancia de Probot.
 *
 * @param {import('probot').Probot} app
 */
export function registerLabelsHandlers(app) {
  // ── Etiqueta añadida ───────────────────────────────────────────────────────
  app.on('pull_request.labeled', async (context) => {
    const { pull_request, label, repository } = context.payload;
    const rule = LABEL_RULES[label.name.toLowerCase()];
    if (!rule) return;

    app.log.info(
      `[labels] #${pull_request.number} ${repository.full_name} ` +
      `label="${label.name}" → bloqueando merge`,
    );

    await applyLabelCheck(
      context,
      { checkName: rule.checkName, ...rule.onAdd },
      pull_request.head.sha,
    );
  });

  // ── Etiqueta retirada ──────────────────────────────────────────────────────
  app.on('pull_request.unlabeled', async (context) => {
    const { pull_request, label, repository } = context.payload;
    const rule = LABEL_RULES[label.name.toLowerCase()];
    if (!rule) return;

    app.log.info(
      `[labels] #${pull_request.number} ${repository.full_name} ` +
      `label="${label.name}" → desbloqueando merge`,
    );

    await applyLabelCheck(
      context,
      { checkName: rule.checkName, ...rule.onRemove },
      pull_request.head.sha,
    );
  });
}
