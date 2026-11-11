/**
 * 真浏览器测试的**统一启动器**。
 *
 * # 为什么不能写死一个入口
 *
 * 这些用例必须用真浏览器（pdf.js 要画 canvas、版式要量 bounding box），但
 * 「哪一份 Chromium 能起来」因机器而异，实测三种情况都出现过：
 *
 *   - Playwright 自带的那份 `chromium.executablePath()` 缺系统库
 *     （Linux 上 `libcairo.so.2: cannot open shared object file`）；
 *   - 只有系统装的 Edge（Windows 开发机），`channel: 'msedge'` 才起得来；
 *   - 只有默认的 headless shell，此时**不能**传 `executablePath`。
 *
 * 写死其中任何一种，结果都是「换一台机器整组红」，而红的原因与被测代码无关 ——
 * 那会训练人忽略红色。所以按「默认 → 环境变量指定 → 系统 Edge / Chrome」
 * 依次试，全都不行就 `skip` 并说明原因。
 *
 * 用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 显式指定可绕开探测。
 *
 * @returns {Promise<import('playwright').Browser|null>} 起不来的浏览器一律 `null`。
 */
export async function launchBrowser() {
  const { chromium } = await import('playwright');
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const attempts = [];
  // 默认入口先试：headless shell 不依赖那批系统库，是容器里唯一稳的那条。
  if (explicit) attempts.push({ executablePath: explicit });
  attempts.push({});
  attempts.push({ channel: 'msedge' });
  attempts.push({ channel: 'chrome' });

  const problems = [];
  for (const options of attempts) {
    try {
      return await chromium.launch({ headless: true, ...options });
    } catch (error) {
      problems.push(`${JSON.stringify(options)}: ${String(error?.message ?? error).split('\n')[0]}`);
    }
  }
  console.error(`[browser] 没有可用的 Chromium：\n  ${problems.join('\n  ')}`);
  return null;
}

/**
 * 起一个浏览器并保证收尾；起不来就 `skip`（不是失败）。
 *
 * @param {object} t - `node:test` 的 TestContext。
 * @param {(browser) => Promise<void>} run
 */
export async function withBrowser(t, run) {
  const browser = await launchBrowser();
  if (browser === null) {
    t.skip('没有可启动的 Chromium（装 Playwright 浏览器，或设 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH）');
    return;
  }
  try {
    await run(browser);
  } finally {
    await browser.close().catch(() => {});
  }
}
