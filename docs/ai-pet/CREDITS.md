# 致谢 / Credits

`docs/ai-pet/` 下的角色素材**不是本仓库原创**，来自下面两个上游项目，按 MIT 许可引入。
按许可要求保留版权声明，并对角色原作者署名。

## 角色设计

**鲸鱼娘** 角色设计：[ZipZipPipe](https://space.bilibili.com/4168597)

素材与代码中出现的该角色形象，版权归原作者所有。本仓库只做引用与展示，未主张任何权利，
也未对角色形象做改绘。若原作者认为使用不当，请联系本仓维护者移除。

## 素材来源

### whale-girl

- 仓库：https://github.com/vlln/whale-girl
- 作者：Sam Gao（vlln）
- 许可：MIT
- 引入内容：`lib/assets/manifest.json`、`lib/assets/characters/whale-girl/*.png`（15 张 sprite sheet）、
  `originals/鲸鱼娘.png`（存为 `assets/whale-girl-original.png`）

原文（`assets/LICENSE-whale-girl`）：

```
MIT License

Copyright (c) 2026 Sam Gao (vlln)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### dsh-desktop-pet（大肥鱼）

- 仓库：https://github.com/xiaoshihou514/dsh-desktop-pet
- 作者：xiaoshihou
- 许可：MIT
- 引入内容：**无图片素材**。该仓本身是桌面端 Electron/Tauri 外壳，sprite 由 whale-girl 插件在运行时提供。
  本目录的素材实际取自 whale-girl，此处列出该仓是因为「大肥鱼」桌面端是这套素材的展示场景，
  其 `THIRD_PARTY_NOTICES.md` 也明确记录了 whale-girl 与 ZipZipPipe 的署名关系。

## 许可兼容性说明

- 本仓的引入方式是**原样拷贝文件**，未修改像素，因此保留原 MIT 声明即可满足要求。
- MIT 覆盖的是**代码与素材文件**；角色形象本身的著作权仍属 ZipZipPipe，MIT 不能替代角色授权。
  若后续要把这个宠物用于商业发行，需要另行取得角色原作者的许可。
- `assets/manifest.json` 是上游数据文件，保留原样（含 `"credit": "ZipZipPipe"` 字段）。
