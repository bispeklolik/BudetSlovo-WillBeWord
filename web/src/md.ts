// Мини-Markdown для ИИ-результатов: заголовки, списки, жирный/курсив/код.
// Сначала экранируем HTML (безопасность), затем размечаем известный сабсет.

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

export function mdToHtml(src: string): string {
  const lines = esc(src).split('\n')
  let html = ''
  let inList = false
  let para: string[] = []
  const flushPara = (): void => {
    if (para.length) {
      html += `<p>${inline(para.join('<br>'))}</p>`
      para = []
    }
  }
  const closeList = (): void => {
    if (inList) {
      html += '</ul>'
      inList = false
    }
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flushPara()
      closeList()
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)/)
    if (h) {
      flushPara()
      closeList()
      const lvl = Math.min(4, h[1].length + 2)
      html += `<h${lvl}>${inline(h[2])}</h${lvl}>`
      continue
    }
    const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/)
    if (li) {
      flushPara()
      if (!inList) {
        html += '<ul>'
        inList = true
      }
      html += `<li>${inline(li[1])}</li>`
      continue
    }
    closeList()
    para.push(line)
  }
  flushPara()
  closeList()
  return html
}
