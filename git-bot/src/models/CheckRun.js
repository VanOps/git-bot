import mongoose from 'mongoose';

/**
 * Represents one GitHub check_run inside a suite.
 * Used for: Change Failure Rate (failed runs), step-level data.
 */
const checkRunSchema = new mongoose.Schema(
  {
    run_id:       { type: Number, required: true, unique: true },
    suite_id:     { type: Number, required: true, index: true },
    repo_id:      { type: Number, required: true, index: true },
    name:         String,
    status:       String,
    conclusion:   String,
    duration_ms:  Number,
    started_at:   Date,
    completed_at: Date,
    // Derived from workflow_job steps when available
    steps: [
      {
        name:       String,
        status:     String,
        conclusion: String,
        number:     Number,
        duration_ms: Number,
      },
    ],
  },
  { timestamps: true },
);

checkRunSchema.index({ repo_id: 1, createdAt: -1 });
checkRunSchema.index({ suite_id: 1, conclusion: 1 });

export default mongoose.model('CheckRun', checkRunSchema);
