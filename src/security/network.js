const dns = require('dns').promises;
const net = require('net');

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith('169.254.')) return true;
  if (ip.startsWith('100.64.') || ip.startsWith('0.')) return true;
  if (/^fc/i.test(ip) || /^fd/i.test(ip) || /^fe80:/i.test(ip)) return true;
  if (ip === '::' || ip === '0:0:0:0:0:0:0:0') return true;
  return false;
}

async function assertPublicHttpUrl(urlText) {
  let parsedUrl;
  try {
    parsedUrl = new URL(urlText);
  } catch {
    throw new Error('请输入可访问的文章链接');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('请输入有效的 http 或 https 链接');
  }

  const host = parsedUrl.hostname.trim().toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local')) {
    throw new Error('不支持本地或内网地址，请输入公开可访问的网页链接');
  }

  const ipType = net.isIP(host);
  if (ipType && isPrivateIp(host)) {
    throw new Error('不支持本地或内网地址，请输入公开可访问的网页链接');
  }

  const lookupResults = ipType
    ? [{ address: host }]
    : await dns.lookup(host, { all: true, verbatim: true });

  if (!lookupResults.length || lookupResults.some((entry) => isPrivateIp(entry.address))) {
    throw new Error('不支持本地或内网地址，请输入公开可访问的网页链接');
  }

  return parsedUrl;
}

module.exports = { assertPublicHttpUrl };
