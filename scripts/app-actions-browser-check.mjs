import { send, navigate, evaluate, click, type, key, waitFor, close, consumerRequest } from './browser-cdp.mjs'
const origin = process.env.QA_ORIGIN
if (!origin) { close(); throw Error('Set QA_ORIGIN; Chromium must be signed into a test account.') }
const name = 'Direct app actions ' + Date.now()
let boardId, tokenId
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await navigate(origin + '/dashboard')
  boardId = (await consumerRequest('/boards', 'POST', { name })).id
  let board = await consumerRequest(`/boards/${boardId}`)
  let cardId = (await consumerRequest(`/boards/${boardId}/cards`, 'POST', { title: name, columnId: board.columns[0].id })).id
  await navigate(origin + '/dashboard/account')
  await click('[aria-label="Open navigation"]')
  await waitFor(`!!document.querySelector('#jump-navigation a[href="/dashboard/boards/${boardId}"]')`)
  await click(`#jump-navigation a[href="/dashboard/boards/${boardId}"]`)
  await waitFor(`location.pathname === '/dashboard/boards/${boardId}' && !!document.querySelector('.board')`)
  await click('.search-trigger')
  await type('[aria-label="Search all cards"]', name)
  await waitFor('document.querySelectorAll(".command-results li").length === 1 && document.querySelector(".command-results").getAttribute("aria-busy") === "false"')
  await key('Enter')
  await waitFor(`location.pathname === '/dashboard/cards/${boardId}/${cardId}' && !!document.querySelector('#card-detail-heading')`)
  await navigate(origin + `/dashboard/boards/${boardId}/edit`)
  await type('#board-settings-name', ' renamed')
  await click('.board-settings-panel .new-board-submit')
  await waitFor(`location.pathname === '/dashboard/boards/${boardId}' && document.body.innerText.includes('renamed')`)
  await navigate(origin + '/dashboard/account')
  await click('.token-panel button')
  await type('[aria-label="Token name"]', name)
  await click('.token-panel form button')
  await waitFor('!!document.querySelector(".token-secret") && !document.querySelector(".token-panel form button").disabled')
  let tokens = await consumerRequest('/tokens')
  tokenId = tokens.find(token => token.name === name)?.id
  if (!tokenId) throw Error('Token was not persisted')
  let index = await evaluate(`[...document.querySelectorAll('.token-panel li')].findIndex(e => e.textContent.includes(${JSON.stringify(name)}))`)
  await click(`.token-panel li:nth-child(${index + 1}) button`)
  await waitFor(`![...document.querySelectorAll('.token-panel li')].some(e => e.textContent.includes(${JSON.stringify(name)}))`)
  if ((await consumerRequest('/tokens')).some(token => token.id === tokenId)) throw Error('Token was not revoked')
  tokenId = undefined
  console.log(JSON.stringify({ lazyNavigation: true, search: true, renameBoard: true, createToken: true, revokeToken: true, consumerApiBlocked: process.env.QA_BLOCK_API === '1' }))
} finally {
  if (tokenId) await consumerRequest('/tokens/' + tokenId, 'DELETE')
  if (boardId) await consumerRequest('/boards/' + boardId, 'DELETE')
  await navigate(origin + '/dashboard')
  close()
}
