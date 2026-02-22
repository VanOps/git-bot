import mongoose from 'mongoose';

/**
 * Represents a successful (or failed) deployment event.
 * Populated from check_suite.completed on "deploy*" workflows.
 * Used for: Deployment Frequency, Lead Time for Changes.
 */
const deploymentSchema = new mongoose.Schema(
  {
    suite_id:      { type: Number, required: true, unique: true },
    repo_id:       { type: Number, required: true, index: true },
    repo_full_name: String,
    sha:           { type: String, index: true },
    branch:        String,
    status:        String,
    conclusion:    String,
    duration_ms:   Number,
    pr_numbers:    [Number],
    workflow_name: String,
    deployed_at:   { type: Date, index: true },
  },
  { timestamps: true },
);

deploymentSchema.index({ repo_id: 1, deployed_at: -1 });
deploymentSchema.index({ repo_id: 1, conclusion: 1, deployed_at: -1 });

export default mongoose.model('Deployment', deploymentSchema);
