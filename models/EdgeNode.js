const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * Hash an API key using SHA-256 for secure storage.
 * The raw key is never persisted — only the hash.
 * @param {string} rawKey
 * @returns {string}
 */
function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

const edgeNodeSchema = new mongoose.Schema({
  node_id: { type: String, required: true, unique: true },
  api_key_hash: { type: String, required: true, index: true },
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

/**
 * Find an edge node by raw API key. Hashes the input and queries by hash.
 * @param {string} rawKey - The raw API key from the x-edge-api-key header.
 * @returns {Promise<Document|null>}
 */
edgeNodeSchema.statics.findByApiKey = async function findByApiKey(rawKey) {
  const hash = hashApiKey(rawKey);
  let node = await this.findOne({ api_key_hash: hash, status: 'ACTIVE' });
  if (!node) {
    // Backward-compatibility: match legacy unhashed api_key and auto-migrate to hash
    node = await this.findOne({ api_key: rawKey, status: 'ACTIVE' });
    if (node) {
      node.api_key_hash = hash;
      await node.save().catch(() => {});
    }
  }
  return node;
};

/**
 * Create a new edge node with a raw API key (will be hashed before storage).
 * @param {Object} fields - Fields including raw `api_key` (not `api_key_hash`).
 * @returns {Promise<Document>}
 */
edgeNodeSchema.statics.createWithRawKey = async function createWithRawKey(fields) {
  const { api_key, ...rest } = fields;
  if (!api_key) throw new Error('api_key is required for edge node creation.');
  return this.create({ ...rest, api_key_hash: hashApiKey(api_key) });
};

module.exports = mongoose.model('EdgeNode', edgeNodeSchema);
module.exports.hashApiKey = hashApiKey;
