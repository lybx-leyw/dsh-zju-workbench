import { Command, InvalidArgumentError } from 'commander'
import { exportMarkdown } from './article.ts'
import { SkillError, outPath } from './config.ts'
import { accounts, list, listTracked, read, track, newArticles, type Options } from './sources.ts'
import { login, loginState, logout } from './web.ts'

/** 全部命令。每个命令只做一件事，结果交给 write 输出。 */
export function commands(write: (value: unknown) => void) {
  const root = new Command('weread').description('从微信读书找公众号文章，转成带图片的 Markdown').showHelpAfterError().exitOverride()
  const command = (name: string, description: string, run: (options: Options & { out: string }) => unknown) =>
    root.command(name).description(description).action(async options => {
      // 宿主应用把这项功能关掉时一条命令都不执行。
      if (process.env.WEREAD_DISABLED === '1') throw new SkillError('plugin_disabled', '这项功能在宿主应用里关着，请先在应用里打开。')
      write(await run(options))
    })
  const article = (target: Command) => target
    .option('--url <链接>', '微信原文链接，或 list 返回的文章链接；与 --account/--title 二选一')
    .option('--account <公众号>', '公众号名称，可以只写一部分；和 --title 一起用')
    .option('--title <标题>', '文章标题，可以只写一部分')
  const count = (value: string) => {
    if (!/^[1-9]\d{0,2}$/.test(value)) throw new InvalidArgumentError('应为 1～999 的整数。')
    return Number(value)
  }

  command('login', '在自带浏览器窗口扫码登录微信读书', options => options.check ? loginState() : login())
    .option('--check', '只看有没有登录记录，不打开窗口')
  command('logout', '退出微信读书，清掉自带浏览器里的登录状态', logout)
  command('accounts', '按名称找公众号的候选；不带 --query 时列出书架上的公众号', accounts)
    .option('--query <名称>', '公众号名称的一部分')
  command('list', '列出一个公众号最近的文章；不带 --account 时列出跟踪名单里每个号的', options => options.account ? list(options) : listTracked(options))
    .option('--account <公众号>', '公众号名称，可以只写一部分')
    .option('--limit <数量>', '每个号最多返回几篇', count, 20)
  article(command('read', '读取一篇文章，输出 Markdown 正文', async options => ({ ok: true, article: await read(options) })))
  article(command('download', '把一篇文章保存为 Markdown，并下载正文图片', async options => exportMarkdown(await read(options), outPath(options.out))))
    .requiredOption('--out <目录>', '保存到哪个目录')
  command('track', '开始跟踪一个公众号；不带 --account 时只列出跟踪名单', track)
    .option('--account <公众号>', '公众号名称')
    .option('--cancel', '停止跟踪这个公众号')
  command('new', '跟踪的公众号在上次检查之后新发的文章', newArticles)
    .option('--account <公众号>', '只检查这一个')
  return root
}
