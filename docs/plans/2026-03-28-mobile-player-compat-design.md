# 移动端播放器兼容修复 Spec

## 背景

当前桌面端主要依赖 MediaSource 进行流式播放，但 iOS Safari、iOS Chrome 以及部分 Android 浏览器在音频流接入、播放器展示时机和自动起播上存在不稳定现象。最近几次修复把“移动端兼容链路”和“播放器 UI 展示时机”耦合在一起，导致 iOS 出现播放器消失、过早展示或自动起播失效等回归。

## 目标

- 统一移动端兼容策略，覆盖 iOS Safari、iOS Chrome、iOS Edge、iOS Firefox，以及 Android 上不稳定或不支持 MSE 的浏览器
- 手机端下方播客区域统一改为：开始生成后，收到第一条有效内容才展示
- 第一条有效内容到达后，展示博客内容、标题和播放器
- 移动端在首次可播时自动起播
- 保留桌面端现有的流式体验，不让桌面链路回归

## 非目标

- 本轮不引入 HLS
- 不重写火山引擎协议层
- 不调整桌面端现有 MSE 数据管线

## 现状问题

- 移动端兼容性依赖浏览器分支较多，容易回归
- iOS 之前的非 MSE 降级逻辑会频繁替换 audio.src，导致回到开头或续播失败
- 最近为 iOS 引入 HTTP 实时音频流后，又把播放器展示时机提前了，与需求冲突

## 方案

### 方案选择

采用统一移动端策略：

- 桌面端继续使用现有 MSE 流式播放
- 移动端在满足条件时走稳定的 HTTP 音频流通道
- 生成期间先预连音频流与接收内容
- 收到第一条有效内容后再展示下方播客区域，并尝试自动起播

### 移动端判定

- 所有 iOS 浏览器统一走稳定 HTTP 音频流模式
- Android 中：
  - Samsung Browser 走稳定 HTTP 音频流模式
  - 不支持 MSE 的浏览器走稳定 HTTP 音频流模式
  - 其余保持现有链路

### 播放器行为

- generate 开始时：
  - 保持下方播客区域隐藏
  - 若命中移动端稳定流模式，则预先绑定 `/stream/:streamId.mp3`
  - 不强制展示博客内容、标题和播放器
- 生成过程中：
  - 收到第一条有效内容前，只展示状态文案
  - 收到第一条有效内容后，展示博客内容、标题和播放器
- onGenerateDone：
  - 如果有音频数据，则保持播放器可见
  - 若此前尚未可播，则在完成时自动起播
  - 桌面端沿用现有逻辑

### 后端行为

- 继续保留 `/stream/:streamId.mp3`
- WebSocket 继续负责字幕、状态和 done/error
- 音频数据继续同步写入稳定 HTTP 流

## 实现点

### 前端

- app.js
  - 收敛 `shouldUseHttpStreamMode()`
  - `generate()` 中仅预连稳定音频流，不展示下方播客区域
  - 新增“第一条有效内容到达后揭示播客区域”的状态控制
  - `appendAudioChunk()`、`appendTranscriptItem()`、`meta` 分支共同驱动移动端首次展示
  - `onGenerateDone()` 中按链路类型兜底自动起播

### 后端

- server.js
  - 保留 `/stream/:streamId.mp3`
- src/services/liveAudioStreams.js
  - 保持会话级 chunked 输出
- src/ws/handlePodcastConnection.js
  - 保持 streamId 音频同步写入

## 验收标准

- iOS Safari：开始生成后，收到第一条有效内容时显示博客内容、标题和播放器，并自动起播
- iOS Chrome：同上
- Android Samsung Browser：同上
- Android Chrome：
  - 若命中 HTTP 流模式，同上
  - 若保留 MSE，则不回归当前桌面播放行为
- 生成失败时不显示下方播客区域

## 风险

- 某些 Android 浏览器对 HTMLAudioElement 的自动播放限制可能仍受系统策略影响
- HTTP 流模式下，下方播客区域在首条有效内容前不可见，但底层连接已建立，需要保证断流时正确清理

## 验证方式

- 前端语法检查
- 本地 WebSocket 握手验证
- 本地 `/stream/:streamId.mp3` 持续响应验证
- 线上使用 iOS Safari、iOS Chrome、Android Chrome 至少各验证一次
