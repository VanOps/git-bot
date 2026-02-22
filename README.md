# Git Bot - Un bot de GitHub para automatizar tareas en repositorios, construido con Probot y Node.js. [github](https://github.com/probot/probot)

## Comenzando con Probot

Pre-requisitos: Node.js, npm, GitHub account. [probot.github](https://probot.github.io/docs/development/)

1. Crea app con Probot CLI: `npx create-probot-app mi-bot` y elige "JavaScript".
2. Configura para manejar una serie de checks y acciones requeridas en tu flujo de trabajo DevOps.
3. Despliega en tu entorno preferido (Heroku, Vercel, etc.) o localmente con smee.io para pruebas.

## Creation results

```shell
Successfully created git-bot.

Begin using your app with:

  cd mi-bot
  npm start

Refer to your app's README for more usage instructions.

Visit the Probot docs
  https://probot.github.io/docs/

Get help from the community:
  https://probot.github.io/community/
```

## Configuracion de GitHub App

El bot requiere configurar una GitHub App con permisos específicos (ej. Issues: Read/Write) y un webhook para recibir eventos.

LA configuración incluye:

- Webhook URL: https://smee.io/new (temporal para desarrollo)
- Webhook secret: "development"
- Copia APP_ID y descarga private-key.pem para tu .env

Copia env.example a .env y completa con tus valores:

```
APP_ID=tu_app_id
PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----  ..."
WEBHOOK_SECRET=development
WEBHOOK_PROXY_URL=https://smee.io/tu_app_id
```

La clave privada se puede generar en el interfaz de GitHub App y debe ser formateada correctamente en el .env. [probot.github](https://probot.github.io/docs/development/)

Incluye los permisos necesarios para el bot (Handle check_suite request and rerequested
actions):

- Checks: Read/Write
- Pull Requests: Read/Write
- Issues: Read/Write
- Repositories: Read

## Flujo de Trabajo

Diagrama de flujo de eventos:

```mermaid
flowchart TD
    A[GitHub Event] --> B[Probot Webhook]
    B --> C[Verify Signature]
    C --> D[Execute Bot Code]
    D --> E[Octokit API Calls]
    E --> F[GitHub Response]
    D --> G[Console Logs]
```

Secuencia de eventos:

```mermaid
sequenceDiagram
    participant G as GitHub
    participant P as Probot Server
    participant A as Bot Code
    participant O as Octokit API
    G->>P: POST /payload (e.g. issues.opened)
    P->>P: Verify HMAC signature
    P->>A: app.on('issues.opened', handler)
    A->>O: context.octokit.issues.createComment()
    O->>G: 201 Created
    Note over P,A: Logs in console
```

## Simulacion de Bot de Bienvenida

Para instalar tu app Probot en uno de tus repositorios propios, usa el botón "Install" desde la URL de tu app en GitHub (ej. https://github.com/apps/tu-app-name). Asegúrate de que el servidor local esté corriendo (`npm start`) para recibir webhooks durante pruebas. [probot.github](https://probot.github.io/docs/development/)

## Pasos para Instalar
Sigue estos pasos exactos; toma ~2 minutos si ya tienes la app creada. [docs.github](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app)

1. **Corre tu app local**: `npm start` (localhost:3000).
2. **Obtén URL de instalación**: Ve a https://github.com/apps/[nombre-de-tu-app] (nombre del repo donde pusheaste tu Probot app).
3. **Click "Configure" o "Install App"**: Selecciona tu cuenta (personal u org).
4. **Elige repos**: "All repositories" o "Only select repositories" → busca y selecciona tu repo objetivo.
5. **Review permissions**: Confirma (ej. Checks: Read/Write para tu handler).
6. **Instalar**: Ingresa password GitHub si pide; redirige a settings del repo con "App installed".
7. **Verifica**: En repo → Settings > Applications > busca tu app (debe mostrar installed).

**Nota**: Si app privada (Only this account), solo ves en tu cuenta. Haz pública en settings para Marketplace-like. [docs.github](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app)

## Diagrama de Flujo
```mermaid
flowchart TD
    A[Crear/Pushear Repo App] --> B[npm start Local]
    B --> C[Ir a github.com/apps/tu-app]
    C --> D[Click Install > Elige Cuenta]
    D --> E[Selecciona Tu Repo]
    E --> F[Review Permissions > Install]
    F --> G[Trigger Evento ej. Push/PR]
    G --> H[Webhook a Local via smee]
```

## Verificación y Troubleshooting
- **Installed?**: Repo Settings > Applications (o Integrations) > Tu app listada.
- **Logs**: En `npm start`, ve "installation" o eventos al trigger (push/PR para check_suite).
- **No instala?**: 
  - App no pública: Cambia visibility en GitHub App settings.
  - Permissions insuficientes: Edita app > Permissions > Añade Checks/Metadata.
  - Webhook no llega: Usa smee.io como proxy (ver manual previo). [probot.github](https://probot.github.io/docs/development/)
- **Múltiples repos**: Repite install o usa API `octokit.apps.createInstallationAccessToken` para bulk. [stackoverflow](https://stackoverflow.com/questions/78813115/is-there-a-way-to-install-a-github-app-on-only-public-repositories-in-a-github-o)

## Para Tu Setup DevOps
- Repo test con `.github/workflows/ci.yml` para disparar check_suite al push.
- Una vez probado local, deploya a Render/Heroku/K8s y reinstala (elige deployed URL en webhook).
- Madrid timezone: GitHub events 24/7, logs en UTC.

