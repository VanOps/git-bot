## Contribuir a git-bot

¡Gracias por tu interés en contribuir! Este documento explica cómo preparar el entorno, ejecutar los tests y enviar cambios.

---

### Código de conducta

Este proyecto sigue el [Contributor Code of Conduct](CODE_OF_CONDUCT.md). Al participar, aceptas sus términos.

---

### Entorno de desarrollo

**Requisitos:**

- Node.js ≥ 18 (`node -v`)
- Docker + Docker Compose (para MongoDB local)
- Una cuenta GitHub con una GitHub App registrada (ver [README](../README.md#github-app--configuración))

**Setup inicial:**

```bash
git clone <repo>
cd git-bot/git-bot
npm install
cp .env.example .env
# Editar .env con tus credenciales de GitHub App
```

**Arrancar solo MongoDB:**

```bash
# Desde la raíz del repo
docker compose up mongo -d
```

**Arrancar el bot:**

```bash
# Desde git-bot/
node index.js
# o con hot-reload:
npx nodemon --watch src --watch index.js index.js
```

---

### Tests

```bash
npm test
```

Los tests usan `node --test` (built-in, sin frameworks externos) y levantan su propio servicio MongoDB mediante el CI. Para ejecutarlos localmente necesitas MongoDB corriendo (ver arriba).

Variables de entorno necesarias para los tests:

```env
DATABASE_URL=mongodb://localhost:27017/probot_test
LOG_LEVEL=warn
```

---

### Estructura relevante para contribuciones

| Fichero / carpeta                  | Qué contiene                                               |
| ---------------------------------- | ---------------------------------------------------------- |
| `src/handlers/`                    | Listeners de eventos GitHub (check, pullRequest, incident) |
| `src/models/`                      | Esquemas Mongoose (CheckSuite, CheckRun, Deployment, ...)  |
| `src/queries/dora.js`              | Aggregations MongoDB para métricas DORA                    |
| `src/queries/workflows.js`         | Aggregations MongoDB para estadísticas genéricas de workflows |
| `src/api/metrics.js`               | Rutas REST `/metrics/dora/*` y `/metrics/workflows/*`      |
| `../grafana/dashboards/dora.json`  | Dashboard Grafana DORA Metrics                             |
| `../grafana/dashboards/workflows.json` | Dashboard Grafana Workflow Statistics                  |
| `test/`                            | Tests unitarios e integración                              |

---

### Cómo enviar un Pull Request

1. Haz un fork del repositorio y clónalo localmente.
2. Crea una rama: `git checkout -b mi-feature`.
3. Haz tus cambios y añade/actualiza los tests correspondientes.
4. Verifica que los tests pasan: `npm test`.
5. Verifica que el título de tu PR cumple el formato del bot: `[TIPO] Descripción [TICKET-NNN]`.
6. Abre el PR contra `main`.

**Consejos para que el PR sea aceptado:**

- Un PR por cambio funcional. Si tienes varias mejoras independientes, envíalas por separado.
- Actualiza la documentación en `docs/` si cambias el comportamiento de la API o de los handlers.
- Si añades un nuevo endpoint en `metrics.js`, documéntalo en el README y en `docs/dora-metrics.md` según corresponda.
- Si modificas el dashboard de Grafana, exporta el JSON actualizado y reemplaza el fichero en `grafana/dashboards/`.

---

### Recursos

- [Probot docs](https://probot.github.io/docs/)
- [Grafana Infinity datasource](https://grafana.com/grafana/plugins/yesoreyeram-infinity-datasource/)
- [Mongoose aggregation](https://mongoosejs.com/docs/api/aggregate.html)
- [GitHub Webhooks reference](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
