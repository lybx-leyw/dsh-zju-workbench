# dsh-zhiyun-page-me

「个人」页：空间信息、偏好开关，以及宿主设置面板的落点。

**改这一页的东西都在这里。** 页面正文（`Personal`）与账号区块（`Account`）都在本包。
账号区块**不再渲染在个人页正文上**：它注册进外壳的 `sidebar.account.signin`，
显示在「头像 → 登录」那个对话框里 —— 登录是应用级动作，入口在头像那一层。
它一度住在学习面板包里，后来跟着"页面包拥有自己页面上的一切"搬到这里；现在表面又变了，
于是**只换注册的插槽，组件仍留在本包**。

## 两个插槽

| 插槽 | 内容 | 谁声明 children |
| --- | --- | --- |
| `zhiyun.me.content` | 页面正文（个人卡片、偏好、设置入口 `#zy-personal-settings`） | 外壳 |
| `sidebar.account.signin` | 账号区块（登录表单 / 已连接状态），显示在账号对话框里 | 外壳 |

`Account` 用 `ctx.inject(['zhiyunStudyController'], …)` 惰性取领域状态。它现在**没有自己的标题**：对话框的头部已经写着「登录智云课堂」，里面再顶一个「智云课堂」就是两行字说同一件事。

`Personal` 从渲染参数里拿外壳给的 `controller`（`navigate / toggleTheme` —— 「切换明暗」走的就是壳的 `toggleTheme`）和 `renderSlot`（用它把网络代理那一块嵌进正文）。

> ⚠️ **「今天 / 我的课 / 学习」三页里的 `controller` 不是外壳的**：那几个包自己把
> `zhiyunStudyController` 绑给了页面组件，而它盖过外壳通过插槽注入的 owner props。
> 所以那三页的「登录智云课堂」按钮调的是**领域控制器**上的 `openAccount()` ——
> 学习核心把它顺着 `navigation` 转发给外壳（和 `navigate` 完全同一条路），
> 见 `dsh-zhiyun-core-study`。

`#zy-personal-settings` 是宿主设置适配器的落点：外壳的 `components.jsx` 用 MutationObserver 找到这个容器（`settings-adapter.js` 只做插槽条目的换装，不碰 DOM），再把原生设置分组 portal 进来。改这个 id 要同步改外壳。
