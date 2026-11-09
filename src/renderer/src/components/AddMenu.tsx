import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, FileAudio, FolderSync, Link2, Smartphone } from 'lucide-react'

// «Добавить запись»: меню способов (Radix DropdownMenu — стрелки, Esc, фокус сами).
// Используется в боковом меню (кнопка «+ Добавить запись», с пунктом «Файл…»)
// и на странице «Записи» (кнопка «Ещё», без пункта «Файл» — он там отдельной кнопкой).

export default function AddMenu({
  onFile,
  onPhone,
  onLink,
  onWatch,
  trigger,
  side = 'bottom',
  align = 'start'
}: {
  onFile?: () => void
  onPhone: () => void
  onLink: () => void
  onWatch: () => void
  /** Своя кнопка-триггер (иначе «Ещё»). */
  trigger?: React.ReactNode
  side?: 'bottom' | 'right'
  align?: 'start' | 'end'
}): React.JSX.Element {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        {trigger ?? (
          <button className="btn">
            Ещё <ChevronDown size={14} aria-hidden="true" />
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="dd-content" side={side} align={align} sideOffset={6}>
          {onFile && (
            <DropdownMenu.Item className="dd-item" onSelect={onFile}>
              <FileAudio size={16} /> Файл с компьютера…
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item className="dd-item" onSelect={onPhone}>
            <Smartphone size={16} /> С телефона (QR-код)
          </DropdownMenu.Item>
          <DropdownMenu.Item className="dd-item" onSelect={onLink}>
            <Link2 size={16} /> По ссылке (YouTube, VK, RuTube…)
          </DropdownMenu.Item>
          <DropdownMenu.Item className="dd-item" onSelect={onWatch}>
            <FolderSync size={16} /> Папка-наблюдатель…
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
