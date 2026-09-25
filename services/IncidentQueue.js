// ==========================================
// ASYNCHRONOUS INCIDENT INGESTION SERVICE
// ==========================================
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();

const logger = require('../utils/logger');
const queueLog = logger.forComponent('IncidentQueue');

class IncidentIngestionQueue {
  constructor({ concurrency, maxPending, uploadsDir, io, Incident }) {
    this.concurrency = concurrency;
    this.maxPending = maxPending;
    this.uploadsDir = uploadsDir;
    this.io = io;
    this.Incident = Incident;
    this.pending = [];
    this.running = 0;
  }

  enqueue(job) {
    if (this.pending.length + this.running >= this.maxPending) {
      return false;
    }
    this.pending.push(job);
    setImmediate(() => this.drain());
    return true;
  }

  drain() {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      this.running += 1;
      this.process(job)
        .catch((error) => {
          queueLog.error('Failed to persist %s: %s', job.incidentId, error.message);
        })
        .finally(() => {
          this.running -= 1;
          if (this.pending.length > 0) {
            setImmediate(() => this.drain());
          }
        });
    }
  }

  async process(job) {
    const { incidentId, nodeId, cameraId, incidentType, gps, confidence, metadata, evidence } = job;
    let evidenceUrl = null;

    if (evidence) {
      const fileName = `${uuidv4()}${evidence.extension}`;
      const filePath = path.join(this.uploadsDir, fileName);
      await fs.writeFile(filePath, evidence.buffer);
      evidenceUrl = `/uploads/evidence/${fileName}`;
    }

    try {
      const incident = new this.Incident({
        id: incidentId,
        node_id: nodeId,
        camera_id: cameraId,
        incident_type: incidentType,
        gps,
        confidence,
        metadata,
        evidence_image_url: evidenceUrl,
        timestamp: new Date(),
      });
      await incident.save();
      this.io.to('authenticated_dashboard').emit('new_alert', incident.toObject());
      queueLog.info('Persisted %s', incidentId);
    } catch (error) {
      if (evidenceUrl) {
        const filePath = path.join(this.uploadsDir, path.basename(evidenceUrl));
        await fs.unlink(filePath).catch(() => {});
      }
      throw error;
    }
  }
}

/**
 * Parse multipart form values, converting JSON strings, booleans, and numbers.
 */
function parseMultipartValue(value) {
  if (Array.isArray(value)) {
    return value.map(parseMultipartValue);
  }
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?(?:\d+|\d*\.\d+)$/.test(trimmed)) return Number(trimmed);
  return value;
}

/**
 * Build an incident job from the incoming multipart request.
 */
function buildIncidentJob(req) {
  const rawCameraId = req.body?.camera_id !== undefined ? String(req.body.camera_id).trim() : '';
  const rawIncidentType = req.body?.incident_type !== undefined ? String(req.body.incident_type).trim() : '';

  if (!rawCameraId) {
    throw new Error('camera_id is required.');
  }
  if (!rawIncidentType) {
    throw new Error('incident_type is required.');
  }

  const fields = Object.fromEntries(
    Object.entries(req.body || {}).map(([key, value]) => [key, parseMultipartValue(value)]),
  );
  delete fields.camera_id;
  delete fields.incident_type;
  const { gps, confidence, ...metadata } = fields;
  const cameraId = rawCameraId;
  const incidentType = rawIncidentType;

  const numericConfidence = confidence === undefined || confidence === ''
    ? undefined
    : Number(confidence);
  if (numericConfidence !== undefined && !Number.isFinite(numericConfidence)) {
    throw new Error('confidence must be numeric.');
  }

  const evidence = req.file
    ? {
      buffer: req.file.buffer,
      extension: req.file.mimetype === 'image/png'
        ? '.png'
        : req.file.mimetype === 'image/webp'
          ? '.webp'
          : '.jpg',
    }
    : null;

  return {
    incidentId: `EV-${Date.now()}-${uuidv4()}`,
    nodeId: req.edgeNode.node_id,
    cameraId,
    incidentType,
    gps: gps && typeof gps === 'object' ? gps : undefined,
    confidence: numericConfidence,
    metadata,
    evidence,
  };
}

module.exports = {
  IncidentIngestionQueue,
  parseMultipartValue,
  buildIncidentJob,
};
