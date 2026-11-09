import { useEffect, useMemo, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Check, Circle, Copy, FileAudio, Mic, Phone, Plus, TriangleAlert } from 'lucide-react'
import type { DictationEntry, DictationSettings } from '../../../shared/types'
import { defaultDictation } from '../../../shared/types'
import { buildFeed, groupFeed, type FeedItem } from '../../../shared/feed'
import { api } from '../api'
import { showToast } from '../toast'
import { onActivate } from '../activate'
import { useLibrary, useChecklist } from '../library'
import { doneCount, type ChecklistId } from '../../../shared/setupChecklist'
import { hotkeyLabel } from '../dictKeys'
import EngineStatus from '../components/EngineStatus'
import QueueStrip from '../components/QueueStrip'
import Tip from '../components/Tip'
import { Skeleton } from '../components/Skeleton'

// «Главная»: приветствие, одна строка про диктовку, три больших действия и
// лента за дни — записи и диктовки вперемешку (фильтр Все / Записи / Диктовки).

type Filter = 'all' | 'rec' | 'dict'

const HIDE_KEY = 'slovo.checklistHidden'
const CHECK_ACTION: Record<ChecklistId, string> = {
  stt: 'Подключить',
  dictation: 'Попробовать',
  record: 'Добавить',
  ai: 'Подключить',
  vocab: 'Добавить'
}

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === '1'
  } catch {
    return false
  }
}

function greeting(h = new Date().getHours()): string {
  if (h < 5) return 'Доброй ночи'
  if (h < 12) return 'Доброе утро'
  if (h < 18) return 'Добрый день'
  return 'Добрый вечер'
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function fmtDur(sec: number): string {
  const t = Math.round(sec)
  if (t < 60) return `${t} с`
  const m = Math.round(t / 60)
  if (m < 60) return `${m} мин`
  return `${Math.floor(m / 60)} ч ${m % 60} мин`
}

export default function Home({
  onOpen,
  onOpenWelcome,
  onRecordCall,
  onImport,
  importBusy,
  onDictation,
  onChecklist
}: {
  onOpen: (slug: string) => void
  onOpenWelcome: () => void
  onRecordCall: () => void
  onImport: () => void
  importBusy: string | null
  /** Открыть страницу «Диктовка». */
  onDictation: () => void
  /** Пункт чек-листа: открыть то место, где это делается. */
  onChecklist: (id: ChecklistId) => void
}): React.JSX.Element {
  const projects = useLibrary((s) => s.projects)
  const error = useLibrary((s) => s.error)
  const refresh = useLibrary((s) => s.refresh)
  const [dict, setDict] = useState<DictationSettings | null>(null)
  const [dicts, setDicts] = useState<DictationEntry[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [hidden, setHidden] = useState(readHidden)
  const stats = useLibrary((s) => s.setup?.stats)
  const checklist = useChecklist()

  useEffect(() => {
    void refresh()
    const loadDicts = (): void => {
      api.getSettings().then((s) => setDict({ ...defaultDictation, ...s.dictation }))
      api
        .dictHistory()
        .then(setDicts)
        .catch(() => setDicts([]))
    }
    loadDicts()
    return api.onDictLogged(loadDicts)
  }, [refresh])

  const recsWeek = useMemo(() => {
    const from = Date.now() - 7 * 86400_000
    return (projects ?? []).filter((p) => !p.demo && new Date(p.createdAt).getTime() >= from).length
  }, [projects])
  const hide = (): void => {
    setHidden(true)
    try {
      localStorage.setItem(HIDE_KEY, '1')
    } catch {
      /* без localStorage чек-лист вернётся при следующем запуске */
    }
  }
  const showList = !!checklist && !hidden && doneCount(checklist) < checklist.length
  const showStats = !!stats && stats.wordsWeek + stats.streak + recsWeek > 0

  const loading = projects === null || dicts === null
  const groups = useMemo(() => {
    if (loading) return []
    return groupFeed(buildFeed(projects, dicts, 40, filter))
  }, [loading, projects, dicts, filter])

  const copy = (text: string): void => {
    void navigator.clipboard
      .writeText(text)
      .then(() => showToast('Скопировано', 'info'))
      .catch(() => showToast('Не удалось скопировать.'))
  }

  const row = (it: FeedItem, key: string): React.JSX.Element => {
    if (it.kind === 'rec') {
      return (
        <div
          key={key}
          className="feed-row"
          role="button"
          tabIndex={0}
          onClick={() => onOpen(it.slug)}
          onKeyDown={onActivate(() => onOpen(it.slug))}
        >
          <span className="feed-ico" aria-hidden="true">
            <FileAudio size={16} />
          </span>
          <span className="feed-time">{fmtTime(it.at)}</span>
          <span className="feed-title">{it.title}</span>
          <span className="feed-meta">{it.demo ? 'пример' : fmtDur(it.durationSec)}</span>
        </div>
      )
    }
    return (
      <div key={key} className="feed-row feed-row-dict">
        <span className="feed-ico feed-ico-dict" aria-hidden="true">
          <Mic size={16} />
        </span>
        <span className="feed-time">{fmtTime(it.at)}</span>
        <span className={'feed-title' + (it.failed ? ' feed-failed' : '')}>
          {it.failed ? 'Диктовка не распозналась' : it.text || 'Пустая диктовка'}
        </span>
        {it.text && (
          <Tip label="Копировать текст">
            <button
              className="btn-icon feed-copy"
              aria-label="Копировать текст диктовки"
              onClick={() => copy(it.text)}
            >
              <Copy size={15} />
            </button>
          </Tip>
        )}
      </div>
    )
  }

  const status = dict?.enabled ? (
    <>
      <span className="status-dot is-on" aria-hidden="true" />
      Диктовка включена · {hotkeyLabel(dict.hotkey)}
    </>
  ) : dict ? (
    <>
      <span className="status-dot" aria-hidden="true" />
      Диктовка выключена
      <button className="btn btn-sm" onClick={onDictation}>
        Включить
      </button>
    </>
  ) : (
    <Skeleton width={220} height={18} />
  )

  return (
    <main className="start-page">
      <div className="start-inner">
        <h1 className="start-title">{greeting()}</h1>
        <div className="start-status">{status}</div>

        <div className="start-actions">
          <button className="start-btn" onClick={onDictation}>
            <Mic size={20} aria-hidden="true" />
            <span>Диктовать</span>
          </button>
          <button className="start-btn" onClick={onRecordCall}>
            <Phone size={20} aria-hidden="true" />
            <span>Записать звонок</span>
          </button>
          <button className="start-btn" onClick={onImport} disabled={importBusy !== null}>
            <Plus size={20} aria-hidden="true" />
            <span>{importBusy ?? 'Добавить запись'}</span>
          </button>
        </div>

        <EngineStatus onOpenWelcome={onOpenWelcome} />
        <QueueStrip />

        {showStats && stats && (
          <section className="home-summary" aria-label="Сводка за неделю" data-testid="home-summary">
            <div className="home-sum-item">
              <b>{stats.wordsWeek}</b>
              <span>слов за неделю</span>
            </div>
            <div className="home-sum-item">
              <b>{stats.streak}</b>
              <span>дней подряд</span>
            </div>
            <div className="home-sum-item">
              <b>{recsWeek}</b>
              <span>записей за неделю</span>
            </div>
          </section>
        )}

        {showList && checklist && (
          <section className="home-check" aria-label="Настройка" data-testid="home-checklist">
            <div className="home-check-head">
              <h2 className="feed-h">
                Настройка: {doneCount(checklist)} из {checklist.length}
              </h2>
              <button className="text-link" onClick={hide} data-testid="checklist-hide">
                Скрыть
              </button>
            </div>
            <ul className="home-check-list">
              {checklist.map((it) => (
                <li key={it.id} className={'home-check-item' + (it.done ? ' is-done' : '')} aria-label={it.label + (it.done ? ': готово' : '')}>
                  <span className="home-check-ico" aria-hidden="true">
                    {it.done ? <Check size={14} /> : <Circle size={14} />}
                  </span>
                  <span className="home-check-label">{it.label}</span>
                  {!it.done && (
                    <button className="btn btn-sm" onClick={() => onChecklist(it.id)} data-testid={'check-' + it.id}>
                      {CHECK_ACTION[it.id]}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <Tabs.Root value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <div className="feed-head">
            <h2 className="feed-h">Недавнее</h2>
            <Tabs.List className="seg" aria-label="Что показывать">
              <Tabs.Trigger className="seg-btn" value="all">
                Все
              </Tabs.Trigger>
              <Tabs.Trigger className="seg-btn" value="rec">
                Записи
              </Tabs.Trigger>
              <Tabs.Trigger className="seg-btn" value="dict">
                Диктовки
              </Tabs.Trigger>
            </Tabs.List>
          </div>

          <Tabs.Content value={filter} forceMount>
            {error && projects === null ? (
              <div className="feed-empty">
                <TriangleAlert size={22} aria-hidden="true" />
                <div>Не удалось загрузить записи. {error}</div>
                <button className="btn btn-sm" onClick={() => void refresh()}>
                  Повторить
                </button>
              </div>
            ) : loading ? (
              <div className="feed-skel" aria-label="Загружаю ленту" aria-busy="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} height={44} radius={10} />
                ))}
              </div>
            ) : groups.length === 0 ? (
              <div className="feed-empty">
                <div>
                  {filter === 'dict'
                    ? 'Диктовок пока нет. Включите диктовку и зажмите клавишу.'
                    : filter === 'rec'
                      ? 'Записей пока нет. Нажмите «Добавить запись» или «Записать звонок».'
                      : 'Пока пусто. Продиктуйте что-нибудь или добавьте запись.'}
                </div>
              </div>
            ) : (
              groups.map((g) => (
                <section key={g.group} className="feed-group">
                  <h3 className="feed-day">{g.label}</h3>
                  {g.items.map((it, i) => row(it, g.group + i + it.at))}
                </section>
              ))
            )}
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </main>
  )
}
