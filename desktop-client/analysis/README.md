# 赔率分析

`odds-2026-10-15/` 保存 2026-10-15 的赔率盈亏分析，覆盖 52 个赔率键、80 种情景，并通过客户端赔付函数核对。它是当时规则和配置下的历史分析，不代表当前所有玩家的实际收益。

- `赔率盈亏分析.md`：分析报告。
- `calculate.py`：精确概率、返奖率和盈亏计算，生成报告及 `results.json`。
- `verify.mjs`：调用客户端赔付函数交叉核对，生成 `verification.json`。
- `rules.json`：分析日期的号码、生肖及规则快照。
- `settings.example.json`：复算所需的赔率及退水方案，已去掉原空间标识、修订号和玩家数量，不含玩家名单或账目原文。
- `read_settings.py`：原本机设置读取工具，只读取数据库稳定副本。原始导出 `settings.json` 与运行日志不提交到 Git。

## 复算已保存报告

先在 `desktop-client/` 执行 `npm ci`，然后在仓库根目录运行（需要 Python 3 和 Node.js 22.19+）：

```sh
python3 desktop-client/analysis/odds-2026-10-15/calculate.py
node desktop-client/analysis/odds-2026-10-15/verify.mjs
```

没有本地 `settings.json` 时，脚本使用 `settings.example.json`，因此从 Git 克隆后可以直接复算。存在本地设置时优先使用本地设置。

这两个脚本针对该次分析固定了马年、各市场配置相同等前提，报告中的日期及设置来源说明也保留当时记录。分析其他日期或配置时，应另建分析目录并同步调整前提及说明。
