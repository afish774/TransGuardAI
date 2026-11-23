// ==========================================
// WATCHLIST ROUTES (1 Required Photo, Up to 10 Multi-Angle Photos + Modify Support)
// ==========================================
const { Router } = require('express');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const mongoose = require('mongoose');
const uuidv4 = () => crypto.randomUUID();

const logger = require('../utils/logger');
const log = logger.forComponent('Watchlist');
const { verifyEdgeNode, verifyDashboardUser } = require('../middleware/auth');
const WatchlistTarget = require('../models/WatchlistTarget');

const MAX_WATCHLIST_PHOTOS = 10;

function toAbsoluteUrl(baseUrl, relOrAbs) {
  if (!relOrAbs) return null;
  return relOrAbs.startsWith('http') ? relOrAbs : `${baseUrl}${relOrAbs}`;
}

function normalizeImageList(target) {
  const list = Array.isArray(target.reference_image_urls) && target.reference_image_urls.length > 0
    ? target.reference_image_urls.filter(Boolean)
    : (target.reference_image_url ? [target.reference_image_url] : []);
  return list;
}

function normalizeRelWatchlistPath(urlOrPath) {
  if (!urlOrPath || typeof urlOrPath !== 'string') return '';
  const trimmed = urlOrPath.trim();
  const idx = trimmed.indexOf('/uploads/watchlist/');
  if (idx !== -1) return trimmed.slice(idx);
  return trimmed;
}

function parseUrlArrayField(value) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) {
    return value.map(normalizeRelWatchlistPath).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeRelWatchlistPath).filter(Boolean);
      }
    } catch {
      return trimmed.split(',').map(normalizeRelWatchlistPath).filter(Boolean);
    }
  }
  return null;
}

function extractUploadedFiles(req) {
  const uploadedFiles = [];
  if (req.file) {
    uploadedFiles.push(req.file);
  }
  if (Array.isArray(req.files)) {
    uploadedFiles.push(...req.files);
  } else if (req.files && typeof req.files === 'object') {
    if (Array.isArray(req.files.image)) uploadedFiles.push(...req.files.image);
    if (Array.isArray(req.files.images)) uploadedFiles.push(...req.files.images);
  }
  return uploadedFiles;
}

async function unlinkWatchlistRelUrls(relUrls) {
  for (const relUrl of relUrls) {
    if (relUrl && relUrl.startsWith('/uploads/watchlist/')) {
      const filename = path.basename(relUrl);
      const filePath = path.join(__dirname, '..', 'uploads', 'watchlist', filename);
      await fs.unlink(filePath).catch(() => {});
    }
  }
}

function formatTargetResponse(target, baseUrl) {
  const relUrls = normalizeImageList(target);
  const absUrls = relUrls.map((u) => toAbsoluteUrl(baseUrl, u)).filter(Boolean);
  const primaryRel = relUrls[0] || target.reference_image_url || null;
  return {
    id: target._id,
    _id: target._id,
    subject_id: target.subject_id,
    name: target.name,
    status: target.status,
    created_at: target.created_at,
    reference_image_url: primaryRel,
    reference_image_urls: relUrls,
    url: toAbsoluteUrl(baseUrl, primaryRel),
    urls: absUrls,
    photo_count: relUrls.length,
  };
}

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

  // Accept 1 to MAX_WATCHLIST_PHOTOS photos via either 'image' or 'images' form fields
  const multiPhotoUpload = typeof watchlistUpload.fields === 'function'
    ? watchlistUpload.fields([
        { name: 'image', maxCount: MAX_WATCHLIST_PHOTOS },
        { name: 'images', maxCount: MAX_WATCHLIST_PHOTOS },
      ])
    : watchlistUpload.single('image');

  // GET /api/watchlist — Retrieve active watchlist targets (edge nodes or dashboard)
  router.get('/', verifyEdgeOrDashboard, async (req, res) => {
    try {
      const targets = await WatchlistTarget.find({ status: 'ACTIVE' }).sort({ created_at: -1 });
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      res.json(targets.map((target) => formatTargetResponse(target, baseUrl)));
    } catch (error) {
      log.error('Watchlist fetch error: %s', error.message);
      res.status(500).json({ error: 'Failed to fetch watchlist.' });
    }
  });

  // POST /api/watchlist — Upload a new watchlist target with 1 to MAX_WATCHLIST_PHOTOS photos
  router.post('/', verifyDashboardUser, multiPhotoUpload, async (req, res) => {
    const uploadedFiles = extractUploadedFiles(req);
    try {
      const trimmedName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (uploadedFiles.length === 0 || !trimmedName) {
        await unlinkWatchlistRelUrls(uploadedFiles.map((f) => `/uploads/watchlist/${f.filename}`));
        return res.status(400).json({ error: 'At least 1 image file and an identity name are required.' });
      }

      const cappedFiles = uploadedFiles.slice(0, MAX_WATCHLIST_PHOTOS);
      const excessFiles = uploadedFiles.slice(MAX_WATCHLIST_PHOTOS);
      if (excessFiles.length > 0) {
        await unlinkWatchlistRelUrls(excessFiles.map((f) => `/uploads/watchlist/${f.filename}`));
      }

      const imageUrls = cappedFiles.map((f) => `/uploads/watchlist/${f.filename}`);

      const target = new WatchlistTarget({
        subject_id: uuidv4(),
        name: trimmedName,
        reference_image_url: imageUrls[0],
        reference_image_urls: imageUrls,
      });
      await target.save();
      const baseUrl = `${req.protocol}://${req.get('host')}`;

      log.info(
        'Watchlist target "%s" enrolled with %d reference photo(s)',
        trimmedName,
        imageUrls.length,
      );

      return res.status(201).json({
        success: true,
        target: formatTargetResponse(target, baseUrl),
      });
    } catch (error) {
      await unlinkWatchlistRelUrls(uploadedFiles.map((f) => `/uploads/watchlist/${f.filename}`));
      log.error('Watchlist upload error: %s', error.message);
      return res.status(500).json({ error: 'Failed to upload watchlist target.' });
    }
  });

  // PUT & PATCH /api/watchlist/:id — Modify target name, remove existing photos, and/or add new photos
  const handleUpdateTarget = async (req, res) => {
    const uploadedFiles = extractUploadedFiles(req);
    const newlyUploadedRelUrls = uploadedFiles.map((f) => `/uploads/watchlist/${f.filename}`);

    try {
      const query = mongoose.Types.ObjectId.isValid(req.params.id)
        ? { $or: [{ _id: req.params.id }, { subject_id: req.params.id }] }
        : { subject_id: req.params.id };

      const target = await WatchlistTarget.findOne(query);
      if (!target) {
        await unlinkWatchlistRelUrls(newlyUploadedRelUrls);
        return res.status(404).json({ error: 'Watchlist target not found.' });
      }

      const existingUrls = normalizeImageList(target).map(normalizeRelWatchlistPath).filter(Boolean);
      const keepUrls = parseUrlArrayField(req.body?.keep_urls);
      const removeUrls = parseUrlArrayField(req.body?.remove_urls);

      let retainedUrls = [...existingUrls];
      if (keepUrls !== null) {
        const existingSet = new Set(existingUrls);
        // Preserve the user's chosen order while validating against existing target photos
        retainedUrls = keepUrls.filter((u) => existingSet.has(u));
      } else if (removeUrls !== null && removeUrls.length > 0) {
        const removeSet = new Set(removeUrls);
        retainedUrls = existingUrls.filter((u) => !removeSet.has(u));
      }

      const finalUrls = [...retainedUrls, ...newlyUploadedRelUrls];

      if (finalUrls.length === 0) {
        await unlinkWatchlistRelUrls(newlyUploadedRelUrls);
        return res.status(400).json({
          error: 'At least 1 reference photo is required. Remove the target instead if deleting all photos.',
        });
      }

      if (finalUrls.length > MAX_WATCHLIST_PHOTOS) {
        await unlinkWatchlistRelUrls(newlyUploadedRelUrls);
        return res.status(400).json({
          error: `A watchlist target can have at most ${MAX_WATCHLIST_PHOTOS} reference photos.`,
        });
      }

      let nextName = target.name;
      if (req.body?.name !== undefined) {
        const trimmedName = typeof req.body.name === 'string' ? req.body.name.trim() : '';
        if (!trimmedName) {
          await unlinkWatchlistRelUrls(newlyUploadedRelUrls);
          return res.status(400).json({ error: 'Identity name cannot be empty.' });
        }
        nextName = trimmedName.slice(0, 120);
      }

      const retainedSet = new Set(retainedUrls);
      const removedExistingUrls = existingUrls.filter((u) => !retainedSet.has(u));

      target.name = nextName;
      target.reference_image_url = finalUrls[0];
      target.reference_image_urls = finalUrls;
      await target.save();

      if (removedExistingUrls.length > 0) {
        await unlinkWatchlistRelUrls(removedExistingUrls);
      }

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      log.info(
        'Watchlist target "%s" updated by %s (%d photo(s): +%d added, -%d removed)',
        target.name,
        req.user?.username || 'user',
        finalUrls.length,
        newlyUploadedRelUrls.length,
        removedExistingUrls.length,
      );

      return res.json({
        success: true,
        target: formatTargetResponse(target, baseUrl),
      });
    } catch (error) {
      await unlinkWatchlistRelUrls(newlyUploadedRelUrls);
      log.error('Watchlist update error: %s', error.message);
      return res.status(500).json({ error: 'Failed to update watchlist target.' });
    }
  };

  router.put('/:id', verifyDashboardUser, multiPhotoUpload, handleUpdateTarget);
  router.patch('/:id', verifyDashboardUser, multiPhotoUpload, handleUpdateTarget);

  // DELETE /api/watchlist/:id — Remove a target and all of its reference photos
  router.delete('/:id', verifyDashboardUser, async (req, res) => {
    try {
      const query = mongoose.Types.ObjectId.isValid(req.params.id)
        ? { $or: [{ _id: req.params.id }, { subject_id: req.params.id }] }
        : { subject_id: req.params.id };

      const target = await WatchlistTarget.findOne(query);
      if (!target) {
        return res.status(404).json({ error: 'Watchlist target not found.' });
      }

      const allRelUrls = new Set(normalizeImageList(target));
      if (target.reference_image_url) {
        allRelUrls.add(target.reference_image_url);
      }
      await unlinkWatchlistRelUrls(Array.from(allRelUrls));

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
