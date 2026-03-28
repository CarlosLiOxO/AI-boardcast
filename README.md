# 🎙️ AI 播客

将任意网页链接或一句话话题，转化为两人对谈的 AI 播客音频。

基于 [火山引擎 Podcast TTS](https://www.volcengine.com/docs/6561/1234) 实时生成对话式语音，支持流式播放、实时字幕和 MP3 下载。

---

## 功能特性

- **链接转播客** — 粘贴一篇文章的 URL，自动提取正文并生成两人讨论式音频
- **话题转播客** — 输入一句话描述，AI 联网搜索后即兴对谈
- **流式播放** — 基于 MediaSource API，边生成边播放，无需等待全部完成
- **实时字幕** — 生成过程中逐轮展示每位嘉宾的对话内容
- **嘉宾切换** — 内置两组嘉宾组合，风格各异：
  - 「咪仔 × 大壹」— 轻松自然的男女对谈
  - 「刘飞 × 潇磊」— 沉稳深度的双男声访谈
- **一键下载** — 生成完成后可直接下载完整 MP3 文件
- **安全防护** — 严格 CSP、SSRF 防护、IP 限流、WebSocket 跨域校验

---

## 技术架构

```
浏览器 (app.js)
  │
  │  WebSocket (/ws)
  ▼
Node.js 服务 (server.js)
  ├── 安全层：CSP / CORS / IP 限流 / SSRF 防护
  ├── URL 模式：抓取网页 → GLM 提炼标题 → 提交火山引擎
  ├── 话题模式：直接提交话题 → 火山引擎联网生成
  │
  │  WebSocket (V3 二进制协议)
  ▼
火山引擎 Podcast TTS
  └── 返回：音频流 (MP3) + 对话文本 + 控制帧
```

---

## 快速开始

### 前置条件

- Node.js ≥ 18
- [火山引擎](https://console.volcengine.com/) 账号，开通语音合成服务
- （可选）[智谱 AI](https://open.bigmodel.cn/) API Key，用于 URL 模式下的标题提炼

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/CarlosLiOxO/AI-boardcast.git
cd AI-boardcast

# 安装依赖
npm install

# 复制环境变量模板并填写
cp .env.example .env

# 启动服务
node server.js
```

启动后访问 `http://localhost:3000`。

---

## 环境变量

| 变量 | 必填 | 说明 | 默认值 |
|------|:----:|------|--------|
| `VOLC_APP_ID` | ✅ | 火山引擎 App ID | — |
| `VOLC_API_KEY` | ✅ | 火山引擎 Access Key | — |
| `VOLC_APP_KEY` | ✅ | 火山引擎 App Key | — |
| `VOLC_WS_URL` | | 播客 WebSocket 地址 | `wss://openspeech.bytedance.com/api/v3/sami/podcasttts` |
| `RESOURCE_ID` | | 语音合成资源 ID | `volc.service_type.10050` |
| `GLM_API_KEY` | | 智谱 AI Key（URL 标题提炼） | — |
| `GLM_MODEL` | | 智谱对话模型 | `glm-4.7` |
| `GLM_TITLE_MODEL` | | 智谱标题压缩模型 | `glm-4-flash` |
| `WS_ALLOWED_ORIGINS` | | 允许的 WebSocket 跨域来源（逗号分隔） | — |
| `PUBLIC_WS_BASE_URL` | | 前后端分离时的后端地址 | — |

---

## 部署

### Railway（推荐）

项目已包含 `railway.json`，推荐单实例全栈部署：

1. 在 [Railway](https://railway.app) 连接 GitHub 仓库
2. 创建 New Project → Deploy from GitHub
3. 在 Variables 中填写环境变量
4. 部署完成后直接访问 Railway 分配的域名

> 单 Railway 部署时，无需配置 `PUBLIC_WS_BASE_URL` 和 `WS_ALLOWED_ORIGINS`。

### 前后端分离部署

如果前端部署在 Netlify 等静态托管平台，后端单独部署：

**后端（Railway / Render / VPS）：**
```bash
# 设置环境变量
WS_ALLOWED_ORIGINS=https://your-site.netlify.app
```

**前端（Netlify）：**
```bash
# 设置 Netlify 环境变量
PUBLIC_WS_BASE_URL=https://your-api.up.railway.app
```

项目已包含 `netlify.toml`，构建时会自动生成 `runtime-config.js` 注入后端地址。

### VPS / 自有服务器

```bash
npm install --production
npm install -g pm2
pm2 start server.js --name ai-boardcast
```

Nginx 反向代理需要配置 WebSocket 升级：

```nginx
location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

---

## 项目结构

```
├── server.js                    # 入口：Express + WebSocket 服务
├── public/
│   ├── index.html               # 前端页面
│   ├── app.js                   # 前端逻辑（WebSocket / 流式播放 / UI）
│   └── runtime-config.js        # 构建时注入的运行时配置
├── src/
│   ├── config/
│   │   ├── index.js             # 集中配置对象
│   │   └── loadEnv.js           # .env 文件解析
│   ├── protocol/
│   │   └── volc.js              # 火山引擎 V3 二进制协议编解码
│   ├── security/
│   │   ├── httpHeaders.js       # 安全响应头（CSP / X-Frame 等）
│   │   ├── network.js           # SSRF 防护（私有 IP 检测）
│   │   └── wsPolicy.js          # WebSocket 跨域校验 + IP 限流
│   ├── services/
│   │   └── urlMetadata.js       # URL 抓取 / 标题提取 / GLM 摘要
│   └── ws/
│       └── handlePodcastConnection.js  # 核心 WebSocket 连接处理
├── scripts/
│   └── prepare-netlify.js       # Netlify 构建脚本
├── railway.json                 # Railway 部署配置
├── netlify.toml                 # Netlify 部署配置
├── Procfile                     # Heroku 部署配置
└── vercel.json                  # Vercel 部署配置（仅前端）
```

---

## 安全机制

| 层级 | 措施 |
|------|------|
| HTTP | 严格 CSP、X-Frame-Options DENY、no-sniff、no-referrer |
| SSRF | URL 模式下校验目标地址，拒绝私有 IP / localhost / .local 域名 |
| WebSocket | Origin 白名单校验，支持通配符（如 `*.example.com`）|
| 限流 | 单 IP 最多 3 个并发连接，每分钟最多 5 次生成请求 |
| 音频 | 单次最长 105 秒，静默 3 秒自动收尾 |

---

## 依赖

仅三个运行时依赖，零前端构建工具：

| 包 | 用途 |
|----|------|
| [express](https://expressjs.com/) | HTTP 服务与静态文件托管 |
| [ws](https://github.com/websockets/ws) | WebSocket 服务端 |
| [uuid](https://github.com/uuidjs/uuid) | 会话 ID 生成 |

---

## License

MIT
