# Probot: Crea Bots GitHub con Node.js

Probot permite crear GitHub Apps rápidamente para automatizar repositorios con Node.js. Este manual rápido te guía desde cero hasta un bot funcional en minutos, con diagramas Mermaid para visualizar flujos. [probot.github](https://probot.github.io/docs/development/)

## Requisitos Previos

Necesitas Node.js ≥18 (`node -v` para verificar) y npm/yarn. Crea una cuenta GitHub y accede a https://github.com/settings/apps para registrar apps. [probot.github](https://probot.github.io/docs/development/)

## Inicio Rápido: Pasos

Sigue estos comandos en terminal (Linux/Mac/Windows con Git Bash, ideal para tu setup DevOps). [github](https://github.com/probot/create-probot-app)

1. Genera app: `npx create-probot-app mi-bot --type=basic-js` (elige JS o TS).
2. `cd mi-bot && npm install`.
3. Crea GitHub App en https://github.com/settings/apps:
   - Homepage: URL de tu repo.
   - Webhook URL: https://smee.io (temporal, usa smee.io/new).
   - Webhook secret: "development".
   - Permissions: e.g., Issues: Read/Write.
   - Copia APP_ID y descarga private-key.pem.
4. Edita `.env`: Añade `APP_ID=tu_id`, `PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."`, `WEBHOOK_SECRET=development`, `WEBHOOK_PROXY_URL=https://smee.io/tu_id`.
5. Ejecuta: `npm start`. Abre http://localhost:3000 para instalar en un repo test.
6. Prueba: Crea un issue en tu repo test; el bot responde "¡Hola!" por defecto.

```mermaid
flowchart TD
    A[Crear App con npx] --> B[Configurar .env con GitHub App]
    B --> C[npm start + smee.io]
    C --> D[Instalar en Repo Test]
    D --> E[Trigger Evento ej. Issue]
    E --> F[Bot Responde]
```

## Flujo de Webhook (Secuencia)

Probot maneja eventos de GitHub vía webhooks: GitHub envía payload → Probot verifica firma → Ejecuta tu código → Responde vía Octokit API. [probot.github](https://probot.github.io/docs/development/)

```mermaid
sequenceDiagram
    participant G as GitHub
    participant P as Probot Server
    participant A as Tu App (index.js)
    participant O as Octokit API
    G->>P: POST /payload (evento ej. issues.opened)
    P->>P: Verificar HMAC secret
    P->>A: app.on('issues.opened', handler)
    A->>O: context.octokit.issues.createComment()
    O->>G: 201 Created
    Note over P,A: Logs en consola
```

## Ejemplo Código: Bot Bienvenida

Edita `index.js` para responder en issues con label "help":

```javascript
import { Probot } from "probot";

export default async (app) => {
  app.on("issues.labeled", async (context) => {
    if (context.payload.label.name === "help") {
      const comment = "¡Ayuda en camino! Asignado a equipo.";
      return context.octokit.issues.createComment(
        context.issue({ body: comment }),
      );
    }
  });
};
```

Reinicia `npm start` y prueba añadiendo label "help". [probot.github](https://probot.github.io/docs/development/)

## Despliegue

- **Heroku/Render**: `git push heroku main`, setea vars de entorno.
- **Vercel/Netlify**: Usa createNodeMiddleware para serverless.
- **Kubernetes**: Despliega como Deployment con secrets para PRIVATE_KEY, expone / via Ingress. [probot.github](https://probot.github.io/docs/development/)

```mermaid
flowchart LR
    L[Local: npm start] --> D[Deploy: Heroku/Platform.sh/K8s]
    D --> I[Instalar App Permanente]
    I --> M[Monitoreo: Logs + GitHub Insights]
```

## Recomendaciones de Uso

- **Para DevOps como tú**: Integra con GitHub Actions para checks en PRs (ej. validar Helm charts), o notificar a Slack/Prometheus en fails. [github](https://github.com/probot/example-github-action)
- Usa TS para tipos seguros en K8s-scale apps.
- Seguridad: Siempre secret en webhooks; rota keys.
- Debugging: `npm start` muestra payloads; usa ngrok para local HTTPS.
- Escala: Apps públicas en GitHub Marketplace; limita permissions mínimas.
- Evita: Workflows complejos (usa Actions); enfócate en eventos reactivos. [github](https://github.com/probot/probot/blob/master/docs/development.md)

¡Listo! Tu primer bot corre en <10 min. Explora https://probot.github.io/docs/ para más. [probot.github](https://probot.github.io/docs/development/)
