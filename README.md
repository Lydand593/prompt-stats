# prompt-stats

在 Claude Code 输入框下方常驻一行实时统计：**本次对话花费（人民币）** 与 **prompt 缓存命中率**。

```
¥  0.468 · 缓存命中率 99.6%
```

## 特点

- **实时计价**：每一段模型响应落地就立刻结算；回答流式输出期间按字数滚动估算，整轮结束时用 API 的真实账单校准，不留估算误差
- **真实命中率**：命中率 = 缓存读取 ÷（未缓存输入 + 缓存读取 + 缓存写入），数字直接来自 API 返回的 usage，每段响应一到就更新
- **按数值着色**：命中率越高颜色越好——浅色界面 蓝(100%) → 橙(97.5%) → 红(≤95%)，深色界面 薄荷绿 → 琥珀 → 红
- **深浅自动适配**：桌面端优先读 Claude 应用自己的深浅开关（`userThemeMode`），其次 Claude Code 的主题设置；`auto` 时跟随系统外观（macOS / Windows / Linux 均可探测），切换后约 5 秒内更新
- 打开即显示（还没有数据时是占位 `¥  0.000 · 缓存命中率    —%`），`/clear` 后归零

## 安装

在 Claude Code 中依次执行：

1. `/plugin marketplace add Lydand593/prompt-stats`
2. `/plugin install prompt-stats@liyidong-mods`
3. `/reload-plugins`

以后更新：`claude plugin update prompt-stats@liyidong-mods`

## 须知

- **计价只覆盖 DeepSeek 系模型**（模型 id 以 `deepseek` 开头）：其他模型命中率照常显示，金额会一直是 ¥0.000
- 计价采用 DeepSeek 官方价目：flash `0.02 / 1 / 4`、pro `0.15 / 4.5 / 13.5`（元/百万 token，缓存命中 / 未命中 / 输出）；北京时间工作日 9:00–12:00 与 14:00–18:00 为峰段，双倍
- 费用按**对话**累计并保存在宿主的存储里：**重启不丢**，`/clear` 才归零；命中率是当前对话的实时值

## 开发

- `claude plugin validate .` —— 校验清单与钩子
- `claude plugin test .` —— 运行测试（14 个）
- `tsc -p .` —— 类型检查（`.claude-plugin/types/` 由引擎生成，不入库）

| 文件 | 职责 |
| --- | --- |
| `hooks/register.tsx` | 主模块：事件订阅、状态、绘制 |
| `hooks/cost.ts` | DeepSeek 计价与峰谷时段 |
| `hooks/color.ts` | 命中率配色渐变 |
| `hooks/platform.ts` | 系统深浅探测（macOS / Windows / Linux） |
| `types/index.d.ts` | `$.state` 类型契约 |
