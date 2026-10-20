import { useEffect, useState } from 'react'
import { api } from '../api'

// Настройки → «Claude читает записи (MCP)»: что разрешено и готовая строка для
// Claude Desktop. По умолчанию — все записи (решение владельца 21.10.2026: имя
// без фамилии клиента и так не выдаёт); «только обезличенные» — для особых случаев.

export default function McpSection(): React.JSX.Element {
  const [policy, setPolicy] = useState<'anon' | 'all'>('all')
  const [cfg, setCfg] = useState<{ ok: boolean; json: string; configDir: string } | null>(null)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.getSettings().then((s) => setPolicy(s.mcpPolicy ?? 'all'))
  }, [])
  useEffect(() => {
    if (open && !cfg) api.mcpConfig().then(setCfg)
  }, [open, cfg])

  const copy = async (): Promise<void> => {
    if (!cfg) return
    await navigator.clipboard.writeText(cfg.json)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="settings-section">
      <div className="settings-label">Claude читает записи (MCP)</div>
      <div className="settings-row">
        <span>Что Claude может читать</span>
        <select
          className="rate"
          value={policy}
          onChange={(e) => {
            const v = e.target.value as 'anon' | 'all'
            setPolicy(v)
            void api.setSettings({ mcpPolicy: v })
          }}
        >
          <option value="all">все записи</option>
          <option value="anon">только обезличенные записи</option>
        </select>
      </div>
      <div className="panel-note">
        Claude Desktop или Claude Code сможет искать по вашим записям и конспектам и читать их текст — только читать,
        ничего не меняет. Всё, что прочитал Claude, уходит в облако Anthropic вместе с разговором. Для особо
        чувствительных клиентов выберите «только обезличенные записи» — тогда Claude видит только записи, где
        нажато «ИИ ▾» → «Обезличить», и не видит даже названий остальных.
      </div>
      <div className="settings-row">
        <span>Подключить к Claude Desktop</span>
        <button className="btn btn-sm" onClick={() => setOpen(!open)}>
          {open ? 'Скрыть' : 'Показать как'}
        </button>
      </div>
      {open && cfg && (
        <>
          <div className="panel-note">
            1. Скопируйте текст ниже. 2. В Claude Desktop: «Settings → Developer → Edit Config» (или кнопка «Открыть
            папку Claude») — откройте claude_desktop_config.json. 3. Если файл пустой — вставьте текст целиком; если в
            нём уже есть «mcpServers» — добавьте внутрь только часть «slovo». 4. Перезапустите Claude Desktop.
          </div>
          <textarea className="note-body mcp-json" readOnly value={cfg.json} spellCheck={false} />
          <div className="modal-actions">
            <button
              className="btn"
              onClick={async () => {
                if (!(await api.openClaudeConfigDir())) window.alert('Папка Claude Desktop не найдена — похоже, он не установлен.')
              }}
            >
              Открыть папку Claude
            </button>
            <button className="btn btn-primary" onClick={() => void copy()}>
              {copied ? 'Скопировано ✓' : 'Копировать'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
