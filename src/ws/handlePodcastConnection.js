const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { EVENT, GUEST_GROUPS, buildV3Request, parseV3Response } = require('../protocol/volc');
const { assertPublicHttpUrl } = require('../security/network');
const { fetchUrlMetadataBase, summarizeTitleWithGLM } = require('../services/urlMetadata');

function createPodcastConnectionHandler({ config, wsPolicy, liveAudioStreams }) {
  return function handlePodcastConnection(clientWs, clientIp) {
    let volcWs = null;
    let delayedUpstreamCloseTimer = null;

    const sendJson = (obj) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(obj));
      }
    };

    const clearDelayedUpstreamClose = () => {
      if (!delayedUpstreamCloseTimer) return;
      clearTimeout(delayedUpstreamCloseTimer);
      delayedUpstreamCloseTimer = null;
    };

    clientWs.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type !== 'generate') return;
      const requestedStreamId = typeof msg.streamId === 'string' && msg.streamId
        ? msg.streamId.replace(/[^\w-]/g, '').slice(0, 80)
        : '';
      if (!wsPolicy.canStartGenerate(clientIp)) {
        if (requestedStreamId) {
          liveAudioStreams.ensureSession(requestedStreamId);
          liveAudioStreams.abort(requestedStreamId);
        }
        sendJson({ type: 'error', text: '请求过于频繁，请稍后再试' });
        return;
      }

      let hasReceivedAudio = false;
      let hasSentDone = false;
      let hasErrored = false;
      let isSessionFinished = false;
      let hasSeenTerminalSignal = false;
      let lastControlFrames = [];
      let progressHeartbeatTimer = null;
      let audioSilenceTimer = null;
      let hardStopTimer = null;

      const pushControlFrameLog = (frame) => {
        lastControlFrames.push(frame);
        if (lastControlFrames.length > 8) {
          lastControlFrames = lastControlFrames.slice(-8);
        }
      };

      const stopProgressHeartbeat = () => {
        if (!progressHeartbeatTimer) return;
        clearInterval(progressHeartbeatTimer);
        progressHeartbeatTimer = null;
      };

      const stopAudioSilenceTimer = () => {
        if (!audioSilenceTimer) return;
        clearTimeout(audioSilenceTimer);
        audioSilenceTimer = null;
      };

      const stopHardStopTimer = () => {
        if (!hardStopTimer) return;
        clearTimeout(hardStopTimer);
        hardStopTimer = null;
      };

      const closeUpstream = () => {
        if (!volcWs || volcWs.readyState >= WebSocket.CLOSING) return;
        try {
          volcWs.close();
        } catch {}
      };

      const scheduleAudioSilenceTimeout = () => {
        stopAudioSilenceTimer();
        if (!hasReceivedAudio || hasSentDone || hasErrored) return;
        audioSilenceTimer = setTimeout(() => {
          if (hasSentDone || hasErrored || !hasReceivedAudio) return;
          hasSeenTerminalSignal = true;
          sendJson({ type: 'status', text: '音频流暂时停止，正在自动完成收尾...' });
          finishStream();
          closeUpstream();
        }, config.limits.wsAudioIdleCloseMs);
      };

      const scheduleHardStopTimeout = () => {
        if (hardStopTimer || hasSentDone || hasErrored) return;
        hardStopTimer = setTimeout(() => {
          if (hasSentDone || hasErrored) return;
          if (hasReceivedAudio) {
            hasSeenTerminalSignal = true;
            sendJson({ type: 'status', text: '已达到单次最长音频时长，正在使用当前已生成内容完成收尾...' });
            finishStream();
            closeUpstream();
            return;
          }
          hasErrored = true;
          sendJson({ type: 'error', text: '生成等待时间过长且未收到音频，请稍后重试' });
          closeUpstream();
        }, config.limits.wsMaxAudioStreamMs);
      };

      const startProgressHeartbeat = () => {
        stopProgressHeartbeat();
        progressHeartbeatTimer = setInterval(() => {
          if (hasSentDone || hasErrored) {
            stopProgressHeartbeat();
            return;
          }
          sendJson({
            type: 'status',
            text: mode === 'url'
              ? '正在持续生成中，请保持页面打开...'
              : '正在持续生成话题播客，请稍候...',
          });
        }, 10000);
      };

      const finishStream = () => {
        if (hasSentDone || hasErrored) return;
        hasSentDone = true;
        stopProgressHeartbeat();
        stopAudioSilenceTimer();
        stopHardStopTimer();
        if (streamId) {
          liveAudioStreams.finish(streamId);
        }
        sendJson({ type: 'done' });
      };

      const mode = msg.mode === 'url' ? 'url' : 'topic';
      const promptText = typeof msg.promptText === 'string'
        ? msg.promptText.trim()
        : (typeof msg.text === 'string' ? msg.text.trim() : '');
      const url = typeof msg.url === 'string' ? msg.url.trim() : '';
      const guestGroup = GUEST_GROUPS[msg.guestGroup] ? msg.guestGroup : 'classic';
      const streamId = requestedStreamId;

      if (streamId) {
        liveAudioStreams.ensureSession(streamId);
      }

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

      const buildVolcConnectErrorText = (message) => {
        const detail = String(message || '');
        if (detail.includes('401')) {
          return '连接火山引擎失败：鉴权未通过（401），请检查 VOLC_APP_ID / VOLC_API_KEY / VOLC_APP_KEY / VOLC_WS_URL';
        }
        if (detail.includes('403')) {
          return '连接火山引擎失败：无权限访问（403），请检查资源权限与账户配置';
        }
        return mode === 'url' ? `链接生成连接错误：${detail}` : `连接错误: ${detail}`;
      };

      if (!config.volc.appId || !config.volc.apiKey) {
        if (streamId) {
          liveAudioStreams.abort(streamId);
        }
        sendJson({ type: 'error', text: '火山引擎凭证未配置，请在 .env 中设置 VOLC_APP_ID 和 VOLC_API_KEY' });
        return;
      }

      if (mode === 'url') {
        try {
          await assertPublicHttpUrl(url);
        } catch (err) {
          if (streamId) {
            liveAudioStreams.abort(streamId);
          }
          sendJson({ type: 'error', text: err.message || '请输入可访问的文章链接' });
          return;
        }
      }

      if (mode === 'topic' && !promptText) {
        if (streamId) {
          liveAudioStreams.abort(streamId);
        }
        sendJson({ type: 'error', text: '请输入你想生成播客的话题' });
        return;
      }

      if (volcWs) {
        try { volcWs.close(); } catch {}
      }

      const connectId = uuidv4();
      sendJson({ type: 'status', text: mode === 'url' ? '正在提交文章链接...' : '正在提交话题...' });
      startProgressHeartbeat();

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
          use_head_music: false,
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
          scheduleHardStopTimeout();
          scheduleAudioSilenceTimeout();
          if (streamId) {
            liveAudioStreams.appendChunk(streamId, Buffer.from(payload));
          }
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
          if (streamId) {
            liveAudioStreams.abort(streamId);
          }
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

        if (json.data) {
          hasReceivedAudio = true;
          scheduleHardStopTimeout();
          scheduleAudioSilenceTimeout();
          const audioData = Buffer.from(json.data, 'base64');
          if (streamId) {
            liveAudioStreams.appendChunk(streamId, audioData);
          }
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(audioData, { binary: true });
          }
        }

        if (event === EVENT.PODCAST_END) {
          hasSeenTerminalSignal = true;
          sendJson({ type: 'status', text: '播客内容生成完成，正在收尾音频...' });
        }

        if (event === EVENT.SESSION_FINISHED || event === EVENT.CONNECTION_FINISHED) {
          isSessionFinished = true;
          hasSeenTerminalSignal = true;
        }

        if (
          event === EVENT.PODCAST_END ||
          isSessionFinished ||
          json.is_last_package ||
          json.is_end ||
          json.finish_reason === 'stop'
        ) {
          hasSeenTerminalSignal = true;
          finishStream();
        }

        pushControlFrameLog({
          msgType,
          event,
          is_last_package: Boolean(json.is_last_package),
          is_end: Boolean(json.is_end),
          finish_reason: json.finish_reason || null,
          hasData: Boolean(json.data),
          round_id: json.round_id ?? null,
        });
        console.log('[控制帧] msgType:', msgType, 'json:', JSON.stringify(json).slice(0, 200));
      });

      volcWs.on('error', (err) => {
        console.error('[火山引擎连接错误]', err.message);
        hasErrored = true;
        stopProgressHeartbeat();
        stopAudioSilenceTimer();
        stopHardStopTimer();
        if (streamId) {
          liveAudioStreams.abort(streamId);
        }
        sendJson({ type: 'error', text: buildVolcConnectErrorText(err.message) });
      });

      volcWs.on('unexpected-response', (_request, response) => {
        hasErrored = true;
        stopProgressHeartbeat();
        stopAudioSilenceTimer();
        stopHardStopTimer();
        const code = response?.statusCode;
        const codeHint = code ? `HTTP ${code}` : '上游返回异常';
        console.error('[火山引擎握手异常]', codeHint);
        if (streamId) {
          liveAudioStreams.abort(streamId);
        }
        sendJson({ type: 'error', text: buildVolcConnectErrorText(`Unexpected server response: ${code || ''}`) });
      });

      volcWs.on('close', (code, reason) => {
        console.log(`[火山引擎连接关闭] code=${code} reason=${reason}`);
        console.log('[结束帧回顾]', JSON.stringify(lastControlFrames));
        clearDelayedUpstreamClose();
        stopProgressHeartbeat();
        stopAudioSilenceTimer();
        stopHardStopTimer();
        if (hasErrored || hasSentDone) return;
        if (isSessionFinished || hasSeenTerminalSignal) {
          finishStream();
          return;
        }
        if (hasReceivedAudio && code === 1005) {
          sendJson({ type: 'status', text: '上游未返回标准结束帧，已按当前音频内容完成收尾...' });
          finishStream();
          return;
        }
        if (hasReceivedAudio && code === 1000) {
          sendJson({ type: 'status', text: '音频流已结束，正在完成收尾...' });
          finishStream();
          return;
        }
        if (code === 1005 && lastControlFrames.some((frame) => frame.event === EVENT.PODCAST_ROUND_START || frame.round_id !== null)) {
          sendJson({ type: 'error', text: mode === 'url' ? '上游在正文生成阶段异常关闭（1005），已先关闭片头音乐以规避该问题，请重试' : '上游在正文生成阶段异常关闭（1005），已先关闭片头音乐以规避该问题，请重试' });
          return;
        }
        if (hasReceivedAudio) {
          sendJson({ type: 'error', text: mode === 'url' ? '链接音频生成中断，已收到部分音频但未完整收尾，请重试' : '播客音频生成中断，已收到部分音频但未完整收尾，请重试' });
          return;
        }
        sendJson({ type: 'error', text: mode === 'url' ? '链接已提交，但上游在返回完整音频前关闭，请确认链接可公开访问' : '上游连接在返回完整音频前关闭' });
        if (streamId) {
          liveAudioStreams.abort(streamId);
        }
      });
    });

    clientWs.on('close', (code, reason) => {
      console.log(`[客户端连接关闭] code=${code} reason=${reason} upstreamReadyState=${volcWs ? volcWs.readyState : 'none'}`);
      clearDelayedUpstreamClose();
      if (!volcWs || volcWs.readyState >= WebSocket.CLOSING) {
        return;
      }
      delayedUpstreamCloseTimer = setTimeout(() => {
        if (!volcWs || volcWs.readyState >= WebSocket.CLOSING) {
          return;
        }
        console.log('[延迟关闭上游连接] client closed earlier, closing volcWs now');
        try { volcWs.close(); } catch {}
      }, 2500);
    });
  };
}

module.exports = { createPodcastConnectionHandler };
