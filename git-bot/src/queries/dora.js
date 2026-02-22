/**
 * DORA Metrics – MongoDB Aggregation Queries
 * ============================================
 * All functions accept an optional `repoId` (Number) to scope to one repo.
 * Default window: last 30 days.
 *
 * Quick usage from the shell:
 *   mongosh mongodb://localhost:27017/probot_metrics --eval "
 *     load('src/queries/dora.js')
 *   "
 *
 * Or import and call from Node:
 *   import { deploymentFrequency } from './src/queries/dora.js';
 *   console.table(await deploymentFrequency());
 */

import CheckSuite  from '../models/CheckSuite.js';
import CheckRun    from '../models/CheckRun.js';
import Deployment  from '../models/Deployment.js';
import PullRequest from '../models/PullRequest.js';
import Incident    from '../models/Incident.js';

const windowDays = (days = 30) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1_000);

const repoFilter = (repoId) => (repoId ? { repo_id: repoId } : {});

// ─── 1. Deployment Frequency ────────────────────────────────────────────────
/**
 * Deploys per day (only successful deploy workflows) per repo.
 *
 * Elite:  Multiple per day
 * High:   Between once per day and once per week
 * Medium: Between once per week and once per month
 * Low:    Less than once per month
 *
 * mongosh equivalent:
 *   db.deployments.aggregate([
 *     { $match: { conclusion: "success", deployed_at: { $gte: new Date(Date.now()-30*86400000) } } },
 *     { $group: { _id: { repo: "$repo_full_name", day: { $dateToString: { format: "%Y-%m-%d", date: "$deployed_at" } } }, count: { $sum: 1 } } },
 *     { $group: { _id: "$_id.repo", total: { $sum: "$count" }, active_days: { $sum: 1 }, avg_per_day: { $avg: "$count" } } },
 *     { $sort: { total: -1 } }
 *   ])
 */
export async function deploymentFrequency(repoId, days = 30) {
  return Deployment.aggregate([
    {
      $match: {
        ...repoFilter(repoId),
        deployed_at: { $gte: windowDays(days) },
        conclusion:  'success',
      },
    },
    {
      $group: {
        _id: {
          repo: '$repo_full_name',
          day:  { $dateToString: { format: '%Y-%m-%d', date: '$deployed_at' } },
        },
        count: { $sum: 1 },
      },
    },
    {
      $group: {
        _id:           '$_id.repo',
        total_deploys: { $sum: '$count' },
        active_days:   { $sum: 1 },
        avg_per_day:   { $avg: '$count' },
      },
    },
    { $sort: { total_deploys: -1 } },
  ]);
}

// ─── 2. Lead Time for Changes ───────────────────────────────────────────────
/**
 * Average pipeline duration (started_at → completed_at) for successful
 * deploy workflows. Proxy for commit-to-production lead time.
 *
 * Elite:  < 1 hour
 * High:   1 day – 1 week
 * Medium: 1 week – 1 month
 * Low:    > 1 month
 *
 * mongosh equivalent:
 *   db.checksuites.aggregate([
 *     { $match: { is_deploy: true, conclusion: "success", duration_ms: { $ne: null } } },
 *     { $group: { _id: "$repo_full_name", avg_ms: { $avg: "$duration_ms" }, count: { $sum: 1 } } },
 *     { $project: { avg_min: { $divide: ["$avg_ms", 60000] }, count: 1 } }
 *   ])
 */
export async function leadTimeForChanges(repoId, days = 30) {
  return CheckSuite.aggregate([
    {
      $match: {
        ...repoFilter(repoId),
        is_deploy:    true,
        conclusion:   'success',
        completed_at: { $gte: windowDays(days) },
        duration_ms:  { $ne: null },
      },
    },
    {
      $group: {
        _id:             '$repo_full_name',
        avg_lead_ms:     { $avg: '$duration_ms' },
        min_lead_ms:     { $min: '$duration_ms' },
        max_lead_ms:     { $max: '$duration_ms' },
        count:           { $sum: 1 },
      },
    },
    {
      $project: {
        avg_lead_min: { $divide: ['$avg_lead_ms', 60_000] },
        avg_lead_h:   { $divide: ['$avg_lead_ms', 3_600_000] },
        min_lead_min: { $divide: ['$min_lead_ms', 60_000] },
        max_lead_min: { $divide: ['$max_lead_ms', 60_000] },
        count: 1,
      },
    },
    { $sort: { avg_lead_ms: 1 } },
  ]);
}

// ─── 3. Change Failure Rate ──────────────────────────────────────────────────
/**
 * Percentage of check_suites that failed (failure / timed_out / action_required).
 *
 * Elite:  0–15 %
 * High:   16–30 %
 * Medium: 16–30 %
 * Low:    > 30 %
 *
 * mongosh equivalent:
 *   db.checksuites.aggregate([
 *     { $match: { status: "completed", completed_at: { $gte: ... } } },
 *     { $group: { _id: "$repo_full_name", total: { $sum: 1 },
 *         failed: { $sum: { $cond: [{ $in: ["$conclusion", ["failure","timed_out","action_required"]] }, 1, 0] } } } },
 *     { $project: { failure_rate_pct: { $multiply: [{ $divide: ["$failed","$total"] }, 100] } } }
 *   ])
 */
export async function changeFailureRate(repoId, days = 30) {
  return CheckSuite.aggregate([
    {
      $match: {
        ...repoFilter(repoId),
        status:       'completed',
        completed_at: { $gte: windowDays(days) },
      },
    },
    {
      $group: {
        _id:    '$repo_full_name',
        total:  { $sum: 1 },
        failed: {
          $sum: {
            $cond: [
              { $in: ['$conclusion', ['failure', 'timed_out', 'action_required']] },
              1,
              0,
            ],
          },
        },
      },
    },
    {
      $project: {
        total:            1,
        failed:           1,
        failure_rate_pct: {
          $multiply: [{ $divide: ['$failed', '$total'] }, 100],
        },
      },
    },
    { $sort: { failure_rate_pct: -1 } },
  ]);
}

// ─── 4. Time to Restore Service (MTTR) ──────────────────────────────────────
/**
 * Average time from incident label → issue closed (time_to_restore_ms).
 *
 * Elite:  < 1 hour
 * High:   < 1 day
 * Medium: 1 day – 1 week
 * Low:    > 1 week
 *
 * mongosh equivalent:
 *   db.incidents.aggregate([
 *     { $match: { resolved_at: { $ne: null }, labeled_at: { $gte: ... } } },
 *     { $group: { _id: "$repo_full_name", avg_ms: { $avg: "$time_to_restore_ms" }, count: { $sum: 1 } } },
 *     { $project: { avg_h: { $divide: ["$avg_ms", 3600000] }, count: 1 } }
 *   ])
 */
export async function timeToRestore(repoId, days = 30) {
  return Incident.aggregate([
    {
      $match: {
        ...repoFilter(repoId),
        labeled_at:   { $gte: windowDays(days) },
        resolved_at:  { $ne: null },
        time_to_restore_ms: { $ne: null },
      },
    },
    {
      $group: {
        _id:        '$repo_full_name',
        avg_ttr_ms: { $avg: '$time_to_restore_ms' },
        min_ttr_ms: { $min: '$time_to_restore_ms' },
        max_ttr_ms: { $max: '$time_to_restore_ms' },
        incidents:  { $sum: 1 },
      },
    },
    {
      $project: {
        avg_ttr_h:  { $divide: ['$avg_ttr_ms', 3_600_000] },
        min_ttr_h:  { $divide: ['$min_ttr_ms', 3_600_000] },
        max_ttr_h:  { $divide: ['$max_ttr_ms', 3_600_000] },
        incidents:  1,
      },
    },
    { $sort: { avg_ttr_ms: 1 } },
  ]);
}

// ─── 5. PR Lifetime ──────────────────────────────────────────────────────────
/**
 * Average time from PR creation to merge, per repo.
 * Bonus metric – useful for identifying review bottlenecks.
 *
 * mongosh equivalent:
 *   db.pullrequests.aggregate([
 *     { $match: { merged_at: { $ne: null, $gte: ... } } },
 *     { $group: { _id: "$repo_full_name", avg_ms: { $avg: "$lifetime_ms" }, prs: { $sum: 1 } } },
 *     { $project: { avg_h: { $divide: ["$avg_ms", 3600000] }, prs: 1 } }
 *   ])
 */
export async function prLifetime(repoId, days = 30) {
  return PullRequest.aggregate([
    {
      $match: {
        ...repoFilter(repoId),
        merged_at:   { $ne: null, $gte: windowDays(days) },
        lifetime_ms: { $ne: null },
      },
    },
    {
      $group: {
        _id:            '$repo_full_name',
        avg_lifetime_ms: { $avg: '$lifetime_ms' },
        min_lifetime_ms: { $min: '$lifetime_ms' },
        max_lifetime_ms: { $max: '$lifetime_ms' },
        prs_merged:      { $sum: 1 },
      },
    },
    {
      $project: {
        avg_lifetime_h: { $divide: ['$avg_lifetime_ms', 3_600_000] },
        min_lifetime_h: { $divide: ['$min_lifetime_ms', 3_600_000] },
        max_lifetime_h: { $divide: ['$max_lifetime_ms', 3_600_000] },
        prs_merged:     1,
      },
    },
    { $sort: { avg_lifetime_ms: 1 } },
  ]);
}

// ─── 6. Failed Jobs / Steps per repo ────────────────────────────────────────
/**
 * Count of failed check_runs per repo in the window.
 * Helps identify flaky jobs.
 */
export async function failedJobsBreakdown(repoId, days = 30) {
  return CheckRun.aggregate([
    {
      $match: {
        ...repoFilter(repoId),
        createdAt:  { $gte: windowDays(days) },
        conclusion: { $in: ['failure', 'timed_out'] },
      },
    },
    {
      $group: {
        _id:   { repo_id: '$repo_id', name: '$name' },
        fails: { $sum: 1 },
        avg_duration_ms: { $avg: '$duration_ms' },
      },
    },
    { $sort: { fails: -1 } },
    { $limit: 20 },
  ]);
}

// ─── 7. DORA Summary (all four metrics in one call) ─────────────────────────
export async function doraSummary(repoId, days = 30) {
  const [freq, leadTime, cfr, mttr] = await Promise.all([
    deploymentFrequency(repoId, days),
    leadTimeForChanges(repoId, days),
    changeFailureRate(repoId, days),
    timeToRestore(repoId, days),
  ]);
  return { deploymentFrequency: freq, leadTimeForChanges: leadTime, changeFailureRate: cfr, timeToRestore: mttr };
}
