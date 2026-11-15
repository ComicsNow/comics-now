const MAX_CLIENTS_PER_USER = 10;
const KEEPALIVE_INTERVAL_MS = 25000;

/** @type {Map<string, Set<{ deviceId: string, res: any, keepaliveTimer: any }>>} */
const clientsByUser = new Map();

function safeWrite(res, chunk) {
  if (!res || res.destroyed || res.writableEnded) return false;
  try {
    res.write(chunk);
    return true;
  } catch {
    return false;
  }
}

function unregisterSyncClient(userId, res) {
  const userClients = clientsByUser.get(userId);
  if (!userClients) return;

  for (const entry of userClients) {
    if (entry.res === res) {
      if (entry.keepaliveTimer) {
        clearInterval(entry.keepaliveTimer);
        entry.keepaliveTimer = null;
      }
      userClients.delete(entry);
      break;
    }
  }

  if (userClients.size === 0) {
    clientsByUser.delete(userId);
  }
}

function registerSyncClient(userId, deviceId, res) {
  if (!userId || !res || res.destroyed || res.writableEnded) return false;

  let userClients = clientsByUser.get(userId);
  if (!userClients) {
    userClients = new Set();
    clientsByUser.set(userId, userClients);
  }

  while (userClients.size >= MAX_CLIENTS_PER_USER) {
    const oldest = userClients.values().next().value;
    if (!oldest) break;
    unregisterSyncClient(userId, oldest.res);
    try {
      if (oldest.res && !oldest.res.writableEnded) {
        oldest.res.end();
      }
    } catch {
      // Ignore socket teardown errors
    }
  }

  if (!safeWrite(res, 'retry: 5000\n\n:ok\n\n')) {
    return false;
  }

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const keepaliveTimer = setInterval(() => {
    if (!safeWrite(res, ': keepalive\n\n')) {
      unregisterSyncClient(userId, res);
    }
  }, KEEPALIVE_INTERVAL_MS);
  if (typeof keepaliveTimer.unref === 'function') {
    keepaliveTimer.unref();
  }

  const entry = { deviceId, res, keepaliveTimer };
  userClients.add(entry);
  return true;
}

function notifySyncUpdate(userId, senderDeviceId, payload) {
  const userClients = clientsByUser.get(userId);
  if (!userClients || userClients.size === 0) return;

  const message = `event: sync-update\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const entry of [...userClients]) {
    if (entry.deviceId && entry.deviceId === senderDeviceId) continue;
    if (!safeWrite(entry.res, message)) {
      unregisterSyncClient(userId, entry.res);
    }
  }
}

function closeAllSyncClients() {
  for (const [userId, userClients] of [...clientsByUser.entries()]) {
    for (const entry of [...userClients]) {
      if (entry.keepaliveTimer) {
        clearInterval(entry.keepaliveTimer);
        entry.keepaliveTimer = null;
      }
      try {
        if (entry.res && !entry.res.writableEnded) {
          entry.res.end();
        }
      } catch {
        // Ignore shutdown errors
      }
    }
    clientsByUser.delete(userId);
  }
}

function getSyncClientCount(userId) {
  if (!userId) {
    let total = 0;
    for (const set of clientsByUser.values()) total += set.size;
    return total;
  }
  return clientsByUser.get(userId)?.size || 0;
}

module.exports = {
  MAX_CLIENTS_PER_USER,
  registerSyncClient,
  unregisterSyncClient,
  notifySyncUpdate,
  closeAllSyncClients,
  getSyncClientCount
};
