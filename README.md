# AI-boardcast

## 启动

1. 复制 `.env.example` 为 `.env`
2. 在 `.env` 中填写 GLM 与相关配置
3. 运行 `PORT=3001 node server.js`

## 环境变量

- `GLM_API_KEY`：用于网页内容标题提炼
- `GLM_MODEL`：可选，默认 `glm-4.7`
- `GLM_TITLE_MODEL`：可选，专用于标题压缩模型，默认 `glm-4-flash`
- `VOLC_APP_ID`： App ID
- `VOLC_API_KEY`：Access Key
- `VOLC_APP_KEY`： App Key
- `VOLC_WS_URL`：可选，播客 WebSocket 地址
- `RESOURCE_ID`：播客语音合成资源 ID，默认 `volc.service_type.10050`

## Netlify 部署准备

- 前端可部署到 Netlify，后端 WebSocket 服务需独立部署在可长期运行 Node 进程的平台
- 已提供 `netlify.toml`，发布目录为 `public`
- Netlify 构建时会执行 `npm run build:netlify` 生成 `public/runtime-config.js`
- 在 Netlify 环境变量中配置：
  - `PUBLIC_WS_BASE_URL`：后端服务地址，如 `https://your-api.example.com`
- 前端会自动将 `PUBLIC_WS_BASE_URL` 转换为对应的 `ws/wss` 并拼接 `/ws`
