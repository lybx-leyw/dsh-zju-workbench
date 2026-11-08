/**
 * 命令行里给的输出位置（lib/core/paths.ts 的 outPath）：相对路径从当前目录算，当前目录在技能自己的目录里时改从输出目录算。不联网。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { ROOT, outPath, paths } = await import("../lib/core/paths.ts");
const { validateOptions } = await import("../lib/core/command.ts");

test("完整路径照原样；相对路径从当前目录算", () => {
  const chat = path.resolve(path.sep, "chat", "今天");
  assert.equal(outPath(path.join(chat, "作业.pdf"), ROOT), path.join(chat, "作业.pdf"));
  assert.equal(outPath("作业.pdf", chat), path.join(chat, "作业.pdf"));
  assert.equal(outPath(path.join("课件", "第一讲"), chat), path.join(chat, "课件", "第一讲"));
  // 名字的前一截和技能目录一样的不是技能目录；技能目录的上一级也不是。
  assert.equal(outPath("a.pdf", ROOT + "-old"), path.join(ROOT + "-old", "a.pdf"));
  assert.equal(outPath("a.pdf", path.dirname(ROOT)), path.join(path.dirname(ROOT), "a.pdf"));
});

test("当前目录在技能自己的目录里时，相对路径落在输出目录，不落进装应用的地方", () => {
  for (const cwd of [ROOT, path.join(ROOT, "scripts"), path.join(ROOT, "lib", "doc")]) {
    assert.equal(outPath("作业.pdf", cwd), path.join(paths.output(), "作业.pdf"), cwd);
    assert.equal(outPath(path.join(".", "课件"), cwd), path.join(paths.output(), "课件"), cwd);
  }
});

test("各个模块的 --out、--out-dir 都经过这一处；别的选项不动", () => {
  const options = { out: { description: "存到哪" }, "out-dir": { description: "保存目录" }, file: { description: "输入文件" } };
  const here = process.cwd(), elsewhere = fs.realpathSync(os.tmpdir());
  try {
    process.chdir(ROOT);
    assert.deepEqual(validateOptions(options, { out: "a.pdf", "out-dir": "课件", file: "b.docx" }), { out: path.join(paths.output(), "a.pdf"), "out-dir": path.join(paths.output(), "课件"), file: "b.docx" });
    process.chdir(elsewhere);
    assert.deepEqual(validateOptions(options, { out: "a.pdf", file: "b.docx" }), { out: path.join(elsewhere, "a.pdf"), file: "b.docx" });
  } finally { process.chdir(here); }
});
