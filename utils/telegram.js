const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const log = logger.forComponent('Telegram');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '9017514500:AAEOD2HIL3NkWFzzitRxwu6hr7lJBlcVXb8';
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '5408766784';

const SUBSCRIBERS_FILE = path.join(process.cwd(), 'uploads', 'telegram_subscribers.json');

let pollerActive = false;
let pollerAbortController = null;
let lastUpdateId = 0;

/**
 * Load subscribers from disk and environment variables.
 * Returns array of { chatId, name, username, type, addedAt }
 */
function getSubscribers() {
  const subscribersMap = new Map();

  // Always seed default ID(s) from .env (supports comma-separated list or group IDs)
  if (DEFAULT_CHAT_ID) {
    const envIds = DEFAULT_CHAT_ID.split(',').map((s) => s.trim()).filter(Boolean);
    for (const id of envIds) {
      subscribersMap.set(String(id), {
        chatId: String(id),
        name: 'Primary Responder (.env)',
        username: 'config_admin',
        type: String(id).startsWith('-') ? 'group' : 'private',
        addedAt: new Date().toISOString(),
      });
    }
  }

  // Load dynamically registered subscribers
  try {
    if (fs.existsSync(SUBSCRIBERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf8'));
      if (Array.isArray(data)) {
        for (const sub of data) {
          if (sub && sub.chatId) {
            subscribersMap.set(String(sub.chatId), sub);
          }
        }
      }
    }
  } catch (err) {
    log.warn('Could not read telegram subscribers file: %s', err.message);
  }

  return Array.from(subscribersMap.values());
}

/**
 * Save new subscriber to disk.
 */
function saveSubscriber(chatInfo) {
  try {
    const uploadsDir = path.dirname(SUBSCRIBERS_FILE);
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    let list = [];
    if (fs.existsSync(SUBSCRIBERS_FILE)) {
      try {
        list = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf8')) || [];
      } catch (_e) {
        list = [];
      }
    }

    const strId = String(chatInfo.chatId);
    const existingIndex = list.findIndex((s) => String(s.chatId) === strId);
    if (existingIndex >= 0) {
      list[existingIndex] = { ...list[existingIndex], ...chatInfo, updatedAt: new Date().toISOString() };
    } else {
      list.push({ ...chatInfo, addedAt: new Date().toISOString() });
    }

    fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(list, null, 2), 'utf8');
    log.info('Saved Telegram subscriber: %s (%s, %s)', strId, chatInfo.name, chatInfo.type);
    return true;
  } catch (err) {
    log.error('Failed to save Telegram subscriber: %s', err.message);
    return false;
  }
}

/**
 * Remove subscriber on /stop.
 */
function removeSubscriber(chatId) {
  try {
    if (!fs.existsSync(SUBSCRIBERS_FILE)) return;
    const strId = String(chatId);
    let list = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf8')) || [];
    const beforeCount = list.length;
    list = list.filter((s) => String(s.chatId) !== strId);
    if (list.length !== beforeCount) {
      fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(list, null, 2), 'utf8');
      log.info('Removed Telegram subscriber: %s', strId);
    }
  } catch (err) {
    log.warn('Failed to remove subscriber %s: %s', chatId, err.message);
  }
}

/**
 * Dispatch an incident alert to all subscribed Telegram chats/groups,
 * attaching the evidence photo and interactive action buttons.
 *
 * @param {Object} incident - Incident document or object
 * @param {string} operatorName - Username of the approving operator
 * @param {string} [uploadsDir] - Directory where evidence photos are stored
 */
async function sendTelegramApprovalAlert(incident, operatorName = 'Control Center Operator', uploadsDir = null) {
  if (!BOT_TOKEN) {
    log.warn('Telegram BOT_TOKEN missing; skipping dispatch alert');
    return;
  }

  const subscribers = getSubscribers();
  if (subscribers.length === 0) {
    log.warn('No Telegram subscribers configured or registered; skipping alert');
    return;
  }

  const lat = incident.gps?.lat || 10.5898;
  const lon = incident.gps?.lon || 76.0116;
  const vehicleId = incident.metadata?.vehicle_id || incident.vehicle_id || 'BUS_001';
  const cameraId = incident.camera_id || 'cam0';
  const incidentType = (incident.incident_type || 'SECURITY THREAT').replace(/_/g, ' ');
  const mapsUrl = `https://maps.google.com/?q=${lat},${lon}`;
  const timestamp = new Date(incident.timestamp || Date.now()).toLocaleTimeString();

  // Telegram caption limit is 1024 characters
  let text = `🚨 <b>TRANSGUARD AI — DISPATCH VERIFIED</b>\n\n`;
  text += `🛡️ <b>Threat Type:</b> ${incidentType}\n`;

  const suspectName = incident.metadata?.identity || incident.identity;
  if (suspectName) {
    text += `🎯 <b>Identified Subject:</b> ${suspectName}\n`;
  }

  text += `👤 <b>Authorized By:</b> ${operatorName}\n`;
  text += `🚌 <b>Target Asset:</b> ${vehicleId} (Camera: ${cameraId})\n`;
  text += `⏰ <b>Verification Time:</b> ${timestamp}\n`;
  text += `📍 <b>Coordinates:</b> ${lat.toFixed(4)}, ${lon.toFixed(4)}\n\n`;
  text += `⚡ <b>Action Status:</b> Vehicle Siren Activated on ESP32!`;

  // Interactive inline keyboard buttons
  const replyMarkup = JSON.stringify({
    inline_keyboard: [
      [
        { text: '📍 Live Google Maps', url: mapsUrl },
        { text: '🖥️ TransGuard Dashboard', url: 'http://192.168.18.192:5173' },
      ],
    ],
  });

  // Look for evidence image on disk
  let imageBuffer = null;
  let imageName = 'evidence.jpg';

  if (incident.evidence_image_url) {
    const baseName = path.basename(incident.evidence_image_url.split('?')[0]);
    const candidates = [];
    if (uploadsDir) {
      candidates.push(path.join(uploadsDir, baseName));
    }
    candidates.push(path.join(__dirname, '..', 'uploads', 'evidence', baseName));
    candidates.push(path.join(process.cwd(), 'uploads', 'evidence', baseName));

    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        try {
          imageBuffer = fs.readFileSync(filePath);
          imageName = baseName;
          log.info('Found evidence photo for incident at %s (%d bytes)', filePath, imageBuffer.length);
          break;
        } catch (readErr) {
          log.warn('Error reading evidence photo at %s: %s', filePath, readErr.message);
        }
      }
    }
  }

  log.info('Broadcasting incident alert to %d Telegram subscriber(s)...', subscribers.length);

  // Broadcast to all subscribers concurrently
  const sendPromises = subscribers.map(async (sub) => {
    const targetChatId = sub.chatId;
    try {
      if (imageBuffer && imageBuffer.length > 0) {
        const formData = new FormData();
        formData.append('chat_id', targetChatId);
        formData.append('caption', text);
        formData.append('parse_mode', 'HTML');
        formData.append('reply_markup', replyMarkup);
        formData.append('photo', new Blob([imageBuffer], { type: 'image/jpeg' }), imageName);

        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
          method: 'POST',
          body: formData,
        });

        if (res.ok) {
          return { chatId: targetChatId, success: true, method: 'photo' };
        }
        const errText = await res.text().catch(() => '');
        log.warn('sendPhoto failed for chat %s (HTTP %d): %s. Trying text fallback...', targetChatId, res.status, errText);
      }

      // Text fallback
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetChatId,
          text: text,
          parse_mode: 'HTML',
          reply_markup: JSON.parse(replyMarkup),
        }),
      });

      if (res.ok) {
        return { chatId: targetChatId, success: true, method: 'text' };
      }
      const errText = await res.text().catch(() => '');
      log.warn('sendMessage failed for chat %s (HTTP %d): %s', targetChatId, res.status, errText);
      return { chatId: targetChatId, success: false, error: errText };
    } catch (sendErr) {
      log.error('Telegram dispatch error for chat %s: %s', targetChatId, sendErr.message);
      return { chatId: targetChatId, success: false, error: sendErr.message };
    }
  });

  const results = await Promise.allSettled(sendPromises);
  const successCount = results.filter((r) => r.status === 'fulfilled' && r.value?.success).length;
  log.info('✅ Telegram alert dispatched: %d of %d succeeded.', successCount, subscribers.length);
}

/**
 * Handle incoming user commands like /start, /status, /stop, /help.
 */
async function handleTelegramMessage(message) {
  if (!message || !message.chat || !message.text) return;

  const chatId = String(message.chat.id);
  const text = message.text.trim();
  const firstName = message.from?.first_name || message.chat.title || 'Responder';
  const username = message.from?.username || '';
  const chatType = message.chat.type || 'private';

  // Match commands (supports /start, /start@BotUsername, etc.)
  const command = text.split(/\s+/)[0].toLowerCase().split('@')[0];

  if (command === '/start') {
    saveSubscriber({
      chatId,
      name: firstName,
      username,
      type: chatType,
    });

    const welcomeMsg = `🛡️ <b>TRANSGUARD AI — EMERGENCY DISPATCH</b>\n\n` +
      `✅ <b>Subscription Confirmed!</b>\n` +
      `Welcome <b>${firstName}</b>. Your device is now connected to the TransGuard AI Live Alerting Grid.\n\n` +
      `Whenever an operator reviews and approves a critical incident (e.g. Baggage Theft, Weapon Detected, or Assault), you will automatically receive:\n` +
      `📸 Instant High-Resolution Evidence Photo\n` +
      `📍 Precise GPS Coordinates & Live Google Maps Link\n` +
      `🚨 Vehicle Siren Trigger Status (ESP32 Node)\n\n` +
      `<i>Commands available:</i>\n` +
      `• /status — Verify your connection & system status\n` +
      `• /stop — Unsubscribe from alerts`;

    await sendDirectMessage(chatId, welcomeMsg);
  } else if (command === '/status') {
    const subs = getSubscribers();
    const isSubscribed = subs.some((s) => s.chatId === chatId);

    const statusMsg = `📊 <b>TRANSGUARD AI SYSTEM STATUS</b>\n\n` +
      `• <b>Your Status:</b> ${isSubscribed ? '🟢 Active Subscriber' : '⚪ Not Subscribed (/start to subscribe)'}\n` +
      `• <b>Active Subscribers:</b> ${subs.length}\n` +
      `• <b>Monitored Asset:</b> BUS_001 (DOIT ESP32 DevKit V1)\n` +
      `• <b>Alarm Output:</b> GPIO 15 (Active-High Siren)\n` +
      `• <b>Dashboard URL:</b> http://192.168.18.192:5173\n\n` +
      `<i>System is running and monitoring edge telemetry.</i>`;

    await sendDirectMessage(chatId, statusMsg);
  } else if (command === '/stop' || command === '/unsubscribe') {
    removeSubscriber(chatId);
    const stopMsg = `🔕 <b>TRANSGUARD AI NOTIFICATIONS MUTED</b>\n\nYou will no longer receive emergency incident alerts on this chat. Send /start anytime to re-enable alerts.`;
    await sendDirectMessage(chatId, stopMsg);
  } else if (command === '/help') {
    const helpMsg = `ℹ️ <b>TransGuard AI Bot Commands</b>\n\n` +
      `• /start — Register this chat to receive verified incident alerts & evidence photos\n` +
      `• /status — Check system & subscription status\n` +
      `• /stop — Unsubscribe from alerts`;
    await sendDirectMessage(chatId, helpMsg);
  }
}

/**
 * Send a direct text message to a specific chat.
 */
async function sendDirectMessage(chatId, htmlText) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: htmlText,
        parse_mode: 'HTML',
      }),
    });
  } catch (err) {
    log.warn('sendDirectMessage failed to %s: %s', chatId, err.message);
  }
}

/**
 * Start background long-polling for incoming /start commands.
 * Runs non-blockingly and recovers automatically from network drops.
 */
function startTelegramSubscriberService() {
  if (pollerActive || !BOT_TOKEN) return;
  pollerActive = true;
  pollerAbortController = new AbortController();

  log.info('📡 Starting Telegram subscriber listener (/start auto-registration active)...');

  const pollLoop = async () => {
    while (pollerActive) {
      try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=20`;
        const res = await fetch(url, { signal: pollerAbortController.signal });

        if (res.ok) {
          const data = await res.json();
          if (data.ok && Array.isArray(data.result)) {
            for (const update of data.result) {
              lastUpdateId = Math.max(lastUpdateId, update.update_id);
              if (update.message) {
                await handleTelegramMessage(update.message);
              }
            }
          }
        } else if (res.status === 409) {
          // Another instance is polling (e.g. dev server hot reload); wait longer
          log.warn('Telegram conflict (409): another getUpdates instance may be active. Retrying in 15s...');
          await new Promise((r) => setTimeout(r, 15000));
        } else {
          await new Promise((r) => setTimeout(r, 5000));
        }
      } catch (err) {
        if (err.name === 'AbortError') break;
        // Network drop or timeout; sleep 10s and retry quietly
        await new Promise((r) => setTimeout(r, 10000));
      }
    }
  };

  pollLoop().catch((err) => {
    log.error('Telegram poller loop unhandled failure: %s', err.message);
  });
}

function stopTelegramSubscriberService() {
  pollerActive = false;
  if (pollerAbortController) {
    pollerAbortController.abort();
  }
}

/**
 * Verify bot token validity with Telegram API.
 */
async function verifyTelegramBot() {
  if (!BOT_TOKEN) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    if (res.ok) {
      const data = await res.json();
      log.info('🤖 Connected to Telegram Bot: @%s (%s)', data.result?.username, data.result?.first_name);
      return true;
    }
  } catch (_e) {
    // silently ignore offline network
  }
  return false;
}

module.exports = {
  sendTelegramApprovalAlert,
  verifyTelegramBot,
  startTelegramSubscriberService,
  stopTelegramSubscriberService,
  getSubscribers,
};
