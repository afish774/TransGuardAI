// backend/models/Zone.js
const mongoose = require("mongoose");

const ZoneSchema = new mongoose.Schema(
  {
    cameraId: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: "Restricted Zone" },
    // Polygon vertices in pixel coordinates of the engine frame
    // (engine runs at --width x --height, default 1280x720).
    polygon: {
      type: [[Number]], // [[x, y], ...]
      default: [],
      validate: {
        validator: (v) => v.length === 0 || v.length >= 3,
        message: "A zone polygon needs at least 3 vertices",
      },
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Zone", ZoneSchema);
