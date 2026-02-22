/**
 * DORA Metrics REST API
 * Expone los aggregados de MongoDB como JSON para Grafana Infinity datasource.
 *
 * Rutas registradas bajo el prefijo /metrics:
 *   GET /metrics/health
 *   GET /metrics/dora/summary             ← KPIs planos (para stat panels)
 *   GET /metrics/dora/deployment-frequency
 *   GET /metrics/dora/lead-time
 *   GET /metrics/dora/change-failure-rate
 *   GET /metrics/dora/time-to-restore
 *   GET /metrics/dora/pr-lifetime
 *   GET /metrics/dora/failed-jobs
 *
 * Query params opcionales:
 *   ?days=30      ventana temporal (default 30)
 *   ?repo_id=NNN  filtrar por repo (default: todos)
 */

import {
  deploymentFrequency,
  leadTimeForChanges,
  changeFailureRate,
  timeToRestore,
  prLifetime,
  failedJobsBreakdown,
} from '../queries/dora.js';

/** Parsea los query-params comunes y devuelve { days, repoId }. */
function parseParams(req) {
  const days   = Math.min(Math.max(parseInt(req.query.days  ?? '30', 10), 1), 365);
  const repoId = req.query.repo_id ? parseInt(req.query.repo_id, 10) : undefined;
  return { days, repoId };
}

/** Wrapper que ejecuta la query y gestiona errores de forma uniforme. */
function handle(queryFn) {
  return async (req, res) => {
    try {
      const { days, repoId } = parseParams(req);
      const data = await queryFn(repoId, days);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

/**
 * Registra todas las rutas en el router de Probot.
 * @param {Function} getRouter  La función getRouter que provee Probot
 * @param {import('probot').Logger} log
 */
export function registerMetricsRoutes(getRouter, log) {
  const router = getRouter('/metrics');

  // CORS permisivo para Grafana (mismo Docker network, no expuesto al exterior)
  router.use((_, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
  });

  // ── Health ──────────────────────────────────────────────────────────────────
  router.get('/health', (_, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  // ── DORA Summary (KPIs planos para stat panels de Grafana) ──────────────────
  router.get('/dora/summary', async (req, res) => {
    try {
      const { days, repoId } = parseParams(req);
      const [freq, lead, cfr, mttr, prl] = await Promise.all([
        deploymentFrequency(repoId, days),
        leadTimeForChanges(repoId, days),
        changeFailureRate(repoId, days),
        timeToRestore(repoId, days),
        prLifetime(repoId, days),
      ]);

      // Promediar todos los repos para obtener un KPI global
      const avg = (arr, field) => {
        if (!arr.length) return null;
        return arr.reduce((s, r) => s + (r[field] ?? 0), 0) / arr.length;
      };

      // Infinity datasource (table format) requiere un array, no un objeto plano.
      // Envolvemos en array para que el plugin pueda mapear las columnas correctamente.
      res.json([{
        window_days:          days,
        avg_deploy_freq:      avg(freq, 'avg_per_day'),
        total_deploys:        freq.reduce((s, r) => s + (r.total_deploys ?? 0), 0),
        avg_lead_time_min:    avg(lead, 'avg_lead_min'),
        avg_lead_time_h:      avg(lead, 'avg_lead_h'),
        cfr_pct:              avg(cfr,  'failure_rate_pct'),
        avg_ttr_h:            avg(mttr, 'avg_ttr_h'),
        avg_pr_lifetime_h:    avg(prl,  'avg_lifetime_h'),
        total_prs_merged:     prl.reduce((s, r) => s + (r.prs_merged ?? 0), 0),
      }]);
    } catch (err) {
      log.error({ err }, '[metrics] /dora/summary error');
      res.status(500).json({ error: err.message });
    }
  });

  // ── Métricas individuales ────────────────────────────────────────────────────
  router.get('/dora/deployment-frequency', handle(deploymentFrequency));
  router.get('/dora/lead-time',            handle(leadTimeForChanges));
  router.get('/dora/change-failure-rate',  handle(changeFailureRate));
  router.get('/dora/time-to-restore',      handle(timeToRestore));
  router.get('/dora/pr-lifetime',          handle(prLifetime));
  router.get('/dora/failed-jobs',          handle(failedJobsBreakdown));

  log.info('[metrics] Routes registered under /metrics');
}
