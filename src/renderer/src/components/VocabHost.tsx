import { useEffect, useState } from 'react'
import type { DictationSettings } from '../../../shared/types'
import { defaultDictation } from '../../../shared/types'
import { api } from '../api'
import VocabPanel from './VocabPanel'

// «Словарь» и «Режимы» из бокового меню: то же окно VocabPanel, что открывалось
// из настроек, только открывается на нужной вкладке и сам грузит/сохраняет диктовку.
export default function VocabHost({
  tab,
  onClose
}: {
  tab: 'words' | 'modes'
  onClose: () => void
}): React.JSX.Element | null {
  const [dict, setDict] = useState<DictationSettings | null>(null)
  useEffect(() => {
    api.getSettings().then((s) => setDict({ ...defaultDictation, ...s.dictation }))
  }, [])
  if (!dict) return null
  return (
    <VocabPanel
      customModes={dict.customModes ?? []}
      appRules={dict.appRules}
      initialTab={tab}
      onSaveDict={(patch) => {
        // Берём свежие настройки: их могли поменять после открытия окна.
        void api.getSettings().then((s) =>
          api.setSettings({ dictation: { ...defaultDictation, ...s.dictation, ...patch } })
        )
      }}
      onClose={onClose}
    />
  )
}
