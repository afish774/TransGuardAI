const mongoose = require('mongoose');

const incidentSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  node_id: { type: String },
  camera_id: { type: String, required: true },
  incident_type: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  gps: {
    lat: { type: Number },
    lon: { type: Number }
  },
  evidence_image_url: { type: String },
  confidence: { type: Number },
  metadata: { type: mongoose.Schema.Types.Mixed },
  status: { type: String, enum: ['NEW', 'REVIEWED', 'DISMISSED'], default: 'NEW' }
});

module.exports = mongoose.model('Incident', incidentSchema);
