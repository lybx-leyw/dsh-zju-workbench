/** 插件页、校园事务页和设置里的个人档案共用的几个小控件，尺寸和样子照引擎插件设置页的表单。 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { IconChevronDownOutlineRegular, IconChevronLeftOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { addBack } from './back.ts'

/** 详情页顶上那一行，点了回到上一层。它在场时，鼠标侧键的后退和键盘上的 Alt+← 也算点了它（back.ts）。 */
export function Crumb({ text, onBack }: { text: string, onBack: () => void }) {
  const button = useRef<HTMLButtonElement>(null)
  const latest = useRef(onBack)
  latest.current = onBack
  useEffect(() => addBack({ run: () => { latest.current() }, element: () => button.current }), [])
  return (
    <button ref={button} type="button" className="campus-crumb" aria-label={`返回${text}`} onClick={onBack}>
      <IconChevronLeftOutlineRegular size={14} />
      <span>{text}</span>
    </button>
  )
}

/**
 * 几个选项里选一个，样子照引擎的 SegmentedControl。引擎那个是页签的语义，而且必须有一格选中，
 * 这里是单选，value 可以为空；allowEmpty 时再点一次已选的那项会清空。
 */
export function Choice<Value extends string>({ label, value, options, disabled = false, allowEmpty = false, onChange }: {
  label: string
  value: string
  options: readonly { value: Value, label: string }[]
  disabled?: boolean
  allowEmpty?: boolean
  onChange: (next: Value | '') => void
}) {
  const index = options.findIndex(option => option.value === value)
  const place = { '--campus-choice-count': options.length, '--campus-choice-index': index } as CSSProperties
  return (
    <div className="campus-choice" role="radiogroup" aria-label={label} style={place}>
      {index >= 0 && <span className="campus-choice-thumb" aria-hidden="true" />}
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          onClick={() => {
            if (value !== option.value) onChange(option.value)
            else if (allowEmpty) onChange('')
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** 表单里的一项：标签在上，控件在下。id 是输入框的 id；控件不是输入框时不给。aside 放在标签那一行的右边。 */
export function Field({ id, label, aside, children }: { id?: string, label: string, aside?: ReactNode, children: ReactNode }) {
  return (
    <div className="campus-field">
      <div className="campus-field-head">
        {id ? <label className="campus-field-label" htmlFor={id}>{label}</label> : <span className="campus-field-label">{label}</span>}
        {aside}
      </div>
      {children}
    </div>
  )
}

/** 出错或需要留意的提示条；tone 默认是出错。 */
export function Alert({ tone = 'error', children }: { tone?: 'error' | 'warn', children: ReactNode }) {
  return <div className="campus-alert" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>
}

export interface SelectOption {
  value: string
  label: string
  /** 下一级选项。有下一级的这一项自己不能选，只用来分组。 */
  children?: readonly { value: string, label: string }[]
}

/**
 * 下拉选择：样子是表单里的输入框加一个向下的箭头，点开是引擎的菜单。
 * 当前值不在选项里时照原样显示（比如以前手填的内容），选了别的才会换掉。
 */
export function Select({ id, label, value, options, placeholder = '请选择', allowEmpty = false, disabled = false, onChange }: {
  id?: string
  label: string
  value: string
  options: readonly SelectOption[]
  placeholder?: string
  /** 菜单最后多一行「不填」，选了就清空。 */
  allowEmpty?: boolean
  disabled?: boolean
  onChange: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  const flat = options.flatMap(option => option.children ?? [option])
  const shown = flat.find(option => option.value === value)?.label ?? value
  const EMPTY = '\u0000empty'
  return (
    <Menu
      className="campus-select-wrap"
      open={open}
      onClose={() => { setOpen(false) }}
      items={[
        ...options.map(option => ({
          id: option.value,
          label: option.label,
          ...(option.children ? { submenu: option.children.map(child => ({ id: child.value, label: child.label })) } : {}),
        })),
        ...(allowEmpty && value ? [{ type: 'separator' as const, id: 'before-empty' }, { id: EMPTY, label: '不填' }] : []),
      ]}
      selectedId={value}
      onSelect={(picked) => {
        const next = picked === EMPTY ? '' : picked
        setOpen(false)
        if (next !== value) onChange(next)
      }}
      portal
      anchor={(
        <button type="button" id={id} className="campus-input campus-select" aria-label={label} aria-haspopup="menu" aria-expanded={open}
          disabled={disabled} data-empty={shown ? undefined : ''} onClick={() => { setOpen(old => !old) }}>
          <span>{shown || placeholder}</span>
          <IconChevronDownOutlineRegular size={14} />
        </button>
      )}
    />
  )
}

/**
 * 标签：已选的排在框里，可以逐个去掉；右边的箭头点开是已有的标签，勾选就加上；
 * 也可以直接输入新标签，回车或逗号确认。
 */
export function TagPicker({ id, label, value, known, placeholder = '选已有的，或输入新标签后回车', disabled = false, onChange }: {
  id: string
  label: string
  value: readonly string[]
  /** 别的笔记已经用过的标签。 */
  known: readonly string[]
  /** 框里一个都没有时的提示；不是标签的用法（比如屏蔽词）自己写。 */
  placeholder?: string
  disabled?: boolean
  onChange: (next: string[]) => void
}) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const add = (raw: string) => {
    const names = raw.split(/[,，、]/).map(name => name.trim()).filter(name => name && !value.includes(name))
    if (names.length) onChange([...value, ...new Set(names)])
    setText('')
  }
  const toggle = (name: string) => { onChange(value.includes(name) ? value.filter(item => item !== name) : [...value, name]) }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 输入法选字时的回车不算确认。
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' || event.key === ',' || event.key === '，') { event.preventDefault(); add(text) }
    else if (event.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
  }
  const choices = [...new Set([...known, ...value])]
  return (
    <div className="campus-input campus-tagbox" data-disabled={disabled ? '' : undefined}>
      {value.map(name => (
        <span className="campus-tagchip" key={name}>
          {name}
          <button type="button" aria-label={`去掉标签 ${name}`} disabled={disabled} onClick={() => { toggle(name) }}>×</button>
        </span>
      ))}
      <input id={id} type="text" aria-label={label} autoComplete="off" placeholder={value.length ? '' : placeholder}
        value={text} disabled={disabled} onChange={(event) => { setText(event.target.value) }} onKeyDown={onKeyDown} onBlur={() => { add(text) }} />
      {choices.length > 0 && (
        <Menu
          open={open}
          onClose={() => { setOpen(false) }}
          items={choices.map(name => ({ id: name, label: name }))}
          selectedIds={value}
          onSelect={toggle}
          align="end"
          portal
          anchor={(
            <button type="button" className="campus-tagbox-more" aria-label="选已有的标签" aria-haspopup="menu" aria-expanded={open}
              disabled={disabled} onClick={() => { setOpen(old => !old) }}>
              <IconChevronDownOutlineRegular size={14} />
            </button>
          )}
        />
      )}
    </div>
  )
}
