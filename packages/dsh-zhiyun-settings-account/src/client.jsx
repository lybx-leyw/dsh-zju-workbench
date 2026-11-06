// 账号与数据：**头像登录对话框** + 原生设置里的「账号与数据」分区。
//
// # 为什么不放在某个页面上
//
// 这两件事都不属于任何一条学习动线：
//   - 登录是**应用级动作**，入口在导轨头像那一层，所以它注册 `sidebar.account.signin`，
//     显示在「头像 → 登录」对话框里；
//   - 账号状态与数据统计是对**整个工作台**的描述，属于设置，所以进原生设置浮窗。
//
// 早先它们住在「个人」页（`dsh-zhiyun-page-me`）。那一页除了这两块之外没有别的内容，
// 于是一整页只为承载两个设置项。页面删掉之后，登录对话框与设置分区各自独立存在：
// 停用本包时登录入口与设置分区一起消失，但导航、其他页面都不受影响。
//
// ⚠️ 不要在这里加回浙大账号密码输入框。浙大凭证是**宿主凭据**，由
//    `dsh-zhiyun-source-card` 的「浙大一卡通」分区读写；这个对话框将来要接工作台
//    自己的账号体系，两者不能混在一起。
import React from 'react';
import { Icon, Notice, SectionTitle, mountStyle } from '@lybx-leyw/dsh-zju-ui-shared';
import css from './style.css';

export const name = 'zhiyun-settings-account-client';
export const inject = ['slots'];
export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zhiyunAccountStyle', css, label: 'zhiyun: account settings styles' });
  // 登录对话框的正文。壳只负责什么时候把它显示出来，不认识里面的内容。
  ctx.slots.inject('sidebar.account.signin', () => ctx.slots.register(
    { name: 'sidebar.account.signin' },
    Account,
  ));
  // order 10：排在网络代理（20）、一卡通（60）之前 —— 账号与数据是这一栏最上面、
  // 最先想确认的一件事，具体凭据配置往后排。
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'account-data',
    order: 10,
    label: () => '账号与数据',
  }, AccountData));
}

/**
 * 头像 → 登录 的对话框正文。
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
 *    学在浙大**共用**（见 `dsh-zhiyun-source-card`）。
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

/**
 * 设置里的「账号与数据」分区。
 *
 * 两块都是**占位**：账号状态要等平台账号体系落地，数据统计要先有采集口径。
 * 明确写清在等什么，而不是摆一句「暂无数据」—— 后者读起来像故障。
 */
export function AccountData() {
  return <div className="zy-account-data">
    <SectionTitle>账号</SectionTitle>
    <div className="zy-account-card">
      <div>
        <span>
          <strong>工作台账号</strong>
          <small>还没有接入。当前的学习记录都保存在本地工作区里。</small>
        </span>
        <span className="zy-account-tag">未接入</span>
      </div>
    </div>
    <SectionTitle>数据</SectionTitle>
    <div className="zy-account-card">
      <div>
        <span>
          <strong>学习统计</strong>
          <small>学习时长、课程进度与练习记录，正在规划中</small>
        </span>
      </div>
    </div>
    <p className="zy-account-note">
      浙大课堂的账号密码在「浙大一卡通」里配置，与本页无关。
    </p>
  </div>;
}
