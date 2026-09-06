const mongoose = require('mongoose');

const watchlistTargetSchema = new mongoose.Schema({
  subject_id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  reference_image_url: { type: String, required: true },
  confidence_threshold: { type: Number, default: 80 },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('WatchlistTarget', watchlistTargetSchema);
