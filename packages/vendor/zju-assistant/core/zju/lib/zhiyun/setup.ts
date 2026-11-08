/** Local dependencies belong to zhiyun; setup is invoked only through its CLI/API. */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { paths } from "../core/paths.ts";
import { ConfigError, ZjuError } from "../core/errors.ts";
import { env } from "../core/env.ts";
import { prepareAsr } from "./asr.ts";
import { checkFfmpeg } from "./ffmpeg.ts";

export type SetupComponent = "all" | "media" | "asr";
export interface SetupOptions { component?: SetupComponent }

async function run(executable: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(process.stderr); child.stderr.pipe(process.stderr);
    child.once("error", (error: NodeJS.ErrnoException) => reject(error.code === "ENOENT" ? new ConfigError(`缺少命令 ${executable}`) : error));
    child.once("close", code => code === 0 ? resolve() : reject(new ConfigError(`${executable} 退出 ${code}`)));
  });
}
function missing(error: unknown): boolean {
  return error instanceof ZjuError && error.code === "DEPENDENCY_MISSING";
}
async function setupMedia() {
  try { return { component: "media", reused: true, ...await checkFfmpeg() }; }
  catch (error) { if (!missing(error)) throw error; }
  if (env("FFMPEG_PATH")) throw new ConfigError("FFMPEG_PATH 指向的程序不可用", "修复此路径，或取消覆盖后由 zhiyun setup --component media 安装");
  const destination = path.join(paths.data(), "tools", "zhiyun-media");
  await fs.mkdir(destination, { recursive: true });
  const args = ["install", "--prefix", destination, "--no-audit", "--no-fund", "--save-exact", "ffmpeg-static@5.3.0"];
  let executable = "npm";
  if (process.platform === "win32") {
    const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    try { await fs.access(npmCli); } catch { throw new ConfigError("无法定位 npm-cli.js", "请通过 npm run zju -- zhiyun setup --component media 调用，或配置 FFMPEG_PATH"); }
    executable = process.execPath; args.unshift(npmCli);
  }
  await run(executable, args);
  return { component: "media", reused: false, destination, ...await checkFfmpeg() };
}
/** 转写没有要装的环境：运行库随应用带着，这里只把模型备好（与应用的「语音输入」共用，已有就不下）。 */
async function setupAsr() {
  const { downloaded, ...info } = await prepareAsr();
  return { component: "asr", reused: !downloaded.length, ...info, ...(downloaded.length ? { downloaded } : {}) };
}
export async function setupLocal(opts: SetupOptions = {}) {
  const component = opts.component ?? "all";
  if (!["all", "media", "asr"].includes(component)) throw new ConfigError("component 必须为 all/media/asr");
  const results: Record<string, unknown>[] = [];
  if (component === "all" || component === "media") results.push(await setupMedia());
  if (component === "all" || component === "asr") results.push(await setupAsr());
  return { component, results };
}
