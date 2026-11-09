/**
 * 智云的文件默认落在哪：用户自己打得开的「文档」里，不放应用数据目录。
 *   <文档>\CampusAgent\课程\<课程名>\第N次 日期\   下载的回放、课件、截图、字幕
 *   <文档>\CampusAgent\转写\<文件名>\              别处的录音和课件转出来的文字
 * 课次文件夹里的文件转写后留在那一次课里：<课次>\转写\<文件名>\。
 * CAMPUS_CHATS_DIR 把 <文档>\CampusAgent 整个换掉（和对话文件夹同一个开关，测试时用）。
 */
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { readJson } from "../core/fsjson.ts";
import { safeName } from "./download.ts";
import type { Lesson } from "./types.ts";

/** 「文档」可能被挪到别的盘或 OneDrive 里，Windows 上问系统要；做法与 ui/profile/chats.mjs 相同。 */
function documents(): Promise<string> {
  const fallback = path.join(os.homedir(), "Documents");
  if (process.platform !== "win32") return Promise.resolve(fallback);
  return new Promise(resolve => {
    const command = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments)";
    execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 10_000 }, (error, stdout) => {
      const found = error ? "" : stdout.trim();
      resolve(found && path.isAbsolute(found) ? found : fallback);
    });
  });
}

let located: Promise<string> | undefined;
export function campusDocuments(): Promise<string> {
  const given = process.env["CAMPUS_CHATS_DIR"]?.trim();
  return located ??= given ? Promise.resolve(path.resolve(given)) : documents().then(found => path.join(found, "CampusAgent"));
}

export async function courseDir(title: string): Promise<string> {
  return path.join(await campusDocuments(), "课程", safeName(title));
}

/** 一次课的文件夹。课表变动后「第几次」会重排：同名文件夹里已经装着别的课次时，另起一个带课次编号的。 */
export function lessonDir(course: string, lesson: Lesson): string {
  const date = lesson.startsAt?.slice(0, 10);
  const folder = path.join(course, `第${lesson.lesson}次${date ? ` ${date}` : ""}`);
  const held = readJson<{ lessons?: { lessonId?: string }[] }>(path.join(folder, "download.json"))?.lessons?.[0]?.lessonId;
  return held === undefined || held === lesson.subId ? folder : `${folder} ${lesson.subId}`;
}

/** 录音或课件转出来的文字放哪。 */
export async function transDir(file: string): Promise<string> {
  const root = await campusDocuments(), source = path.resolve(file);
  const relative = path.relative(path.join(root, "课程"), source), inside = relative.split(path.sep);
  // 课程\<课程名>\<课次>\… 里的文件：至少有课程、课次、文件名三段，且没有走出课程目录（另一个盘上的会得到绝对路径）。
  const lesson = inside.length >= 3 && inside[0] !== ".." && !path.isAbsolute(relative) ? path.join(root, "课程", inside[0]!, inside[1]!) : root;
  return path.join(lesson, "转写", safeName(path.basename(source)));
}
