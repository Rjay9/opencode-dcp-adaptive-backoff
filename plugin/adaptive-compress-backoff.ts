import type { Plugin } from "@opencode-ai/plugin"

/**
 * Adaptive Compress Backoff Plugin
 *
 * 解决 DCP 压缩死循环（compaction death spiral）：
 * 当 compress 工具反复失败（0 条删除 / 压无可压）时，动态抑制 DCP 注入的
 * 压缩提醒（nudge），等效于动态抬高软阈值——而非固定写死阈值。
 *
 * 机制（电路熔断器模式）：
 * - tool.execute.after 检测 compress 结果，统计连续失败次数
 * - 连续失败达到 THRESHOLD 时进入退避态，剥离后续 nudge（模型不再被逼压缩）
 * - 成功压缩或用户发新消息时重置计数（恢复信号）
 *
 * 状态：闭包 Map 跨 turn 存活，服务器重启清空。
 * 加载顺序：必须放在 DCP 插件之后（opencode.jsonc plugin 数组靠后），
 * 才能看到并剥离 DCP 注入的 nudge。
 */
export const AdaptiveCompressBackoff: Plugin = async () => {
  // 闭包状态：跨 turn 存活，重启清空
  const failuresBySession = new Map<string, { count: number; lastAt: number }>()
  const THRESHOLD = 2 // 连续失败 2 次即退避
  const NUDGE_RE = /[\s\S]*?<\/dcp-system-reminder>/g

  return {
    "tool.execute.after": async (input, output) => {
      if (input.tool !== "compress") return
      const s = failuresBySession.get(input.sessionID) ?? { count: 0, lastAt: 0 }
      const result = String(output.output ?? "")
      // 失败：0 条删除（压无可压）或净增长
      if (/Compressed 0 messages/.test(result)) {
        s.count += 1
      } else {
        s.count = 0 // 成功即重置
      }
      s.lastAt = Date.now()
      failuresBySession.set(input.sessionID, s)
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      const sessionID = output.messages[0]?.info.sessionID ?? ""
      const s = failuresBySession.get(sessionID)
      if (!s || s.count < THRESHOLD) return
      // 退避态：剥离 DCP 注入的 nudge，动态抬高软阈值
      for (const msg of output.messages) {
        for (const part of msg.parts) {
          if (part.type === "text" && typeof part.text === "string") {
            part.text = part.text.replace(NUDGE_RE, "")
          }
        }
      }
    },

    "chat.message": async (input) => {
      // 用户发新消息 = 恢复信号，重置计数
      failuresBySession.delete(input.sessionID)
    },
  }
}

export default AdaptiveCompressBackoff
