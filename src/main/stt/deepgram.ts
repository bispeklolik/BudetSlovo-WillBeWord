import { readFileSync } from 'fs'
import type { MergeResult } from '../project/merge'
import { deepgramToTurns, type DgResponse } from '../../shared/sttMappers'
import { netSignal } from './net'
import { cleanWords } from '../../shared/vocab'

// Расшифровка через Deepgram (облако). Ключ хранится локально в настройках.
// Аудио уходит на серверы Deepgram — в отличие от локального Whisper.
// Маппер ответа — в shared/sttMappers.ts (общий с веб-версией).

const DG_URL = 'https://api.deepgram.com/v1/listen'

// Словарь для Nova-3 — параметр keyterm. Документация Deepgram «Keyterm Prompting»: до 100 терминов
// и не больше 500 токенов на запрос, советуют 20–50 самых важных. Русское слово — несколько токенов,
// поэтому берём не больше 50 терминов и ~600 знаков: так запрос не упирается в предел.
const KEYTERM_MAX = 50
const KEYTERM_CHARS = 600

export interface DeepgramOpts {
  verbatim?: boolean
  terms?: string[]
  speakers?: number
}

/** Термины словаря, которые уйдут в keyterm (с пределами Deepgram). */
export function keyterms(terms: string[] | undefined): string[] {
  const out: string[] = []
  let chars = 0
  for (const t of cleanWords(terms)) {
    if (out.length >= KEYTERM_MAX || chars + t.length > KEYTERM_CHARS) break
    out.push(t)
    chars += t.length
  }
  return out
}

/** Параметры запроса к Deepgram для записи. withTerms=false — без словаря (повтор после отказа). */
export function deepgramParams(opts?: DeepgramOpts, withTerms = true): URLSearchParams {
  const params = new URLSearchParams({
    // Nova-3 (с 11.11.2026, решение владельца). Замер на 20 мин публичной записи с параметрами
    // программы: ошибок 6,9 % против 7,0 % у nova-2, неуверенных слов вдвое меньше (36 против 79).
    model: 'nova-3',
    language: 'ru',
    // diarize=true устарел и ведёт на старый разделитель v1; diarize_model=v2 — новый
    // (документация Deepgram «Diarization», совместим с Nova-1/2/3; оба параметра сразу
    // Deepgram отклоняет). Числа говорящих Deepgram не принимает.
    diarize_model: 'v2',
    punctuate: 'true',
    smart_format: 'true'
  })
  // filler_words официально только для английского — для русского «как получится».
  if (opts?.verbatim) params.set('filler_words', 'true')
  // Словарь: keywords с Nova-3 не работает, вместо него keyterm (термины и имена пишет как в словаре).
  if (withTerms) for (const t of keyterms(opts?.terms)) params.append('keyterm', t)
  return params
}

export async function transcribeWithDeepgram(
  audioPath: string,
  key: string,
  signal?: AbortSignal,
  opts?: DeepgramOpts
): Promise<MergeResult> {
  const body = readFileSync(audioPath)
  // ponytail: синхронный endpoint — тянет и многочасовые pre-recorded в одном
  // запросе. Если файлы станут огромными / запрос будет отваливаться по таймауту
  // — перейти на async callback API.
  const send = (withTerms: boolean): Promise<Response> =>
    fetch(`${DG_URL}?${deepgramParams(opts, withTerms).toString()}`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/mp4' },
      body,
      signal: netSignal(600_000, signal)
    })
  let res = await send(true)
  if (res.status === 401) throw new Error('Deepgram: неверный ключ API (проверьте в Настройках).')
  // Deepgram отказал из-за словаря (например, «Keyterm limit exceeded») — запись важнее словаря:
  // повторяем без него, чтобы человек получил расшифровку.
  if (res.status === 400 && keyterms(opts?.terms).length > 0) {
    const text = await res.text()
    if (/keyterm/i.test(text)) res = await send(false)
    else throw new Error(`Deepgram HTTP 400: ${text.slice(0, 200)}`)
  }
  if (!res.ok) throw new Error(`Deepgram HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const dg = (await res.json()) as DgResponse
  const result = deepgramToTurns(dg)
  if (result.turns.length === 0) throw new Error('Deepgram вернул пустую расшифровку.')
  return result
}
