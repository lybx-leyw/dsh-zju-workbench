/**
 * 路径约定。DSH 插件经 CAMPUS_PROFILE_DIR 给出档案目录，默认 $DSH_HOME/zju-campus/profile。
 * 所有可变数据在它旁边的 zju 目录下，可用 ZJU_DATA_DIR 覆盖。
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function profileDir(): string {
  const given = process.env["CAMPUS_PROFILE_DIR"];
  if (given && given.trim()) return path.resolve(given);
  return path.join(process.env["DSH_HOME"] || path.join(os.homedir(), ".dsh"), "zju-campus", "profile");
}

export function dataDir(): string {
  const override = process.env["ZJU_DATA_DIR"];
  return override && override.trim() ? path.resolve(override) : path.join(path.dirname(profileDir()), "zju");
}

/**
 * 命令行里给的输出位置（--out、--out-dir）。相对路径照常从当前目录算；当前目录在本技能自己的目录里时，改从输出目录算。
 * 技能的目录是应用装着的地方：装在 C:\Program Files 下面写不进去，写得进去时升级也会把它整个换掉。
 * 助手有时把工作目录切到这里、再给一个相对的路径，文件不该落在里面。命令的结果里写的是完整路径，落在哪看得到。
 */
export function outPath(given: string, cwd = process.cwd()): string {
  if (path.isAbsolute(given)) return path.resolve(given);
  const fromRoot = path.relative(ROOT, cwd);
  const inside = fromRoot !== ".." && !fromRoot.startsWith(".." + path.sep) && !path.isAbsolute(fromRoot);
  return path.resolve(inside ? paths.output() : cwd, given);
}

export const paths = {
  root: ROOT,
  data: dataDir,
  sessions: () => path.join(dataDir(), "sessions"),
  session: (system: string) => path.join(dataDir(), "sessions", `${system}.json`),
  journal: () => path.join(dataDir(), "journal"),
  output: () => path.join(dataDir(), "output"),
  raw: () => path.join(dataDir(), "raw"),
  cache: () => path.join(dataDir(), "cache"),
  db: () => path.join(dataDir(), "zju.db"),
  envFile: () => path.join(ROOT, ".env"),
} as const;
