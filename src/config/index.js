const CONFIG = {
  volc: {
    appId: process.env.VOLC_APP_ID || '',
    apiKey: process.env.VOLC_API_KEY || '',
    appKey: process.env.VOLC_APP_KEY || '',
    resourceId: process.env.RESOURCE_ID || 'volc.service_type.10050',
    wsUrl: process.env.VOLC_WS_URL || '',
  },
  glm: {
    apiKey: process.env.GLM_API_KEY || '',
    model: process.env.GLM_MODEL || 'glm-4.7',
    titleModel: process.env.GLM_TITLE_MODEL || 'glm-4-flash',
  },
  limits: {
    maxHtmlFetchBytes: 1024 * 1024 * 2,
    maxUrlRedirects: 5,
    wsMaxConnectionsPerIp: 3,
    wsMaxGeneratesPerMinute: 5,
    wsAudioIdleCloseMs: Number(process.env.WS_AUDIO_IDLE_CLOSE_MS || 3000),
    wsMaxAudioStreamMs: Number(process.env.WS_MAX_AUDIO_STREAM_MS || 105000),
  },
  security: {
    wsAllowedOrigins: (process.env.WS_ALLOWED_ORIGINS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  },
};

module.exports = { CONFIG };
