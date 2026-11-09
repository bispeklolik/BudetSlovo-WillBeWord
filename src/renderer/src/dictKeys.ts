// Клавиши для диктовки: без левых модификаторов (они испортили бы Ctrl+V
// вставку), одиночные и правые — то, что редко занято.
export const DICT_KEYS: { id: string; label: string }[] = [
  { id: 'F9', label: 'F9' },
  { id: 'F8', label: 'F8' },
  { id: 'F6', label: 'F6' },
  { id: 'F10', label: 'F10' },
  { id: 'F12', label: 'F12' },
  { id: 'ControlRight', label: 'Правый Ctrl' },
  { id: 'AltRight', label: 'Правый Alt' },
  { id: 'ShiftRight', label: 'Правый Shift' },
  { id: 'CapsLock', label: 'CapsLock' },
  { id: 'ScrollLock', label: 'ScrollLock' },
  { id: 'Pause', label: 'Pause' },
  { id: 'Insert', label: 'Insert' },
  { id: 'NumpadAdd', label: 'Num +' },
  { id: 'NumpadSubtract', label: 'Num −' }
]

export function hotkeyLabel(id: string): string {
  return DICT_KEYS.find((k) => k.id === id)?.label ?? id
}
