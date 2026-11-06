/**
 * 出题流水线的入口测试（仓库根路径的薄壳）。
 *
 * 用例本体在 `packages/dsh-zhiyun-core-question/tests/core-question.test.mjs`：
 * 与其它包一样把测试放在包内，才能保证「包单独拿出来也能自测」。
 * 这里只是把同一批用例挂到仓库根，让 `node tests/core-question.test.mjs` 也能跑
 * —— 两条命令跑的是**同一份断言**，不存在两份会漂移的用例。
 *
 * 运行：node tests/core-question.test.mjs
 */
import '../packages/dsh-zhiyun-core-question/tests/core-question.test.mjs';
