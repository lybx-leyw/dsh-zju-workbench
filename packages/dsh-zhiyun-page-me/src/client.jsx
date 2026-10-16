// 「个人」页：空间与偏好、宿主设置面板的落点。
//
// 账号区块（登录表单 / 已连接状态）曾经是这一页的一部分，现在搬去了**导轨头像的
// 账号对话框**（壳声明 `sidebar.account.signin`，内容仍由本包提供）。理由很简单：
// 登录是应用级动作，入口在头像那一层，而不是"设置页上的一个区块" —— 于是它不再
// 因为「个人」页被停用而消失。
import React, { useState } from 'react';
import { Icon, Mark, Notice, SectionTitle, mountStyle, useStudy } from 'dsh-zhiyun-ui-primitives';
import css from './style.css';

export const name = 'zhiyun-page-me-client';
export const inject = ['slots'];
export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zhiyunMeStyle', css, label: 'zhiyun: me page styles' });
  // 账号区块读的是领域状态，所以等服务到位再注册；服务缺失时那一格是空的。
  ctx.inject(['zhiyunStudyController'], (scope) => {
    scope.slots.inject('sidebar.account.signin', () => scope.slots.register(
      { name: 'sidebar.account.signin' },
      () => <Account controller={scope.zhiyunStudyController} />,
    ));
  });
  ctx.slots.inject('zhiyun.me.content', () => ctx.slots.register({ name: 'zhiyun.me.content' }, Personal));
}

/**
 * 账号区块。**没有自己的标题** —— 它住在账号对话框里，标题由对话框给
 * （否则"登录智云课堂"下面又顶一个"智云课堂"，两行字说同一件事）。
 */
export function Account({ controller }) {
  const s = useStudy(controller), [username, setUsername] = useState(""), [password, setPassword] = useState("");
  return <section className="zs-account" aria-label="智云课堂账号"><p>{s.user ? `已连接 · ${s.user.name ?? s.user.id}` : "使用浙大统一身份认证账号连接课堂"}</p>{s.loading ? <p>正在读取账号状态…</p> : s.user ? <button className="zs-button" disabled={s.busy} onClick={() => controller.logout()}>退出课堂账号</button> : <form onSubmit={(e) => {
    e.preventDefault();
    const credentials = { username, password };
    setPassword("");
    void controller.authenticate(credentials);
  }}><label>浙大账号<input name="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label><label>密码<input name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label><button className="zs-primary" disabled={s.busy}>{s.busy ? "正在登录…" : "连接课堂"}</button></form>}<Notice>{s.error}</Notice></section>;
}

/** 页面正文。`renderSlot` 由壳在 main 面板的 owner 参数里交过来（本页要嵌网络代理那一块）。 */
export function Personal({ controller, renderSlot }) {
  return <><div className="zy-intro"><div><span className="zy-eyebrow">按自己的节奏</span><h1>个人</h1><p>你的偏好、AI 服务与学习空间，都在这里。</p></div><Icon name="user" size={38}/></div><div className="zy-person-card"><Mark large/><div><h2>我的学习空间</h2><p>让每一次学习，都更合心意。</p></div><span className="zy-tag">本地独立空间</span></div><SectionTitle>空间与偏好</SectionTitle>{renderSlot('zhiyun.me.network', {})}<div className="zy-card zy-preferences"><div><span><strong>明暗外观</strong><small>调整阅读时的光线与氛围</small></span><button className="zy-secondary" onClick={controller.toggleTheme}><Icon name="moon" size={16}/>切换明暗</button></div></div><div id="zy-personal-settings" aria-label="个人设置"/><p className="zy-personal-note">按需展开设置，留更多空间给学习。</p></>;
}
