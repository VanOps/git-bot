Estructura generada

git-bot/
├── docker-compose.yml ← nuevo (en raíz del repo)
├── git-bot/
│ ├── index.js ← reescrito (async, importa handlers)
│ ├── package.json ← + mongoose@^8
│ ├── app.yml ← + issues event habilitado
│ ├── .env.example ← + DATABASE_URL + INCIDENT_LABEL
│ └── src/
│ ├── db.js ← conexión Mongoose (non-fatal si Mongo está caído)
│ ├── models/
│ │ ├── CheckSuite.js ← suite_id, repo_id, duration_ms, is_deploy, pr_numbers…
│ │ ├── CheckRun.js ← run_id, suite_id, conclusion, duration_ms, steps[]
│ │ ├── PullRequest.js ← lifetime_ms, additions, deletions, labels…
│ │ ├── Deployment.js ← sha, branch, deployed_at, pr_numbers…
│ │ └── Incident.js ← labeled_at, resolved_at, time_to_restore_ms…
│ ├── handlers/
│ │ ├── check.js ← check_suite.requested/completed + check_run.completed
│ │ ├── pullRequest.js ← PR title check + pull_request.closed metrics
│ │ └── incident.js ← issues.labeled/closed + fix PR linking
│ └── queries/
│ └── dora.js ← 7 agregaciones DORA exportables
Comportamientos clave
Evento Comportamiento original Nuevo (DORA)
check_suite.requested checks.create "My app!" + upsert CheckSuite
check_suite.completed — upsert CheckSuite con duration_ms; si workflow es deploy\* → upsert Deployment
check_run.rerequested checks.create re-check preservado intacto
check_run.completed — upsert CheckRun
pull_request.opened/edited check título preservado
pull_request.closed — upsert PullRequest con lifetime_ms
issues.labeled (incident) — open Incident con labeled_at
issues.closed — resolve Incident, calcula time_to_restore_ms
Arrancar

# 1. Instalar dependencias (añade mongoose)

cd git-bot && npm install

# 2. Copiar y rellenar .env

cp .env.example .env # edita APP_ID, WEBHOOK_SECRET, WEBHOOK_PROXY_URL

# 3. Dev local (nodemon)

npx nodemon --watch src --watch index.js index.js

# 4. Docker Compose (probot + mongo)

cd .. # raíz del repo
docker compose up --build
Queries DORA de verificación (mongosh)

// Resumen de las 4 métricas DORA (últimos 30 días)
use probot_metrics

// Deployment Frequency
db.deployments.aggregate([
{ $match: { conclusion: "success" } },
{ $group: { _id: { repo: "$repo_full_name", day: { $dateToString: { format: "%Y-%m-%d", date: "$deployed_at" } } }, n: { $sum: 1 } } },
{ $group: { _id: "$_id.repo", total: { $sum: "$n" }, avg_per_day: { $avg: "$n" } } }
])

// Change Failure Rate
db.checksuites.aggregate([
{ $match: { status: "completed" } },
  { $group: { _id: "$repo_full_name", total: { $sum: 1 },
      failed: { $sum: { $cond: [{ $in: ["$conclusion", ["failure","timed_out"]] }, 1, 0] } } } },
{ $project: { cfr_pct: { $multiply: [{ $divide: ["$failed","$total"] }, 100] } } }
])

// MTTR
db.incidents.aggregate([
{ $match: { resolved_at: { $ne: null } } },
  { $group: { _id: "$repo_full_name", avg_ttr_h: { $avg: { $divide: ["$time_to_restore_ms", 3600000] } } } }
])

// PR Lifetime
db.pullrequests.aggregate([
{ $match: { merged_at: { $ne: null } } },
  { $group: { _id: "$repo_full_name", avg_h: { $avg: { $divide: ["$lifetime_ms", 3600000] } }, prs: { $sum: 1 } } }
])
