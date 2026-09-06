// backend/models/Incident.js
const mongoose = require("mongoose");

const IncidentSchema = new mongoose.Schema(
  {
    incidentType: {
      type: String,
      enum: [
        "FALL_DETECTED",
        "UNATTENDED_BAGGAGE",
        "ZONE_INTRUSION",
        "WATCHLIST_MATCH",
      ],
      required: true,
      index: true,
    },
    cameraId: { type: String, required: true, index: true },
    timestamp: { type: Date, required: true },
    snapshot: { type: String, default: "" }, // base64 JPEG from the edge engine

    // FALL_DETECTED
    persons: { type: Number, default: 0 },

    // UNATTENDED_BAGGAGE
    objectClass: { type: String, enum: ["backpack", "handbag", "suitcase", null], default: null },
    trackId: { type: Number, default: null },
    stationarySeconds: { type: Number, default: null },
    bbox: { type: [Number], default: undefined },

    // ZONE_INTRUSION
    point: { type: [Number], default: undefined }, // [cx, cy]
    zone: { type: [[Number]], default: undefined }, // polygon copy at alert time

    // WATCHLIST_MATCH
    identity: { type: String, default: null },

    acknowledged: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Incident", IncidentSchema);
