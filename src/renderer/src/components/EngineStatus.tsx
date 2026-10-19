import { useEffect, useState } from 'react'
import { api } from '../api'
import type { SetupInfo, SetupProgress, Settings } from '../../../shared/types'
import { sttMeta } from '../../../shared/sttEngines'
import { SetupProgressBar } from '../views/Welcome'

// Полоса на главном экране: идёт ли загрузка движка (с паузой/продолжением) и
// готово ли «Слово» расшифровывать. Без этого новый человек узнавал об
// отсутствии движка только по ошибке после импорта.
export default function EngineStatus({ onOpenWelcome }: { onOpenWelcome: () => void }): React.JSX.Element | null {
  const [info, setInfo] = useState<SetupInfo | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [prog, setProg] = useState<SetupProgress | null>(null)

  const refresh = (): void => {
    api.setupInfo().then((i) => {
      setInfo(i)
      if (i.progress) setProg(i.progress)
    })
    api.getSettings().then(setSettings)
  }
  useEffect(() => {
    refresh()
    return api.onSetupProgress((p) => {
      setProg(p)
      if (p.stage === 'done') {
        refresh()
        setTimeout(() => setProg(null), 4000)
      }
    })
  }, [])

  if (!info || !settings) return null

  if (prog) {
    return (
      <div className="queue-strip">
        <SetupProgressBar p={prog} onStop={() => api.stopSetup()} onResume={() => api.startSetup(prog.modelId)} />
      </div>
    )
  }
  if (info.pending) {
    return (
      <div className="queue-strip">
        <div className="queue-item">
          <span>Загрузка локального движка не закончена — скачанное сохранено.</span>
          <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }} onClick={() => api.startSetup(info.pending!.modelId)}>
            Продолжить
          </button>
        </div>
      </div>
    )
  }

  const stt = settings.sttEngine ?? 'local'
  const meta = sttMeta(stt)
  let problem: string | null = null
  if (stt === 'local' && !info.engine.installed)
    problem = 'Чтобы расшифровывать свои записи, подключите движок: облачный по ключу или локальный.'
  else if (meta?.cloud && !(settings.sttKeys?.[stt] ?? '').trim())
    problem = `Выбран сервис ${meta.label}, но не указан ключ.`
  if (!problem) return null
  return (
    <div className="queue-strip">
      <div className="queue-item">
        <span>{problem}</span>
        <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }} onClick={onOpenWelcome}>
          С чего начать
        </button>
      </div>
    </div>
  )
}
