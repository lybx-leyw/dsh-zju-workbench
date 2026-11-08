/**
 * Word、Excel、PPT 转成 PDF 或纯文本，用的是应用自带的 Office 引擎（@deepseek-ai/libreoffice-kit，引擎的依赖，
 * 已经在安装包里，从应用根目录的 node_modules 里找）。不装 LibreOffice，也不用 Python。
 * 支持 doc、docx、odt、xls、xlsx、ods、ppt、pptx、odp；RTF 和 WPS 它不认。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BadResponse, ZjuError } from "../core/errors.ts";
import { engineExt } from "./sniff.ts";

interface Converter {
  convert(request: { inputPath: string; outputPath: string }): Promise<unknown>;
  dispose(): Promise<void>;
}
interface Kit { createConverter(options: { timeoutMs: number }): Promise<Converter> }

async function kit(): Promise<Kit> {
  try { return await import("@deepseek-ai/libreoffice-kit") as unknown as Kit; }
  catch (cause) { throw new ZjuError("DEPENDENCY_MISSING", "找不到应用自带的 Office 引擎", { hint: "Word、Excel、PPT 的转换要在校园智能体应用里用", cause }); }
}

export interface Converted { file: string; cleanup: () => Promise<void> }

/**
 * 把 file（真实格式的扩展名是 ext）转成 target。输入先拷进一个临时文件夹、换成引擎认识的名字再转：
 * 引擎按扩展名认格式，原来的名字可能带着错的扩展名。用完调 cleanup 删掉临时文件夹。
 */
export async function convertOffice(file: string, ext: string, target: "pdf" | "txt"): Promise<Converted> {
  const { createConverter } = await kit();
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "zju-doc-"));
  const cleanup = () => fs.rm(work, { recursive: true, force: true });
  try {
    const input = path.join(work, `input${engineExt(ext)}`), output = path.join(work, `output.${target}`);
    await fs.copyFile(file, input);
    const converter = await createConverter({ timeoutMs: 180_000 });
    try { await converter.convert({ inputPath: input, outputPath: output }); }
    finally { await converter.dispose(); }
    return { file: output, cleanup };
  } catch (error) {
    await cleanup();
    if (error instanceof ZjuError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new BadResponse(`文档转换失败：${detail}`, { file });
  }
}
