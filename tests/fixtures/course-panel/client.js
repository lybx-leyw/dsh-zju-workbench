// Test-only provider. Never included in the product profile.
//
// ⚠️ 它遮蔽的是**「今天」页的正文**，不是某个测试专用的插槽。
//    这里曾经是 `zhiyun.courses.content` —— 「我的课」这个页面包并入「学习」之后
//    那个插槽就没人声明了，注册会抛 "slot ... is not declared"。
//    更重要的理由：这条用例证的是「外部插件能顶掉产品自己的页面内容，并且只通过
//    `zhiyunNavigation` 服务跳转」—— 插槽名换了，断言的东西没变。
//    `priority: 0` 低于页面包的 10，按宿主的「低的先渲染」规则遮蔽它。
window.__ModuleLoader__.load({ id: 'zhiyun-test-course-panel', factory: require => {
  const React = require('react');
  return {
    inject: ['slots', 'zhiyunNavigation'],
    apply(ctx) {
      ctx.slots.inject('zhiyun.today.content', () => ctx.slots.register({ name: 'zhiyun.today.content', priority: 0 }, () => React.createElement('section', { 'data-test-course-provider': true },
        React.createElement('h1', null, '测试课程扩展已接入'),
        React.createElement('button', { onClick: () => ctx.zhiyunNavigation.navigate('study') }, '去学习'),
      )));
    },
  };
} });
