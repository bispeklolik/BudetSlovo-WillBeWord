import { join } from 'path'

export const DATA_DIR = 'D:\\Apps\\slovo-data'
export const PROJECTS_DIR = join(DATA_DIR, 'projects')

export const ENGINE_DIR = 'D:\\STT\\tool\\Faster-Whisper-XXL'
export const ENGINE_EXE = join(ENGINE_DIR, 'faster-whisper-xxl.exe')
export const FFMPEG = join(ENGINE_DIR, 'ffmpeg.exe')
export const MODELS_DIR = 'D:\\STT\\models'
export const STT_TEMP = 'D:\\STT\\temp'

// Локальный ИИ (Ollama). Установлен в D:\Apps\ollama (junction → F).
// Модели ИИ — в slovo-data\models (D:\Apps\slovo-data — junction → F:, т.е. уже на SSD).
// NB: скачанные huihui_ai/qwen2.5-abliterate (F:\ollama-models) выдавали мусор — битые,
// не используем; останавливаемся на рабочей qwen2.5:7b-instruct.
export const OLLAMA_EXE = 'D:\\Apps\\ollama\\ollama.exe'
export const OLLAMA_ADDR = '127.0.0.1:11434'
export const OLLAMA_MODELS_DIR = join(DATA_DIR, 'models')
