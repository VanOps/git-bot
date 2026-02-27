# Despliegue gratuito — Render.com + MongoDB Atlas

Esta guía explica cómo publicar **git-bot** en internet sin coste alguno usando:

| Servicio | Plan gratuito | Límite |
|---|---|---|
| **MongoDB Atlas** | M0 Shared | 512 MB almacenamiento |
| **Render.com** | Free Web Service | 750 h/mes · duerme tras 15 min sin tráfico |
| **UptimeRobot** | Free Monitor | Ping cada 5 min para evitar el sueño |
| **Grafana Cloud** _(opcional)_ | Free Stack | 3 usuarios · 10 k series |

> **Nota sobre el plan Free de Render:** el servicio se suspende tras 15 minutos sin peticiones HTTP. GitHub reintenta los webhooks fallidos durante ~1 hora, por lo que los eventos suelen entregarse igualmente. El ping de UptimeRobot (paso 5) evita la suspensión por completo.

---

## Arquitectura del stack gratuito

```
GitHub Webhooks
      │  HMAC POST /payload
      ▼
┌─────────────────────┐
│   Render.com        │  ← git-bot (Node.js 20)
│   https://<app>.onrender.com  │
└──────────┬──────────┘
           │  mongoose  DATABASE_URL
           ▼
┌─────────────────────┐
│  MongoDB Atlas M0   │  ← mongodb+srv://...
│  (512 MB, gratuito) │
└─────────────────────┘
           │  GET /metrics/*
           ▼
┌─────────────────────┐   (opcional)
│   Grafana Cloud     │
│   grafana.com       │
└─────────────────────┘
```

---

## Prerrequisitos

- Cuenta en [GitHub](https://github.com)
- Cuenta en [MongoDB Atlas](https://cloud.mongodb.com) (gratuita)
- Cuenta en [Render.com](https://render.com) (gratuita, login con GitHub)
- Cuenta en [UptimeRobot](https://uptimerobot.com) (gratuita, para mantener el servicio activo)
- Repositorio fork/propio con el código del bot

---

## Paso 1 — MongoDB Atlas: cluster M0 gratuito

### 1.1 Crear el cluster

1. Accede a [cloud.mongodb.com](https://cloud.mongodb.com) → **Create an account** o inicia sesión.
2. En el dashboard → **Create** → elige **M0 FREE** (Shared).
3. Selecciona cualquier provider/región (AWS us-east-1 suele tener menor latencia).
4. Nombre del cluster: `git-bot` (cualquier nombre).
5. Click **Create Deployment**.

### 1.2 Crear usuario de base de datos

1. Panel izquierdo → **Database Access** → **Add New Database User**.
2. Método de autenticación: **Password**.
3. Usuario: `git-bot-user`
4. Password: genera uno seguro con **Autogenerate Secure Password** → cópialo.
5. Rol: **Atlas admin** (o limítalo a `readWrite` en la base `probot_metrics`).
6. Click **Add User**.

### 1.3 Configurar acceso de red

1. Panel izquierdo → **Network Access** → **Add IP Address**.
2. Selecciona **Allow Access from Anywhere** (`0.0.0.0/0`).
   > En producción, restringe a las IPs de Render publicadas en su documentación.
3. Click **Confirm**.

### 1.4 Obtener la connection string

1. Panel → **Database** → **Connect** → **Drivers**.
2. Driver: **Node.js**, versión **5.5 or later**.
3. Copia la URI, que tendrá este formato:

```
mongodb+srv://git-bot-user:<password>@git-bot.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

4. **Reemplaza `<password>`** por el password real.
5. Añade el nombre de la base de datos antes de `?`:

```
mongodb+srv://git-bot-user:<password>@git-bot.xxxxx.mongodb.net/probot_metrics?retryWrites=true&w=majority
```

Guarda esta URI — la necesitarás en el paso 3 como variable `DATABASE_URL`.

---

## Paso 2 — GitHub App: registro

> Si ya tienes una GitHub App creada, salta al paso 2.5 para obtener los valores necesarios.

### 2.1 Registrar la GitHub App

1. GitHub → **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**.
2. Rellena los campos:

| Campo | Valor |
|---|---|
| **GitHub App name** | `git-bot-<tu-usuario>` (debe ser único en GitHub) |
| **Homepage URL** | URL de tu repositorio (ej. `https://github.com/tu-usuario/git-bot`) |
| **Webhook URL** | `https://placeholder.example.com` ← se actualizará en el paso 4 |
| **Webhook secret** | Genera una cadena aleatoria segura (ej. `openssl rand -hex 32`) |

### 2.2 Permisos requeridos

En **Repository permissions**:

| Permiso | Nivel |
|---|---|
| `Checks` | **Read & write** |
| `Actions` | **Read-only** |
| `Metadata` | **Read-only** |
| `Issues` | **Read-only** |
| `Pull requests` | **Read & write** |

### 2.3 Eventos suscritos

Activa los siguientes **Subscribe to events**:

- [x] Check run
- [x] Check suite
- [x] Issues
- [x] Issue comment
- [x] Pull request
- [x] Workflow job
- [x] Workflow run

### 2.4 Visibilidad

- **Where can this GitHub App be installed?** → **Only on this account** (para uso personal/organización).

Click **Create GitHub App**.

### 2.5 Recopilar credenciales

Tras crear la App, en la página de configuración:

| Dato | Dónde encontrarlo | Variable de entorno |
|---|---|---|
| **App ID** | Campo "App ID" en la cabecera | `APP_ID` |
| **Webhook secret** | El que introdujiste en 2.1 | `WEBHOOK_SECRET` |
| **Private key** | Sección "Private keys" → **Generate a private key** → descarga el `.pem` | `PRIVATE_KEY` |

Para la variable `PRIVATE_KEY`, necesitas el contenido del archivo `.pem` en una sola línea. Ejecuta en tu terminal:

```bash
# Convierte el archivo PEM a una cadena con \n literales
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' private-key.pem
```

Copia el resultado completo — lo usarás en Render como variable de entorno.

---

## Paso 3 — Render.com: despliegue del bot

### 3.1 Crear el servicio

1. Accede a [render.com](https://render.com) → **New** → **Web Service**.
2. Conecta tu cuenta de GitHub si aún no lo has hecho.
3. Selecciona el repositorio del bot.
4. Configura el servicio:

| Campo | Valor |
|---|---|
| **Name** | `git-bot` |
| **Region** | Oregon (US West) u otra cercana a tu Atlas |
| **Branch** | `main` |
| **Root Directory** | `git-bot` |
| **Runtime** | **Node** |
| **Build Command** | `npm ci --production` |
| **Start Command** | `node index.js` |
| **Instance Type** | **Free** |

### 3.2 Variables de entorno

En la sección **Environment Variables** de Render, añade:

| Variable | Valor |
|---|---|
| `APP_ID` | ID numérico de tu GitHub App |
| `PRIVATE_KEY` | Contenido del `.pem` con `\n` literales (del paso 2.5) |
| `WEBHOOK_SECRET` | El secret del webhook elegido en el paso 2.1 |
| `DATABASE_URL` | La URI de Atlas del paso 1.4 |
| `NODE_ENV` | `production` |
| `LOG_LEVEL` | `info` |
| `RELEASE_NOTES_REQUIRED` | `false` _(opcional: desactiva el check si no lo necesitas)_ |

> **Seguridad:** marca todas las variables como **Secret** en Render para que no aparezcan en los logs.

### 3.3 Lanzar el deploy

Click **Create Web Service**. Render clonará el repositorio, ejecutará `npm ci --production` y arrancará el bot. El primer despliegue tarda ~2-3 minutos.

Una vez completado, copia la URL pública del servicio:

```
https://git-bot-xxxx.onrender.com
```

Puedes verificar que el bot está corriendo:

```bash
curl https://git-bot-xxxx.onrender.com/metrics/health
# → {"status":"ok"}
```

---

## Paso 4 — Conectar GitHub App con Render

### 4.1 Actualizar la Webhook URL

1. GitHub → **Settings** → **Developer settings** → **GitHub Apps** → tu app → **Edit**.
2. En **Webhook URL**, pega la URL de Render con el path del payload:

```
https://git-bot-xxxx.onrender.com/api/github/hooks
```

3. Click **Save changes**.

### 4.2 Instalar la App en tus repositorios

1. En la página de tu GitHub App → **Install App**.
2. Selecciona la cuenta/organización.
3. Elige **All repositories** o selecciona repositorios específicos.
4. Click **Install**.

Desde este momento, los eventos de GitHub se enviarán a tu instancia en Render.

### 4.3 Verificar recepción de webhooks

GitHub → tu App → **Advanced** → **Recent Deliveries**. Deberías ver las entregas recientes con código `200`.

---

## Paso 5 — UptimeRobot: evitar el sueño del plan Free

El plan gratuito de Render suspende el servicio tras 15 minutos sin tráfico HTTP. Para mantenerlo activo:

1. Crea una cuenta gratuita en [uptimerobot.com](https://uptimerobot.com).
2. **New Monitor** → tipo **HTTP(s)**.
3. Configura:

| Campo | Valor |
|---|---|
| **Friendly Name** | `git-bot health` |
| **URL** | `https://git-bot-xxxx.onrender.com/metrics/health` |
| **Monitoring Interval** | **5 minutes** |

4. Click **Create Monitor**.

UptimeRobot enviará una petición GET cada 5 minutos, evitando que Render suspenda el proceso.

> **Alternativa:** Render ofrece en su plan **Starter** ($7/mes) servicios que nunca se suspenden, ideal si el bot gestiona repositorios críticos.

---

## Paso 6 (opcional) — Grafana Cloud

Para visualizar los dashboards DORA y Workflow Statistics sin infraestructura propia:

### 6.1 Crear stack gratuito

1. Accede a [grafana.com](https://grafana.com) → **Create account** → **Start for free**.
2. Crea un **Free Stack** (incluye 3 usuarios y acceso a Grafana OSS).
3. Abre tu instancia de Grafana Cloud (URL tipo `https://tu-org.grafana.net`).

### 6.2 Instalar el plugin Infinity

1. En Grafana → **Administration** → **Plugins** → busca `Infinity`.
2. Click **Install** (puede requerir algunos minutos).

### 6.3 Configurar el datasource

1. **Connections** → **Data sources** → **Add new data source** → **Infinity**.
2. Configura:

| Campo | Valor |
|---|---|
| **Name** | `git-bot` |
| **Base URL** | `https://git-bot-xxxx.onrender.com` |
| **Allowed Hosts** | `git-bot-xxxx.onrender.com` |

3. Click **Save & test** → debe mostrar ✅.

### 6.4 Importar los dashboards

Los dashboards del repositorio están en `grafana/dashboards/`:

1. Grafana → **Dashboards** → **New** → **Import**.
2. Arrastra o pega el contenido de `grafana/dashboards/dora.json`.
3. En el campo **Infinity**, selecciona el datasource `git-bot`.
4. Click **Import**.
5. Repite el proceso con `grafana/dashboards/workflows.json`.

---

## Verificación completa

### Comprobar que el bot responde

```bash
# Health check
curl https://git-bot-xxxx.onrender.com/metrics/health

# Métricas DORA (vacías si aún no hay datos)
curl "https://git-bot-xxxx.onrender.com/metrics/dora/summary?days=30"

# Repos detectados
curl "https://git-bot-xxxx.onrender.com/metrics/workflows/repos"
```

### Simular un evento (PR de prueba)

1. Abre un PR en cualquier repositorio donde hayas instalado la App.
2. El bot debería crear un check run con el resultado de la validación del título.
3. GitHub → App → **Advanced** → **Recent Deliveries** → comprueba código `200`.
4. Atlas → **Collections** → `probot_metrics` → verifica que aparecen documentos en `pullrequests`.

---

## Resumen de variables de entorno

```env
# Requeridas
APP_ID=123456
PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIEo...\n-----END RSA PRIVATE KEY-----\n
WEBHOOK_SECRET=tu_secreto_seguro

# Base de datos
DATABASE_URL=mongodb+srv://git-bot-user:password@git-bot.xxxxx.mongodb.net/probot_metrics?retryWrites=true&w=majority

# Opcionales
NODE_ENV=production
LOG_LEVEL=info
INCIDENT_LABEL=incident
RELEASE_NOTES_REQUIRED=true
DONTMERGE_LABEL=DONTMERGE
```

---

## Limitaciones del plan gratuito

| Limitación | Impacto | Mitigación |
|---|---|---|
| Render se suspende tras 15 min | El primer webhook tras el sueño puede perderse (GitHub reintenta ~1h) | UptimeRobot cada 5 min |
| Atlas M0: 512 MB | ~1-2 años de datos en equipos pequeños | Purgar colecciones antiguas con TTL index |
| Atlas M0: sin índices adicionales | Consultas más lentas con alto volumen | Promover a M2 ($9/mes) si es necesario |
| Render Free: sin custom domains HTTPS | URL de Render predefinida | Suficiente para webhooks de GitHub |
| Grafana Cloud Free: 10 k series | Suficiente para métricas DORA básicas | — |

---

## Alternativas de hosting gratuito

Si necesitas un servicio que **nunca se suspenda** en el plan gratuito, considera:

| Plataforma | Plan gratuito | Características |
|---|---|---|
| [**Railway**](https://railway.app) | $5 crédito/mes (sin expirar si < uso) | Sin suspensión · Deploy desde GitHub · MongoDB addon disponible |
| [**Fly.io**](https://fly.io) | 3 VMs shared CPU · 256 MB RAM | Sin suspensión · Requiere `flyctl` CLI |
| [**Koyeb**](https://www.koyeb.com) | 1 instancia Nano (512 MB) | Sin suspensión · Deploy desde Docker Hub o GitHub |

Para Railway, el despliegue desde este repositorio es directo:

```bash
# Instala Railway CLI
npm install -g @railway/cli

# Login y deploy
railway login
railway init
railway up --service git-bot --source git-bot/
```

Y conecta las variables de entorno desde el dashboard de Railway.
