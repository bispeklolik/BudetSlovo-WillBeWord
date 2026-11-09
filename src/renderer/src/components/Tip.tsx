import * as Tooltip from '@radix-ui/react-tooltip'

// Подсказка (Radix Tooltip). Провайдер стоит один раз в App.
export function TipProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Tooltip.Provider delayDuration={350} skipDelayDuration={200}>
      {children}
    </Tooltip.Provider>
  )
}

export default function Tip({
  label,
  side = 'top',
  disabled,
  children
}: {
  label: string
  side?: 'top' | 'right' | 'bottom'
  disabled?: boolean
  children: React.ReactElement
}): React.JSX.Element {
  if (disabled) return children
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip" side={side} sideOffset={8}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
