# opencode-dcp-adaptive-backoff

解决 OpenCode DCP（Dynamic Context Pruning）插件压缩死循环（compaction death spiral）的完整方案。

## 问题

DCP 插件在上下文超过 `maxContextLimit`（软阈值）时注入压缩提醒（nudge），模型调用 `compress` 工具。当上下文压无可压时，`compress` 返回 `"Compressed 0 messages"` 但仍追加 summary，导致上下文净增长 → 系统继续注入 nudge → 再压缩 → 死循环（上游 issue [#573](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning/issues/573)）。

关键根因：DCP 的 `config` 在插件启动时闭包捕获（`dist/index.js`），运行期修改 `dcp.jsonc` 不影响 nudge 逻辑。因此必须修改 DCP 插件源码本身。

## 方案（两部分）

### 1. DCP 补丁（真正动态调整阈值）

`dcp-patch/adaptive-backoff.patch` 修改 DCP 的 `injectCompressNudges` 函数，加入自适应退避：

- 当 `overMaxLimit` 连续 3 次仍超限（压缩无效）时，动态抬高 `config.compress.maxContextLimit`（`min(900000, ×1.5)`）
- 上下文回落到阈值以下时重置计数

这是**动态**调整阈值，而非固定写死——压得动就正常 nudge，压不动就自动放宽。

### 2. 行为层插件（兜底）

`plugin/adaptive-compress-backoff.ts` 是独立 opencode 插件，检测 `compress` 连续失败 2 次后剥离 DCP 注入的 nudge，作为补丁之外的第二道防线。

## 安装

### 应用 DCP 补丁

```bash
# 1. 找到 DCP 包位置（npm 缓存）
DCP_DIR=~/.cache/opencode/packages/@tarquinen/opencode-dcp@3.1.14/node_modules/@tarquinen/opencode-dcp

# 2. 应用补丁
cd "$DCP_DIR"
patch -p1 < /path/to/dcp-patch/adaptive-backoff.patch

# 3. 验证语法
node --check dist/index.js
```

或使用 `dcp-patch/apply.sh`（自动定位 DCP 包并应用补丁）。

> **注意（node_modules 依赖）**：若把 DCP 包复制到自定义位置（如 `dcp-patched/`）再打补丁，必须**连同 `node_modules/` 一起复制**，否则加载插件会报 `Cannot find module '@anthropic-ai/tokenizer'`。原依赖位于 npm 缓存：
> ```bash
> cp -r ~/.cache/opencode/packages/@tarquinen/opencode-dcp@3.1.14/node_modules ~/.config/opencode/dcp-patched/node_modules
> ```
> 若直接在 npm 缓存原位置打补丁（apply.sh 默认方式），则无需此步。

### 安装行为层插件

1. 复制 `plugin/adaptive-compress-backoff.ts` 到 `~/.config/opencode/plugin/`
2. 在 `opencode.jsonc` 的 `plugin` 数组中，**放在 DCP 插件之后**（保证加载顺序，才能剥离 nudge）：
```json
"plugin": [
  "oh-my-opencode-slim@2.2.13",
  "@tarquinen/opencode-dcp@3.1.14",
  "./plugin/adaptive-compress-backoff.ts"
]
```

### 配置 DCP

`dcp.jsonc` 建议配置：

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/Opencode-DCP/opencode-dynamic-context-pruning/master/dcp.schema.json",
  "autoUpdate": false,
  "compress": {
    "protectUserMessages": true,
    "summaryBuffer": true,
    "maxContextLimit": 800000,
    "minContextLimit": 400000
  },
  "turnProtection": { "enabled": true, "turns": 4 },
  "strategies": {
    "deduplication": { "enabled": true },
    "purgeErrors": { "enabled": true }
  }
}
```

> `autoUpdate: false` 防止 npm 自动更新覆盖补丁。

## 维护注意

- **不要** `npm update` DCP 包（会覆盖补丁）
- DCP 升级后需重新应用补丁
- 补丁应用后用 `node --check dist/index.js` 验证语法

## 许可证

MIT
