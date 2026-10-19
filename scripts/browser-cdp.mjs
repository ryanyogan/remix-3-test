import { writeFile } from 'node:fs/promises'
let target=(await(await fetch((process.env.BROWSER_CDP_URL ?? 'http://127.0.0.1:9334') + '/json')).json()).find(t=>t.type==='page')
let ws=new WebSocket(target.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r,{once:true}))
let sequence=0,pending=new Map(),listeners=new Map()
ws.addEventListener('message',({data})=>{let m=JSON.parse(data);if(m.id){let j=pending.get(m.id);pending.delete(m.id);m.error?j.reject(m.error):j.resolve(m.result)}else{for(let listener of listeners.get(m.method)??[])listener(m.params)}})
export function send(method,params={}){return new Promise((resolve,reject)=>{let id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
export async function evaluate(expression){let r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
export async function click(selector,dx=.5,dy=.5){await waitFor(`!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).matches(':disabled')`);await evaluate(`(()=>{let e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:e.closest(':popover-open')?'nearest':'center'})})()`);await new Promise(r=>setTimeout(r,100));let r=await evaluate(`(()=>{let e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});let r=e.getBoundingClientRect();let x=r.x+r.width*${dx},y=r.y+r.height*${dy};if(!e.contains(document.elementFromPoint(x,y)))throw Error('Click target is covered: '+${JSON.stringify(selector)});return {x,y}})()`);for(let type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...r,button:type==='mouseMoved'?'none':'left',clickCount:1})}
export async function key(key,code=key){await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,text:key==='Enter'?'\r':undefined,unmodifiedText:key==='Enter'?'\r':undefined,windowsVirtualKeyCode:key==='Enter'?13:key==='Escape'?27:undefined});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code})}
export async function type(selector,text){await click(selector);await send('Input.insertText',{text})}
export async function waitFor(expression,timeout=8000){let until=Date.now()+timeout;while(Date.now()<until){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100))}throw Error('Timeout: '+expression)}
export async function navigate(url){
  await send('Page.bringToFront')
  let navigation=await send('Page.navigate',{url})
  if(navigation.errorText)throw Error(navigation.errorText)
  let deadline=Date.now()+15000
  while(Date.now()<deadline){
    let {frameTree}=await send('Page.getFrameTree')
    if((!navigation.loaderId||frameTree.frame.loaderId===navigation.loaderId) && await evaluate(`location.href===${JSON.stringify(url)} && document.readyState==='complete'`))return
    await new Promise(r=>setTimeout(r,100))
  }
  throw Error('Navigation timed out: '+url)
}
export async function screenshot(path){let r=await send('Page.captureScreenshot',{format:'png'});await writeFile(path,Buffer.from(r.data,'base64'))}
export function close(){ws.close();if(consumerAttempts.length)throw Error('App contacted the consumer API: '+consumerAttempts.join(', '))}

export function subscribe(method,listener){let set=listeners.get(method)??new Set();set.add(listener);listeners.set(method,set);return ()=>set.delete(listener)}

// Fixtures are consumer calls from Node. Browser traffic can independently block the public API.
export async function consumerRequest(path, method = 'GET', body) {
  let origin = process.env.QA_ORIGIN
  if (!origin) throw Error('Set QA_ORIGIN')
  let { cookies } = await send('Network.getCookies', { urls: [origin] })
  let response = await fetch(origin + '/api/v1' + path, {
    method, headers: { Origin: origin, Cookie: cookies.map(c => `${c.name}=${c.value}`).join('; '), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw Error(`${response.status}: ${await response.text()}`)
  return response.status === 204 ? null : (await response.json()).data
}

let consumerAttempts = []
if (process.env.QA_BLOCK_API === '1') {
  await send('Network.enable')
  await send('Network.setBlockedURLs', { urls: ['*/api/v1*'] })
  subscribe('Network.requestWillBeSent', ({ request }) => {
    if (new URL(request.url).pathname.startsWith('/api/v1')) consumerAttempts.push(request.url)
  })
}
