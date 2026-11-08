/**
 * 子行。根行的服务（ctx.zjuCampus）在时才挂上，根行关掉它就跟着停下。
 * 开着的这段时间里告诉根行自己在：技能正文里有没有这一行的那一段、页面上显不显示它的东西、ZJU Core 执不执行它管的模块，都照这个。
 * start 是这一行自己的东西：工具、后台检查、监控着的聊天和公众号，在这一行的 ctx 里登记，行关掉时引擎一起收回。
 * inject 是 start 里还要用的引擎服务。
 */
export function row(key, { inject = [], start } = {}) {
  return {
    name: `zju-campus-${key}`,
    inject: ['zjuCampus', ...inject],
    apply(ctx) {
      ctx.effect(() => ctx.zjuCampus.activate(key), `zju-campus: ${key} row`)
      start?.(ctx, ctx.zjuCampus)
    },
  }
}
