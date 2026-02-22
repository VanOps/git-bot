import mongoose from 'mongoose';

/**
 * Represents an incident issue (labeled "incident").
 * Used for: Time to Restore Service (MTTR).
 */
const incidentSchema = new mongoose.Schema(
  {
    issue_id:           { type: Number, required: true, unique: true },
    issue_number:       { type: Number, required: true },
    repo_id:            { type: Number, required: true, index: true },
    repo_full_name:     String,
    title:              String,
    labeled_at:         { type: Date, index: true },
    resolved_at:        Date,
    fix_pr_number:      Number,
    fix_pr_sha:         String,
    time_to_restore_ms: Number,  // resolved_at - labeled_at
  },
  { timestamps: true },
);

incidentSchema.index({ repo_id: 1, labeled_at: -1 });

export default mongoose.model('Incident', incidentSchema);
