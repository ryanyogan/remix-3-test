import { clientEntry, on, ref, type Handle } from 'remix/component'
import { routes } from '../../../routes.ts'
import { isTyping } from './navigation.tsx'
import { XIcon, ArrowRightIcon } from '../../../ui/public/icons.tsx'

interface Result { id: string; title: string; board_id: string; board_name: string; column_name: string; color: string; tags: string[] }

export const Search = clientEntry(import.meta.url, function Search(handle: Handle<{ dock?: boolean }>) {
  let dialog: HTMLDialogElement | undefined, field: HTMLInputElement | undefined
  let results: Result[] = [], query = '', error = '', next: string | null = null
  let pending = false, selected = 0, request: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined
  let cache = new Map<string, { data: Result[]; next: string | null }>()
  function href(card: Result) { return `/dashboard/cards/${encodeURIComponent(card.board_id)}/${encodeURIComponent(card.id)}` }
  function go(card: Result) { dialog?.close(); window.location.assign(href(card)) }
  async function search(append = false) {
    request?.abort(); let current = request = new AbortController()
    let term = query.trim().replace(/^#/, '')
    pending = true; error = ''
    if (!append) { selected = 0; results = cache.get(term)?.data ?? []; next = cache.get(term)?.next ?? null }
    handle.update()
    try {
      let params = new URLSearchParams({ q: term, limit: '20' })
      if (append && next) params.set('after', next)
      let response = await fetch(`${routes.dashboard.search.href()}?${params}`, { signal: current.signal, headers: { Accept: 'application/json' } })
      let body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Could not search cards')
      if (current.signal.aborted) return
      results = append ? [...results, ...body.data] : body.data; next = body.next
      if (!append) { if (cache.size > 20) cache.clear(); cache.set(term, body) }
    } catch (e) { if (!current.signal.aborted) error = (e as Error).message }
    finally { if (!current.signal.aborted) { pending = false; handle.update() } }
  }
  function open() { if (dialog?.open) { field?.focus(); return }; dialog?.showModal(); field?.focus(); void search() }
  async function move(delta: number) {
    if (!results.length) return
    selected = (selected + delta + results.length) % results.length
    await handle.update()
    dialog?.querySelector(`#search-result-${selected}`)?.scrollIntoView({ block: 'nearest' })
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', event => {
      if (event.isComposing || event.repeat || (document.querySelector('dialog[open]') && !dialog?.open)) return
      if (((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') || (!event.metaKey && !event.ctrlKey && !event.altKey && !isTyping(event) && event.key.toLowerCase() === 'k')) { event.preventDefault(); open() }
    }, { signal: handle.signal })
    handle.signal.addEventListener('abort', () => { request?.abort(); clearTimeout(timer) })
  }
  return () => <>
    <button type="button" class="btn btn-ghost search-trigger" aria-label="Search cards" title="Search cards (Ctrl/⌘ K)" mix={on('click', open)}><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><span>Search</span><kbd>{handle.props.dock ? 'K' : '⌘ K'}</kbd></button>
    <dialog class="search-dialog command-search" aria-label="Search cards" mix={[
      ref(node => { dialog = node }),
      on('close',()=>{clearTimeout(timer);request?.abort();pending=false}),
      on('click',event=>{if(event.target!==dialog)return;let r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close()}),
    ]}>
      <div class="command-search-input"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
        <input type="search" role="combobox" list={undefined} aria-label="Search all cards" aria-autocomplete="list" aria-expanded="true" aria-controls="card-search-results" aria-activedescendant={results.length ? `search-result-${selected}` : undefined} placeholder="Search cards, descriptions, tags…" value={query} autoComplete="off" mix={[
          ref(node=>{field=node}),
          on('input',event=>{query=event.currentTarget.value;request?.abort();clearTimeout(timer);results=[];pending=true;selected=0;handle.update();timer=setTimeout(()=>{void search()},120)}),
          on('keydown',event=>{if(event.key==='Escape'){event.preventDefault();dialog?.close()}else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();void move(event.key==='ArrowDown'?1:-1)}else if(event.key==='Enter'&&results[selected]){event.preventDefault();go(results[selected])}}),
        ]} />
        <button class="icon-btn" type="button" aria-label="Close search" mix={on('click',()=>dialog?.close())}><XIcon /></button>
      </div>
      <div class="command-search-label" role="status"><span>{query.trim() ? 'Matching cards' : 'Recent cards'}</span><span>{pending?'Searching…':`${results.length}${next?'+':''} ${results.length===1&&!next?'card':'cards'}`}</span></div>
      {error && <p class="alert command-search-message" role="alert">{error}</p>}
      <ul class="command-results" id="card-search-results" role="listbox" aria-label="Cards" aria-busy={pending}>
        {results.map((card,index)=><li key={card.id} id={`search-result-${index}`} role="option" aria-selected={selected===index}>
          <a href={href(card)} tabIndex={-1} mix={[on('mousemove',()=>{if(selected!==index){selected=index;handle.update()}}),on('click',event=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();go(card)})]}>
            <span class="search-board-dot" /><span class="search-result-content"><strong>{card.title}</strong><small>{card.board_name}<span> / </span>{card.column_name}{card.tags.length>0&&<span> · {card.tags.slice(0,3).map(t=>'#'+t).join(' ')}</span>}</small></span><ArrowRightIcon />
          </a>
        </li>)}
      </ul>
      {!pending&&!results.length&&!error&&<div class="command-search-empty"><strong>{query?'No matching cards':'Your cards will appear here'}</strong><p>{query?'Try a shorter phrase or a tag.':'Create a card on a board, then find it here.'}</p></div>}
      {next&&<button class="btn btn-ghost command-more" disabled={pending} mix={on('click',()=>{void search(true)})}>Show more results</button>}
      <footer class="command-search-footer"><span><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></footer>
    </dialog>
  </>
})
