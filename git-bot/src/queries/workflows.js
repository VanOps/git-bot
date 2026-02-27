/**
 * Workflow Statistics – MongoDB Aggregation Queries
 * ==================================================
 * Generic workflow metrics across all repos and workflow names.
 * Completely independent from DORA metrics – operates on CheckSuite collection.
 *
 * All functions accept optional filters:
 *   repoName     (string) – repo_full_name  e.g. "owner/repo"  (falsy = all repos)
 *   workflowName (string) – workflow_name                       (falsy = all workflows)
 *   days         (number) – lookback window (default 30)
 */

import CheckSuite from '../models/CheckSuite.js';

const windowDays = (days = 30) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1_000);

const FAILED_CONCLUSIONS = ['failure', 'timed_out', 'action_required'];

/** Build the common $match stage for completed suites inside the window. */
function baseMatch(repoName, workflowName, days) {
  const match = {
    status:       'completed',
    completed_at: { $gte: windowDays(days) },
  };
  if (repoName)     match.repo_full_name = repoName;
  if (workflowName) match.workflow_name  = workflowName;
  return match;
}

// ─── 1. List repos with activity in the window ──────────────────────────────
/**
 * Returns [{ repo: "owner/repo" }, ...] sorted alphabetically.
 * Used by the Grafana template variable `repo`.
 */
export async function listRepos(days = 30) {
  return CheckSuite.aggregate([
    {
      $match: {
        status:         'completed',
        completed_at:   { $gte: windowDays(days) },
        repo_full_name: { $nin: [null, ''] },
      },
    },
    { $group: { _id: '$repo_full_name' } },
    { $sort:  { _id: 1 } },
    { $project: { _id: 0, repo: '$_id' } },
  ]);
}

// ─── 2. List workflow names with activity in the window ──────────────────────
/**
 * Returns [{ workflow: "CI" }, ...] sorted alphabetically.
 * Optionally scoped to a single repo.
 * Used by the Grafana template variable `workflow`.
 */
export async function listWorkflows(repoName, days = 30) {
  const match = {
    status:        'completed',
    completed_at:  { $gte: windowDays(days) },
    workflow_name: { $nin: [null, ''] },
  };
  if (repoName) match.repo_full_name = repoName;

  return CheckSuite.aggregate([
    { $match: match },
    { $group: { _id: '$workflow_name' } },
    { $sort:  { _id: 1 } },
    { $project: { _id: 0, workflow: '$_id' } },
  ]);
}

// ─── 3. Global summary KPIs ──────────────────────────────────────────────────
/**
 * Single-row summary with total/success/failed counts and avg duration.
 * Supports both optional filters.
 * Returns [{total_runs, success_runs, failed_runs, success_rate_pct, avg_duration_min, ...}]
 */
export async function workflowSummary(repoName, workflowName, days = 30) {
  const results = await CheckSuite.aggregate([
    { $match: baseMatch(repoName, workflowName, days) },
    {
      $group: {
        _id:             null,
        total_runs:      { $sum: 1 },
        success_runs:    { $sum: { $cond: [{ $eq:  ['$conclusion', 'success']  }, 1, 0] } },
        failed_runs:     { $sum: { $cond: [{ $in:  ['$conclusion', FAILED_CONCLUSIONS] }, 1, 0] } },
        avg_duration_ms: { $avg: '$duration_ms' },
        min_duration_ms: { $min: '$duration_ms' },
        max_duration_ms: { $max: '$duration_ms' },
      },
    },
    {
      $project: {
        _id:              0,
        total_runs:       1,
        success_runs:     1,
        failed_runs:      1,
        success_rate_pct: {
          $cond: [
            { $eq: ['$total_runs', 0] },
            0,
            { $multiply: [{ $divide: ['$success_runs', '$total_runs'] }, 100] },
          ],
        },
        avg_duration_min: { $divide: ['$avg_duration_ms', 60_000] },
        min_duration_min: { $divide: ['$min_duration_ms', 60_000] },
        max_duration_min: { $divide: ['$max_duration_ms', 60_000] },
      },
    },
  ]);

  // Always return one row so Grafana stat panels render 0 instead of N/A
  return results.length
    ? results
    : [{
        total_runs:       0,
        success_runs:     0,
        failed_runs:      0,
        success_rate_pct: 0,
        avg_duration_min: null,
        min_duration_min: null,
        max_duration_min: null,
      }];
}

// ─── 4. Stats grouped by repo ────────────────────────────────────────────────
/**
 * One row per repo. Optionally scoped to a single workflow name.
 * Returns [{repo, total_runs, success_runs, failed_runs, success_rate_pct, avg_duration_min}]
 */
export async function workflowsByRepo(workflowName, days = 30) {
  const match = {
    status:       'completed',
    completed_at: { $gte: windowDays(days) },
  };
  if (workflowName) match.workflow_name = workflowName;

  return CheckSuite.aggregate([
    { $match: match },
    {
      $group: {
        _id:             '$repo_full_name',
        total_runs:      { $sum: 1 },
        success_runs:    { $sum: { $cond: [{ $eq:  ['$conclusion', 'success'] }, 1, 0] } },
        failed_runs:     { $sum: { $cond: [{ $in:  ['$conclusion', FAILED_CONCLUSIONS] }, 1, 0] } },
        avg_duration_ms: { $avg: '$duration_ms' },
      },
    },
    {
      $project: {
        _id:              0,
        repo:             '$_id',
        total_runs:       1,
        success_runs:     1,
        failed_runs:      1,
        success_rate_pct: {
          $cond: [
            { $eq: ['$total_runs', 0] },
            0,
            { $multiply: [{ $divide: ['$success_runs', '$total_runs'] }, 100] },
          ],
        },
        avg_duration_min: { $divide: ['$avg_duration_ms', 60_000] },
      },
    },
    { $sort: { total_runs: -1 } },
  ]);
}

// ─── 5. Stats grouped by workflow name ──────────────────────────────────────
/**
 * One row per workflow name. Optionally scoped to a single repo.
 * Returns [{workflow, total_runs, success_runs, failed_runs, success_rate_pct, avg_duration_min}]
 */
export async function workflowsByName(repoName, workflowName, days = 30) {
  const match = {
    status:        'completed',
    completed_at:  { $gte: windowDays(days) },
    workflow_name: { $nin: [null, ''] },
  };
  if (repoName)     match.repo_full_name = repoName;
  if (workflowName) match.workflow_name  = workflowName;

  return CheckSuite.aggregate([
    { $match: match },
    {
      $group: {
        _id:             '$workflow_name',
        total_runs:      { $sum: 1 },
        success_runs:    { $sum: { $cond: [{ $eq:  ['$conclusion', 'success'] }, 1, 0] } },
        failed_runs:     { $sum: { $cond: [{ $in:  ['$conclusion', FAILED_CONCLUSIONS] }, 1, 0] } },
        avg_duration_ms: { $avg: '$duration_ms' },
      },
    },
    {
      $project: {
        _id:              0,
        workflow:         '$_id',
        total_runs:       1,
        success_runs:     1,
        failed_runs:      1,
        success_rate_pct: {
          $cond: [
            { $eq: ['$total_runs', 0] },
            0,
            { $multiply: [{ $divide: ['$success_runs', '$total_runs'] }, 100] },
          ],
        },
        avg_duration_min: { $divide: ['$avg_duration_ms', 60_000] },
      },
    },
    { $sort: { total_runs: -1 } },
  ]);
}

// ─── 6. Daily run counts (trend) ────────────────────────────────────────────
/**
 * One row per calendar day with total/success/failed counts.
 * Supports both optional filters.
 * Returns [{date: "YYYY-MM-DD", total, success, failed}] sorted ASC.
 */
export async function workflowsOverTime(repoName, workflowName, days = 30) {
  return CheckSuite.aggregate([
    { $match: baseMatch(repoName, workflowName, days) },
    {
      $group: {
        _id:     { $dateToString: { format: '%Y-%m-%d', date: '$completed_at' } },
        total:   { $sum: 1 },
        success: { $sum: { $cond: [{ $eq:  ['$conclusion', 'success'] }, 1, 0] } },
        failed:  { $sum: { $cond: [{ $in:  ['$conclusion', FAILED_CONCLUSIONS] }, 1, 0] } },
      },
    },
    {
      $project: {
        _id:     0,
        date:    '$_id',
        ts:      { $dateFromString: { dateString: '$_id' } },
        total:   1,
        success: 1,
        failed:  1,
      },
    },
    { $sort: { date: 1 } },
  ]);
}
