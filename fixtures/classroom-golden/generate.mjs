#!/usr/bin/env node
/**
 * 重新生成 `fixtures/classroom-golden/` 的两个二进制同级产物。
 *
 *   node fixtures/classroom-golden/generate.mjs
 *
 * 语料是本目录的 `classroom.json`（一个 4 场景课堂：slide / interactive / quiz / pbl，
 * 故意乱序存放）。生成用的是本仓导出包本身，因此**只有在确认导出层改动是预期的时候**
 * 才重跑；跑完看 `git diff`（本仓无 git 时看文件 mtime）并说明理由。
 *
 * 产物：
 *   classroom.html   html() 的结果（parity 的「场景序列」「DOM 文本」两个维度都读它）
 *   classroom.pptx   pptx() 的结果（「PPTX 结构」维度读它）
 *
 * 不生成 `classroom.json`：它是输入，不是产物。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const exportUrl = pathToFileURL(
  path.join(root, 'packages', 'dsh-zhiyun-core-classroom-export', 'src', 'index.js'),
).href;
const plugin = await import(exportUrl);

const doc = JSON.parse(await readFile(path.join(here, 'classroom.json'), 'utf8'));

// 最小 Cordis 假 ctx：导出包只认 `ctx.provide`（见 tests/classroom-export.test.mjs）。
const provided = new Map();
const log = { debug() {}, info() {}, warn() {}, error() {} };
plugin.apply({
  logger: log,
  get: (name) => provided.get(name),
  provide: (name, value) => { provided.set(name, value); return () => provided.delete(name); },
  on() {},
}, { logger: log });

const service = provided.get('zhiyunClassroomExport');
if (!service) throw new Error('导出服务没有注册');

const classroom = {
  stage: doc.stage,
  scenes: doc.scenes,
  // 图片用归档 ref，这里给一段 8×8 PNG，产物里的 data: URI 才是稳定的。
  assets: {
    golden_leaf: {
      bytes: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGNQOhqHFTEMLQkAsJlRQXS/RwMAAAAASUVORK5CYII=',
        'base64',
      ),
      mimeType: 'image/png',
    },
  },
};

const html = await service.html(classroom, { lang: 'en' });
const pptx = await service.pptx(classroom, { lang: 'en' });

await writeFile(path.join(here, 'classroom.html'), html);
await writeFile(path.join(here, 'classroom.pptx'), pptx);
console.log(`classroom.html ${html.length} 字节；classroom.pptx ${pptx.length} 字节`);
