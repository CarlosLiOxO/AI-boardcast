function createLiveAudioStreams() {
  const sessions = new Map();

  const scheduleCleanup = (id, delayMs = 60000) => {
    const session = sessions.get(id);
    if (!session) return;
    if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
    session.cleanupTimer = setTimeout(() => {
      const latest = sessions.get(id);
      if (!latest) return;
      if (latest.response && !latest.response.writableEnded) return;
      sessions.delete(id);
    }, delayMs);
  };

  const ensureSession = (id) => {
    if (!id) return null;
    let session = sessions.get(id);
    if (!session) {
      session = {
        id,
        chunks: [],
        done: false,
        response: null,
        cleanupTimer: null,
      };
      sessions.set(id, session);
    }
    return session;
  };

  const attachResponse = (id, res) => {
    const session = ensureSession(id);
    if (!session) {
      res.status(404).end();
      return;
    }
    if (session.response && !session.response.writableEnded) {
      session.response.end();
    }
    session.response = res;
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }
    for (const chunk of session.chunks) {
      res.write(chunk);
    }
    if (session.done) {
      res.end();
      scheduleCleanup(id, 5000);
      return;
    }
    res.on('close', () => {
      const latest = sessions.get(id);
      if (!latest) return;
      if (latest.response === res) {
        latest.response = null;
        scheduleCleanup(id);
      }
    });
  };

  const appendChunk = (id, chunk) => {
    const session = ensureSession(id);
    if (!session || session.done) return;
    session.chunks.push(chunk);
    if (session.response && !session.response.writableEnded) {
      session.response.write(chunk);
    }
  };

  const finish = (id) => {
    const session = sessions.get(id);
    if (!session || session.done) return;
    session.done = true;
    if (session.response && !session.response.writableEnded) {
      session.response.end();
    }
    scheduleCleanup(id, 5000);
  };

  const abort = (id) => {
    const session = sessions.get(id);
    if (!session) return;
    session.done = true;
    if (session.response && !session.response.writableEnded) {
      session.response.end();
    }
    scheduleCleanup(id, 5000);
  };

  return {
    ensureSession,
    attachResponse,
    appendChunk,
    finish,
    abort,
  };
}

module.exports = { createLiveAudioStreams };
