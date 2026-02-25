# git-bot — DORA Metrics & Workflow Statistics para GitHub Actions

GitHub App construida con [Probot](https://probot.github.io) + Node.js 20 que captura métricas DORA y estadísticas genéricas de workflows de todos tus repositorios en tiempo real, persiste en MongoDB y expone una API REST consumida por Grafana mediante el plugin Infinity.

> **Stack**: Probot 13 · Mongoose 8 · MongoDB 7 · Docker Compose · Grafana 11.4 · Node ≥ 18 · ISC License

---

## Tabla de contenidos

- [Arquitectura](#arquitectura)
- [Qué hace](#qué-hace)
- [Métricas DORA](#métricas-dora)
- [Modelo de datos](#modelo-de-datos)
- [API REST](#api-rest)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Inicio rápido](#inicio-rápido)
- [Docker Compose](#docker-compose)
- [Kubernetes / Helm / ArgoCD](#kubernetes--helm--argocd)
- [Grafana](#grafana)
- [GitHub App — Configuración](#github-app--configuración)
- [Variables de entorno](#variables-de-entorno)
- [CI/CD](#cicd)
- [Queries de referencia](#queries-de-referencia)
- [License](#license)

---

## Arquitectura

```mermaid
graph TB
    GH[("GitHub\n(webhooks)")]

    subgraph Docker Compose
        P["Probot App\n:3000"]
        M[("MongoDB 7\n:27017")]
        G["Grafana 11.4\n:3001"]
        P -- "mongoose upsert" --> M
        G -- "GET /metrics/*\nInfinity plugin" --> P
    end

    subgraph Handlers
        CH["check.js\ncheck_suite / workflow_run"]
        PR["pullRequest.js\nPR title + metrics"]
        IN["incident.js\nissues labeled/closed"]
    end

    subgraph Queries
        DQ["dora.js\naggregations DORA"]
        WQ["workflows.js\naggregations Workflow Stats"]
    end

    GH -- "HMAC signed\nPOST /payload" --> P
    P --> CH & PR & IN
    M -- "aggregate()" --> DQ & WQ
    DQ & WQ -- "JSON\n/metrics/*" --> P
```

---

## Qué hace

### Handlers registrados

| Evento GitHub                         | Acción GitHub API                     | Persistencia                                                                  |
| ------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| `check_suite.requested`               | `checks.create` "My app!"             | Upsert `checksuites`                                                          |
| `check_suite.completed`               | —                                     | Update suite + `duration_ms`; si workflow es `deploy*` → upsert `deployments` |
| `check_run.rerequested`               | `checks.create` re-check              | —                                                                             |
| `check_run.completed`                 | —                                     | Upsert `checkruns`                                                            |
| `pull_request.opened/edited/reopened` | Check título `[TIPO] Desc [JIRA-NNN]` | —                                                                             |
| `pull_request.closed`                 | —                                     | Upsert `pullrequests` con `lifetime_ms`                                       |
| `issues.labeled` (`incident`)         | —                                     | Crea registro `incidents` con `labeled_at`                                    |
| `issues.closed`                       | —                                     | Resuelve incident, calcula `time_to_restore_ms`                               |
| `workflow_run.completed`              | —                                     | Detecta deploys; actualiza `is_deploy` en CheckSuite                          |

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

## API REST

Toda la API corre en `http://probot:3000/metrics` (o `http://localhost:3000/metrics` desde el host).

### DORA Metrics — `/metrics/dora/*`

> Query params: `?days=30` (ventana temporal, 1–365) · `?repo_id=NNN` (filtrar por repo)

| Endpoint                              | Descripción                                          |
| ------------------------------------- | ---------------------------------------------------- |
| `GET /metrics/health`                 | Health check                                         |
| `GET /metrics/dora/summary`           | Los 4 KPIs DORA + bonus en una sola llamada (1 fila) |
| `GET /metrics/dora/deployment-frequency` | Deploys por repo por día                          |
| `GET /metrics/dora/lead-time`         | Duración media de suites de deploy por repo          |
| `GET /metrics/dora/change-failure-rate` | % de suites fallidos por repo                      |
| `GET /metrics/dora/time-to-restore`   | MTTR por repo (incidentes resueltos)                 |
| `GET /metrics/dora/pr-lifetime`       | Tiempo medio de vida de PRs mergeados por repo       |
| `GET /metrics/dora/failed-jobs`       | Top 20 jobs con más fallos                           |

### Workflow Statistics — `/metrics/workflows/*`

> Query params: `?days=30` · `?repo=owner/repo` · `?workflow=CI` (todos opcionales)

| Endpoint                          | Descripción                                                  |
| --------------------------------- | ------------------------------------------------------------ |
| `GET /metrics/workflows/repos`    | Lista de repos activos (para variable Grafana)               |
| `GET /metrics/workflows/names`    | Lista de workflow names, opcionalmente filtrada por repo      |
| `GET /metrics/workflows/summary`  | KPIs globales: total, éxito, fallos, duración media (1 fila) |
| `GET /metrics/workflows/by-repo`  | Stats agrupadas por repo (filtrable por workflow)            |
| `GET /metrics/workflows/by-name`  | Stats agrupadas por workflow name (filtrable por repo)       |
| `GET /metrics/workflows/over-time`| Tendencia diaria: total / success / failed por día           |

---

## Estructura del proyecto

```
git-bot/                         ← raíz del repositorio
├── .github/
│   └── workflows/
│       ├── ci.yml               ← tests + docker build + compose validate
│       ├── deploy.yaml          ← build & push a ghcr.io
│       ├── ai-disclosure.yaml   ← EU AI Act Art.50 auto-update
│       └── ci-ai-compliance.yaml
├── docker-compose.yml           ← probot + mongo + grafana (volúmenes persistentes)
├── docs/
│   ├── dora-metrics.md          ← guía de configuración de métricas DORA
│   ├── probot.md                ← referencia del framework Probot
│   └── use-cases.md             ← casos de uso del bot
├── grafana/
│   ├── dashboards/
│   │   ├── dora.json            ← dashboard DORA Metrics (15 paneles)
│   │   └── workflows.json       ← dashboard Workflow Statistics (11 paneles)
│   └── provisioning/
│       ├── dashboards/
│       │   └── provider.yml     ← provisioner de ficheros de dashboard
│       └── datasources/
│           └── infinity.yml     ← datasource Infinity → Probot API
└── git-bot/                     ← código de la app
    ├── Dockerfile               ← node:20-slim, npm ci --production
    ├── index.js                 ← entry point
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
        │   ├── check.js         ← check_suite.* + workflow_run.*
        │   ├── pullRequest.js   ← PR title check + pull_request.closed
        │   └── incident.js      ← issues.labeled/closed + fix PR linking
        ├── queries/
        │   ├── dora.js          ← 7 funciones de agregación DORA
        │   └── workflows.js     ← 6 funciones de agregación Workflow Stats
        └── api/
            └── metrics.js       ← rutas REST /metrics/dora/* y /metrics/workflows/*
```

---

## Inicio rápido

### Requisitos

- Node.js ≥ 18
- Docker + Docker Compose
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

### 4. Arrancar el bot en modo dev

```bash
cd git-bot
npx nodemon --watch src --watch index.js index.js
```

---

## Docker Compose

Levanta la stack completa desde la raíz del repo:

```bash
docker compose up --build
```

```mermaid
graph LR
    subgraph docker-compose
        M["mongo:7\n:27017\nvolumen persistente"]
        P["probot app\n:3000"]
        G["grafana 11.4\n:3001"]
        P -- "DATABASE_URL" --> M
        G -- "GET /metrics/*" --> P
    end
    HOST["localhost"] -- ":3000 webhook / API" --> P
    HOST -- ":3001 dashboards" --> G
    HOST -- ":27017 mongosh" --> M
```

| Servicio  | Imagen                      | Puerto | Volumen                          |
| --------- | --------------------------- | ------ | -------------------------------- |
| `mongo`   | `mongo:7`                   | 27017  | `mongo_data:/data/db`            |
| `probot`  | `./git-bot` (build local)   | 3000   | `./git-bot/private-key.pem` (ro) |
| `grafana` | `grafana/grafana-oss:11.4.0` | 3001  | `grafana_data:/var/lib/grafana`  |

El servicio `probot` arranca solo cuando `mongo` supera su healthcheck. Grafana arranca después de `probot` y consulta su API vía el plugin **Infinity** (OSS, sin licencia Enterprise).

---

## Kubernetes / Helm / ArgoCD

El repositorio incluye tres métodos de despliegue en Kubernetes. Consulta la guía completa en [docs/deployment.md](docs/deployment.md).

| Método | Directorio | Descripción |
|---|---|---|
| **Helm chart** | [`helm/`](helm/) | Chart con subcharts de MongoDB y Grafana; publicado en GHCR vía CI |
| **ArgoCD GitOps** | [`argocd/`](argocd/) | Pull deploy automático desde GHCR OCI registry |
| **Manifiestos raw** | [`kubernetes/`](kubernetes/) | Kustomize con Deployment, StatefulSet, Services y ConfigMaps |

```bash
# Despliegue rápido con Helm desde GHCR
helm upgrade --install git-bot oci://ghcr.io/<owner>/charts/git-bot \
  --version 0.1.0 --namespace git-bot --create-namespace \
  --set existingSecret=git-bot-secret

# Despliegue con manifiestos raw (Kustomize)
kubectl apply -k kubernetes/
```

---

## Grafana

Abre **http://localhost:3001** · usuario `admin` · password en `GRAFANA_PASSWORD` (default: `admin`).

Los dashboards se provisionan automáticamente al arrancar el contenedor. No requieren configuración manual.

### Dashboard 1 — DORA Metrics

UID: `dora-metrics-v1`

- 4 paneles KPI (stat + gauge) con colores Elite/High/Medium/Low
- Tablas detalladas por repo: Deployment Frequency, Lead Time, CFR, MTTR, PR Lifetime, Failed Jobs
- Variable `$days` (7 / 30 / 60 / 90 / 180 días)

### Dashboard 2 — Workflow Statistics

UID: `workflow-stats-v1`

Dashboard genérico e independiente de DORA que muestra la actividad de **todos los workflows** de **todos los repos**:

- 4 paneles KPI: Total ejecuciones · Tasa de éxito % · Duración media · Ejecuciones fallidas
- Barras + tabla por repositorio
- Barras + tabla por nombre de workflow
- Time series de tendencia diaria (total / exitosas / fallidas)
- Variables de filtro: `$repo` (dropdown dinámico) · `$workflow` (dependiente del repo seleccionado) · `$days`

```bash
# Solo Grafana (si ya tienes probot+mongo corriendo)
docker compose up grafana -d
```

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
| `GRAFANA_USER`                     | No        | `admin`                                    | Usuario admin de Grafana            |
| `GRAFANA_PASSWORD`                 | No        | `admin`                                    | Password admin de Grafana           |

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

El workflow [`.github/workflows/deploy.yaml`](.github/workflows/deploy.yaml) publica la imagen en `ghcr.io` en cada push a `main`.

---

## Queries de referencia

```bash
mongosh mongodb://localhost:27017/probot_metrics
```

### DORA — Deployment Frequency

```js
db.deployments.aggregate([
  { $match: { conclusion: "success" } },
  {
    $group: {
      _id: { repo: "$repo_full_name", day: { $dateToString: { format: "%Y-%m-%d", date: "$deployed_at" } } },
      n: { $sum: 1 },
    },
  },
  { $group: { _id: "$_id.repo", total: { $sum: "$n" }, avg_per_day: { $avg: "$n" } } },
]);
```

### DORA — Change Failure Rate

```js
db.checksuites.aggregate([
  { $match: { status: "completed" } },
  {
    $group: {
      _id: "$repo_full_name",
      total: { $sum: 1 },
      failed: { $sum: { $cond: [{ $in: ["$conclusion", ["failure", "timed_out"]] }, 1, 0] } },
    },
  },
  { $project: { cfr_pct: { $multiply: [{ $divide: ["$failed", "$total"] }, 100] } } },
]);
```

### Workflow Stats — Resumen global

```js
db.checksuites.aggregate([
  { $match: { status: "completed" } },
  {
    $group: {
      _id: null,
      total: { $sum: 1 },
      success: { $sum: { $cond: [{ $eq: ["$conclusion", "success"] }, 1, 0] } },
      failed: { $sum: { $cond: [{ $in: ["$conclusion", ["failure", "timed_out", "action_required"]] }, 1, 0] } },
      avg_duration_min: { $avg: { $divide: ["$duration_ms", 60000] } },
    },
  },
]);
```

### Workflow Stats — Por repo

```js
db.checksuites.aggregate([
  { $match: { status: "completed" } },
  {
    $group: {
      _id: "$repo_full_name",
      total: { $sum: 1 },
      success: { $sum: { $cond: [{ $eq: ["$conclusion", "success"] }, 1, 0] } },
    },
  },
  { $project: { repo: "$_id", _id: 0, total: 1, success_rate_pct: { $multiply: [{ $divide: ["$success", "$total"] }, 100] } } },
  { $sort: { total: -1 } },
]);
```

> Las queries completas están disponibles como funciones exportables en [`git-bot/src/queries/dora.js`](git-bot/src/queries/dora.js) y [`git-bot/src/queries/workflows.js`](git-bot/src/queries/workflows.js).

---

## License

[ISC](git-bot/LICENSE) © 2026 VanOps & Probot Contributors
