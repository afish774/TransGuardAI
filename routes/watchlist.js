// ==========================================
// WATCHLIST ROUTES
// ==========================================
const { Router } = require('express');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();

const logger = require('../utils/logger');
const log = logger.forComponent('Watchlist');
const { verifyEdgeNode, verifyDashboardUser } = require('../middleware/auth');
const WatchlistTarget = require('../models/WatchlistTarget');

/**
 * Create the watchlist router.
 *
 * @param {Object} deps
 * @param {multer.Multer} deps.watchlistUpload - configured multer instance for watchlist images
 */
function createWatchlistRouter({ watchlistUpload }) {
  const router = Router();

  // Dual authentication middleware for watchlist: edge nodes (via API key) OR dashboard users (via JWT)
  const verifyEdgeOrDashboard = (req, res, next) => {
    if (req.headers['x-edge-api-key']) {
      return verifyEdgeNode(req, res, next);
    }
    return verifyDashboardUser(req, res, next);
  };

  // GET /api/watchlist — Retrieve active watchlist targets (edge nodes or dashboard)
  router.get('/', verifyEdgeOrDashboard, async (req, res) => {
    try {
      const targets = await WatchlistTarget.find({ status: 'ACTIVE' }).sort({ created_at: -1 });
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      res.json(targets.map((target) => ({
        id: target._id,
        _id: target._id,
        subject_id: target.subject_id,
        name: target.name,
        status: target.status,
        created_at: target.created_at,
        reference_image_url: target.reference_image_url || null,
        url: target.reference_image_url
          ? (target.reference_image_url.startsWith('http')
              ? target.reference_image_url
              : `${baseUrl}${target.reference_image_url}`)
          : null,
      })));
    } catch (error) {
      log.error('Watchlist fetch error: %s', error.message);
      res.status(500).json({ error: 'Failed to fetch watchlist.' });
    }
  });

  // POST /api/watchlist — Upload a new watchlist target (dashboard users)
  router.post('/', verifyDashboardUser, watchlistUpload.single('image'), async (req, res) => {
    try {
      if (!req.file || !req.body.name) {
        return res.status(400).json({ error: 'Image file and name are required.' });
      }
      const target = new WatchlistTarget({
        subject_id: uuidv4(),
        name: req.body.name,
        reference_image_url: `/uploads/watchlist/${req.file.filename}`,
      });
      await target.save();
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      return res.status(201).json({
        success: true,
        target: {
          ...target.toObject(),
          id: target._id,
          url: `${baseUrl}${target.reference_image_url}`,
        },
      });
    } catch (error) {
      log.error('Watchlist upload error: %s', error.message);
      return res.status(500).json({ error: 'Failed to upload watchlist target.' });
    }
  });

  // DELETE /api/watchlist/:id — Remove a target
  router.delete('/:id', verifyDashboardUser, async (req, res) => {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const mongoose = require('mongoose');

      const query = mongoose.Types.ObjectId.isValid(req.params.id)
        ? { $or: [{ _id: req.params.id }, { subject_id: req.params.id }] }
        : { subject_id: req.params.id };

      const target = await WatchlistTarget.findOne(query);
      if (!target) {
        return res.status(404).json({ error: 'Watchlist target not found.' });
      }

      if (target.reference_image_url && target.reference_image_url.startsWith('/uploads/watchlist/')) {
        const filename = path.basename(target.reference_image_url);
        const filePath = path.join(__dirname, '..', 'uploads', 'watchlist', filename);
        fs.unlink(filePath).catch(() => {});
      }

      await WatchlistTarget.deleteOne({ _id: target._id });
      log.info('Watchlist target %s removed by %s', target.name, req.user?.username || 'user');
      return res.json({ success: true, id: req.params.id });
    } catch (error) {
      log.error('Watchlist delete error: %s', error.message);
      return res.status(500).json({ error: 'Failed to delete watchlist target.' });
    }
  });

  return router;
}

module.exports = createWatchlistRouter;
