// ==========================================
// ZONE MODEL — Persistent Geofence Polygons
// ==========================================
const mongoose = require('mongoose');

const zoneSchema = new mongoose.Schema({
  camera_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  polygon: {
    type: [[Number]],
    default: [],
  },
  updated_at: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Zone', zoneSchema);
