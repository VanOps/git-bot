import mongoose from 'mongoose';

/**
 * Represents one GitHub check_suite event.
 * Used for: Deployment Frequency, Lead Time, Change Failure Rate.
 */
const checkSuiteSchema = new mongoose.Schema(
  {
    suite_id:        { type: Number, required: true, unique: true },
    repo_id:         { type: Number, required: true, index: true },
    installation_id: { type: Number, index: true },
    repo_full_name:  String,
    status:          String,   // queued | in_progress | completed
    conclusion:      String,   // success | failure | neutral | cancelled | timed_out | action_required
    head_sha:        { type: String, index: true },
    head_branch:     String,
    workflow_name:   String,
    pr_numbers:      [Number],
    duration_ms:     Number,   // completed_at - started_at
    is_deploy:       { type: Boolean, default: false, index: true },
    started_at:      Date,
    completed_at:    { type: Date, index: true },
  },
  { timestamps: true },
);

checkSuiteSchema.index({ repo_id: 1, createdAt: -1 });
checkSuiteSchema.index({ repo_id: 1, conclusion: 1 });
checkSuiteSchema.index({ repo_id: 1, is_deploy: 1, completed_at: -1 });

export default mongoose.model('CheckSuite', checkSuiteSchema);
