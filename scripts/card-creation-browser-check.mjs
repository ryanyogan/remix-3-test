import {writeFile, unlink} from 'node:fs/promises'
import {deflateSync} from 'node:zlib'
import {send,navigate,evaluate,click,type,key,waitFor,screenshot,close} from './browser-cdp.mjs'
const origin=process.env.QA_ORIGIN
if(!origin){close();throw Error('Set QA_ORIGIN; Chromium must be signed into a test account.')}
const ready=()=>new Promise(r=>setTimeout(r,300))
const editor=async()=>{await waitFor('!!document.querySelector("lexxy-editor [contenteditable]") && !document.querySelector(".perma-primary").disabled');await ready()}
async function check(expression,message){if(!await evaluate(expression))throw Error(message)}
import { consumerRequest as api } from './browser-cdp.mjs'
async function selectAll(){await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2})}
// Small real PNG for file-input verification (CDP supplies the selected local file).
let file='/tmp/trellix-creation-cover.png'
function crc32(buf){let c=0xffffffff;for(let b of buf){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
function chunk(type,data){let t=Buffer.from(type),n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(data.length);c.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([n,t,data,c])}
let header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=2
await writeFile(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,80,180,220,80,180,220,0,80,180,220,80,180,220]))),chunk('IEND',Buffer.alloc(0))]))
let boards=[]
try{
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false})
await navigate(origin+'/dashboard')
let a=await api('/boards','POST',{name:'Creation controls A'});boards.push(a.id)
let b=await api('/boards','POST',{name:'Creation controls B'});boards.push(b.id)
await navigate(origin+'/dashboard/cards/new?board='+a.id);await editor()
await check('document.querySelectorAll(".perma-tools button").length===1 && !!document.querySelector(".perma-tools-left button")','Draft has extra outside actions')
await click('#card-board-trigger');await waitFor('document.activeElement?.matches("#card-board input")');await type('#card-board input','controls B');await key('Enter');await waitFor('document.querySelector("#card-board-trigger").textContent.includes("controls B") && !document.querySelector("#card-board-trigger").disabled')
await type('#card-title','Creation controls card')
await check('!document.querySelector("#card-title").matches(":placeholder-shown")','Title placeholder remained')
await click('lexxy-editor [contenteditable]', .6, .8)
await check('getComputedStyle(document.querySelector("[contenteditable]"),"::before").content!=="none"','Focusing hid the placeholder')
await check('(()=>{let e=document.querySelector("[contenteditable]"),p=e.querySelector("p");return Math.abs(p.getBoundingClientRect().top-e.getBoundingClientRect().top)<1 && getSelection().anchorOffset===0})()','Empty caret did not start on the first line')
await send('Input.insertText',{text:'Description stays after picker changes'})
await waitFor('document.querySelector("lexxy-editor").value.includes("Description stays")')
await check('getComputedStyle(document.querySelector("[contenteditable]"),"::before").content==="none"','Editor placeholder remained')
await selectAll();await key('Backspace');await waitFor('document.querySelector("lexxy-editor").isBlank')
await check('getComputedStyle(document.querySelector("[contenteditable]"),"::before").content!=="none"','Empty editor lost its placeholder')
await type('lexxy-editor [contenteditable]','Description stays after picker changes')
await click('#card-tags-trigger');await type('#card-tags input','controls-tag');await key('Enter');await waitFor('document.querySelector(".perma-header").textContent.includes("#controls-tag")')
await click('#card-assign-trigger');await click('#card-assign .card-picker-options button');await waitFor('document.querySelector(".perma-meta-grid").textContent.includes("Assigned to")')
await type('[aria-label="New step"]','Prepare the card');await key('Enter');await waitFor('document.querySelectorAll(".perma-step").length===1');await click('.perma-step input')
await send('Page.setInterceptFileChooserDialog',{enabled:true});await click('[aria-label="Add background image"]')
let {root}=await send('DOM.getDocument');let {nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'});await send('DOM.setFileInputFiles',{nodeId,files:[file]})
await waitFor('!!document.querySelector(".perma-background") && !document.querySelector(".perma-primary").disabled')
await screenshot('/tmp/trellix-draft-with-cover.png')
await click('.perma-secondary')
await waitFor(`location.pathname==='/dashboard/cards/new' && location.search==='?board=${b.id}' && document.querySelector('#card-title')?.value===''`);await editor()
await check('!document.querySelector(".perma-background") && !document.querySelector(".perma-tag") && !document.querySelector(".perma-step") && document.querySelector(".perma-meta-grid").textContent.includes("Not assigned")','New draft retained previous metadata')
let board=await api('/boards/'+b.id),card=board.items.find(c=>c.title==='Creation controls card');if(!card)throw Error('Create another did not save card')
let detail=await api(`/boards/${b.id}/cards/${card.id}`)
if(!detail.cover_file_id||!detail.assignee_id||detail.tags[0]!=='controls-tag'||detail.steps[0].completed!==1||!detail.description.includes('Description stays'))throw Error('Draft metadata was lost')
await type('#card-title','Second creation controls card');await click('.perma-actions button[type=submit]')
await waitFor(`location.pathname==='/dashboard/boards/${b.id}' && !!document.querySelector('.card-open')`);await ready()
await click(`a.card-open[href$='/${card.id}']`);await waitFor('!!document.querySelector(".perma-comment-compose [contenteditable]")');await ready()
await check('!!document.querySelector(".perma-background") && document.querySelector(".perma-step input").checked','Saved cover/step missing')
await click('#card-board-trigger');await waitFor('document.activeElement?.matches("#card-board input")');await type('#card-board input','controls A');await key('Enter');await waitFor(`location.pathname==='/dashboard/cards/${a.id}/${card.id}' && !!document.querySelector('.perma-comment-compose [contenteditable]')`);await ready()
await click('[aria-label="Remove background image"]');await waitFor('!document.querySelector(".perma-background") && !document.querySelector(".pin-button").disabled')
await navigate(origin+`/dashboard/cards/${a.id}/${card.id}`);await waitFor('!!document.querySelector(".perma-comment-compose [contenteditable]")');await ready()
await check('!document.querySelector(".perma-background")','Cover removal did not persist')
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
await navigate(origin+'/dashboard/cards/new?board='+a.id);await editor()
await check('document.documentElement.scrollWidth<=innerWidth','Mobile draft overflows')
for(let id of ['card-board','card-tags','card-assign']){await click('#'+id+'-trigger');await waitFor(`document.querySelector('#${id}').matches(':popover-open')`);await ready();await check(`(()=>{let r=document.querySelector('#${id}').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`,'Mobile picker escapes viewport: '+id);await key('Escape')}
await screenshot('/tmp/trellix-creation-mobile.png')
console.log(JSON.stringify({singleUploadControl:true,boardPicker:true,tags:true,assignment:true,draftSteps:true,placeholders:true,coverUpload:true,coverRemoval:true,createAnother:true,createReturnsToBoard:true,moveBoard:true,mobilePickers:true}))
}catch(error){console.error(await evaluate('JSON.stringify({body:document.body.innerText,focus:document.activeElement?.outerHTML})'));throw error
}finally{
for(let id of boards)await api('/boards/'+id,'DELETE')
await send('Page.setInterceptFileChooserDialog',{enabled:false})
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false})
await navigate(origin+'/dashboard/cards/new')
await unlink(file).catch(()=>{});close()
}
