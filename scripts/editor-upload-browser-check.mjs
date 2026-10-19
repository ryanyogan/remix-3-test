import {deflateSync} from 'node:zlib'
import {writeFile,unlink} from 'node:fs/promises'
import {send,navigate,evaluate,click,type,key,waitFor,screenshot,close} from './browser-cdp.mjs'
const origin=process.env.QA_ORIGIN
if(!origin){close();throw Error('Set QA_ORIGIN; use a signed-in Chromium test account.')}
const ready=()=>new Promise(r=>setTimeout(r,300))
async function check(expression,message){if(!await evaluate(expression))throw Error(message)}
async function api(path,method='GET',body){return evaluate(`fetch('/api/v1'+${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{'Content-Type':'application/json'},body:${body===undefined?'undefined':JSON.stringify(JSON.stringify(body))}}).then(async r=>{if(!r.ok)throw Error(await r.text());return r.status===204?null:(await r.json()).data})`)}
async function selectFiles(selector,files){await click(selector);let {root}=await send('DOM.getDocument');let {nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:'lexxy-editor input[type=file]'});if(!nodeId)throw Error('File chooser missing');await send('DOM.setFileInputFiles',{nodeId,files})}
const file='/tmp/trellix-inline-notes.txt'
await writeFile(file,'A downloadable attachment from the card editor.')
const image='/tmp/trellix-inline-image.png'
function crc32(buf){let c=0xffffffff;for(let b of buf){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
function chunk(type,data){let t=Buffer.from(type),n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(data.length);c.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([n,t,data,c])}
let header=Buffer.alloc(13);header.writeUInt32BE(200,0);header.writeUInt32BE(100,4);header[8]=8;header[9]=2
let pixels=Buffer.alloc(100*601);for(let y=0;y<100;y++){for(let x=0;x<200;x++){pixels[y*601+1+x*3]=50;pixels[y*601+2+x*3]=130;pixels[y*601+3+x*3]=210}}
await writeFile(image,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]))
let boardId
try{
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});await navigate(origin+'/dashboard')
let board=await api('/boards','POST',{name:'Inline upload check'});boardId=board.id
await navigate(origin+'/dashboard/cards/new?board='+boardId);await waitFor('!!document.querySelector("[data-lexical-editor]") && !document.querySelector(".perma-primary").disabled');await ready()
await type('#card-title','Card with inline uploads')
await type('[contenteditable]','Notes before the attachments.');await key('Enter')
await send('Page.setInterceptFileChooserDialog',{enabled:true})
await selectFiles('lexxy-toolbar [data-command="uploadImage"]',[image])
await waitFor('document.querySelector("lexxy-editor").value.includes("action-text-attachment") && !document.querySelector(".perma-primary").disabled')
await check('document.querySelector("lexxy-editor figure img")?.naturalWidth>0','Image preview missing')
await selectFiles('lexxy-toolbar [data-command="uploadFile"]',[file])
await waitFor('document.querySelector("lexxy-editor").value.includes("trellix-inline-notes.txt") && !document.querySelector(".perma-primary").disabled')
await screenshot('/tmp/trellix-inline-upload-draft.png')
let draftHtml=await evaluate('document.querySelector("lexxy-editor").value');if(!draftHtml.includes('action-text-attachment'))throw Error('No attachment markup')
await click('.perma-actions button[type=submit]');await waitFor(`location.pathname==='/dashboard/boards/${boardId}' && !!document.querySelector('.card-open')`);await ready()
let stored=await api('/boards/'+boardId);let card=stored.items[0],path=`/boards/${boardId}/cards/${card.id}`
let detail=await api(path);if(detail.files.length!==2)throw Error('Files not attached to created card')
await click('.card-open');await waitFor('!!document.querySelector(".perma-comment-compose [contenteditable]")');await ready()
await check('document.querySelector(".perma-description img")?.naturalWidth>0','Saved image did not load')
await check('document.querySelector(".perma-description").textContent.includes("trellix-inline-notes.txt")','Saved file link missing')
let fileId=detail.files.find(f=>f.name==='trellix-inline-notes.txt').id
await check(`fetch('/api/v1/files/${fileId}').then(async r=>r.ok && (await r.text()).includes('downloadable attachment'))`,'Download bytes changed')
await click('#card-detail-heading button');await waitFor('!!document.querySelector("#card-title") && !document.querySelector(".perma-primary").disabled');await ready()
await check('document.querySelector(".perma-edit lexxy-editor").value.includes("action-text-attachment") && document.querySelector(".perma-edit lexxy-editor figure img")?.naturalWidth>0','Editing lost attachments')
await click('.perma-actions button[type=submit]');await waitFor('!!document.querySelector("#card-detail-heading")')
await navigate(origin+`/dashboard/cards/${boardId}/${card.id}`);await waitFor('!!document.querySelector(".perma-comment-compose [contenteditable]")');await ready()
await check('document.querySelector(".perma-description img")?.naturalWidth>0','Reload lost image')
await selectFiles('.perma-comment-compose lexxy-toolbar [data-command="uploadFile"]',[file]);await waitFor('!document.querySelector(".perma-post").disabled');await click('.perma-post');await waitFor('!!document.querySelector(".perma-comment-content action-text-attachment")')
// A failed upload stays visible and blocks saving until explicitly retried/discarded.
await navigate(origin+'/dashboard/cards/new?board='+boardId);await waitFor('!!document.querySelector("[data-lexical-editor]") && !document.querySelector(".perma-primary").disabled');await ready()
let point=await evaluate('(()=>{let r=document.querySelector("[contenteditable]").getBoundingClientRect();return {x:r.x+30,y:r.y+30}})()')
for(let type of ['dragEnter','dragOver','drop'])await send('Input.dispatchDragEvent',{type,...point,data:{items:[],files:[file],dragOperationsMask:1}})
await waitFor('document.querySelector("lexxy-editor").value.includes("trellix-inline-notes.txt") && !document.querySelector(".perma-primary").disabled')
await click('[contenteditable]');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2});await key('Backspace');await waitFor('document.querySelector("lexxy-editor").isBlank')
await send('Network.enable');await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1})
await selectFiles('lexxy-toolbar [data-command="uploadFile"]',[file]);await waitFor('!!document.querySelector(".editor-upload-error")');await check('document.querySelector(".perma-primary").disabled','Failure did not block creation')
await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1})
await click('.editor-upload-error button');await waitFor('!document.querySelector(".editor-upload-error") && !document.querySelector(".perma-primary").disabled && document.querySelector("lexxy-editor").value.includes("trellix-inline-notes.txt")')
let abandoned=await evaluate('new DOMParser().parseFromString(document.querySelector("lexxy-editor").value,"text/html").querySelector("action-text-attachment").getAttribute("sgid")')
await click('.card-route-back');await waitFor(`location.pathname==='/dashboard/boards/${boardId}'`);await waitFor(`fetch('/api/v1/files/${abandoned}').then(r=>r.status===404)`)
console.log(JSON.stringify({imageToolbar:true,fileToolbar:true,dragAndDrop:true,removeAttachment:true,privatePreview:true,createWithUploads:true,download:true,editAndReload:true,commentAttachment:true,failureBlocking:true,retry:true,discardCleanup:true}))
}catch(error){console.error(await evaluate('document.body.innerText.slice(-1800)'));throw error}
finally{
await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1}).catch(()=>{})
if(boardId)await api('/boards/'+boardId,'DELETE')
await send('Page.setInterceptFileChooserDialog',{enabled:false});await navigate(origin+'/dashboard/cards/new');await unlink(file).catch(()=>{});await unlink(image).catch(()=>{});close()
}
