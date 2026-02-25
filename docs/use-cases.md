# Casos de Uso de Probot: Ejemplos Reales y Prácticos

> **Este proyecto** es un ejemplo real de Probot que captura métricas DORA y estadísticas de workflows de GitHub Actions, las persiste en MongoDB y las expone vía API REST para Grafana. Ver [README](../README.md) para detalles de arquitectura y configuración.

Probot se usa principalmente para crear GitHub Apps que responden a eventos como issues, PRs o pushes, automatizando tareas repetitivas en repositorios. Aquí tienes múltiples ejemplos reales y prácticos, muchos open-source y listos para instalar en tu repo. [github](https://github.com/probot/probot)

## Ejemplos Populares

Estas apps construidas con Probot están disponibles en probot.github.io/apps y se instalan con un click. [probot.github](https://probot.github.io/apps/)

- **Release Drafter**: Detecta PRs mergeadas y genera borradores de releases con changelog automático basado en labels como "enhancement" o "bug". [codesandbox](https://codesandbox.io/examples/package/probot)
- **Stale**: Marca issues/PRs inactivos después de días configurables y los cierra con un comentario, reduciendo ruido en repos grandes. [probot.github](https://probot.github.io)
- **All Contributors**: Añade contributors automáticamente al README con un emoji por tipo de contribución (code, docs, etc.) al usar /add-contributor. [codesandbox](https://codesandbox.io/examples/package/probot)

## Casos Avanzados

Probot brilla en workflows DevOps como los tuyos con Kubernetes y CI/CD. [github](https://github.com/probot/example-github-action)

- **First Timers Bot**: Asigna issues simples a nuevos colaboradores, fomentando onboarding en open-source. [codesandbox](https://codesandbox.io/examples/package/probot)
- **DCO Bot**: Verifica Signed-off-by en commits de PRs para cumplir Developer Certificate of Origin. [codesandbox](https://codesandbox.io/examples/package/probot)
- **Self Approve**: Permite autores de PRs auto-aprobarse bajo reglas (ej. cambios triviales), acelerando merges en equipos pequeños. [probot.github](https://probot.github.io/apps/)

## Ejemplos de Código Simple

Puedes crear apps básicas en minutos con Probot CLI (`npx create-probot-app mi-bot`). [probot.github](https://probot.github.io/docs/development/)

- **Bienvenida en Issues**: Responde "¡Hola @user!" a issues nuevos: `app.on('issues.opened', async context => { return context.octokit.issues.createComment(context.issue({ body: '¡Hola!' })) })`. [probot.github](https://probot.github.io/docs/development/)
- **Comentario Trivial**: Si escribes "trivial", el bot pregunta "¿Estás seguro?" para evitar comentarios impulsivos. [probot.github](https://probot.github.io/apps/)
- **Visual Diffs**: Monitorea workflows de tests y postea diffs de screenshots en PRs para UI reviews. [probot.github](https://probot.github.io/apps/)

## Tabla de Instalación

| App              | Repo/Eventos         | Instalación           | Uso Típico [probot.github](https://probot.github.io) |
| ---------------- | -------------------- | --------------------- | ---------------------------------------------------- |
| Release Drafter  | Merge PRs            | probot.github.io/apps | Changelogs auto                                      |
| Stale            | Issues/PRs inactivos | probot.github.io/apps | Limpieza repo                                        |
| All Contributors | /add command         | probot.github.io/apps | Créditos equipo                                      |
| DCO              | Commits PR           | Busca en GitHub       | Cumplir licencias                                    |

Explora más en https://probot.github.io/apps/ o el repo oficial para templates como integración con GitHub Actions o Netlify. Perfecto para tus pipelines en GitHub Actions con Helm/K8s. [github](https://github.com/probot/example-begin)
