/**
 * 把一件事交给助手：开一个新的对话，把写好的一段话放进输入框，用户看过、想补就补，再自己发出去（campus.ts 的 handToAssistant）。
 * 桌面版里「让助手讲这次课」是点了就替用户发出去；插件里新对话由 dsh 的工作区开，拿不到是哪一个对话，所以也只放进输入框。
 */
import { Button, IconNewChatOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { handToAssistant as start } from './campus.ts'

/** 开一个新的对话并把 text 放进它的输入框。开不了时抛出原因。send 是桌面版的写法，插件里照样只放进输入框。 */
export function handToAssistant(text: string, _options: { send?: boolean } = {}): Promise<void> { return start(text) }

/**
 * 列表里每一行右边的「交给助手」：只画一个图标，鼠标放上去或键盘聚焦时显示这四个字。
 * 行里地方窄，带字的按钮会把卡片撑高；详情页右上角的那个仍然带字。
 */
export function HandIconButton({ onClick, disabled = false }: { onClick: () => void, disabled?: boolean }) {
  return (
    <Tooltip label="交给助手" side="top" portal>
      <Button className="campus-hand" size="sm" variant="outline" aria-label="交给助手" disabled={disabled} icon={<IconNewChatOutlineRegular size={14} />} onClick={onClick} />
    </Tooltip>
  )
}
