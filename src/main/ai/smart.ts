import { chunkByLines } from '../../shared/chunk'
import type { AiProvider } from './provider'

// Map-reduce для локальной модели: длинная запись не влезает в контекст
// (16k токенов) — обрабатываем частями и сводим итог. Облачным моделям
// (200k+) отдаём целиком.
export const LOCAL_CTX_CHARS = 45_000

export async function generateSmart(provider: AiProvider, system: string, text: string): Promise<string> {
  if (!provider.isLocal || text.length <= LOCAL_CTX_CHARS) return provider.generate(system, text)
  const chunks = chunkByLines(text, LOCAL_CTX_CHARS)
  const parts: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    parts.push(
      await provider.generate(
        system + ` (Это часть ${i + 1} из ${chunks.length} длинной записи — обработай только её.)`,
        chunks[i]
      )
    )
  }
  return provider.generate(
    system +
      ' Ниже — результаты по последовательным частям одной длинной записи. Сведи их в один целостный ответ без повторов.',
    parts.join('\n\n---\n\n')
  )
}
