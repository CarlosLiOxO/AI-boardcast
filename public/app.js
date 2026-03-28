(() => {
  const refs = {
    guestGroupClassicBtn: document.getElementById('guestGroupClassic'),
    guestGroupLiufeiBtn: document.getElementById('guestGroupLiufei'),
    contentEl: document.getElementById('content'),
    generateBtn: document.getElementById('generateBtn'),
    btnIcon: document.getElementById('btnIcon'),
    transcriptSection: document.querySelector('.transcript-section'),
    transcriptList: document.getElementById('transcriptList'),
    transcriptEmpty: document.getElementById('transcriptEmpty'),
    playerSection: document.getElementById('playerSection'),
    playerTopic: document.getElementById('playerTopic'),
    audioPlayer: document.getElementById('audioPlayer'),
    downloadBtn: document.getElementById('downloadBtn'),
    toastEl: document.getElementById('toast'),
  };

  const state = {
    ws: null,
    audioChunks: [],
    audioBlob: null,
    generating: false,
    hasCompleted: false,
    hasReceivedAudio: false,
    mediaSource: null,
    sourceBuffer: null,
    streamQueue: [],
    isStreamReady: false,
    isStreamClosed: false,
    objectUrl: null,
    inputMode: 'url',
    downloadFileName: '',
    generationTopic: '',
    shouldStickTranscriptToBottom: true,
    selectedGuestGroup: 'classic',
    userPausedPlayback: false,
    programmaticPause: false,
    isUrlTitleResolved: false,
    pendingTranscriptItems: [],
    pendingAudioChunks: [],
    toastTimer: null,
    placeholderTimer: null,
    wsCloseTimer: null,
    wsPingTimer: null,
    nonStreamLastRefreshMs: 0,
    activeStreamId: '',
    useHttpStreamMode: false,
    currentPlaceholderIndex: 0,
  };

  const desktopPlaceholders = [
    '粘贴网页链接，例如 https://example.com/article',
    '输入一句话话题，例如：AI 如何帮助独立开发者提升效率？',
    '也可以输入一个观点，例如：为什么好产品都在拼情绪价值？',
    '或者直接给一个方向，例如：聊聊 Agent 和工作流的差别',
  ];

  const mobilePlaceholders = [
    '粘贴网页链接',
    '输入一句话话题',
    '例如：AI 如何提效？',
    '例如：聊聊 Agent',
  ];

  const guestGroups = {
    classic: {
      speakers: [
        'zh_female_mizaitongxue_v2_saturn_bigtts',
        'zh_male_dayixiansheng_v2_saturn_bigtts',
      ],
      map: {
        zh_female_mizaitongxue_v2_saturn_bigtts: { name: '咪仔', role: 'female' },
        zh_male_dayixiansheng_v2_saturn_bigtts: { name: '大壹', role: 'male' },
      }
    },
    liufei: {
      speakers: [
        'zh_male_liufei_v2_saturn_bigtts',
        'zh_male_xiaolei_v2_saturn_bigtts',
      ],
      map: {
        zh_male_liufei_v2_saturn_bigtts: { name: '刘飞', role: 'female' },
        zh_male_xiaolei_v2_saturn_bigtts: { name: '潇磊', role: 'male' },
      }
    }
  };

  refs.transcriptList.addEventListener('scroll', () => {
    const distanceToBottom = refs.transcriptList.scrollHeight - refs.transcriptList.scrollTop - refs.transcriptList.clientHeight;
    state.shouldStickTranscriptToBottom = distanceToBottom < 24;
  });

  refs.audioPlayer.addEventListener('pause', () => {
    if (state.programmaticPause) return;
    if (state.generating || (!state.hasCompleted && state.hasReceivedAudio)) {
      state.userPausedPlayback = true;
    }
  });

  refs.audioPlayer.addEventListener('play', () => {
    state.userPausedPlayback = false;
  });

  refs.transcriptSection.addEventListener('animationend', () => {
    refs.transcriptSection.classList.remove('animate-in');
  });

  function scrollTranscriptToBottom(force = false) {
    if (!force && !state.shouldStickTranscriptToBottom) {
      return;
    }
    refs.transcriptList.scrollTop = refs.transcriptList.scrollHeight;
  }

  function setTranscriptEmpty(text) {
    refs.transcriptEmpty.textContent = text;
    refs.transcriptEmpty.style.display = 'flex';
  }

  function setBlogTitle(title) {
    refs.playerTopic.textContent = title ? `主题：${title}` : '';
  }

  function showToast(text) {
    refs.toastEl.textContent = text;
    refs.toastEl.className = 'toast visible';
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      refs.toastEl.className = 'toast';
    }, 1800);
  }

  function setDownloadButtonState(isReady, titleText) {
    refs.downloadBtn.className = `btn-download${isReady ? '' : ' is-disabled'}`;
    refs.downloadBtn.setAttribute('aria-disabled', isReady ? 'false' : 'true');
    refs.downloadBtn.dataset.ready = isReady ? 'true' : 'false';
    refs.downloadBtn.dataset.toast = titleText || '完整生成完成后可下载';
  }

  function showTranscriptSection() {
    if (refs.transcriptSection.classList.contains('visible')) {
      return;
    }
    refs.transcriptSection.className = 'transcript-section visible animate-in';
  }

  function hideTranscriptSection() {
    refs.transcriptSection.className = 'transcript-section';
  }

  function getSpeakerPresentation(rawSpeaker) {
    return guestGroups[state.selectedGuestGroup]?.map?.[rawSpeaker] || { name: '播客嘉宾', role: 'system' };
  }

  function showValidationError(text) {
    resetTranscript();
    appendTranscriptItem({ speaker: '系统', text, type: 'error' });
  }

  function appendTranscriptItem({ speaker, text, type = 'dialogue' }) {
    if (state.inputMode === 'url' && !state.isUrlTitleResolved) {
      state.pendingTranscriptItems.push({ speaker, text, type });
      return;
    }
    showTranscriptSection();
    refs.transcriptEmpty.style.display = 'none';
    refs.transcriptList.querySelectorAll('.transcript-item.latest').forEach((el) => el.classList.remove('latest'));
    const item = document.createElement('div');
    const presentation = type === 'dialogue'
      ? getSpeakerPresentation(speaker)
      : { name: speaker, role: type === 'error' ? 'error system' : 'system' };
    item.className = `transcript-item ${presentation.role} latest`.trim();
    const speakerEl = document.createElement('div');
    speakerEl.className = 'transcript-speaker';
    if (type === 'dialogue') {
      const dotEl = document.createElement('span');
      dotEl.className = 'speaker-dot';
      speakerEl.appendChild(dotEl);
    }
    speakerEl.appendChild(document.createTextNode(presentation.name));
    const textEl = document.createElement('div');
    textEl.className = 'transcript-text';
    textEl.textContent = text;
    item.appendChild(speakerEl);
    item.appendChild(textEl);
    refs.transcriptList.appendChild(item);
    scrollTranscriptToBottom();
  }

  function setGenerating(val) {
    state.generating = val;
    refs.generateBtn.disabled = val;
    refs.btnIcon.textContent = val ? '⏳' : '▶';
  }

  function setGuestGroup(groupKey) {
    state.selectedGuestGroup = guestGroups[groupKey] ? groupKey : 'classic';
    refs.guestGroupClassicBtn.className = 'guest-card' + (state.selectedGuestGroup === 'classic' ? ' active' : '');
    refs.guestGroupLiufeiBtn.className = 'guest-card' + (state.selectedGuestGroup === 'liufei' ? ' active' : '');
  }

  function isValidUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function normalizeUrlInput(value) {
    const trimmed = value.trim();
    if (isValidUrl(trimmed)) {
      return trimmed;
    }
    if (/^(www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(trimmed)) {
      return `https://${trimmed.replace(/^https?:\/\//, '')}`;
    }
    return '';
  }

  function getRotatingPlaceholders() {
    return window.innerWidth <= 640 ? mobilePlaceholders : desktopPlaceholders;
  }

  function resolveWsEndpoint() {
    const isLocalPage = ['localhost', '127.0.0.1'].includes(location.hostname);
    const isRailwayPage = location.hostname.endsWith('.up.railway.app');
    if (isLocalPage || isRailwayPage) {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${location.host}/ws`;
    }

    const configuredBase = (window.__APP_CONFIG__?.WS_BASE_URL || '').trim();
    if (!configuredBase) {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${location.host}/ws`;
    }

    if (configuredBase.startsWith('ws://') || configuredBase.startsWith('wss://')) {
      const normalized = configuredBase.replace(/\/$/, '');
      return normalized.endsWith('/ws') ? normalized : `${normalized}/ws`;
    }

    if (configuredBase.startsWith('http://') || configuredBase.startsWith('https://')) {
      const parsed = new URL(configuredBase);
      const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      const pathname = parsed.pathname.replace(/\/$/, '');
      const wsPath = pathname.endsWith('/ws') ? pathname : `${pathname}/ws`;
      return `${wsProtocol}//${parsed.host}${wsPath}`;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/ws`;
  }

  function resolveHttpStreamBase() {
    const wsEndpoint = resolveWsEndpoint();
    const parsed = new URL(wsEndpoint, location.href);
    parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  }

  function shouldUseHttpStreamMode() {
    const ua = navigator.userAgent || '';
    const isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
    return isIOS && isSafari;
  }

  function createStreamId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
    return `stream-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function startPlaceholderRotation() {
    const applyPlaceholder = () => {
      const placeholders = getRotatingPlaceholders();
      state.currentPlaceholderIndex %= placeholders.length;
      if (document.activeElement !== refs.contentEl && !refs.contentEl.value.trim()) {
        refs.contentEl.placeholder = placeholders[state.currentPlaceholderIndex];
      }
      state.currentPlaceholderIndex = (state.currentPlaceholderIndex + 1) % placeholders.length;
    };
    applyPlaceholder();
    clearInterval(state.placeholderTimer);
    state.placeholderTimer = setInterval(applyPlaceholder, 1500);
  }

  function resetAudioState() {
    clearTimeout(state.wsCloseTimer);
    state.wsCloseTimer = null;
    clearInterval(state.wsPingTimer);
    state.wsPingTimer = null;
    state.audioChunks = [];
    state.audioBlob = null;
    state.downloadFileName = '';
    state.hasCompleted = false;
    state.hasReceivedAudio = false;
    state.streamQueue = [];
    state.isStreamReady = false;
    state.isStreamClosed = false;
    state.sourceBuffer = null;
    state.mediaSource = null;
    state.userPausedPlayback = false;
    state.pendingAudioChunks = [];
    state.nonStreamLastRefreshMs = 0;
    state.activeStreamId = '';
    state.useHttpStreamMode = false;
    if (refs.audioPlayer.src) {
      state.programmaticPause = true;
      refs.audioPlayer.pause();
      state.programmaticPause = false;
      refs.audioPlayer.removeAttribute('src');
      refs.audioPlayer.load();
    }
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = null;
    }
  }

  function resetTranscript() {
    hideTranscriptSection();
    refs.transcriptList.innerHTML = '';
    refs.transcriptList.appendChild(refs.transcriptEmpty);
    state.shouldStickTranscriptToBottom = true;
    state.pendingTranscriptItems = [];
    setTranscriptEmpty('生成后会在这里实时展示对话人和他们说的话');
  }

  function canStreamPlay() {
    return 'MediaSource' in window && MediaSource.isTypeSupported('audio/mpeg');
  }

  function swapAudioSourcePreserveProgress(nextObjectUrl) {
    const previousTime = Number.isFinite(refs.audioPlayer.currentTime) ? refs.audioPlayer.currentTime : 0;
    const wasPlaying = !refs.audioPlayer.paused;
    refs.audioPlayer.src = nextObjectUrl;
    let restored = false;
    const restorePlayback = () => {
      if (restored) return;
      restored = true;
      if (previousTime > 0) {
        const duration = Number.isFinite(refs.audioPlayer.duration) ? refs.audioPlayer.duration : previousTime;
        const safeTime = Math.max(0, Math.min(previousTime, Math.max(0, duration - 0.15)));
        try { refs.audioPlayer.currentTime = safeTime; } catch {}
      }
      if (!state.userPausedPlayback || wasPlaying) {
        refs.audioPlayer.play().catch(() => {});
      }
    };
    refs.audioPlayer.addEventListener('loadedmetadata', restorePlayback, { once: true });
    refs.audioPlayer.addEventListener('canplay', restorePlayback, { once: true });
  }

  function refreshNonStreamingPlayer(force = false) {
    if (state.useHttpStreamMode) return;
    if (state.audioChunks.length === 0) return;
    const now = Date.now();
    if (!force && now - state.nonStreamLastRefreshMs < 1200) return;
    state.nonStreamLastRefreshMs = now;
    buildAudioBlob();
    const previousObjectUrl = state.objectUrl;
    state.objectUrl = URL.createObjectURL(state.audioBlob);
    swapAudioSourcePreserveProgress(state.objectUrl);
    if (previousObjectUrl) {
      URL.revokeObjectURL(previousObjectUrl);
    }
    refs.playerSection.className = 'player-section visible';
  }

  function flushStreamQueue() {
    if (!state.sourceBuffer || !state.isStreamReady || state.sourceBuffer.updating || state.streamQueue.length === 0) {
      return;
    }
    state.sourceBuffer.appendBuffer(state.streamQueue.shift());
  }

  function finalizeStreamPlayback() {
    if (!state.mediaSource || state.mediaSource.readyState !== 'open' || state.sourceBuffer?.updating || state.streamQueue.length > 0 || state.isStreamClosed) {
      return;
    }
    state.isStreamClosed = true;
    state.mediaSource.endOfStream();
  }

  function ensureStreamingPlayer() {
    if (!canStreamPlay() || state.mediaSource) {
      return;
    }
    state.mediaSource = new MediaSource();
    state.objectUrl = URL.createObjectURL(state.mediaSource);
    refs.audioPlayer.src = state.objectUrl;
    refs.playerSection.className = 'player-section visible';
    state.mediaSource.addEventListener('sourceopen', () => {
      state.sourceBuffer = state.mediaSource.addSourceBuffer('audio/mpeg');
      state.sourceBuffer.mode = 'sequence';
      state.isStreamReady = true;
      state.sourceBuffer.addEventListener('updateend', () => {
        flushStreamQueue();
        if (state.hasCompleted) {
          finalizeStreamPlayback();
        }
      });
      flushStreamQueue();
      if (!state.userPausedPlayback) {
        refs.audioPlayer.play().catch(() => {});
      }
    }, { once: true });
  }

  function appendAudioChunk(chunk) {
    state.audioChunks.push(chunk);
    state.hasReceivedAudio = true;
    if (state.inputMode === 'url' && !state.isUrlTitleResolved) {
      state.isUrlTitleResolved = true;
      state.generationTopic = state.generationTopic || state.downloadFileName || '链接播客';
      setBlogTitle(state.generationTopic);
      flushPendingContentAfterTitleResolved();
    }
    if (state.useHttpStreamMode) {
      refs.playerSection.className = 'player-section visible';
      return;
    }
    state.streamQueue.push(chunk);
    if (!canStreamPlay()) {
      refreshNonStreamingPlayer();
      return;
    }
    ensureStreamingPlayer();
    if (!state.sourceBuffer) {
      return;
    }
    flushStreamQueue();
    if (!state.userPausedPlayback && refs.audioPlayer.paused) {
      refs.audioPlayer.play().catch(() => {});
    }
  }

  function buildAudioBlob() {
    const totalLen = state.audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of state.audioChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    state.audioBlob = new Blob([merged], { type: 'audio/mpeg' });
  }

  function flushPendingContentAfterTitleResolved() {
    const bufferedTranscriptItems = state.pendingTranscriptItems.slice();
    const bufferedAudioChunks = state.pendingAudioChunks.slice();
    state.pendingTranscriptItems = [];
    state.pendingAudioChunks = [];
    bufferedTranscriptItems.forEach((item) => appendTranscriptItem(item));
    state.streamQueue.push(...bufferedAudioChunks);
    ensureStreamingPlayer();
    flushStreamQueue();
    if (!state.userPausedPlayback && refs.audioPlayer.paused) {
      refs.audioPlayer.play().catch(() => {});
    }
  }

  function onGenerateDone() {
    state.hasCompleted = true;
    setGenerating(false);

    if (state.inputMode === 'url' && !state.isUrlTitleResolved && state.hasReceivedAudio && state.audioChunks.length > 0) {
      state.isUrlTitleResolved = true;
      state.generationTopic = state.generationTopic || state.downloadFileName || '链接播客';
      setBlogTitle(state.generationTopic);
      flushPendingContentAfterTitleResolved();
    }

    if (!state.hasReceivedAudio || state.audioChunks.length === 0) {
      appendTranscriptItem({ speaker: '系统', text: '未收到音频数据，请检查接口配置或输入内容', type: 'error' });
      return;
    }

    buildAudioBlob();
    state.nonStreamLastRefreshMs = Date.now();
    setBlogTitle(state.generationTopic || '本次播客');
    refs.playerSection.className = 'player-section visible';
    setDownloadButtonState(true, '下载本次生成的 MP3');
    if (state.mediaSource) {
      finalizeStreamPlayback();
    } else if (state.useHttpStreamMode) {
      if (!state.userPausedPlayback && refs.audioPlayer.paused) {
        refs.audioPlayer.play().catch(() => {});
      }
    } else {
      const previousObjectUrl = state.objectUrl;
      state.objectUrl = URL.createObjectURL(state.audioBlob);
      swapAudioSourcePreserveProgress(state.objectUrl);
      if (previousObjectUrl) {
        URL.revokeObjectURL(previousObjectUrl);
      }
    }

    if (state.ws) {
      const wsToClose = state.ws;
      clearInterval(state.wsPingTimer);
      state.wsPingTimer = null;
      clearTimeout(state.wsCloseTimer);
      state.wsCloseTimer = setTimeout(() => {
        if (wsToClose.readyState === WebSocket.OPEN || wsToClose.readyState === WebSocket.CONNECTING) {
          wsToClose.onclose = null;
          wsToClose.close();
        }
      }, 1200);
    }
  }

  function onGenerateError(errText) {
    state.hasCompleted = true;
    setGenerating(false);
    clearInterval(state.wsPingTimer);
    state.wsPingTimer = null;
    setDownloadButtonState(false, '生成失败，暂无可下载文件');
    if (state.inputMode === 'url' && !state.isUrlTitleResolved) {
      setBlogTitle('标题提炼失败，请更换链接后重试');
    } else {
      appendTranscriptItem({ speaker: '系统', text: errText, type: 'error' });
    }
    if (state.ws) {
      state.ws.onclose = null;
      state.ws.close();
    }
  }

  function generate() {
    const rawInput = refs.contentEl.value.trim();
    const normalizedUrl = normalizeUrlInput(rawInput);
    state.inputMode = normalizedUrl ? 'url' : 'topic';
    const url = normalizedUrl;
    const content = rawInput;

    if (state.inputMode === 'url') {
      if (!url) {
        showValidationError('请输入可访问的文章链接');
        return;
      }
      if (!isValidUrl(url)) {
        showValidationError('请输入有效的 http 或 https 链接');
        return;
      }
    } else if (!content) {
      showValidationError('请输入你想生成播客的话题');
      return;
    }

    state.generationTopic = state.inputMode === 'url' ? url : content.slice(0, 60);
    state.isUrlTitleResolved = state.inputMode !== 'url';

    refs.playerSection.className = 'player-section';
    resetAudioState();
    resetTranscript();
    refs.playerTopic.textContent = '';
    setDownloadButtonState(false, '完整生成完成后可下载');

    if (state.ws) {
      state.ws.onclose = null;
      state.ws.close();
    }

    setGenerating(true);
    state.useHttpStreamMode = shouldUseHttpStreamMode();
    state.activeStreamId = state.useHttpStreamMode ? createStreamId() : '';
    setTranscriptEmpty(state.inputMode === 'url' ? '正在用 AI 压缩播客主题，完成前不会开始播放...' : '正在准备话题并等待第一段对话...');
    if (state.inputMode !== 'url') {
      setBlogTitle(content.slice(0, 50));
    } else {
      setBlogTitle('正在压缩播客主题...');
    }

    const wsEndpoint = resolveWsEndpoint();
    if (state.useHttpStreamMode) {
      refs.playerSection.className = 'player-section visible';
      refs.audioPlayer.src = `${resolveHttpStreamBase()}/stream/${state.activeStreamId}.mp3`;
      refs.audioPlayer.load();
      refs.audioPlayer.play().catch(() => {});
    }
    let wsOpened = false;
    let wsHadErrorEvent = false;
    let wsHandledError = false;
    const failWsOnce = (text) => {
      if (wsHandledError) return;
      wsHandledError = true;
      onGenerateError(text);
    };

    state.ws = new WebSocket(wsEndpoint);
    state.ws.binaryType = 'arraybuffer';

    state.ws.onopen = () => {
      wsOpened = true;
      const wsRef = state.ws;
      const sendPing = () => {
        if (state.ws !== wsRef || !state.generating || wsRef.readyState !== WebSocket.OPEN) {
          return false;
        }
        wsRef.send(JSON.stringify({ type: 'ping' }));
        return true;
      };
      clearInterval(state.wsPingTimer);
      sendPing();
      state.wsPingTimer = setInterval(() => {
        if (!sendPing()) {
          clearInterval(state.wsPingTimer);
          state.wsPingTimer = null;
          return;
        }
      }, 1000);
      if (state.inputMode === 'url') {
        state.ws.send(JSON.stringify({ type: 'generate', mode: 'url', url, guestGroup: state.selectedGuestGroup, streamId: state.activeStreamId }));
        return;
      }
      state.ws.send(JSON.stringify({ type: 'generate', mode: 'topic', promptText: content, guestGroup: state.selectedGuestGroup, streamId: state.activeStreamId }));
    };

    state.ws.onmessage = async (event) => {
      if (event.data instanceof Blob) {
        const arrayBuffer = await event.data.arrayBuffer();
        appendAudioChunk(new Uint8Array(arrayBuffer));
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        appendAudioChunk(new Uint8Array(event.data));
        return;
      }
      if (!(typeof event.data === 'string' || event.data instanceof String)) {
        return;
      }

      let msg;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (msg.type === 'status') {
        if (!refs.transcriptList.querySelector('.transcript-item')) {
          setTranscriptEmpty(msg.text);
        }
      } else if (msg.type === 'meta') {
        state.downloadFileName = msg.downloadName || state.downloadFileName;
        if (state.inputMode !== 'url' && msg.blogTitle) {
          setBlogTitle(msg.blogTitle);
        }
        if (state.inputMode === 'url') {
          if (msg.blogTitle && !state.isUrlTitleResolved) {
            state.isUrlTitleResolved = true;
            state.generationTopic = msg.blogTitle;
            setBlogTitle(msg.blogTitle);
            flushPendingContentAfterTitleResolved();
          } else if (msg.titleReady && msg.blogTitle) {
            state.isUrlTitleResolved = true;
            state.generationTopic = msg.blogTitle;
            setBlogTitle(msg.blogTitle);
          } else if (!state.isUrlTitleResolved) {
            state.generationTopic = state.generationTopic || msg.downloadName || '链接播客';
            setBlogTitle('正在压缩播客主题...');
            setTranscriptEmpty('正在用 AI 压缩播客主题，完成前不会开始播放...');
          }
        } else if (state.inputMode !== 'url' && msg.downloadName) {
          state.generationTopic = msg.blogTitle || msg.downloadName;
        }
      } else if (msg.type === 'transcript') {
        appendTranscriptItem({
          speaker: msg.speaker || '播客嘉宾',
          text: msg.text || '',
        });
      } else if (msg.type === 'done') {
        onGenerateDone();
      } else if (msg.type === 'error') {
        onGenerateError(msg.text);
      }
    };

    state.ws.onerror = () => {
      if (!state.generating) return;
      wsHadErrorEvent = true;
      setTimeout(() => {
        if (!state.generating || wsHandledError) return;
        if (state.ws && state.ws.readyState !== WebSocket.OPEN) {
          failWsOnce(`WebSocket 连接出错（${wsEndpoint}）`);
        }
      }, 300);
    };
    state.ws.onclose = (event) => {
      clearInterval(state.wsPingTimer);
      state.wsPingTimer = null;
      if (!state.generating) return;
      if (event.code === 1008) {
        failWsOnce(`连接被后端拒绝（1008）。请在后端 WS_ALLOWED_ORIGINS 加入：${location.origin}`);
        return;
      }
      if (!wsOpened) {
        if (wsHadErrorEvent && (event.code === 1006 || event.code === 1015)) {
          failWsOnce(`WebSocket 握手失败（TLS/网络拦截）。请检查手机网络、VPN/代理与后端证书：${wsEndpoint}`);
          return;
        }
        failWsOnce(`WebSocket 握手失败（${event.code || 'unknown'}），请检查后端地址：${wsEndpoint}`);
        return;
      }
      const reasonText = event.reason ? `，原因：${event.reason}` : '';
      if (event.code === 1006) {
        failWsOnce(`连接异常中断（1006）。可能是手机网络切换、代理拦截或后端实例重启，请重试并保持网络稳定。目标：${wsEndpoint}`);
        return;
      }
      failWsOnce(`连接意外断开（code=${event.code || 'unknown'}${reasonText}）`);
    };
  }

  function download() {
    if (refs.downloadBtn.dataset.ready !== 'true' || !state.audioBlob) {
      showToast(refs.downloadBtn.dataset.toast || '完整生成完成后可下载');
      return;
    }
    const title = state.downloadFileName || (state.inputMode === 'url'
      ? (normalizeUrlInput(refs.contentEl.value) || 'podcast').replace(/^https?:\/\//, '').replace(/[^\w\u4e00-\u9fa5.-]+/g, '_')
      : (refs.contentEl.value.trim().slice(0, 24) || 'podcast'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(state.audioBlob);
    a.download = `${title}.mp3`;
    a.click();
  }

  refs.contentEl.addEventListener('focus', () => {
    const placeholders = getRotatingPlaceholders();
    if (!refs.contentEl.value.trim()) {
      refs.contentEl.placeholder = placeholders[state.currentPlaceholderIndex % placeholders.length];
    }
  });

  refs.contentEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      generate();
    }
  });

  window.addEventListener('resize', startPlaceholderRotation);
  startPlaceholderRotation();
  setGuestGroup('classic');

  window.generate = generate;
  window['download'] = download;
  window.setGuestGroup = setGuestGroup;
})();
