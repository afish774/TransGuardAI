const mongoose = require('mongoose');

const incidentSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  node_id: { type: String },
  camera_id: { type: String, required: true, index: true },
  incident_type: { type: String, required: true },
  timestamp: { type: Date, default: Date.now, index: true },
  gps: {
    lat: { type: Number },
    lon: { type: Number }
  },
  evidence_image_url: { type: String },
  confidence: { type: Number },
  metadata: { type: mongoose.Schema.Types.Mixed },
  status: { type: String, enum: ['NEW', 'REVIEWED', 'DISMISSED'], default: 'NEW', index: true }
});

// Compound index for common dashboard queries (newest incidents, filtered by camera)
incidentSchema.index({ timestamp: -1, camera_id: 1 });

module.exports = mongoose.model('Incident', incidentSchema);
