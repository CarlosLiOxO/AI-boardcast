function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function normalizeOriginValue(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isOriginMatched(origin, rule) {
  const normalizedOrigin = normalizeOriginValue(origin);
  const normalizedRule = normalizeOriginValue(rule);
  if (!normalizedRule) return false;
  if (normalizedRule === '*') return true;
  if (normalizedRule.startsWith('*.')) {
    const suffix = normalizedRule.slice(1).toLowerCase();
    return normalizedOrigin.toLowerCase().endsWith(suffix);
  }
  return normalizedOrigin.toLowerCase() === normalizedRule.toLowerCase();
}

function isAllowedWsOrigin(req, allowedOrigins = []) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const hostHeader = req.headers.host || '';
    const selfOrigin = normalizeOriginValue(`${originUrl.protocol}//${hostHeader}`);
    const normalizedOrigin = normalizeOriginValue(origin);
    if (normalizedOrigin === selfOrigin || originUrl.host === hostHeader) {
      return true;
    }
    return allowedOrigins.some((rule) => isOriginMatched(origin, rule));
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
