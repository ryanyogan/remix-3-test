import assert from 'node:assert/strict'
import { send, subscribe, navigate, evaluate, click, type, key, waitFor, close, consumerRequest as api } from './browser-cdp.mjs'
const origin = process.env.QA_ORIGIN
if (!origin) { close(); throw Error('Set QA_ORIGIN; Chromium must be signed into a test account.') }
const settle = () => new Promise(resolve => setTimeout(resolve, 250))
const geometry = () => evaluate(`(() => {
  let rect = selector => { let r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height } }
  return { editor: rect('lexxy-editor'), compose: rect('.perma-comment-compose'), below: rect('.perma-subscribers'), card: rect('.perma-paper'), scrollY, width: document.documentElement.clientWidth }
})()`)
let boardId, paused = [], holding = false
const unsubscribe = subscribe('Fetch.requestPaused', ({ requestId }) => {
  if (holding) paused.push(requestId)
  else void send('Fetch.continueRequest', { requestId })
})
try {
  boardId = (await api('/boards', 'POST', { name: 'Card layout check' })).id
  const board = await api(`/boards/${boardId}`)
  const cardId = (await api(`/boards/${boardId}/cards`, 'POST', { title: 'Stable card', columnId: board.columns[0].id, descriptionHtml: '<p>Server rendered description</p>' })).id
  const path = `/boards/${boardId}/cards/${cardId}`
  await api(path + '/comments', 'POST', { bodyHtml: '<p>Server rendered comment</p>' })
  await send('Network.enable')
  await send('Network.setCacheDisabled', { cacheDisabled: true })
  await send('Fetch.enable', { patterns: [{ urlPattern: '*lexxy/runtime/*', requestStage: 'Request' }] })
  for (const width of [1440, 390, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
    holding = true
    await navigate(origin + `/dashboard/cards/${boardId}/${cardId}`)
    await waitFor(`!!document.querySelector('lexxy-editor') && document.body.innerText.includes('Server rendered comment')`)
    await settle()
    assert.ok(paused.length, 'Editor runtime was not delayed')
    assert.equal(await evaluate(`!!customElements.get('lexxy-editor')`), false)
    const before = await geometry()
    holding = false
    for (const requestId of paused.splice(0)) await send('Fetch.continueRequest', { requestId })
    await waitFor(`!!document.querySelector('lexxy-editor [contenteditable]')`)
    await settle()
    const after = await geometry()
    for (const name of ['editor', 'compose', 'below', 'card']) {
      for (const axis of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(before[name][axis] - after[name][axis]) <= 1, `${width}px: ${name}.${axis} shifted from ${before[name][axis]} to ${after[name][axis]}`)
    }
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Page overflows on mobile')
    console.log(`${width}px: server-rendered discussion and editor upgrade have stable geometry`)
  }
  await send('Fetch.disable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await settle()
  // Scroll with real input; opening and dismissing the menu must not reposition the page.
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1300, y: 700, deltaX: 0, deltaY: 300 })
  await waitFor('scrollY > 0')
  const beforeMenu = await geometry()
  await key('j', 'KeyJ')
  await waitFor(`!!document.querySelector('.jump-dialog[open]')`)
  assert.equal(await evaluate(`document.querySelector('.jump-dialog').matches(':modal')`), false)
  assert.notEqual(await evaluate(`getComputedStyle(document.documentElement).overflowY`), 'hidden')
  await settle()
  assert.deepEqual(await geometry(), beforeMenu, 'Opening menu moved the background')
  await key('Escape')
  await waitFor(`!document.querySelector('.jump-dialog[open]')`)
  assert.deepEqual(await geometry(), beforeMenu, 'Closing menu moved the background')
  assert.equal(await evaluate(`document.activeElement.matches('.jump-trigger')`), true)
  await key('j', 'KeyJ'); await settle()
  for (const event of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type: event, x: 30, y: 250, button: 'left', clickCount: 1 })
  await waitFor(`!document.querySelector('.jump-dialog[open]')`)
  assert.deepEqual(await geometry(), beforeMenu, 'Outside dismissal moved the background')
  // Adding/removing the viewport scrollbar must not change the card's horizontal position.
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 5000, deviceScaleFactor: 1, mobile: false })
  await settle()
  const tall = await geometry()
  assert.equal(await evaluate('document.documentElement.scrollHeight > innerHeight'), false)
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await settle()
  const short = await geometry()
  assert.equal(await evaluate('document.documentElement.scrollHeight > innerHeight'), true)
  assert.equal(tall.card.x, short.card.x)
  assert.equal(tall.card.width, short.card.width)
  // Existing editor runtime also handles fresh editors after posting and switching to edit mode.
  await type('.perma-comment-compose [contenteditable]', 'A new comment')
  await click('.perma-post')
  await waitFor(`document.querySelector('.perma-discussion').textContent.includes('A new comment') && document.querySelector('lexxy-editor').isBlank`)
  await type('.perma-comment-compose [contenteditable]', 'Another comment')
  await click('.perma-post')
  await waitFor(`document.querySelector('.perma-discussion').textContent.includes('Another comment')`)
  await click('#card-detail-heading button')
  await waitFor(`!!document.querySelector('#card-title') && !document.querySelector('.perma-primary').disabled`)
  assert.ok(await evaluate(`document.querySelector('.perma-edit lexxy-editor').value.includes('Server rendered description')`))
  await type('.perma-edit [contenteditable]', ' Edited')
  await click('.perma-actions button[type=submit]')
  await waitFor(`!!document.querySelector('#card-detail-heading') && document.querySelector('.perma-description').textContent.includes('Edited')`)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await click('.jump-trigger')
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.jump-dialog')).animationName`), 'none')
  console.log(JSON.stringify({ stableEditorUpgrade: true, serverRenderedComments: true, nonmodalMenu: true, outsideDismissal: true, focusReturn: true, stableScrollbar: true, commentRemount: true, editing: true, reducedMotion: true }))
} finally {
  holding = false
  await send('Fetch.disable')
  unsubscribe()
  await send('Network.setCacheDisabled', { cacheDisabled: false })
  await send('Emulation.setEmulatedMedia', { features: [] })
  if (boardId) await api('/boards/' + boardId, 'DELETE')
  await navigate(origin + '/dashboard')
  close()
}
