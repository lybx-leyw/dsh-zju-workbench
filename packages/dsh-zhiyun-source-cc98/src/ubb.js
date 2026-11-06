/**
 * UBB（CC98 的富文本标记）→ 纯文本。
 *
 * # 为什么必须有这一层
 *
 * CC98 的帖子正文、私信、个人简介在 API 里是**带 UBB 标记的字符串**
 * （`[b]…[/b]`、`[img]…[/img]`、`[quote]…[/quote]` …）。调用方要的是「人说的话」，
 * 不是标记。把清洗放在数据层而不是每个消费方各写一遍，是因为标记集是**站点事实**：
 * 站点加一种标签，只有这里该改。
 *
 * # 转换规则（与 omni 的实现一致）
 *
 * | 标记 | 结果 |
 * | --- | --- |
 * | `[img]u[/img]` `[video]u[/video]` `[audio]u[/audio]` | `[图片: u]` 等占位符，**保留地址** |
 * | `[upload=2]u[/upload]` | `[文件: u]`（附件下载链接是有效信息，不能丢） |
 * | `[url=x]文本[/url]` | `文本 (x)` |
 * | `[url]u[/url]` | `u` |
 * | `[quote]…[/quote]` | 行首 `> [引用]`，保留引用层级 |
 * | `[code]…[/code]` | 只去掉标签，**代码内容原样保留** |
 * | `[b] [i] [u] [del] [center] …` | 成对剥掉 |
 * | `[color=red] [size=5] [font=x] [align=center]` | 成对剥掉 |
 * | `[ac01] [em02] [CC9801] [tb01] [ms01]` | `[表情]` |
 *
 * # 与 omni 唯一的不同：`[code]` 的处理
 *
 * omni 那份没有处理 `[code]`，于是正文里的 `[code]` 会**原样留在输出里** ——
 * 与这个函数自己的说明（"清洗为纯文本"）相矛盾。代码块是技术版最常见的正文形式，
 * 留着一对裸标签没有任何信息价值，所以这里补上「剥标签、留内容」。
 * 其余规则逐条照搬，没有别的改动。
 */

/**
 * 把一段 UBB 文本压成纯文本。
 *
 * @param content - 原始正文（任意字符串；`null` / `undefined` 会被当成空串）。
 * @returns 清洗后的文本；连续 3 个以上换行折叠成 2 个，首尾空白去掉。
 */
export function ubbToText(content) {
  let text = String(content ?? '');

  // 媒体类：替换为占位符并保留地址。
  // 顺序必须在剥标签之前 —— 否则 `[img]` 先被当成未知标签走掉，地址就丢了。
  text = text.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, '[图片: $1]');
  text = text.replace(/\[video\]([\s\S]*?)\[\/video\]/gi, '[视频: $1]');
  text = text.replace(/\[audio\]([\s\S]*?)\[\/audio\]/gi, '[音频: $1]');

  // 附件：[upload=2]url[/upload] 有闭合标签；[upload]url 是站点历史上出现过的
  // 无闭合写法（用户手打或旧编辑器产生）。两条都要处理，否则后者会留下半截标签。
  text = text.replace(/\[upload(?:=[^\]]*)?\]([\s\S]*?)\[\/upload\]/gi, '[文件: $1]');
  text = text.replace(/\[upload(?:=[^\]]*)?\](https?:\/\/\S+)/gi, '[文件: $1]');

  // 链接：[url=x]text[/url] → text (x)；[url]x[/url] → x。
  // 带上地址而不是只留锚文本：纯文本里丢了 href，链接就再也找不回来了。
  text = text.replace(/\[url=([^\]]*)\]([\s\S]*?)\[\/url\]/gi, '$2 ($1)');
  text = text.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '$1');

  // 代码块：只剥标签、保留内容（见文件头的说明）。
  text = text.replace(/\[code(?:=[^\]]*)?\]/gi, '');
  text = text.replace(/\[\/code\]/gi, '');

  // 引用：保留层级提示。独占一行的 `> [引用]` 比直接拍平更容易看出"这段是别人的话"。
  text = text.replace(/\[quote\]/gi, '\n> [引用] ');
  text = text.replace(/\[\/quote\]/gi, '\n');

  // 纯样式标签：成对剥掉（含带参数形式，如 [color=red] [size=5] [font=x] [align=center]）。
  // 这些标签**不携带内容**，去掉即可；不带参数的 `[color]` 由第一条顺带覆盖。
  text = text.replace(/\[\/?(b|i|u|del|center|left|right|line|noubb)\]/gi, '');
  text = text.replace(/\[(color|size|font|align|bg|sound|upload)=[^\]]*\]/gi, '');
  text = text.replace(/\[\/(color|size|font|align|bg|sound|upload)\]/gi, '');

  // 表情代码（[ac01] [em02] [CC9801] [tb01] [ms01] 等）→ 统一占位。
  // 不保留具体编号：编号对读文字的人没有意义，而每个表情都留一处占位会淹掉正文。
  text = text.replace(/\[(ac|em|cc98|tb|ms)\d+\]/gi, '[表情]');

  // 折叠多余空行，并去掉首尾空白。
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
