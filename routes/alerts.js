// ==========================================
// ALERT INGESTION & HISTORY ROUTES
// ==========================================
const { Router } = require('express');
const rateLimit = require('express-rate-limit');

const logger = require('../utils/logger');
const log = logger.forComponent('Alerts');
const { verifyEdgeNode, verifyDashboardUser } = require('../middleware/auth');
const { validate, acknowledgeSchema } = require('../middleware/validate');
const Incident = require('../models/Incident');

/**
 * Create the alerts router.
 *
 * @param {Object} deps
 * @param {import('../services/IncidentQueue').IncidentIngestionQueue} deps.incidentQueue
 * @param {import('socket.io').Server} deps.io
 * @param {boolean} deps.getMonitoringEnabled - getter for the monitoring toggle
 * @param {multer.Multer} deps.evidenceUpload - configured multer instance
 * @param {string} deps.uploadsDir - absolute path to the evidence uploads directory
 */
function createAlertsRouter({ incidentQueue, io, getMonitoringEnabled, evidenceUpload, uploadsDir }) {
  const router = Router();
  const fs = require('fs').promises;
  const path = require('path');
  const { buildIncidentJob } = require('../services/IncidentQueue');

  const alertRateLimiter = rateLimit({
    windowMs: 1000,
    max: process.env.NODE_ENV === 'test' ? 1000 : 15,
    message: 'Too many alerts received. Rate limited.',
  });

  // POST /api/alerts — Ingest an incident from an edge node
  router.post(
    '/',
    verifyEdgeNode,
    alertRateLimiter,
    evidenceUpload.single('evidence'),
    (req, res) => {
      if (!req.is('multipart/form-data')) {
        return res.status(415).json({ error: 'Use multipart/form-data with an optional evidence file field.' });
      }
      if (!getMonitoringEnabled()) {
        return res.status(403).json({ error: 'Monitoring is currently disabled.' });
      }
      try {
        const job = buildIncidentJob(req);
        if (!incidentQueue.enqueue(job)) {
          return res.status(503).json({ error: 'Incident queue is full. Retry shortly.' });
        }
        return res.status(202).json({ success: true, id: job.incidentId, status: 'QUEUED' });
      } catch (error) {
        return res.status(400).json({ error: error.message || 'Invalid incident payload.' });
      }
    },
  );

  // GET /api/alerts/history — Paginated incident history
  router.get('/history', verifyDashboardUser, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const skip = (page - 1) * limit;

      const [recentAlerts, total] = await Promise.all([
        Incident.find().sort({ timestamp: -1 }).skip(skip).limit(limit),
        Incident.countDocuments(),
      ]);

      res.json({
        data: recentAlerts,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch incident history.' });
    }
  });

  // PATCH /api/alerts/:id/acknowledge — Mark incident as REVIEWED/DISMISSED
  router.patch('/:id/acknowledge', verifyDashboardUser, validate(acknowledgeSchema), async (req, res) => {
    try {
      const mongoose = require('mongoose');
      const query = mongoose.Types.ObjectId.isValid(req.params.id)
        ? { $or: [{ id: req.params.id }, { _id: req.params.id }] }
        : { id: req.params.id };

      const incident = await Incident.findOneAndUpdate(
        query,
        { status: req.body.status || 'REVIEWED' },
        { returnDocument: 'after' }
      );
      if (!incident) {
        return res.status(404).json({ error: 'Incident not found.' });
      }
      io.to('authenticated_dashboard').emit('alert_updated', incident.toObject());
      log.info('Incident %s acknowledged as %s by %s', req.params.id, req.body.status, req.user.username);
      return res.json(incident);
    } catch (error) {
      log.error('Acknowledge error: %s', error.message);
      return res.status(500).json({ error: 'Failed to update incident.' });
    }
  });

  // DELETE /api/alerts/:id — Permanently remove an incident
  router.delete('/:id', verifyDashboardUser, async (req, res) => {
    try {
      const mongoose = require('mongoose');
      const query = mongoose.Types.ObjectId.isValid(req.params.id)
        ? { $or: [{ id: req.params.id }, { _id: req.params.id }] }
        : { id: req.params.id };

      const incident = await Incident.findOne(query);
      if (!incident) {
        return res.status(404).json({ error: 'Incident not found.' });
      }

      // Clean up local evidence file if it exists
      if (incident.evidence_image_url && incident.evidence_image_url.startsWith('/uploads/evidence/')) {
        const filename = path.basename(incident.evidence_image_url);
        const filePath = path.join(uploadsDir, filename);
        fs.unlink(filePath).catch((err) => {
          log.debug('Evidence cleanup note: %s', err.message);
        });
      }

      await Incident.deleteOne({ _id: incident._id });

      io.to('authenticated_dashboard').emit('alert_deleted', {
        id: incident.id,
        _id: incident._id,
      });

      log.info('Incident %s deleted by %s', incident.id, req.user.username);
      return res.json({
        success: true,
        id: incident.id,
        message: 'Incident deleted successfully.',
      });
    } catch (error) {
      log.error('Delete alert error: %s', error.message);
      return res.status(500).json({ error: 'Failed to delete incident.' });
    }
  });

  return router;
}

module.exports = createAlertsRouter;
