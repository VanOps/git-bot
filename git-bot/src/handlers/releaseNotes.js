// Release Notes check – bloquea el merge si el cuerpo del PR no incluye
// una sección de release notes con contenido real.
//
// Configuración (variables de entorno):
//   RELEASE_NOTES_HEADER  Encabezado Markdown a buscar (default: "## Release Notes")
//   RELEASE_NOTES_REQUIRED  Pon "false" para desactivar el check (default: true)

const HEADER  = process.env.RELEASE_NOTES_HEADER   ?? '## Release Notes';
const ENABLED = (process.env.RELEASE_NOTES_REQUIRED ?? 'true') !== 'false';

const CHECK_NAME = 'Release Notes';

/**
 * Devuelve true si el cuerpo del PR contiene la sección de release notes
 * con al menos una línea de contenido (no vacía, no otro heading).
 *
 * @param {string | null | undefined} body
 * @returns {boolean}
 */
export function hasReleaseNotes(body) {
  if (!body) return false;

  const idx = body.indexOf(HEADER);
  if (idx === -1) return false;

  // Analiza las líneas posteriores al encabezado
  const afterHeader = body.slice(idx + HEADER.length);
  for (const line of afterHeader.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;           // línea vacía – sigue buscando
    if (trimmed.startsWith('#')) break; // nuevo heading – no hay contenido
    return true;                       // hay texto real
  }

  return false;
}

/**
 * Registra el handler de release notes en la instancia de Probot.
 *
 * @param {import('probot').Probot} app
 */
export function registerReleaseNotesHandlers(app) {
  if (!ENABLED) {
    app.log.info('[release-notes] check desactivado (RELEASE_NOTES_REQUIRED=false)');
    return;
  }

  // Disparado en apertura, edición de descripción, reapertura y nuevos commits
  app.on(
    [
      'pull_request.opened',
      'pull_request.edited',
      'pull_request.reopened',
      'pull_request.synchronize',
    ],
    async (context) => {
      const { pull_request, repository } = context.payload;
      const sha   = pull_request.head.sha;
      const valid = hasReleaseNotes(pull_request.body);

      app.log.info(
        `[release-notes] #${pull_request.number} ${repository.full_name} ` +
        `valid=${valid}`,
      );

      await context.octokit.checks.create(
        context.repo({
          name:       CHECK_NAME,
          head_sha:   sha,
          status:     'completed',
          conclusion: valid ? 'success' : 'failure',
          output: {
            title: valid
              ? '✅ Release notes presentes'
              : '❌ Release notes requeridas',
            summary: valid
              ? `Se encontró la sección \`${HEADER}\` con contenido.`
              : [
                  `El PR no incluye la sección \`${HEADER}\` con contenido.`,
                  '',
                  'Añade una sección como la del ejemplo al cuerpo del PR:',
                  '',
                  '```markdown',
                  HEADER,
                  '- Descripción del cambio visible para el usuario final.',
                  '```',
                ].join('\n'),
          },
        }),
      );
    },
  );
}
