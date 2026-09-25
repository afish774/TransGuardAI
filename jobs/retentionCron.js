const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
const Incident = require('../models/Incident');
const logger = require('../utils/logger').forComponent('Cron');

const initRetentionCron = () => {
  // Schedule: Every night at midnight
  const task = cron.schedule('0 0 * * *', async () => {
    logger.info('Starting retention purge for incidents older than 30 days...');

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);

      // 1. Query MongoDB for expired incidents with lean projection
      const oldIncidents = await Incident.find({ timestamp: { $lt: cutoffDate } })
        .select('_id id evidence_image_url')
        .lean();

      if (oldIncidents.length === 0) {
        logger.info('No expired incidents found. Skipping.');
        return;
      }

      // 2. Loop through and delete the physical evidence files from disk
      for (const incident of oldIncidents) {
        if (incident.evidence_image_url && incident.evidence_image_url.includes('/uploads/evidence/')) {
          try {
            const fileName = path.basename(incident.evidence_image_url.split('?')[0]);
            const filePath = path.join(__dirname, '..', 'uploads', 'evidence', fileName);
            await fs.unlink(filePath);
          } catch (err) {
            // File may already be gone — log and continue
            if (err.code !== 'ENOENT') {
              logger.error('Failed to delete file for %s: %s', incident.id, err.message);
            }
          }
        }
      }

      // 3. Bulk delete all expired records from MongoDB directly by index
      const result = await Incident.deleteMany({ timestamp: { $lt: cutoffDate } });

      logger.info('Retention purge complete. Deleted %d records and their evidence files.', result.deletedCount);
    } catch (error) {
      logger.error('Error during retention purge: %s', error.message);
    }
  });

  logger.info('Retention job initialized (runs daily at midnight).');
  return task;
};

module.exports = initRetentionCron;
