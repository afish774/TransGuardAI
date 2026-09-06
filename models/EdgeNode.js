const mongoose = require('mongoose');

const edgeNodeSchema = new mongoose.Schema({
  node_id: { type: String, required: true, unique: true },
  api_key: { type: String, required: true, unique: true },
  label: { type: String },
  location: { type: String },
  hardware: { type: String },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'MAINTENANCE'], default: 'ACTIVE' },
  registered_at: { type: Date, default: Date.now },
  last_heartbeat: { type: Date },

  // MULTI-CAM: Array of cameras reporting under this edge node.
  // Updated by POST /api/edge/heartbeat from each Python engine instance.
  cameras: [{
    camera_id: { type: String, required: true },
    rtsp_url: { type: String },
    status: { type: String, enum: ['ONLINE', 'OFFLINE'], default: 'OFFLINE' },
    last_heartbeat: { type: Date },
    fps: { type: Number, default: 0 }
  }]
});

module.exports = mongoose.model('EdgeNode', edgeNodeSchema);
