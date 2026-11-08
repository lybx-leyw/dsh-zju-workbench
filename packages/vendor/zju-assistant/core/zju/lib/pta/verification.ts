import net from "node:net";
import { NeedsUser } from "../core/errors.ts";

export interface CaptchaProof { ticket: string; randStr: string }
export type VerifyCaptcha = () => Promise<CaptchaProof>;

const HINTS: Record<string, string> = {
  browser_missing: "这台电脑上没找到能用的浏览器，请装一个 Chrome 或 Edge 后重新查询",
  verification_required: "请在对话里重新查询，完成官方窗口中的验证后会自动继续",
  plugin_disabled: "请在插件页启用「课程与学习」后重新查询",
  verification_cancelled: "验证窗口已关闭，本次没有继续提交密码",
  verification_timeout: "没有在限定时间内完成验证，请重新查询",
};

/** 复用 DSH 插件的微信读书验证桥。请求不含账号、密码、Cookie，回传票据不落盘。 */
export const verifyCaptcha: VerifyCaptcha = async () => {
  const endpoint = process.env.PTA_BROWSER_ENDPOINT;
  if (!endpoint) throw new NeedsUser("PTA 登录需要验证码", "请在 DeepSeek Harness 的校园插件中重新查询以完成验证；也可正常网页登录后导入本人会话");
  return new Promise((resolve, reject) => {
    const socket = net.connect(endpoint);
    let received = "", settled = false;
    const finish = (error?: Error, proof?: CaptchaProof) => {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(proof!);
    };
    const timer = setTimeout(() => finish(new NeedsUser("PTA 登录验证超时", HINTS.verification_timeout)), 300_000);
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(JSON.stringify({ id: 1, action: "ptaCaptcha", input: {}, interactive: process.env.PTA_INTERACTIVE === "1" }) + "\n"));
    socket.on("data", (chunk: string) => {
      received += chunk;
      if (received.length > 64 * 1024) { finish(new NeedsUser("PTA 验证返回异常，本次未继续登录")); return; }
      if (!received.includes("\n")) return;
      let reply: { id?: number; result?: { ticket?: unknown; randstr?: unknown }; error?: { code?: string } };
      try { reply = JSON.parse(received.slice(0, received.indexOf("\n"))); }
      catch { finish(new NeedsUser("PTA 验证返回无效数据，本次未继续登录")); return; }
      if (reply?.id !== 1) { finish(new NeedsUser("PTA 验证回执不匹配，本次未继续登录")); return; }
      if (reply.error) {
        finish(new NeedsUser("PTA 登录验证未完成", HINTS[reply.error.code ?? ""] ?? "请重新查询，在官方窗口完成验证")); return;
      }
      const proof = reply.result;
      if (typeof proof?.ticket !== "string" || !proof.ticket || typeof proof.randstr !== "string" || !proof.randstr) {
        finish(new NeedsUser("PTA 验证没有返回有效票据，本次未继续登录")); return;
      }
      finish(undefined, { ticket: proof.ticket, randStr: proof.randstr });
    });
    socket.once("error", () => finish(new NeedsUser("连不上 PTA 验证浏览器", "请确认 DeepSeek Harness 中的校园插件正在运行")));
    socket.once("close", () => finish(new NeedsUser("PTA 验证连接已断开，本次未继续登录")));
  });
};
