// Страница для телефона: выбрать файлы из диктофона/галереи и отправить на
// компьютер. Без внешних скриптов и стилей — всё внутри страницы.

export function phonePage(): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Слово — отправить запись</title>
<style>
  :root { color-scheme: light dark; --a: #0f766e; }
  body { font: 16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 24px 16px; max-width: 520px; margin-inline: auto; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  p { color: #667; margin: 0 0 18px; }
  label.pick { display: block; text-align: center; background: var(--a); color: #fff; padding: 16px; border-radius: 14px; font-weight: 600; }
  input { display: none; }
  .f { border: 1px solid #ccc5; border-radius: 12px; padding: 10px 12px; margin-top: 12px; }
  .bar { height: 6px; background: #ccc5; border-radius: 3px; margin-top: 8px; overflow: hidden; }
  .bar i { display: block; height: 100%; width: 0; background: var(--a); transition: width .2s; }
  .ok { color: var(--a); } .err { color: #c0392b; }
</style>
</head>
<body>
<h1>Отправить запись в «Слово»</h1>
<p>Выберите файл из диктофона или галереи — он придёт прямо на компьютер. Не закрывайте страницу, пока идёт отправка.</p>
<label class="pick">Выбрать записи<input id="i" type="file" accept="audio/*,video/*" multiple></label>
<div id="list"></div>
<script>
const list = document.getElementById('list')
document.getElementById('i').addEventListener('change', async (e) => {
  for (const file of e.target.files) await send(file)
  e.target.value = ''
})
function send(file) {
  return new Promise((resolve) => {
    const row = document.createElement('div')
    row.className = 'f'
    row.innerHTML = '<div class="n"></div><div class="bar"><i></i></div><div class="s">Отправляю…</div>'
    row.querySelector('.n').textContent = file.name
    list.prepend(row)
    const bar = row.querySelector('i'), st = row.querySelector('.s')
    const x = new XMLHttpRequest()
    x.open('POST', location.pathname + '/file?name=' + encodeURIComponent(file.name))
    x.upload.onprogress = (ev) => { if (ev.lengthComputable) bar.style.width = (ev.loaded / ev.total * 100).toFixed(0) + '%' }
    x.upload.onload = () => { st.textContent = 'Файл на компьютере, готовлю запись…' }
    x.onload = () => {
      let r = {}
      try { r = JSON.parse(x.responseText) } catch (e) {}
      if (x.status === 200) { bar.style.width = '100%'; st.className = 's ok'; st.textContent = 'Готово: «' + (r.title || file.name) + '» в списке записей.' }
      else { st.className = 's err'; st.textContent = 'Не получилось: ' + (r.error || ('ошибка ' + x.status)) }
      resolve()
    }
    x.onerror = () => { st.className = 's err'; st.textContent = 'Нет связи с компьютером. Окно «С телефона» открыто? Телефон в той же Wi-Fi сети?'; resolve() }
    x.send(file)
  })
}
</script>
</body>
</html>`
}
