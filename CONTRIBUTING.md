# 贡献指南 / Contributing

感谢你愿意改进这个项目。这是一个小而完整的工具，所以流程保持轻量。

## 分支与提交

- 从 `main` 切分支，例如 `feat/swing-presets` 或 `fix/safari-panner`。
- 提交信息用一句话说明改了什么以及为什么。
- 不要直接往 `main` 推送；走 Pull Request。

## 改之前

```bash
npm install
npm run dev        # 本地开发 http://localhost:5173
npm run build      # 生产构建
npm run verify     # 离线渲染 + 音频断言（需要 node-web-audio-api）
```

`npm run verify` 是硬门槛。它会真的把鼓组渲染成 PCM 再断言：

- 8 个音色都有可闻输出
- 音符落点与 `audioContext.currentTime` 的误差在微秒级
- Swing 只推迟反拍，且小节长度不变
- Mute / Solo 门控正确
- 最大密度下母带不过 0 dBFS

改了声音或时序相关代码，请务必跑它。修改 UI 后请至少在桌面 1440px 与移动 390px 两个宽度确认无横向溢出。

## 声音相关的改动

所有音色都在 `src/audio/voices.js`，签名固定为 `(ctx, destination, startTime, velocity)`：

- **不要**在函数里读 `ctx.currentTime`，也不要依赖任何外部可变状态。这是同一份代码既能实时播放、又能在 `OfflineAudioContext` 里离线渲染成 WAV 的前提。
- `src/audio/master.js` 的母线被实时播放和 WAV 导出共用。改母线等于同时改两边，这正是我们要的，但请确认导出结果没有削波。
- `VOICES` 的键必须与 `src/audio/engine.js` 里 `TRACKS` 的 `id` 完全一致 —— 调度器和离线渲染都靠 `VOICES[track.id]` 查表。

## 报告问题

请附上浏览器与版本、复现步骤，以及是否与导出结果有关。音频类问题如果方便，附一段 WAV 比截图更有用。
