const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const runtimeConfigPath = path.join(publicDir, 'runtime-config.js');
const wsBaseUrl = process.env.PUBLIC_WS_BASE_URL || '';

const content = `window.__APP_CONFIG__ = ${JSON.stringify({ WS_BASE_URL: wsBaseUrl }, null, 2)};\n`;
fs.writeFileSync(runtimeConfigPath, content, 'utf-8');
console.log(`Generated runtime config: ${runtimeConfigPath}`);
