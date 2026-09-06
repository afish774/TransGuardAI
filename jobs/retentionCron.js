const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
const Incident = require('../models/Incident');

const initRetentionCron = () => {
  // Schedule: Every night at midnight
  cron.schedule('0 0 * * *', async () => {
    console.log('[Cron] Starting retention purge for incidents older than 30 days...');

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);

      // 1. Query MongoDB for all expired incidents
      const oldIncidents = await Incident.find({ timestamp: { $lt: cutoffDate } });

      if (oldIncidents.length === 0) {
        console.log('[Cron] No expired incidents found. Skipping.');
        return;
      }

      // 2. Loop through and delete the physical .jpg files from disk
      const idsToDelete = [];
      for (const incident of oldIncidents) {
        idsToDelete.push(incident._id);

        if (incident.evidence_image_url) {
          try {
            const fileName = path.basename(incident.evidence_image_url);
            const filePath = path.join(__dirname, '..', 'uploads', 'evidence', fileName);
            await fs.unlink(filePath);
          } catch (err) {
            // File may already be gone — log and continue
            if (err.code !== 'ENOENT') {
              console.error(`[Cron] Failed to delete file for ${incident.id}:`, err.message);
            }
          }
        }
      }

      // 3. Bulk delete all expired records from MongoDB in one operation
      const result = await Incident.deleteMany({ _id: { $in: idsToDelete } });

      console.log(`[Cron] Retention purge complete. Deleted ${result.deletedCount} records and their evidence files.`);
    } catch (error) {
      console.error('[Cron] Error during retention purge:', error);
    }
  });

  console.log('[Cron] Retention job initialized (runs daily at midnight).');
};

module.exports = initRetentionCron;
