# git-bot — DORA Metrics para GitHub Actions

GitHub App construida con [Probot](https://probot.github.io) + Node.js 20 que captura métricas DORA (y extras) de todos tus repositorios en tiempo real, persiste en MongoDB y expone queries listos para Grafana.

> **Stack**: Probot 13 · Mongoose 8 · MongoDB 7 · Docker Compose · Node ≥ 18 · ISC License

---

## Tabla de contenidos

- [Arquitectura](#arquitectura)
- [Qué hace](#qué-hace)
- [Métricas DORA](#métricas-dora)
- [Modelo de datos](#modelo-de-datos)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Inicio rápido](#inicio-rápido)
- [Docker Compose](#docker-compose)
- [GitHub App — Configuración](#github-app--configuración)
- [Variables de entorno](#variables-de-entorno)
- [CI/CD](#cicd)
- [Queries DORA](#queries-dora)
- [License](#license)

---

## Arquitectura

```mermaid
graph TB
    GH[("GitHub\n(webhooks)")]

    subgraph Docker Compose
        P["Probot App\n:3000"]
        M[("MongoDB 7\n:27017")]
        P -- "mongoose upsert" --> M
    end

    subgraph Handlers
        CH["check.js\ncheck_suite / check_run"]
        PR["pullRequest.js\nPR title + metrics"]
        IN["incident.js\nissues labeled/closed"]
    end

    GH -- "HMAC signed\nPOST /payload" --> P
    P --> CH & PR & IN

    subgraph Queries
        DQ["dora.js\naggregations"]
    end

    M -- "aggregate()" --> DQ
    DQ -- "JSON" --> GR["Grafana\n(future)"]
```

---

## Qué hace

### Handlers registrados

| Evento GitHub                         | Acción GitHub API                     | Persistencia DORA                                                             |
| ------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| `check_suite.requested`               | `checks.create` "My app!"             | Upsert `checksuites`                                                          |
| `check_suite.completed`               | —                                     | Update suite + `duration_ms`; si workflow es `deploy*` → upsert `deployments` |
| `check_run.rerequested`               | `checks.create` re-check              | —                                                                             |
| `check_run.completed`                 | —                                     | Upsert `checkruns`                                                            |
| `pull_request.opened/edited/reopened` | Check título `[TIPO] Desc [JIRA-NNN]` | —                                                                             |
| `pull_request.closed`                 | —                                     | Upsert `pullrequests` con `lifetime_ms`                                       |
| `issues.labeled` (`incident`)         | —                                     | Crea registro `incidents` con `labeled_at`                                    |
| `issues.closed`                       | —                                     | Resuelve incident, calcula `time_to_restore_ms`                               |
| `workflow_run` / `workflow_job`       | —                                     | Log estructurado DEBUG                                                        |

### Flujo de un evento

```mermaid
sequenceDiagram
    participant GH as GitHub
    participant P  as Probot :3000
    participant H  as Handler (check.js)
    participant DB as MongoDB

    GH->>P: POST /payload (check_suite.completed)
    P->>P: Verify HMAC signature
    P->>H: app.on('check_suite.completed', ctx)
    H->>DB: CheckSuite.findOneAndUpdate (upsert)
    alt is_deploy = true
        H->>DB: Deployment.findOneAndUpdate (upsert)
    end
    H-->>P: resolve (non-blocking errors)
    Note over H,DB: Fallos de DB son no-fatales (log.warn)
```

### Validación de título de PR

El bot bloquea PRs cuyo título no cumpla el formato:

```
[TIPO] Descripción libre [JIRA-NNN]
```

Tipos válidos: `FIX` · `FEAT` · `CHORE` · `DOCS` · `REFACTOR` · `TEST`

---

## Métricas DORA

```mermaid
quadrantChart
    title DORA Performance Levels
    x-axis Low --> High
    y-axis Low --> High
    quadrant-1 Elite
    quadrant-2 High
    quadrant-3 Low
    quadrant-4 Medium
    Deployment Frequency: [0.85, 0.85]
    Lead Time for Changes: [0.75, 0.65]
    Change Failure Rate: [0.3, 0.7]
    Time to Restore: [0.65, 0.8]
```

| Métrica                    | Fuente de datos                                | Colección Mongo | Nivel Elite   |
| -------------------------- | ---------------------------------------------- | --------------- | ------------- |
| **Deployment Frequency**   | `check_suite.completed` en workflows `deploy*` | `deployments`   | Múltiples/día |
| **Lead Time for Changes**  | `duration_ms` de suites de deploy              | `checksuites`   | < 1 hora      |
| **Change Failure Rate**    | `conclusion: failure` / total suites           | `checksuites`   | < 15 %        |
| **Time to Restore (MTTR)** | `labeled_at` → `resolved_at` en issues         | `incidents`     | < 1 hora      |
| PR Lifetime _(bonus)_      | `created_at` → `merged_at`                     | `pullrequests`  | —             |
| Failed Jobs _(bonus)_      | `check_run.conclusion: failure`                | `checkruns`     | —             |

---

## Modelo de datos

```mermaid
erDiagram
    CheckSuite {
        Number suite_id PK
        Number repo_id
        Number installation_id
        String repo_full_name
        String status
        String conclusion
        String head_sha
        String head_branch
        String workflow_name
        Array  pr_numbers
        Number duration_ms
        Bool   is_deploy
        Date   started_at
        Date   completed_at
    }

    CheckRun {
        Number run_id PK
        Number suite_id FK
        Number repo_id
        String name
        String status
        String conclusion
        Number duration_ms
        Array  steps
    }

    Deployment {
        Number suite_id PK
        Number repo_id
        String sha
        String branch
        String conclusion
        Number duration_ms
        Array  pr_numbers
        Date   deployed_at
    }

    PullRequest {
        Number pr_id PK
        Number pr_number
        Number repo_id
        String author
        Date   created_at
        Date   merged_at
        Number lifetime_ms
        Number additions
        Number deletions
    }

    Incident {
        Number issue_id PK
        Number repo_id
        Date   labeled_at
        Date   resolved_at
        Number time_to_restore_ms
        Number fix_pr_number
    }

    CheckSuite ||--o{ CheckRun    : "has"
    CheckSuite ||--o|  Deployment  : "generates"
    PullRequest }o--o{ CheckSuite  : "pr_numbers"
    Incident    }o--o| PullRequest : "fix_pr_number"
```

---

## Estructura del proyecto

```
git-bot/                         ← raíz del repositorio
├── .github/
│   └── workflows/
│       ├── ci.yml               ← tests + docker build + compose validate
│       ├── ai-disclosure.yaml   ← EU AI Act Art.50 auto-update
│       └── ci-ai-compliance.yaml
├── docker-compose.yml           ← probot + mongo (volúmenes persistentes)
├── docs/
│   ├── probot.md
│   └── use-cases.md
└── git-bot/                     ← código de la app
    ├── Dockerfile               ← node:20-slim, npm ci --production
    ├── index.js                 ← entry point (probot run ./index.js)
    ├── package.json             ← probot@13 + mongoose@8
    ├── app.yml                  ← permisos y eventos del GitHub App
    ├── .env.example
    └── src/
        ├── db.js                ← conexión Mongoose (non-fatal si Mongo está caído)
        ├── models/
        │   ├── CheckSuite.js
        │   ├── CheckRun.js
        │   ├── PullRequest.js
        │   ├── Deployment.js
        │   └── Incident.js
        ├── handlers/
        │   ├── check.js         ← check_suite.* + check_run.*
        │   ├── pullRequest.js   ← PR title check + pull_request.closed
        │   └── incident.js      ← issues.labeled/closed + fix PR linking
        └── queries/
            └── dora.js          ← 7 funciones de agregación DORA
```

---

## Inicio rápido

### Requisitos

- Node.js ≥ 18
- Docker + Docker Compose (para MongoDB local)
- Cuenta GitHub + GitHub App creada

### 1. Clonar e instalar

```bash
git clone <repo>
cd git-bot/git-bot
npm install
```

### 2. Configurar el `.env`

```bash
cp .env.example .env
# Editar con tus valores reales
```

```env
APP_ID=123456
PRIVATE_KEY_PATH=./private-key.pem      # descarga desde GitHub App settings
WEBHOOK_SECRET=un_secreto_seguro
WEBHOOK_PROXY_URL=https://smee.io/xxxx  # para desarrollo local
DATABASE_URL=mongodb://localhost:27017/probot_metrics
INCIDENT_LABEL=incident
LOG_LEVEL=debug
```

### 3. Arrancar MongoDB local

```bash
# Desde la raíz del repo
docker compose up mongo -d
```

### 4. Arrancar el bot en modo dev (hot-reload)

```bash
cd git-bot
npx nodemon --watch src --watch index.js index.js
```

---

## Docker Compose

Levanta la stack completa (probot + mongo) desde la raíz del repo:

```bash
docker compose up --build
```

```mermaid
graph LR
    subgraph docker-compose
        M["mongo:7\n:27017\nvolumen persistente"]
        P["probot app\n:3000\ndepends_on: mongo healthy"]
        P -- "DATABASE_URL" --> M
    end
    HOST["localhost"] -- ":3000" --> P
    HOST -- ":27017" --> M
```

| Servicio | Imagen              | Puerto | Volumen                          |
| -------- | ------------------- | ------ | -------------------------------- |
| `mongo`  | `mongo:7`           | 27017  | `mongo_data:/data/db`            |
| `probot` | `./git-bot` (build) | 3000   | `./git-bot/private-key.pem` (ro) |

El servicio `probot` arranca solo cuando `mongo` supera su healthcheck (`db.adminCommand('ping')`).

---

## GitHub App — Configuración

### Permisos requeridos

| Permiso         | Nivel   | Para qué                      |
| --------------- | ------- | ----------------------------- |
| `checks`        | `write` | Crear y actualizar check runs |
| `actions`       | `read`  | Leer info de workflows        |
| `metadata`      | `read`  | Metadata de repos             |
| `issues`        | `read`  | Eventos de incidentes         |
| `pull_requests` | `read`  | Métricas de PRs               |

### Eventos suscritos

`check_run` · `check_suite` · `workflow_run` · `workflow_job` · `pull_request` · `issues`

### Pasos para instalar en tus repos

1. Arrancar el bot (`npm start` o `docker compose up`)
2. Ir a `https://github.com/apps/<nombre-de-tu-app>`
3. Click **Install** → selecciona los repositorios objetivo
4. El bot empieza a recibir webhooks inmediatamente

> Para desarrollo local usa [smee.io](https://smee.io/new) como proxy de webhooks y ponlo en `WEBHOOK_PROXY_URL`.

---

## Variables de entorno

| Variable                           | Requerida | Default                                    | Descripción                         |
| ---------------------------------- | --------- | ------------------------------------------ | ----------------------------------- |
| `APP_ID`                           | Sí        | —                                          | ID de tu GitHub App                 |
| `PRIVATE_KEY` / `PRIVATE_KEY_PATH` | Sí        | —                                          | Clave privada RSA                   |
| `WEBHOOK_SECRET`                   | Sí        | `development`                              | Secret del webhook                  |
| `WEBHOOK_PROXY_URL`                | Dev       | —                                          | URL smee.io para dev local          |
| `DATABASE_URL`                     | No        | `mongodb://localhost:27017/probot_metrics` | URI de MongoDB                      |
| `INCIDENT_LABEL`                   | No        | `incident`                                 | Label que abre un incident          |
| `LOG_LEVEL`                        | No        | `info`                                     | `trace` · `debug` · `info` · `warn` |
| `NODE_ENV`                         | No        | —                                          | `production` en Docker              |

---

## CI/CD

El workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) corre en push a `main`/`develop` y en PRs (solo cuando cambia `git-bot/**` o `docker-compose.yml`).

```mermaid
flowchart TD
    Push["push / pull_request"] --> PF{Path filter\ngit-bot/** ?}
    PF -- No --> Skip["skip (no-op)"]
    PF -- Sí --> T

    subgraph T["test — matrix Node 20 & 22"]
        Mongo["Service: mongo:7"] --> NI["npm ci"]
        NI --> NT["node --test"]
    end

    T --> D

    subgraph D["docker-build (needs: test)"]
        Build["docker buildx build\ncache: GHA"]
    end

    T --> CV

    subgraph CV["compose-validate (paralelo)"]
        Config["docker compose config --quiet"]
    end
```

| Job                | Depende de      | Valida                                             |
| ------------------ | --------------- | -------------------------------------------------- |
| `test`             | MongoDB service | Unit tests con `node --test` en Node 20 y 22       |
| `docker-build`     | `test`          | Imagen buildea sin errores (`npm ci --production`) |
| `compose-validate` | —               | Sintaxis correcta del `docker-compose.yml`         |

---

## Queries DORA

```bash
mongosh mongodb://localhost:27017/probot_metrics
```

### Deployment Frequency

```js
db.deployments.aggregate([
  { $match: { conclusion: "success" } },
  {
    $group: {
      _id: {
        repo: "$repo_full_name",
        day: { $dateToString: { format: "%Y-%m-%d", date: "$deployed_at" } },
      },
      n: { $sum: 1 },
    },
  },
  {
    $group: {
      _id: "$_id.repo",
      total: { $sum: "$n" },
      avg_per_day: { $avg: "$n" },
    },
  },
]);
```

### Lead Time for Changes

```js
db.checksuites.aggregate([
  {
    $match: {
      is_deploy: true,
      conclusion: "success",
      duration_ms: { $ne: null },
    },
  },
  {
    $group: {
      _id: "$repo_full_name",
      avg_min: { $avg: { $divide: ["$duration_ms", 60000] } },
      count: { $sum: 1 },
    },
  },
]);
```

### Change Failure Rate

```js
db.checksuites.aggregate([
  { $match: { status: "completed" } },
  {
    $group: {
      _id: "$repo_full_name",
      total: { $sum: 1 },
      failed: {
        $sum: {
          $cond: [{ $in: ["$conclusion", ["failure", "timed_out"]] }, 1, 0],
        },
      },
    },
  },
  {
    $project: {
      cfr_pct: { $multiply: [{ $divide: ["$failed", "$total"] }, 100] },
    },
  },
]);
```

### Time to Restore (MTTR)

```js
db.incidents.aggregate([
  { $match: { resolved_at: { $ne: null } } },
  {
    $group: {
      _id: "$repo_full_name",
      avg_ttr_h: { $avg: { $divide: ["$time_to_restore_ms", 3600000] } },
      count: { $sum: 1 },
    },
  },
]);
```

### PR Lifetime

```js
db.pullrequests.aggregate([
  { $match: { merged_at: { $ne: null } } },
  {
    $group: {
      _id: "$repo_full_name",
      avg_h: { $avg: { $divide: ["$lifetime_ms", 3600000] } },
      prs: { $sum: 1 },
    },
  },
]);
```

> Las mismas queries están disponibles como funciones exportables en [`git-bot/src/queries/dora.js`](git-bot/src/queries/dora.js) para usar desde Node o preparar un dashboard de Grafana.

---

## License

[ISC](git-bot/LICENSE) © 2026 VanOps & Probot Contributors
