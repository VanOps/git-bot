import mongoose from 'mongoose';

/**
 * Represents a GitHub pull_request lifecycle.
 * Used for: PR Lifetime, Lead Time (commit→merge), incident fix linking.
 */
const pullRequestSchema = new mongoose.Schema(
  {
    pr_id:         { type: Number, required: true, unique: true },
    pr_number:     { type: Number, required: true },
    repo_id:       { type: Number, required: true, index: true },
    repo_full_name: String,
    author:        String,
    title:         String,
    state:         String,   // open | closed
    created_at:    { type: Date, index: true },
    merged_at:     { type: Date, index: true },
    closed_at:     Date,
    lifetime_ms:   Number,   // merged_at (or closed_at) - created_at
    commits:       Number,
    additions:     Number,
    deletions:     Number,
    changed_files: Number,
    head_sha:      String,
    base_branch:   String,
    labels:        [String],
  },
  { timestamps: true },
);

pullRequestSchema.index({ repo_id: 1, merged_at: -1 });

export default mongoose.model('PullRequest', pullRequestSchema);
