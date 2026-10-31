/**
 * dsh-zhiyun-classroom-dsl —— 课堂 DSL 内核包的**入口**。
 *
 * 本文件不含任何逻辑：上游 `@openmaic/dsl@0.12.0` 的构建产物被原样 vendored 到
 * `../vendor/dsl/`，这里只做一次 re-export。为什么不做 TS→JS 重写、也不改一行
 * 上游代码，见 `docs/architecture/classroom-port.md` 第 3 节（归属：vendor）。
 *
 * 来源：https://github.com/THU-MAIC/OpenMAIC
 * commit 0ae3215e965412b8ee536feaa5d98f75b7a70923 · MIT · 见 ATTRIBUTION.md
 */
export * from '../vendor/dsl/index.js';
