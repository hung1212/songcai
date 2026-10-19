# 松财

Windows / macOS 本地算账客户端，使用 Electron + Vue，支持投注原文解析、SQLite 账目与空间管理、微信收件箱、开奖核对、赔付和玩家退水。

- [客户端说明与版本记录](desktop-client/README.md)
- [需求及规则文档](docs/)
- [赔率盈亏分析与复算说明](desktop-client/analysis/README.md)

## 开发

需要 Node.js 22.19 或更新版本。

```sh
cd desktop-client
npm ci
npm test
npm run dev
```

`npm start` 构建并启动桌面客户端；`npm run build` 构建网页资源。macOS 的微信读取与 OCR 辅助程序使用 `npm run build:native` 编译，需要 Xcode Command Line Tools。

仓库包含源代码、测试、规则文档、必要参考图片和赔率分析。依赖、安装包、自动生成的验收报告、本地账目数据库与原始设置导出保留在本机，不纳入版本管理。测试使用的合成回归样例，以及分析报告和匿名参数样例随仓库保留。

`npm run audit:samples` 是可选的旧项目样例审计，需要本机另有 `number-of-statistical-plug/oglang-test`；正常开发、构建与 `npm test` 不依赖该目录。
