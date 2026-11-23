// ==========================================
// HUMAN-IN-THE-LOOP (HITL) FEEDBACK COLLECTOR
// ==========================================
// Archives operator-verified REVIEWED (true positive) and DISMISSED (hard negative)
// incidents alongside their evidence frames into structured folders so every
// real-world false alarm becomes training & calibration data for fine-tuning.

const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

const log = logger.forComponent('FeedbackCollector');

function sanitizeSegment(raw) {
  return String(raw || 'UNKNOWN')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64) || 'UNKNOWN';
}

function resolveFeedbackRoot(uploadsDir) {
  // uploadsDir is typically <project>/uploads/evidence -> sibling <project>/uploads/feedback
  const baseDir = uploadsDir ? path.dirname(uploadsDir) : path.join(__dirname, '..', 'uploads');
  return path.join(baseDir, 'feedback');
}

/**
 * Record an operator review decision (REVIEWED => true_positives, DISMISSED => false_positives).
 * Fire-and-forget safe: catches all I/O errors so API responses are never disrupted.
 */
async function recordOperatorFeedback(incident, status, reviewer, uploadsDir, options = {}) {
  try {
    if (!incident || (status !== 'REVIEWED' && status !== 'DISMISSED')) {
      return null;
    }
    if (process.env.NODE_ENV === 'test' && !options.feedbackRoot) {
      return null;
    }

    const bucket = status === 'REVIEWED' ? 'true_positives' : 'false_positives';
    const typeDir = sanitizeSegment(incident.incident_type);
    const feedbackRoot = options.feedbackRoot || resolveFeedbackRoot(uploadsDir);
    const targetDir = path.join(feedbackRoot, bucket, typeDir);

    await fs.mkdir(targetDir, { recursive: true });

    const safeId = sanitizeSegment(incident.id || incident._id || Date.now());
    let copiedEvidence = null;

    if (
      uploadsDir
      && incident.evidence_image_url
      && incident.evidence_image_url.startsWith('/uploads/evidence/')
    ) {
      const srcName = path.basename(incident.evidence_image_url);
      const srcPath = path.join(uploadsDir, srcName);
      const ext = path.extname(srcName) || '.jpg';
      const destName = `${safeId}${ext}`;
      const destPath = path.join(targetDir, destName);
      try {
        await fs.copyFile(srcPath, destPath);
        copiedEvidence = destName;
      } catch (copyErr) {
        log.debug('Evidence photo not copied for %s: %s', safeId, copyErr.message);
      }
    }

    const labelPayload = {
      id: incident.id || String(incident._id || safeId),
      incident_type: incident.incident_type,
      label: status === 'REVIEWED' ? 'TRUE_POSITIVE' : 'FALSE_POSITIVE',
      status,
      camera_id: incident.camera_id || null,
      confidence: incident.confidence ?? null,
      gps: incident.gps || null,
      metadata: incident.metadata || {},
      evidence_file: copiedEvidence,
      reviewed_by: reviewer || 'Operator',
      incident_timestamp: incident.timestamp || null,
      reviewed_at: new Date().toISOString(),
    };

    const metaPath = path.join(targetDir, `${safeId}.json`);
    await fs.writeFile(metaPath, JSON.stringify(labelPayload, null, 2), 'utf8');
    log.info('Archived %s sample for %s -> %s', labelPayload.label, typeDir, metaPath);
    return { bucket, typeDir, metaPath, evidenceFile: copiedEvidence };
  } catch (err) {
    log.warn('Feedback archival skipped due to error: %s', err.message);
    return null;
  }
}

async function countJsonFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith('.json')).length;
  } catch (_err) {
    return 0;
  }
}

/**
 * Compute live precision statistics per incident type from archived feedback.
 */
async function getFeedbackStats(uploadsDir, options = {}) {
  const feedbackRoot = options.feedbackRoot || resolveFeedbackRoot(uploadsDir);
  const byType = {};

  for (const [bucket, field] of [['true_positives', 'truePositives'], ['false_positives', 'falsePositives']]) {
    const bucketDir = path.join(feedbackRoot, bucket);
    let subdirs = [];
    try {
      subdirs = (await fs.readdir(bucketDir, { withFileTypes: true })).filter((d) => d.isDirectory());
    } catch (_err) {
      subdirs = [];
    }
    for (const dir of subdirs) {
      const count = await countJsonFiles(path.join(bucketDir, dir.name));
      if (!byType[dir.name]) {
        byType[dir.name] = { truePositives: 0, falsePositives: 0, total: 0, precisionPct: null };
      }
      byType[dir.name][field] = count;
    }
  }

  let totalTP = 0;
  let totalFP = 0;
  for (const stats of Object.values(byType)) {
    stats.total = stats.truePositives + stats.falsePositives;
    stats.precisionPct = stats.total > 0
      ? Number(((stats.truePositives / stats.total) * 100).toFixed(1))
      : null;
    totalTP += stats.truePositives;
    totalFP += stats.falsePositives;
  }

  const grandTotal = totalTP + totalFP;
  return {
    overall: {
      truePositives: totalTP,
      falsePositives: totalFP,
      total: grandTotal,
      precisionPct: grandTotal > 0 ? Number(((totalTP / grandTotal) * 100).toFixed(1)) : null,
    },
    byType,
  };
}

module.exports = {
  recordOperatorFeedback,
  getFeedbackStats,
  resolveFeedbackRoot,
};
