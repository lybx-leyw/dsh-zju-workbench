/**
 * 场馆验证码交给模型认的那一步（lib/tyys/captcha.ts）：放大、从回答里取出认到的字、按字对坐标、认不齐不作答，
 * 以及经管道找应用问模型时的几种结果。模型是假的，不联网；管道那一头用一个本机的小服务顶替引擎。
 */
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";

const { CaptchaSolver, askApp, enlarge, glyphsIn, locate } = await import("../lib/tyys/captcha.ts");

/** 和场馆的题图一样大的一张空白图。 */
const blank = PNG.sync.write(new PNG({ width: 310, height: 155 })).toString("base64");
const words = ["岁", "平", "信"];
/** 模型按放大三倍以后的图给坐标。 */
const glyphs = [{ char: "平", x: 654, y: 48 }, { char: "岁", x: 570, y: 324 }, { char: "信", x: 315, y: 366 }, { char: "到", x: 135, y: 294 }];
const expected = [{ x: 190, y: 108 }, { x: 218, y: 16 }, { x: 105, y: 122 }];

/** 顶替引擎的那一头：收一行请求，照 reply 回一行。返回管道地址和收到的请求。 */
async function bridge(t: { after(fn: () => void): void }, reply: (request: Record<string, string>) => unknown) {
  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\zju-captcha-test-${randomUUID()}` : path.join(os.tmpdir(), `zju-captcha-test-${randomUUID().slice(0, 8)}.sock`);
  const requests: Record<string, string>[] = [];
  const server = net.createServer(socket => {
    let received = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      received += chunk;
      if (!received.includes("\n")) return;
      const request = JSON.parse(received) as Record<string, string>;
      requests.push(request);
      const value = reply(request);
      socket.end(typeof value === "string" ? value : JSON.stringify(value) + "\n");
    });
  });
  await new Promise<void>(resolve => server.listen(endpoint, resolve));
  const previous = process.env.CAMPUS_MODEL_ENDPOINT;
  process.env.CAMPUS_MODEL_ENDPOINT = endpoint;
  t.after(() => { server.close(); if (previous === undefined) delete process.env.CAMPUS_MODEL_ENDPOINT; else process.env.CAMPUS_MODEL_ENDPOINT = previous; });
  return requests;
}

test("不在应用里跑时说明认不了，不去连", async () => {
  delete process.env.CAMPUS_MODEL_ENDPOINT;
  await assert.rejects(new CaptchaSolver().solve(blank, words), { code: "DEPENDENCY_MISSING" });
});

test("按认出的字对坐标：换回原图像素，保留题目顺序", () => {
  assert.deepEqual(locate(glyphs, words, 310, 155), expected);
});

test("题目里的字没有各认出正好一个、或者坐标在图外时不作答", () => {
  assert.equal(locate(glyphs.filter(g => g.char !== "信"), words, 310, 155), undefined);
  assert.equal(locate([...glyphs, { char: "平", x: 30, y: 30 }], words, 310, 155), undefined);
  assert.equal(locate(glyphs.map(g => g.char === "平" ? { ...g, x: 940 } : g), words, 310, 155), undefined);
  assert.equal(locate(glyphs.map(g => g.char === "平" ? { char: "平", x: "654", y: 48 } : g), words, 310, 155), undefined);
  assert.equal(locate(undefined, words, 310, 155), undefined);
});

test("回答里的 JSON 包着代码块、前后多说了话也取得出来；不是 JSON 就当没认出来", () => {
  assert.deepEqual(glyphsIn(JSON.stringify({ glyphs })), glyphs);
  assert.deepEqual(glyphsIn("好的，结果如下：\n```json\n" + JSON.stringify({ glyphs }, null, 2) + "\n```\n以上。"), glyphs);
  assert.equal(glyphsIn("认不出来"), undefined);
  assert.equal(glyphsIn("{ 坏的 }"), undefined);
});

test("放大三倍：尺寸对，颜色还是原来那两块", () => {
  const source = new PNG({ width: 2, height: 1 });
  source.data.set([0, 0, 0, 255, 255, 255, 255, 255]);
  const big = enlarge(source, 3);
  assert.deepEqual([big.width, big.height], [6, 3]);
  assert.deepEqual([...big.data.subarray(0, 4)], [0, 0, 0, 255]);
  assert.deepEqual([...big.data.subarray(5 * 4, 6 * 4)], [255, 255, 255, 255]);
});

test("交给模型的是题目和放大以后的图；模型答得不成样子时这道题不作答", async () => {
  let asked: { text: string; image: Buffer } | undefined;
  const solver = (answer: string) => new CaptchaSolver(undefined, async (text: string, image: Buffer) => { asked = { text, image }; return answer; });
  assert.deepEqual(await solver(JSON.stringify({ glyphs })).solve(blank, words), expected);
  assert.match(asked!.text, /岁、平、信/);
  const sent = PNG.sync.read(asked!.image);
  assert.deepEqual([sent.width, sent.height], [930, 465]);
  assert.equal(await solver("认不出来").solve(blank, words), undefined);
  assert.equal(await solver(JSON.stringify({ glyphs: glyphs.slice(0, 2) })).solve(blank, words), undefined);
});

test("经管道找应用问：图按 base64 的 PNG 交过去，拿回模型的回答", async t => {
  const requests = await bridge(t, () => ({ ok: true, text: JSON.stringify({ glyphs }) }));
  assert.deepEqual(await new CaptchaSolver().solve(blank, words), expected);
  assert.equal(requests[0]!.mediaType, "image/png");
  assert.equal(PNG.sync.read(Buffer.from(requests[0]!.image!, "base64")).width, 930);
});

test("应用说要用户去处理、这一次没问成、话没说完，各报各的；应用没开着时说连不上", async t => {
  const replies: unknown[] = [{ ok: false, code: "needs_user", message: "现在选的模型看不了图" }, { ok: false, code: "failed", message: "余额不足" }, "{\"ok\":tr"];
  await bridge(t, () => replies.shift());
  const image = Buffer.from(blank, "base64");
  await assert.rejects(askApp("题目", image), { code: "NEEDS_USER", message: /现在选的模型看不了图/ });
  await assert.rejects(askApp("题目", image), { code: "BAD_RESPONSE", message: /余额不足/ });
  await assert.rejects(askApp("题目", image), { code: "BAD_RESPONSE" });
  process.env.CAMPUS_MODEL_ENDPOINT = process.platform === "win32" ? `\\\\.\\pipe\\zju-captcha-test-${randomUUID()}` : path.join(os.tmpdir(), `zju-captcha-test-${randomUUID().slice(0, 8)}.sock`);
  await assert.rejects(askApp("题目", image), { code: "TRANSPORT" });
});
