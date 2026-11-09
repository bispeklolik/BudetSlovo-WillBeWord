import * as Switch from '@radix-ui/react-switch'

// Кирпичики страницы «Настройки» (views/Settings.tsx).
// id у Row / SwitchRow / Block нужен поиску по настройкам: он находит элемент
// по id="set-…" и подсвечивает (список — shared/settingsIndex.ts).

/** Строка: название слева, элемент управления справа. */
export function Row({
  id,
  label,
  hint,
  children
}: {
  id?: string
  label: React.ReactNode
  hint?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="settings-row st-row" id={id ? 'set-' + id : undefined}>
      <span className="st-row-text">
        <span>{label}</span>
        {hint && <span className="st-hint">{hint}</span>}
      </span>
      {children && <div className="st-ctl">{children}</div>}
    </div>
  )
}

/** Строка с настоящим переключателем (Radix Switch) и подписью «Вкл / Выкл». */
export function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
  onText = 'Вкл',
  offText = 'Выкл'
}: {
  id: string
  label: React.ReactNode
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  onText?: string
  offText?: string
}): React.JSX.Element {
  const swId = 'sw-' + id
  return (
    <div className="settings-row st-row" id={'set-' + id}>
      <label className="st-row-text" htmlFor={swId}>
        <span>{label}</span>
        {hint && <span className="st-hint">{hint}</span>}
      </label>
      <div className="st-ctl">
        <span className="st-sw-state" aria-hidden="true">
          {checked ? onText : offText}
        </span>
        <Switch.Root id={swId} className="sw" checked={checked} onCheckedChange={onChange}>
          <Switch.Thumb className="sw-thumb" />
        </Switch.Root>
      </div>
    </div>
  )
}

/** Группа внутри раздела: рамка с заголовком. */
export function Block({
  id,
  title,
  bare,
  children
}: {
  id?: string
  title?: string
  /** Без своей рамки — когда внутри уже лежит готовый раздел. */
  bare?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={bare ? 'st-bare' : 'settings-section'} id={id ? 'set-' + id : undefined}>
      {title && <div className="settings-label">{title}</div>}
      {children}
    </div>
  )
}
