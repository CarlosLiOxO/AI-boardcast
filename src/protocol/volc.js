const zlib = require('zlib');

const EVENT = {
  START_SESSION: 100,
  CONNECTION_FINISHED: 52,
  SESSION_FINISHED: 152,
  USAGE_RESPONSE: 154,
  PODCAST_ROUND_START: 360,
  PODCAST_ROUND_RESPONSE: 361,
  PODCAST_ROUND_END: 362,
  PODCAST_END: 363,
};

const GUEST_GROUPS = {
  classic: [
    'zh_female_mizaitongxue_v2_saturn_bigtts',
    'zh_male_dayixiansheng_v2_saturn_bigtts',
  ],
  liufei: [
    'zh_male_liufei_v2_saturn_bigtts',
    'zh_male_xiaolei_v2_saturn_bigtts',
  ],
};

function buildV3Request(event, sessionId, payload) {
  const sessionIdBuffer = Buffer.from(sessionId, 'utf-8');
  const payloadBuffer = Buffer.from(JSON.stringify(payload), 'utf-8');
  const header = Buffer.from([0x11, 0x14, 0x10, 0x00]);
  const eventBuffer = Buffer.allocUnsafe(4);
  const sessionIdSizeBuffer = Buffer.allocUnsafe(4);
  const payloadSizeBuffer = Buffer.allocUnsafe(4);
  eventBuffer.writeUInt32BE(event, 0);
  sessionIdSizeBuffer.writeUInt32BE(sessionIdBuffer.length, 0);
  payloadSizeBuffer.writeUInt32BE(payloadBuffer.length, 0);
  return Buffer.concat([
    header,
    eventBuffer,
    sessionIdSizeBuffer,
    sessionIdBuffer,
    payloadSizeBuffer,
    payloadBuffer,
  ]);
}

function parseV3Response(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 4) return null;

  const headerLen = (buf[0] & 0x0f) * 4;
  const msgType = (buf[1] & 0xf0) >> 4;
  const flags = buf[1] & 0x0f;
  const serialization = (buf[2] & 0xf0) >> 4;
  const compression = buf[2] & 0x0f;
  let offset = headerLen;
  let event = null;
  let payloadSize = 0;
  let sessionId = null;
  let code = null;

  if (msgType === 0xf) {
    if (buf.length < offset + 8) return null;
    code = buf.readUInt32BE(offset);
    offset += 4;
    payloadSize = buf.readUInt32BE(offset);
    offset += 4;
  } else if ((flags & 0x04) !== 0) {
    if (buf.length < offset + 8) return null;
    event = buf.readUInt32BE(offset);
    offset += 4;
    const sessionIdSize = buf.readUInt32BE(offset);
    offset += 4;
    if (buf.length < offset + sessionIdSize + 4) return null;
    sessionId = buf.slice(offset, offset + sessionIdSize).toString('utf-8');
    offset += sessionIdSize;
    payloadSize = buf.readUInt32BE(offset);
    offset += 4;
  } else {
    if (buf.length < offset + 4) return null;
    payloadSize = buf.readUInt32BE(offset);
    offset += 4;
  }

  if (buf.length < offset + payloadSize) return null;

  let payload = buf.slice(offset, offset + payloadSize);
  if (compression === 1) {
    try {
      payload = zlib.gunzipSync(payload);
    } catch (e) {
      console.warn('[解压失败]', e.message);
    }
  }

  return { msgType, flags, serialization, compression, event, sessionId, code, payload };
}

module.exports = { EVENT, GUEST_GROUPS, buildV3Request, parseV3Response };
