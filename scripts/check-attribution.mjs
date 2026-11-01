// 校验 ATTRIBUTION 完整性：根文件里每个包级链接都必须指向真实文件；
// 每个含 vendor 副本的包都必须有自己的 ATTRIBUTION.md。
import fs from 'node:fs';
import path from 'node:path';

const root = fs.readFileSync('ATTRIBUTION.md', 'utf8');
const failures = [];

// 1. 根文件里所有指向包级 ATTRIBUTION 的链接都要存在。
const links = [...root.matchAll(/\]\((packages\/[^)]+\/ATTRIBUTION\.md)\)/g)].map(m => m[1]);
const unique = [...new Set(links)];
for (const link of unique) {
  if (!fs.existsSync(path.resolve(link))) failures.push(`dangling link: ${link}`);
}
console.log(`包级链接 ${unique.length} 条，全部存在：${failures.length === 0 ? '是' : '否'}`);

// 2. 每个 vendor 了第三方内容的包都要有 ATTRIBUTION.md。
const vendors = [];
for (const name of fs.readdirSync('packages')) {
  const dir = path.join('packages', name);
  if (!fs.statSync(dir).isDirectory()) continue;
  const vendor = path.join(dir, 'vendor');
  if (!fs.existsSync(vendor)) continue;
  const files = fs.readdirSync(vendor);
  if (!files.length) continue;
  vendors.push({ name, files });
  if (!fs.existsSync(path.join(dir, 'ATTRIBUTION.md'))) failures.push(`vendor without ATTRIBUTION: packages/${name}/vendor (${files.join(', ')})`);
}
console.log(`含 vendor/ 的包 ${vendors.length} 个：${vendors.map(v => v.name).join(', ')}`);

// 3. 根文件不得再把 OpenMAIC 归在「仅参考」一节。
const referenceSection = root.slice(root.indexOf('## 仅参考，未引入实现'), root.indexOf('## 运行时依赖的第三方插件'));
if (referenceSection.includes('OpenMAIC')) failures.push('OpenMAIC 仍出现在「仅参考」一节');

// 4. 两个上游提交都要写出来。
for (const commit of ['03dee2bb4e1bf2e3296ad05ca1f78ce863452921', '0ae3215e965412b8ee536feaa5d98f75b7a70923']) {
  if (!root.includes(commit)) failures.push(`missing upstream commit: ${commit}`);
}

// 5. LGPL 例外必须被记录。
if (!root.includes('LGPL-3.0-or-later')) failures.push('mathml2omml 的 LGPL 例外未记录');

// 6. 致谢与临时实现声明必须在。
if (!root.includes('## 关于「临时实现」与致谢')) failures.push('缺少临时实现与致谢声明');

console.log('');
if (failures.length) {
  console.error('FAILURES:');
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
console.log('ATTRIBUTION 完整性检查通过');
