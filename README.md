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
- `WS_ALLOWED_ORIGINS`：可选，允许连接后端 WS 的前端来源，逗号分隔

## Railway 部署

- 推荐只部署到 Railway，由同一个 Node 服务同时提供页面和 WebSocket
- Railway 访问页面时，前端会默认连接当前域名下的 `/ws`
- 单 Railway 部署通常不需要配置：
  - `PUBLIC_WS_BASE_URL`
  - `WS_ALLOWED_ORIGINS`
- 启动命令保持为 `node server.js`
- 部署后直接访问 Railway 分配的域名即可

## 分离部署

- 只有前后端拆开部署时，才需要配置：
  - `PUBLIC_WS_BASE_URL`：后端服务地址，如 `https://your-api.example.com`
  - `WS_ALLOWED_ORIGINS`：允许连接后端 WS 的前端来源
- 前端会自动将 `PUBLIC_WS_BASE_URL` 转换为对应的 `ws/wss` 并拼接 `/ws`
