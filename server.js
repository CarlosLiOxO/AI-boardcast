const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { loadEnv } = require('./src/config/loadEnv');
const { applySecurityHeaders } = require('./src/security/httpHeaders');
const { createWsPolicy, getClientIp, isAllowedWsOrigin } = require('./src/security/wsPolicy');
const { createPodcastConnectionHandler } = require('./src/ws/handlePodcastConnection');

loadEnv(__dirname);
const { CONFIG } = require('./src/config');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });
const wsPolicy = createWsPolicy({
  maxConnectionsPerIp: CONFIG.limits.wsMaxConnectionsPerIp,
  maxGeneratesPerMinute: CONFIG.limits.wsMaxGeneratesPerMinute,
});
const handlePodcastConnection = createPodcastConnectionHandler({ config: CONFIG, wsPolicy });

applySecurityHeaders(app);
app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (clientWs, req) => {
  const clientIp = getClientIp(req);
  if (!isAllowedWsOrigin(req, CONFIG.security.wsAllowedOrigins)) {
    clientWs.close(1008, 'Origin not allowed');
    return;
  }
  if (wsPolicy.addConnection(clientIp) > wsPolicy.maxConnectionsPerIp) {
    wsPolicy.removeConnection(clientIp);
    clientWs.close(1008, 'Too many connections');
    return;
  }

  const keepAliveTimer = setInterval(() => {
    if (clientWs.readyState !== WebSocket.OPEN) return;
    try {
      clientWs.ping();
    } catch {}
  }, 15000);

  handlePodcastConnection(clientWs, clientIp);
  clientWs.on('close', () => {
    clearInterval(keepAliveTimer);
    wsPolicy.removeConnection(clientIp);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎙️  AI 博客播客 Demo`);
  console.log(`📌  http://localhost:${PORT}\n`);
  if (!CONFIG.volc.appId || !CONFIG.volc.apiKey) {
    console.warn('⚠️  引擎凭证未配置，请在 .env 中设置 VOLC_APP_ID 和 VOLC_API_KEY');
  }
  if (!CONFIG.volc.appKey) {
    console.warn('⚠️  VOLC_APP_KEY 未配置，当前请求可能无法通过引擎鉴权');
  }
  if (!process.env.RESOURCE_ID) {
    console.warn('⚠️  RESOURCE_ID 未配置，当前使用默认值 volc.service_type.10050');
  }
  if (CONFIG.security.wsAllowedOrigins.length > 0) {
    console.log(`🔐 WS 允许跨域来源: ${CONFIG.security.wsAllowedOrigins.join(', ')}`);
  }
});
