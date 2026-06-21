import { Document, Packer, Paragraph, TextRun, BorderStyle } from 'docx'
import { writeFileSync } from 'fs'
import type { ProjectMeta, Word } from '../../shared/types'
import { toSubtitles } from './subtitles'
import { buildAnonOverlay } from '../../shared/anon'

export type ExportFormat = 'docx' | 'md' | 'txt' | 'srt' | 'vtt'

// Обезличенная копия проекта: слова заменяются по правилам meta.anon, скрытые
// хвосты многословных замен выбрасываются. Замены становятся «чистыми» словами.
function anonymizeMeta(meta: ProjectMeta): ProjectMeta {
  if (!meta.anon?.length || !meta.turns) return meta
  const overlay = buildAnonOverlay(meta.turns, meta.anon)
  const turns = meta.turns.map((t) => ({
    ...t,
    words: t.words
      .filter((w) => overlay.get(w.id) !== '')
      .map((w): Word => (overlay.has(w.id) ? { id: w.id, t: overlay.get(w.id)! } : w))
  }))
  return { ...meta, turns }
}

function fmtTime(sec: number): string {
  const t = Math.floor(sec)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function speakerName(meta: ProjectMeta, spk: string): string {
  return meta.speakers?.find((s) => s.id === spk)?.name ?? spk
}

function turnText(words: Word[]): string {
  return words
    .map((w) => w.t)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Подсветка только у «движковых» слов: правленые (t0) и вставленные (нет p) — без неё.
function confHighlight(w: Word): 'red' | 'yellow' | null {
  if (w.t0 !== undefined || w.p === undefined) return null
  if (w.p < 0.5) return 'red'
  if (w.p < 0.72) return 'yellow'
  return null
}

async function buildDocx(meta: ProjectMeta, highlight: boolean): Promise<Buffer> {
  const children: Paragraph[] = []

  children.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: `Расшифровка: ${meta.title}`, bold: true, size: 32 })]
    })
  )
  const date = new Date().toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })
  children.push(
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: `Обработано: ${date}. Текст дословный, без редактуры.`,
          italics: true,
          color: '595959'
        })
      ]
    })
  )

  if (highlight) {
    children.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({ text: 'Как читать: ', bold: true }),
          new TextRun({ text: 'под вопросом', highlight: 'yellow' }),
          new TextRun({ text: ' — модель не вполне уверена;  ' }),
          new TextRun({ text: 'низкая уверенность', bold: true, highlight: 'red' }),
          new TextRun({ text: ' — возможно, не расслышано/ошибка, проверьте по аудио.' })
        ]
      })
    )
  }

  children.push(
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: 'BFBFBF' } },
      children: []
    })
  )

  for (const turn of meta.turns ?? []) {
    const runs: TextRun[] = [
      new TextRun({
        text: `[${speakerName(meta, turn.spk)} — ${fmtTime(turn.startSec)}]  `,
        bold: true,
        color: '1F4E79'
      })
    ]
    for (const w of turn.words) {
      if (!w.t) continue
      const text = w.t + ' '
      const hl = highlight ? confHighlight(w) : null
      if (hl === 'red') runs.push(new TextRun({ text, highlight: 'red', bold: true }))
      else if (hl === 'yellow') runs.push(new TextRun({ text, highlight: 'yellow' }))
      else runs.push(new TextRun({ text }))
    }
    children.push(new Paragraph({ spacing: { after: 160 }, children: runs }))
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
          }
        },
        children
      }
    ]
  })
  return Packer.toBuffer(doc)
}

function buildMd(meta: ProjectMeta): string {
  let out = `# Расшифровка: ${meta.title}\n\n`
  for (const turn of meta.turns ?? []) {
    out += `**${speakerName(meta, turn.spk)} — ${fmtTime(turn.startSec)}:** ${turnText(turn.words)}\n\n`
  }
  return out
}

function buildTxt(meta: ProjectMeta): string {
  let out = `Расшифровка: ${meta.title}\n`
  out += `Текст дословный, без редактуры.\n`
  out += '-'.repeat(60) + '\n\n'
  for (const turn of meta.turns ?? []) {
    out += `[${speakerName(meta, turn.spk)} — ${fmtTime(turn.startSec)}]\n`
    out += turnText(turn.words) + '\n\n'
  }
  return out
}

const BOM = '﻿'

// Простой docx из произвольного текста (для экспорта саммари/тезисов/мыслей).
export async function buildTextDocx(title: string, text: string): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      spacing: { after: 140 },
      children: [new TextRun({ text: title, bold: true, size: 32 })]
    })
  ]
  for (const line of text.split('\n')) {
    children.push(
      new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: line })] })
    )
  }
  const doc = new Document({
    sections: [{ properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }]
  })
  return Packer.toBuffer(doc)
}

export async function exportTranscript(
  meta: ProjectMeta,
  outPath: string,
  format: ExportFormat,
  highlight: boolean,
  anon = false
): Promise<void> {
  const m = anon ? anonymizeMeta(meta) : meta
  if (format === 'docx') {
    const buf = await buildDocx(m, anon ? false : highlight)
    writeFileSync(outPath, buf)
  } else if (format === 'md') {
    writeFileSync(outPath, BOM + buildMd(m), 'utf8')
  } else if (format === 'srt' || format === 'vtt') {
    writeFileSync(outPath, toSubtitles(m.turns ?? [], format), 'utf8')
  } else {
    writeFileSync(outPath, BOM + buildTxt(m), 'utf8')
  }
}
