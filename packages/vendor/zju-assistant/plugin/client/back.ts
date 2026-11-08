/**
 * 「返回」认哪些输入。页面顶上那一行返回（controls.tsx 的 Crumb）在场时，鼠标侧键的后退、键盘上的 Alt+←
 * 和后退键也算点了它。引擎不用浏览器的历史记录，DeepSeek Harness 也不替页面后退，所以在这里直接认这几种输入。
 * 按住不放时键盘会连发，所以很短时间内的第二次不算。
 */

interface Entry { run: () => void, element: () => HTMLElement | null }

/** 现在在场的几个返回，后出现的在上面：设置面板盖在页面上时，认的是面板里的那个。 */
const entries: Entry[] = []
/** 两次后退至少隔这么久。 */
const GAP_MS = 300
let lastAt = 0

/** 执行最上面的那个返回。没有返回在场时什么都不做，返回 false。 */
function goBack(): boolean {
  const top = entries[entries.length - 1]
  if (!top) return false
  // 上面盖着确认框（删除、放弃修改）时不动，等用户先把它处理掉。
  const modals = document.querySelectorAll('[aria-modal="true"]'), modal = modals[modals.length - 1], element = top.element()
  if (modal && element && !modal.contains(element)) return true
  const now = Date.now()
  if (now - lastAt >= GAP_MS) { lastAt = now; top.run() }
  return true
}

/** 把一个返回登记成「后退」要执行的事；返回的函数用来撤掉。element 是画出来的那个返回，用来判断它是不是被确认框盖住了。 */
export function addBack(entry: Entry): () => void {
  entries.push(entry)
  return () => { const at = entries.indexOf(entry); if (at >= 0) entries.splice(at, 1) }
}

/** 焦点在能打字的地方时，Alt+← 归它自己：macOS 上 Option+← 是往前跳一个词，详情页的编辑框里也不能被当成返回。 */
function typing(target: EventTarget | null): boolean {
  const element = target as Partial<HTMLElement> | null
  return !!element && (element.isContentEditable === true || element.matches?.('input, textarea') === true)
}

/** 开始听后退的几种输入；返回的函数用来停止。 */
export function installBack(): () => void {
  const mouse = (event: MouseEvent) => { if (event.button === 3 && goBack()) event.preventDefault() }
  const key = (event: KeyboardEvent) => {
    const altLeft = event.key === 'ArrowLeft' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !typing(event.target)
    if ((event.key === 'BrowserBack' || altLeft) && goBack()) event.preventDefault()
  }
  window.addEventListener('mouseup', mouse, true)
  window.addEventListener('keydown', key, true)
  return () => {
    window.removeEventListener('mouseup', mouse, true)
    window.removeEventListener('keydown', key, true)
  }
}
