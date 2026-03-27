const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { EVENT, GUEST_GROUPS, buildV3Request, parseV3Response } = require('../protocol/volc');
const { assertPublicHttpUrl } = require('../security/network');
const { fetchUrlMetadataBase, summarizeTitleWithGLM } = require('../services/urlMetadata');

function createPodcastConnectionHandler({ config, wsPolicy }) {
  return function handlePodcastConnection(clientWs, clientIp) {
    let volcWs = null;

    const sendJson = (obj) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(obj));
      }
    };

    clientWs.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type !== 'generate') return;
      if (!wsPolicy.canStartGenerate(clientIp)) {
        sendJson({ type: 'error', text: '请求过于频繁，请稍后再试' });
        return;
      }

      let hasReceivedAudio = false;
      let hasSentDone = false;
      let hasErrored = false;
      let isSessionFinished = false;

      const finishStream = () => {
        if (hasSentDone || hasErrored) return;
        hasSentDone = true;
        sendJson({ type: 'done' });
      };

      const mode = msg.mode === 'url' ? 'url' : 'topic';
      const promptText = typeof msg.promptText === 'string'
        ? msg.promptText.trim()
        : (typeof msg.text === 'string' ? msg.text.trim() : '');
      const url = typeof msg.url === 'string' ? msg.url.trim() : '';
      const guestGroup = GUEST_GROUPS[msg.guestGroup] ? msg.guestGroup : 'classic';

      const buildUserErrorText = (message, statusCode) => {
        const detail = message || '';
        if (mode === 'url') {
          if (detail.includes('invalid param') || detail.includes('input_url')) {
            return '链接解析失败，请确认链接可公开访问且内容可被火山播客接口读取';
          }
          if (detail.includes('content filter')) {
            return '链接内容触发了安全审核，暂时无法生成播客';
          }
          if (detail.includes('content length')) {
            return '链接内容过长，建议更换更短的文章链接后重试';
          }
          return `链接生成失败 ${statusCode || ''}`.trim() + `：${detail || '请确认链接可公开访问后重试'}`;
        }
        return `话题生成失败 ${statusCode}: ${detail || '生成失败'}`;
      };

      if (!config.volc.appId || !config.volc.apiKey) {
        sendJson({ type: 'error', text: '火山引擎凭证未配置，请在 .env 中设置 VOLC_APP_ID 和 VOLC_API_KEY' });
        return;
      }

      if (mode === 'url') {
        try {
          await assertPublicHttpUrl(url);
        } catch (err) {
          sendJson({ type: 'error', text: err.message || '请输入可访问的文章链接' });
          return;
        }
      }

      if (mode === 'topic' && !promptText) {
        sendJson({ type: 'error', text: '请输入你想生成播客的话题' });
        return;
      }

      if (volcWs) {
        try { volcWs.close(); } catch {}
      }

      const connectId = uuidv4();
      sendJson({ type: 'status', text: mode === 'url' ? '正在提交文章链接...' : '正在提交话题...' });

      if (mode === 'url') {
        fetchUrlMetadataBase(url, config.limits).then(async ({ downloadName, blogTitle, pageText }) => {
          sendJson({ type: 'meta', downloadName, blogTitle, titleReady: false });
          const refinedTitle = await summarizeTitleWithGLM(blogTitle, pageText, config.glm);
          if (refinedTitle && refinedTitle !== blogTitle) {
            sendJson({ type: 'meta', downloadName, blogTitle: refinedTitle, titleReady: true });
          }
        });
      }

      volcWs = new WebSocket(config.volc.wsUrl, {
        headers: {
          'X-Api-App-Id': config.volc.appId,
          'X-Api-Access-Key': config.volc.apiKey,
          'X-Api-Resource-Id': config.volc.resourceId,
          'X-Api-App-Key': config.volc.appKey,
          'X-Api-Request-Id': connectId,
        }
      });

      volcWs.on('open', () => {
        sendJson({ type: 'status', text: mode === 'url' ? '已连接，正在解析链接并生成播客（可能需要数十秒）...' : '已连接，正在联网生成话题播客（可能需要数十秒）...' });

        const reqPayload = {
          input_id: connectId,
          action: mode === 'url' ? 0 : 4,
          use_head_music: true,
          use_tail_music: false,
          input_text: undefined,
          input_info: undefined,
          prompt_text: undefined,
          audio_config: {
            format: 'mp3',
            sample_rate: 24000,
            speech_rate: 0,
          },
          speaker_info: {
            random_order: false,
            speakers: GUEST_GROUPS[guestGroup],
          }
        };

        if (mode === 'url') {
          reqPayload.input_info = { input_url: url };
        } else {
          reqPayload.prompt_text = promptText;
        }

        volcWs.send(buildV3Request(EVENT.START_SESSION, connectId, reqPayload));
      });

      volcWs.on('message', (data, isBinary) => {
        if (!isBinary) {
          console.log('[文本消息]', data.toString());
          return;
        }

        const parsed = parseV3Response(data);
        if (!parsed) {
          console.warn('[无法解析的帧], 长度:', data.length);
          return;
        }

        const { msgType, event, serialization, code, payload } = parsed;

        if (msgType === 0xb || event === EVENT.PODCAST_ROUND_RESPONSE) {
          hasReceivedAudio = true;
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(payload, { binary: true });
          }
          return;
        }

        if (serialization !== 1) {
          console.warn('[非JSON控制帧] msgType:', msgType, 'event:', event);
          return;
        }

        let json;
        try {
          json = JSON.parse(payload.toString('utf-8'));
        } catch {
          console.warn('[非JSON帧] msgType:', msgType, 'event:', event, 'payload预览:', payload.slice(0, 64).toString('hex'));
          return;
        }

        if (msgType === 0xf || (json.code !== undefined && json.code !== 0)) {
          console.error('[服务端错误]', json);
          hasErrored = true;
          sendJson({ type: 'error', text: buildUserErrorText(json.message || json.error || JSON.stringify(json), code || json.code) });
          return;
        }

        if (event === EVENT.PODCAST_ROUND_START && json.round_id !== undefined) {
          if (json.round_id >= 0 && json.speaker && json.text) {
            sendJson({
              type: 'transcript',
              roundId: json.round_id,
              speaker: json.speaker,
              text: json.text,
            });
          }
        }

        if (event === EVENT.PODCAST_END) {
          sendJson({ type: 'status', text: '播客内容生成完成，正在收尾音频...' });
          if (hasReceivedAudio) {
            finishStream();
          }
        }

        if (json.data) {
          hasReceivedAudio = true;
          const audioData = Buffer.from(json.data, 'base64');
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(audioData, { binary: true });
          }
        }

        if (event === EVENT.SESSION_FINISHED || event === EVENT.CONNECTION_FINISHED) {
          isSessionFinished = true;
        }

        if (
          isSessionFinished ||
          json.is_last_package ||
          json.is_end ||
          json.finish_reason === 'stop'
        ) {
          finishStream();
        }

        console.log('[控制帧] msgType:', msgType, 'json:', JSON.stringify(json).slice(0, 200));
      });

      volcWs.on('error', (err) => {
        console.error('[火山引擎连接错误]', err.message);
        hasErrored = true;
        sendJson({ type: 'error', text: mode === 'url' ? `链接生成连接错误：${err.message}` : `连接错误: ${err.message}` });
      });

      volcWs.on('close', (code, reason) => {
        console.log(`[火山引擎连接关闭] code=${code} reason=${reason}`);
        if (hasErrored || hasSentDone) return;
        if (isSessionFinished || hasReceivedAudio) {
          finishStream();
          return;
        }
        sendJson({ type: 'error', text: mode === 'url' ? '链接已提交，但上游在返回完整音频前关闭，请确认链接可公开访问' : '上游连接在返回完整音频前关闭' });
      });
    });

    clientWs.on('close', () => {
      if (volcWs) {
        try { volcWs.close(); } catch {}
      }
    });
  };
}

module.exports = { createPodcastConnectionHandler };
