function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function isAllowedWsOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const hostHeader = req.headers.host || '';
    return originUrl.host === hostHeader;
  } catch {
    return false;
  }
}

function createWsPolicy({ maxConnectionsPerIp, maxGeneratesPerMinute }) {
  const requestHistoryByIp = new Map();
  const activeConnectionsByIp = new Map();

  return {
    addConnection(ip) {
      const count = activeConnectionsByIp.get(ip) || 0;
      activeConnectionsByIp.set(ip, count + 1);
      return count + 1;
    },
    removeConnection(ip) {
      const count = activeConnectionsByIp.get(ip) || 0;
      if (count <= 1) {
        activeConnectionsByIp.delete(ip);
        return;
      }
      activeConnectionsByIp.set(ip, count - 1);
    },
    canStartGenerate(ip) {
      const now = Date.now();
      const recent = (requestHistoryByIp.get(ip) || []).filter((time) => now - time < 60_000);
      if (recent.length >= maxGeneratesPerMinute) {
        requestHistoryByIp.set(ip, recent);
        return false;
      }
      recent.push(now);
      requestHistoryByIp.set(ip, recent);
      return true;
    },
    maxConnectionsPerIp,
  };
}

module.exports = { createWsPolicy, getClientIp, isAllowedWsOrigin };
