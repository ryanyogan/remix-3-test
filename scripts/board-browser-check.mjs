import { subscribe, send, navigate, evaluate, click, type, key, waitFor, screenshot, close } from './browser-cdp.mjs'
const origin = process.env.QA_ORIGIN
if (!origin) { close(); throw Error('Set QA_ORIGIN; the Chromium test browser must be signed in.') }
let boardId
let returnUrl = await evaluate('location.href')
async function request(path, method = 'GET', body) {
  return evaluate(`fetch('/api/v1'+${JSON.stringify(path)}, {method:${JSON.stringify(method)},headers:{'Content-Type':'application/json'},body:${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))}}).then(async r=>{if(!r.ok)throw Error(r.status+': '+await r.text());return r.status===204?null:(await r.json()).data})`)
}
async function settle() { await new Promise(r => setTimeout(r, 350)) }
async function drag(source, target) {
  const box = selector => evaluate(`(()=>{let r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+Math.min(48,r.height/2)}})()`)
  await evaluate(`document.querySelector(${JSON.stringify(source)}).scrollIntoView({block:'center'})`)
  await settle()
  let from = await box(source), to = await box(target)
  await send('Input.setInterceptDrags', { enabled: true })
  let dragData
  const unsubscribe = subscribe('Input.dragIntercepted', event => { dragData = event.data })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1 })
  for (let i = 1; i <= 12; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x+(to.x-from.x)*i/12, y: from.y+(to.y-from.y)*i/12, button: 'left', buttons: 1 })
    await new Promise(r => setTimeout(r, 40))
  }
  if (!dragData) throw Error('Chromium did not start a native drag')
  for (let type of ['dragEnter','dragOver','drop']) await send('Input.dispatchDragEvent', {type,...to,data:dragData})
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', buttons: 0, clickCount: 1 })
  unsubscribe()
  await send('Input.setInterceptDrags', { enabled: false })
  await settle()
}
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1249, height: 1299, deviceScaleFactor: 2, mobile: false })
  await navigate(`${origin}/dashboard`)
  boardId = (await request('/boards', 'POST', { name: 'Omarchy' })).id
  let board = await request(`/boards/${boardId}`)
  for (let [index, name] of ['Maybe?', 'Yes', 'Done'].entries()) await request(`/boards/${boardId}/columns/${board.columns[index].id}`, 'PATCH', { name })
  let cardId = (await request(`/boards/${boardId}/cards`, 'POST', { title: 'Untitled', columnId: board.columns[0].id })).id
  await request(`/boards/${boardId}/cards`, 'POST', { title: 'Current work', columnId: board.columns[1].id })
  for (let title of ['White flash on navigation in dark mode', 'Header changes', 'Performance', 'ditch the globe', 'Fix', 'Update domains', 'Remove find by mood', 'One global header component', 'Mobile optimization']) {
    let card = await request(`/boards/${boardId}/cards`, 'POST', { title, columnId: board.columns[2].id })
    await request(`/boards/${boardId}/cards/${card.id}/comments`, 'POST', { body: 'A browser verification comment.' })
  }
  const url = `${origin}/dashboard/boards/${boardId}`
  await navigate(url); await settle()
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 })
  await settle(); await screenshot('/tmp/trellix-board-desktop.png')
  if (await evaluate('document.documentElement.scrollWidth > innerWidth')) throw Error('Desktop horizontal overflow')
  let metrics = await evaluate(`(()=>{let c=document.querySelector('.lane[data-done] .card'),r=c.getBoundingClientRect();return {width:r.width,height:r.height,title:getComputedStyle(c.querySelector('.card-title')).fontSize}})()`)
  await click('.board-round-button[aria-label="Webhooks"]')
  await waitFor('location.pathname.endsWith("/webhooks") && document.body?.innerText.includes("Webhook delivery")')
  await click('.board-tools-heading a'); await waitFor('!!document.querySelector(".board")'); await settle()
  await click('.board-round-button[aria-label^="Settings for"]')
  await waitFor('!!document.querySelector("#board-settings-name")'); await settle()
  await click('#board-settings-name')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65, commands: ['selectAll'] })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65, commands: ['selectAll'] })
  await send('Input.insertText', { text: 'Omarchy board check' })
  await click('.board-settings-panel .new-board-submit')
  await waitFor('document.querySelector(".board-title")?.textContent === "Omarchy board check"'); await settle()
  await click('.lane .board-watch-toggle')
  await waitFor('document.querySelector(".lane .board-watch-toggle")?.getAttribute("aria-pressed") === "false"')
  await navigate(url)
  if ((await request(`/boards/${boardId}`)).watching !== false) throw Error('Watching did not persist')
  await click('.lane .board-watch-toggle')
  await waitFor('document.querySelector(".lane .board-watch-toggle")?.getAttribute("aria-pressed") === "true"')
  let notification = await request(`/boards/${boardId}/cards`, 'POST', { title: 'A watched notification', columnId: board.columns[0].id })
  await click('.dashboard-dock a[href="/dashboard/notifications"]')
  await waitFor('document.body?.innerText.includes("A watched notification")')
  await request(`/boards/${boardId}/cards/${notification.id}`, 'DELETE')
  await navigate(url); await settle()
  await key('f', 'KeyF'); await waitFor('document.activeElement?.getAttribute("aria-label") === "Filter cards"')
  await send('Input.insertText', { text: 'Performance' }); await settle()
  if (await evaluate('document.querySelectorAll(".lane .card").length') !== 1) throw Error('Filter did not narrow cards')
  await click('.board-search')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65, commands: ['selectAll'] })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await key('Tab'); await settle()
  await click('[aria-label=\'Expand column "Yes"\']'); await settle()
  if (!await evaluate('!!document.querySelector(".lane[data-done][data-collapsed]")')) throw Error('Expanding Yes did not collapse Done')
  await navigate(url); await settle()
  if (!await evaluate(`document.querySelector('[aria-label="Yes"]')?.getAttribute('data-collapsed') === null`)) throw Error('Expansion did not persist')
  await click('[aria-label=\'Expand column "Done"\']'); await settle()
  // Native HTML drag with real pointer input, including a collapsed column target.
  let source = `.lane[data-maybe] .card:has(a[href$="/${cardId}"])`
  await drag(source, '.lane[data-not-now] .lane-expand')
  await waitFor(`fetch('/api/v1/boards/${boardId}').then(r=>r.json()).then(({data:b})=>b.columns.find(c=>c.name==='Not Now')?.id===b.items.find(i=>i.id==='${cardId}')?.columnId)`)
  await key('c', 'KeyC')
  await waitFor('!!document.querySelector("lexxy-editor [contenteditable]")'); await settle()
  await type('[aria-label="Card title"]', 'New cards still start in Maybe')
  await key('Enter')
  await waitFor('!!document.querySelector(".board")'); await settle()
  let created = (await request(`/boards/${boardId}`)).items.find(item => item.title === 'New cards still start in Maybe')
  if (created?.columnId !== board.columns[0].id) throw Error('New card went into Not Now')
  await request(`/boards/${boardId}/cards/${created.id}`, 'PATCH', { columnId: board.columns[2].id })
  await navigate(`${origin}/dashboard/cards/${boardId}/${created.id}`); await settle()
  await key('d', 'KeyD'); await settle()
  if ((await request(`/boards/${boardId}/cards/${created.id}`)).column_id !== board.columns[0].id) throw Error('Reopened card went into Not Now')
  await navigate(url); await settle()
  await click('[aria-label=\'Expand column "Not Now"\']'); await settle()
  await screenshot('/tmp/trellix-board-not-now.png')
  await click('[aria-label=\'Expand column "Done"\']'); await settle()
  await click('.lane-add'); await type('[aria-label="Column name"]', 'Review'); await click('.composer button[type="submit"]'); await settle()
  board = await request(`/boards/${boardId}`)
  if (board.columns.at(-1).name !== 'Done' || board.columns.at(-2).name !== 'Review') throw Error('New column displaced Done')
  await key('Escape')
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await navigate(url); await settle()
  if (await evaluate('document.documentElement.scrollWidth > innerWidth')) throw Error('Mobile page overflow')
  await screenshot('/tmp/trellix-board-mobile.png')
  await send('Emulation.setDeviceMetricsOverride', { width: 1249, height: 1299, deviceScaleFactor: 2, mobile: false })
  await request(`/boards/${boardId}`, 'PATCH', { name: 'Omarchy' })
  await navigate(url); await settle()
  await screenshot('/tmp/trellix-board-final.png')
  await click('.jump-trigger'); await waitFor('!!document.querySelector(".jump-dialog[open]")'); await settle()
  await click('.theme-toggle'); await key('Escape'); await settle()
  await screenshot('/tmp/trellix-board-dark.png')
  await click('.jump-trigger'); await settle(); await click('.theme-toggle'); await key('Escape'); await settle()
  console.log(JSON.stringify({ metrics, gearAndGlobe: true, settingsRename: true, watchingPersisted: true, notifications: true, filtering: true, collapsePersisted: true, collapsedDrop: true, columnOrdering: true, createAndReopenIntake: true, mobileBounds: true, darkTheme: true }))
} catch (error) {
  await screenshot('/tmp/trellix-board-failure.png')
  throw error
} finally {
  await send('Input.setInterceptDrags', { enabled: false })
  if (boardId) { await request(`/boards/${boardId}`, 'DELETE'); await evaluate(`Object.keys(localStorage).filter(k=>k.includes(${JSON.stringify(boardId)})).forEach(k=>localStorage.removeItem(k))`) }
  await send('Emulation.setEmulatedMedia', { features: [] })
  await navigate(returnUrl)
  close()
}
