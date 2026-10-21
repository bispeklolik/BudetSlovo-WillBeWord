import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  Settings,
  ProjectMeta,
  ImportProgress,
  JobInfo,
  TranscribeOptions,
  Turn,
  SpeakerInfo,
  Note,
  NoteInput,
  AnonRule,
  SetupInfo,
  SetupProgress,
  OllamaStatus,
  KeyVerdict,
  DictationEntry,
  AskAnswer,
  AskTurn
} from '../shared/types'

const api = {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke('settings:set', patch),

  importAudio: (): Promise<ProjectMeta[] | null> => ipcRenderer.invoke('project:import'),
  // Путь к перетащенному файлу (в новых Electron — только через webUtils).
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  importPath: (path: string): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('project:importPath', path),
  renameProject: (slug: string, title: string): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('project:rename', slug, title),
  setFolder: (slug: string, folder: string): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('project:setFolder', slug, folder),
  renameFolder: (oldPath: string, newPath: string): Promise<boolean> =>
    ipcRenderer.invoke('project:renameFolder', oldPath, newPath),
  listProjects: (): Promise<ProjectMeta[]> => ipcRenderer.invoke('project:list'),
  deleteProject: (slug: string): Promise<boolean> => ipcRenderer.invoke('project:delete', slug),
  openDataDir: (): Promise<string> => ipcRenderer.invoke('app:openDataDir'),
  getProject: (slug: string): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('project:get', slug),
  getPeaks: (slug: string): Promise<Uint8Array | null> =>
    ipcRenderer.invoke('project:peaks', slug),
  saveTranscript: (
    slug: string,
    turns: Turn[],
    speakers: SpeakerInfo[]
  ): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('project:saveTranscript', slug, turns, speakers),

  onImportProgress: (cb: (p: ImportProgress) => void): (() => void) => {
    const handler = (_e: unknown, p: ImportProgress): void => cb(p)
    ipcRenderer.on('import:progress', handler)
    return () => {
      ipcRenderer.off('import:progress', handler)
    }
  },

  exportTranscript: (
    slug: string,
    format: 'docx' | 'md' | 'txt' | 'srt' | 'vtt',
    highlight: boolean,
    anon?: boolean
  ): Promise<string | null> => ipcRenderer.invoke('export:run', slug, format, highlight, anon),
  exportAudio: (slug: string): Promise<string | null> =>
    ipcRenderer.invoke('export:audio', slug),
  exportTextDocx: (title: string, text: string): Promise<string | null> =>
    ipcRenderer.invoke('export:textDocx', title, text),

  listNotes: (): Promise<Note[]> => ipcRenderer.invoke('notes:list'),
  saveNote: (input: NoteInput): Promise<Note> => ipcRenderer.invoke('notes:save', input),
  deleteNote: (id: string): Promise<void> => ipcRenderer.invoke('notes:delete', id),

  aiAvailable: (): Promise<boolean> => ipcRenderer.invoke('ai:available'),
  aiHasBackup: (slug: string): Promise<boolean> => ipcRenderer.invoke('ai:hasBackup', slug),
  cleanupAi: (slug: string): Promise<ProjectMeta | null> => ipcRenderer.invoke('ai:cleanup', slug),
  revertAi: (slug: string): Promise<ProjectMeta | null> => ipcRenderer.invoke('ai:revert', slug),
  summarizeAi: (
    slug: string,
    level: 'note' | 'medium' | 'detailed',
    domain: 'therapy' | 'business' | 'general'
  ): Promise<string | null> => ipcRenderer.invoke('ai:summarize', slug, level, domain),
  runPromptAi: (slug: string, system: string): Promise<string | null> =>
    ipcRenderer.invoke('ai:runPrompt', slug, system),
  transcribeClip: (data: ArrayBuffer): Promise<string> => ipcRenderer.invoke('stt:clip', data),

  // Системная диктовка: main командует записью, renderer шлёт аудио обратно.
  sendDictAudio: (data: ArrayBuffer, meta?: { silent?: boolean; error?: string; tooShort?: boolean; id?: number }): Promise<void> =>
    ipcRenderer.invoke('dict:audio', data, meta),
  // Кусок звука во время записи — для текста в плашке (поток), без ответа.
  sendDictChunk: (data: ArrayBuffer): void => ipcRenderer.send('dict:chunk', data),
  onDictLive: (cb: (text: string) => void): (() => void) => {
    const h = (_e: unknown, t: string): void => cb(t)
    ipcRenderer.on('dict:live', h)
    return () => ipcRenderer.off('dict:live', h)
  },
  dictHistory: (): Promise<DictationEntry[]> => ipcRenderer.invoke('dict:history'),
  retryDict: (audio: string): Promise<string> => ipcRenderer.invoke('dict:retry', audio),
  onDictRecord: (
    cb: (cmd: 'start' | 'stop' | 'cancel', opts?: { sounds?: boolean; tailMs?: number; micId?: string; live?: boolean; id?: number }) => void
  ): (() => void) => {
    const hs = (
      ['dict:record-start', 'dict:record-stop', 'dict:record-cancel'] as const
    ).map((ch) => {
      const cmd = ch.split('-')[1] as 'start' | 'stop' | 'cancel'
      const h = (_e: unknown, opts?: { sounds?: boolean; tailMs?: number; micId?: string; live?: boolean; id?: number }): void => cb(cmd, opts)
      ipcRenderer.on(ch, h)
      return [ch, h] as const
    })
    return () => hs.forEach(([ch, h]) => ipcRenderer.off(ch, h))
  },
  onDictState: (cb: (state: string) => void): (() => void) => {
    const h = (_e: unknown, s: string): void => cb(s)
    ipcRenderer.on('dict:state', h)
    return () => ipcRenderer.off('dict:state', h)
  },
  highlightAi: (slug: string): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('ai:highlights', slug),
  clearHighlightsAi: (slug: string): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('ai:clearHighlights', slug),
  anonymizeAi: (slug: string): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('ai:anonymize', slug),
  setAnonRules: (slug: string, rules: AnonRule[]): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('ai:setAnon', slug, rules),
  onAiProgress: (cb: (p: { done: number; total: number; phase: string }) => void): (() => void) => {
    const handler = (_e: unknown, p: { done: number; total: number; phase: string }): void => cb(p)
    ipcRenderer.on('ai:progress', handler)
    return () => {
      ipcRenderer.off('ai:progress', handler)
    }
  },

  startTranscribe: (slug: string, opts: TranscribeOptions): Promise<JobInfo> =>
    ipcRenderer.invoke('job:start', slug, opts),
  cancelJob: (id: string): Promise<JobInfo | null> => ipcRenderer.invoke('job:cancel', id),
  listJobs: (): Promise<JobInfo[]> => ipcRenderer.invoke('job:list'),
  onJobUpdate: (cb: (j: JobInfo) => void): (() => void) => {
    const handler = (_e: unknown, j: JobInfo): void => cb(j)
    ipcRenderer.on('job:update', handler)
    return () => {
      ipcRenderer.off('job:update', handler)
    }
  },

  // Первый запуск («три двери»), локальный движок, бэкап.
  setupInfo: (): Promise<SetupInfo> => ipcRenderer.invoke('setup:info'),
  startSetup: (modelId: string): Promise<void> => ipcRenderer.invoke('setup:start', modelId),
  stopSetup: (): Promise<void> => ipcRenderer.invoke('setup:stop'),
  onSetupProgress: (cb: (p: SetupProgress) => void): (() => void) => {
    const h = (_e: unknown, p: SetupProgress): void => cb(p)
    ipcRenderer.on('setup:progress', h)
    return () => ipcRenderer.off('setup:progress', h)
  },
  ollamaStatus: (): Promise<OllamaStatus> => ipcRenderer.invoke('setup:ollama'),
  pullOllama: (name: string): Promise<void> => ipcRenderer.invoke('setup:pullOllama', name),
  stopOllamaPull: (): Promise<void> => ipcRenderer.invoke('setup:stopOllama'),
  onOllamaProgress: (cb: (p: { status: string; done: number; total: number }) => void): (() => void) => {
    const h = (_e: unknown, p: { status: string; done: number; total: number }): void => cb(p)
    ipcRenderer.on('setup:ollamaProgress', h)
    return () => ipcRenderer.off('setup:ollamaProgress', h)
  },
  checkKey: (service: string, key: string): Promise<KeyVerdict> =>
    ipcRenderer.invoke('setup:checkKey', service, key),
  createDemo: (): Promise<ProjectMeta> => ipcRenderer.invoke('setup:demo'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
  createBackup: (): Promise<{ path: string; items: number; bytes: number } | null> =>
    ipcRenderer.invoke('backup:create'),
  restoreBackup: (): Promise<{ restored: string[]; savedTo: string } | null> =>
    ipcRenderer.invoke('backup:restore'),

  mcpConfig: (): Promise<{ ok: boolean; json: string; configDir: string }> => ipcRenderer.invoke('mcp:config'),
  openClaudeConfigDir: (): Promise<boolean> => ipcRenderer.invoke('mcp:openConfigDir'),

  // Волна 5: запись с телефона, папка-наблюдатель, ссылка.
  phoneStart: (): Promise<{ urls: string[]; qr: string }> => ipcRenderer.invoke('phone:start'),
  phoneStop: (): Promise<void> => ipcRenderer.invoke('phone:stop'),
  onPhoneReceived: (cb: (p: { slug: string; title: string }) => void): (() => void) => {
    const h = (_e: unknown, p: { slug: string; title: string }): void => cb(p)
    ipcRenderer.on('phone:received', h)
    return () => ipcRenderer.off('phone:received', h)
  },
  watchPick: (): Promise<string | null> => ipcRenderer.invoke('watch:pick'),
  watchSet: (dir: string | null, autoTranscribe: boolean, takeExisting: boolean): Promise<void> =>
    ipcRenderer.invoke('watch:set', dir, autoTranscribe, takeExisting),
  linkStatus: (): Promise<{ ytDlp: boolean }> => ipcRenderer.invoke('link:status'),
  linkInstall: (): Promise<void> => ipcRenderer.invoke('link:install'),
  linkImport: (url: string): Promise<ProjectMeta> => ipcRenderer.invoke('link:import', url),
  linkCancel: (): Promise<void> => ipcRenderer.invoke('link:cancel'),
  onLinkProgress: (cb: (p: { phase: string; percent: number | null }) => void): (() => void) => {
    const h = (_e: unknown, p: { phase: string; percent: number | null }): void => cb(p)
    ipcRenderer.on('link:progress', h)
    return () => ipcRenderer.off('link:progress', h)
  },
  onProjectsChanged: (cb: () => void): (() => void) => {
    const h = (): void => cb()
    ipcRenderer.on('projects:changed', h)
    return () => ipcRenderer.off('projects:changed', h)
  },
  onAppNotice: (cb: (message: string) => void): (() => void) => {
    const h = (_e: unknown, m: string): void => cb(m)
    ipcRenderer.on('app:notice', h)
    return () => ipcRenderer.off('app:notice', h)
  },

  // Волна 4: мои заметки → конспект, «Спросить запись», динамика клиента.
  setMyNotes: (slug: string, text: string): Promise<void> => ipcRenderer.invoke('project:setMyNotes', slug, text),
  enhanceNotes: (slug: string): Promise<Note> => ipcRenderer.invoke('ai:enhanceNotes', slug),
  askRecording: (slug: string, question: string, history: AskTurn[], thorough?: boolean): Promise<AskAnswer> =>
    ipcRenderer.invoke('ai:askRecording', slug, question, history, thorough),
  askAll: (question: string, folder: string | null, history: AskTurn[], thorough?: boolean): Promise<AskAnswer> =>
    ipcRenderer.invoke('ai:askAll', question, folder, history, thorough),
  clientDynamics: (folder: string): Promise<Note> => ipcRenderer.invoke('ai:dynamics', folder),
  callMissed: (id: string, minutes: number): Promise<string> => ipcRenderer.invoke('call:missed', id, minutes),
  callNotes: (id: string, text: string): void => ipcRenderer.send('call:notes', id, text),

  // Запись звонка: две дорожки кусками на диск, сборка проекта в main.
  callOpen: (id: string): Promise<void> => ipcRenderer.invoke('call:open', id),
  callChunk: (id: string, kind: 'mic' | 'sys', data: ArrayBuffer): void =>
    ipcRenderer.send('call:chunk', id, kind, data),
  callFinish: (
    id: string,
    opts: { title: string; names: [string, string]; app?: string; myNotes?: string }
  ): Promise<ProjectMeta> =>
    ipcRenderer.invoke('call:finish', id, opts),
  callCancel: (id: string): Promise<void> => ipcRenderer.invoke('call:cancel', id),
  callMute: (appId: string): Promise<void> => ipcRenderer.invoke('call:mute', appId),
  callUnmute: (appId: string): Promise<void> => ipcRenderer.invoke('call:unmute', appId),
  callSnooze: (): Promise<void> => ipcRenderer.invoke('call:snooze'),
  onCallPrompt: (cb: (p: { appId: string; name: string; open?: boolean }) => void): (() => void) => {
    const h = (_e: unknown, p: { appId: string; name: string; open?: boolean }): void => cb(p)
    ipcRenderer.on('call:prompt', h)
    return () => ipcRenderer.off('call:prompt', h)
  },
  onCallWriteError: (cb: (message: string) => void): (() => void) => {
    const h = (_e: unknown, m: string): void => cb(m)
    ipcRenderer.on('call:write-error', h)
    return () => ipcRenderer.off('call:write-error', h)
  },
  onCallPromptGone: (cb: () => void): (() => void) => {
    const h = (): void => cb()
    ipcRenderer.on('call:prompt-gone', h)
    return () => ipcRenderer.off('call:prompt-gone', h)
  },
  onCallRecovered: (cb: (count: number) => void): (() => void) => {
    const h = (_e: unknown, n: number): void => cb(n)
    ipcRenderer.on('call:recovered', h)
    return () => ipcRenderer.off('call:recovered', h)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
