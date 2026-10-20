// 「个人」页：空间与偏好、宿主设置面板的落点。
//
// 账号区块（登录表单 / 已连接状态）曾经是这一页的一部分，现在搬去了**导轨头像的
// 账号对话框**（壳声明 `sidebar.account.signin`，内容仍由本包提供）。理由很简单：
// 登录是应用级动作，入口在头像那一层，而不是"设置页上的一个区块" —— 于是它不再
// 因为「个人」页被停用而消失。
import React from 'react';
import { Icon, Mark, Notice, SectionTitle, mountStyle } from 'dsh-zhiyun-ui-primitives';
import css from './style.css';

export const name = 'zhiyun-page-me-client';
export const inject = ['slots'];
export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zhiyunMeStyle', css, label: 'zhiyun: me page styles' });
  // 账号区块是**独立**的：它不再依赖 `zhiyunStudyController`（那个控制器本该属于
  // 学习页，而账号入口不该因为领域包停用就消失）。
  ctx.slots.inject('sidebar.account.signin', () => ctx.slots.register(
    { name: 'sidebar.account.signin' },
    Account,
  ));
  ctx.slots.inject('zhiyun.me.content', () => ctx.slots.register({ name: 'zhiyun.me.content' }, Personal));
}

/**
 * 账号区块。
 *
 * # 现在是一个**占位**
 *
 * 这里原来是「连接课堂」表单：填浙大账号密码 → 写进宿主凭据 → 智云课堂登录。
 * 那条路已经拆掉了，原因有两个：
 *
 * 1. **登录是应用级动作，不该挂在这一层。** 这个对话框将来要接我们自己的账号体系
 *    （平台账号，与浙大凭证无关）。把浙大凭证的入口留在这里，会让人以为
 *    "登录这个工作台 = 登录浙大课堂"，两件事被绑死。
 * 2. **浙大凭证改了归属。** 「浙大一卡通」现在在「设置」里配置，由智云课堂与
 *    学在浙大**共用**（见 `dsh-zhiyun-card`）。它不再属于某一个页面。
 *
 * 所以这里只留一句说明 + 指路，不再有任何输入框。等我们自己的登录策略落地时，
 * 这块就是它的位置。
 *
 * ⚠️ 不要在这里加回账号密码输入框：那会让"平台账号"与"浙大凭证"再次混在一起。
 */
export function Account() {
  return (
    <section className="zs-account" aria-label="账号">
      <p>账号功能正在重做。</p>
      <p className="zs-account-hint">
        浙大课堂与学在浙大用的账号，现在去<strong>「设置 → 浙大一卡通」</strong>配置一次即可，
        两处共用同一份。
      </p>
      <Notice>这个入口将来会接工作台自己的账号体系，与浙大凭证无关。</Notice>
    </section>
  );
}

/** 页面正文。`renderSlot` 由壳在 main 面板的 owner 参数里交过来（本页要嵌网络代理那一块）。 */
export function Personal({ controller, renderSlot }) {
  return <><div className="zy-intro"><div><span className="zy-eyebrow">按自己的节奏</span><h1>个人</h1><p>你的偏好、AI 服务与学习空间，都在这里。</p></div><Icon name="user" size={38}/></div><div className="zy-person-card"><Mark large/><div><h2>我的学习空间</h2><p>让每一次学习，都更合心意。</p></div><span className="zy-tag">本地独立空间</span></div><SectionTitle>空间与偏好</SectionTitle>{renderSlot('zhiyun.me.network', {})}<div className="zy-card zy-preferences"><div><span><strong>明暗外观</strong><small>调整阅读时的光线与氛围</small></span><button className="zy-secondary" onClick={controller.toggleTheme}><Icon name="moon" size={16}/>切换明暗</button></div></div><div id="zy-personal-settings" aria-label="个人设置"/><p className="zy-personal-note">按需展开设置，留更多空间给学习。</p></>;
}
