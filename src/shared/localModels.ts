// Каталог локальных моделей Whisper для двери «На этом компьютере».
// Оценки 1–5 — для карточек «точность / скорость» (образец — Handy). Скорость
// дана отдельно для видеокарты NVIDIA и для процессора: на процессоре large-v3
// идёт медленнее реального времени, и человеку надо видеть это ДО загрузки.

export interface LocalModel {
  id: string // имя для движка (--model) и папки faster-whisper-<id>
  label: string
  repo: string // репозиторий на HuggingFace
  approxBytes: number
  accuracy: number
  speedGpu: number
  speedCpu: number
  note: string
}

export const LOCAL_MODELS: LocalModel[] = [
  {
    id: 'large-v3',
    label: 'Large v3 — максимум точности',
    repo: 'Systran/faster-whisper-large-v3',
    approxBytes: 3_092_000_000,
    accuracy: 5,
    speedGpu: 3,
    speedCpu: 1,
    note: 'Лучше всех понимает русскую речь, тихие и сбивчивые места. Нужна видеокарта NVIDIA от 6 ГБ.'
  },
  {
    id: 'large-v3-turbo',
    label: 'Large v3 Turbo — быстро и точно',
    repo: 'mobiuslabsgmbh/faster-whisper-large-v3-turbo',
    approxBytes: 1_623_000_000,
    accuracy: 4,
    speedGpu: 5,
    speedCpu: 2,
    note: 'В 3–4 раза быстрее Large v3, чуть слабее на тихой речи.'
  },
  {
    id: 'medium',
    label: 'Medium — для компьютера без видеокарты',
    repo: 'Systran/faster-whisper-medium',
    approxBytes: 1_532_000_000,
    accuracy: 3,
    speedGpu: 4,
    speedCpu: 2,
    note: 'Компромисс для мощного процессора без NVIDIA. Ошибок больше, чем у Large.'
  },
  {
    id: 'small',
    label: 'Small — для слабых компьютеров',
    repo: 'Systran/faster-whisper-small',
    approxBytes: 486_000_000,
    accuracy: 2,
    speedGpu: 5,
    speedCpu: 4,
    note: 'Работает почти везде, но ошибок заметно больше. Для черновиков.'
  }
]

export const DEFAULT_LOCAL_MODEL = 'large-v3'

export function localModel(id: string | undefined): LocalModel {
  return LOCAL_MODELS.find((m) => m.id === id) ?? LOCAL_MODELS[0]
}

/** Движок расшифровки: архив Faster-Whisper-XXL (Purfview) с GitHub. */
export const ENGINE_RELEASE = {
  repo: 'Purfview/whisper-standalone-win',
  tag: 'Faster-Whisper-XXL',
  asset: /^Faster-Whisper-XXL_r([\d.]+)_windows\.7z$/,
  approxBytes: 1_424_000_000,
  /** архив + распакованный движок одновременно лежат на диске во время установки */
  approxInstallBytes: 1_424_000_000 + 4_600_000_000
}

export interface GpuInfo {
  name: string
  vramMb: number
}

/** Что советовать по железу: есть NVIDIA от 6 ГБ → Large v3; меньше → Turbo; нет → Medium. */
export function recommendModel(gpu: GpuInfo | null): string {
  if (!gpu) return 'medium'
  if (gpu.vramMb >= 6000) return 'large-v3'
  return 'large-v3-turbo'
}

/** Аргументы устройства для движка. auto: есть NVIDIA → GPU float16 (как было
 *  у владельца), иначе процессор int8 (float16 на процессоре просто не работает). */
export function deviceArgs(device: 'auto' | 'cuda' | 'cpu' | undefined, hasGpu: boolean): string[] {
  const useGpu = device === 'cuda' || ((device ?? 'auto') === 'auto' && hasGpu)
  return useGpu ? ['--device', 'cuda', '--compute_type', 'float16'] : ['--device', 'cpu', '--compute_type', 'int8']
}

/** Сколько места нужно под установку (с запасом 10%). */
export function requiredBytes(modelId: string, needEngine: boolean): number {
  const m = localModel(modelId).approxBytes
  return Math.round((m + (needEngine ? ENGINE_RELEASE.approxInstallBytes : 0)) * 1.1)
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace('.', ',') + ' ГБ'
  if (n >= 1e6) return Math.round(n / 1e6) + ' МБ'
  return Math.max(1, Math.round(n / 1e3)) + ' КБ'
}
