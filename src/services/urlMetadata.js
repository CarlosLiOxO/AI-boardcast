const { assertPublicHttpUrl } = require('../security/network');

function sanitizeFileName(name) {
  return name
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function decodeHtmlTitle(title) {
  return title
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

function buildKnownSiteFallbackName(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const shortValue = (value, length = 24) => (value || '').replace(/[^\w-]+/g, '').slice(0, length);

  if (host === 'mp.weixin.qq.com') {
    const sn = shortValue(url.searchParams.get('sn'), 12);
    const mid = shortValue(url.searchParams.get('mid'), 10);
    const idx = shortValue(url.searchParams.get('idx'), 4);
    const suffix = [mid, idx, sn].filter(Boolean).join('_');
    return sanitizeFileName(`微信公众号文章${suffix ? `_${suffix}` : ''}`);
  }

  if (host === 'zhuanlan.zhihu.com' || host === 'zhihu.com') {
    const articleId = shortValue(url.pathname.split('/').filter(Boolean).pop(), 16);
    return sanitizeFileName(`知乎文章${articleId ? `_${articleId}` : ''}`);
  }

  if (host === 'juejin.cn') {
    const postId = shortValue(url.pathname.split('/').filter(Boolean).pop(), 18);
    return sanitizeFileName(`掘金文章${postId ? `_${postId}` : ''}`);
  }

  if (host.endsWith('xiaohongshu.com')) {
    const noteId = shortValue(url.pathname.split('/').filter(Boolean).pop(), 18);
    return sanitizeFileName(`小红书笔记${noteId ? `_${noteId}` : ''}`);
  }

  return '';
}

function buildUrlFallbackName(url) {
  const knownSiteFallback = buildKnownSiteFallbackName(url);
  if (knownSiteFallback) {
    return knownSiteFallback;
  }
  const fallback = sanitizeFileName(url.hostname.replace(/^www\./, '')) || 'podcast';
  const lastSegment = url.pathname.split('/').filter(Boolean).pop();
  if (!lastSegment) return fallback;
  const decodedSegment = sanitizeFileName(decodeURIComponent(lastSegment.replace(/\.[a-z0-9]+$/i, '')));
  if (!decodedSegment || decodedSegment.length < 3 || /^s$/i.test(decodedSegment)) {
    return fallback;
  }
  return decodedSegment;
}

function extractReadableTextFromHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericTitle(title) {
  const normalized = (title || '').trim();
  if (!normalized) return true;
  return /^(微信公众号文章|微信公众平台|知乎文章|掘金文章|小红书笔记)(_|$)/.test(normalized);
}

function isPlayablePodcastTitle(title, originalTitle) {
  const normalized = (title || '').trim();
  const original = (originalTitle || '').trim();
  if (!normalized || isGenericTitle(normalized)) return false;
  if (normalized.length > 22) return false;
  if (!original) return true;
  if (normalized === original) return false;
  if (original.includes(normalized) && original.length - normalized.length < 4) return false;
  return true;
}

function normalizePodcastTitleCandidate(rawTitle) {
  const cleaned = sanitizeFileName(String(rawTitle || '').replace(/[。！？.!?]+$/g, ''));
  if (!cleaned) return '';
  if (cleaned.length <= 22) return cleaned;
  const parts = cleaned.split(/[：:，,；;。!?！？]/).map((part) => part.trim()).filter(Boolean);
  const shortPart = parts.find((part) => part.length >= 6 && part.length <= 22);
  if (shortPart) return shortPart;
  return cleaned.slice(0, 22);
}

function extractMetaContent(html, attrName, attrValue) {
  const direct = html.match(new RegExp(`<meta[^>]+${attrName}=["']${attrValue}["'][^>]+content=["']([^"']+)["']`, 'i'));
  if (direct?.[1]) return direct[1];
  const reverse = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attrName}=["']${attrValue}["']`, 'i'));
  return reverse?.[1] || '';
}

function extractBestHtmlTitle(html, fallbackName) {
  const candidates = [
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '',
    extractMetaContent(html, 'property', 'og:title'),
    extractMetaContent(html, 'name', 'twitter:title'),
    html.match(/var\s+msg_title\s*=\s*'([^']+)'/i)?.[1] || '',
    html.match(/window\.__INITIAL_STATE__[\s\S]*?"title":"([^"]+)"/i)?.[1] || '',
  ]
    .map((item) => sanitizeFileName(decodeHtmlTitle(item || '')))
    .filter(Boolean);

  const meaningful = candidates.find((item) => !isGenericTitle(item) && item !== fallbackName);
  return meaningful || candidates[0] || fallbackName;
}

async function fetchHtmlWithSafeRedirects(initialUrl, { maxRedirects }) {
  let currentUrl = initialUrl;

  for (let i = 0; i <= maxRedirects; i += 1) {
    const parsedUrl = await assertPublicHttpUrl(currentUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(parsedUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 AI-boardcast/1.0',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error('链接跳转失败');
        }
        currentUrl = new URL(location, parsedUrl).toString();
        continue;
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('链接跳转次数过多');
}

async function readResponseTextWithLimit(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return Buffer.from(text).subarray(0, maxBytes).toString('utf-8');
  }

  let total = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - total;
    if (remaining <= 0) {
      break;
    }
    const chunkBuffer = Buffer.from(value);
    if (chunkBuffer.byteLength > remaining) {
      chunks.push(chunkBuffer.subarray(0, remaining));
      total += remaining;
      break;
    }
    total += chunkBuffer.byteLength;
    chunks.push(chunkBuffer);
  }

  return Buffer.concat(chunks).toString('utf-8');
}

async function fetchUrlMetadataBase(urlText, { maxHtmlFetchBytes, maxUrlRedirects }) {
  let parsedUrl;
  try {
    parsedUrl = await assertPublicHttpUrl(urlText);
  } catch {
    return { downloadName: 'podcast', blogTitle: '本次播客', pageText: '' };
  }

  const fallbackName = buildUrlFallbackName(parsedUrl);

  try {
    const response = await fetchHtmlWithSafeRedirects(parsedUrl.toString(), { maxRedirects: maxUrlRedirects });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('text/html')) {
      return { downloadName: fallbackName, blogTitle: fallbackName, pageText: '' };
    }
    const html = await readResponseTextWithLimit(response, maxHtmlFetchBytes);
    const decodedTitle = extractBestHtmlTitle(html, fallbackName);
    return {
      downloadName: decodedTitle || fallbackName,
      blogTitle: decodedTitle || fallbackName,
      pageText: extractReadableTextFromHtml(html),
    };
  } catch {
    return { downloadName: fallbackName, blogTitle: fallbackName, pageText: '' };
  }
}

async function summarizeTitleWithGLM(pageTitle, pageText, glmConfig) {
  if (!glmConfig.apiKey) {
    return null;
  }

  const requestGlmTitle = async (textSnippet, timeoutMs) => {
    const prompt = [
      '你是播客选题编辑。',
      '请把下面内容压缩成一句中文播客主题标题（不超过18字）。',
      '要求：简洁、有信息密度、只输出标题。',
      `网页标题：${pageTitle || '无'}`,
      `正文片段：${textSnippet || '无'}`,
    ].join('\n');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${glmConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: glmConfig.titleModel || glmConfig.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
        }),
      });
      if (!resp.ok) {
        return null;
      }
      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content || '';
      const summarized = normalizePodcastTitleCandidate(content);
      if (!isPlayablePodcastTitle(summarized, pageTitle)) {
        return null;
      }
      return summarized;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };

  const fastSnippet = (pageText || '').slice(0, 180);
  const fastResult = await requestGlmTitle(fastSnippet, 4500);
  if (fastResult) return fastResult;

  const retrySnippet = (pageText || '').slice(0, 420);
  return requestGlmTitle(retrySnippet, 5000);
}

module.exports = {
  fetchUrlMetadataBase,
  summarizeTitleWithGLM,
  sanitizeFileName,
  isGenericTitle,
  isPlayablePodcastTitle,
};
