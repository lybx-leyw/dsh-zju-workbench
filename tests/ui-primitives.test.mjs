/**
 * 共享原语的**出口清单**契约。
 *
 * `dsh-zhiyun-shell-ui` 的入口是 `src/client.jsx`，它把 `primitives.jsx` 的东西
 * **逐个解构**再导出：
 *
 *     export const { Icon, Mark, … } = primitives;
 *
 * 于是新增一个原语时有个很容易漏的一步：在 `primitives.jsx` 里写好、在入口的清单里
 * 忘了加。症状非常难查 ——
 *
 *   - 构建**成功**，产物里也能搜到那个名字（它在 primitives 的命名空间里）；
 *   - 使用方 `import { 新原语 } from 'dsh-zhiyun-shell-ui'` 拿到 `undefined`；
 *   - React 抛 #130「Element type is invalid」，**整块插槽**崩掉、界面上凭空少一片，
 *     而报错栈是压缩过的，指不到这一行。
 *
 * 这个坑真踩过（新加的 `StudentAvatar` 漏在了入口清单里，侧栏整条消失）。
 * 所以这里把两个文件的导出名对一遍：静态比对，不需要起宿主。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

test('原语的入口清单与 primitives.jsx 的导出一一对应（漏一个就整块插槽崩掉）', () => {
  const primitives = read('packages/dsh-zhiyun-shell-ui/src/primitives.jsx');
  const client = read('packages/dsh-zhiyun-shell-ui/src/client.jsx');

  // `export function X` / `export const X` / `export let X` / `export class X`
  const exported = [...primitives.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)]
    .map((match) => match[1]);

  const list = /export const \{([^}]*)\} = primitives;/.exec(client);
  assert.ok(list !== null, 'client.jsx 里应有一条 `export const { … } = primitives;`（形状变了就要改本条测试）');
  const reexported = list[1].split(',').map((name) => name.trim()).filter(Boolean);

  // 两条自检：解析要是失效了（正则没匹配到、写法变了），断言必须在**这里**红，
  // 而不是因为"两个空清单相等"而静默通过。
  assert.ok(exported.length >= 8, `primitives.jsx 的导出名解析结果太少（${exported.length}），正则大概失效了`);
  assert.ok(reexported.length >= 8, `入口清单解析结果太少（${reexported.length}），形状可能变了`);

  const missing = exported.filter((name) => !reexported.includes(name));
  assert.deepEqual(missing, [], `这些原语没有从入口导出，使用方会拿到 undefined：${missing.join('、')}`);
});
