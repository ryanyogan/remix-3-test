import sanitizeHtml from 'sanitize-html'
import { parseDocument, DomUtils } from 'htmlparser2'
import { previewTypes, type EditorFile } from './editor-uploads.ts'

// Rich HTML is untrusted at the API boundary. Keep a plain-text copy for search,
// activity previews, and older clients; never reinterpret their text as markup.
export function richText(value: string, files: EditorFile[] = []) {
  let byId = new Map(files.map(file => [file.id, file]))
  // Replace the whole attachment subtree with server-owned metadata and markup.
  // URLs, filenames, preview types, and nested HTML supplied by clients are not trusted.
  for (let node of attachmentNodes(value).reverse()) {
    let file = byId.get(node.attribs.sgid)
    if (!file) throw new Error('An attachment is missing or expired. Remove it and upload it again.')
    let url = `/api/v1/files/${file.id}`
    let caption = node.attribs.caption?.slice(0, 1000) ?? ''
    let alt = node.attribs.alt?.slice(0, 1000) ?? ''
    let image = previewTypes.has(file.type)
    let figure = image ? `<figure class="attachment attachment--preview"><a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${escapeHtml(alt)}" loading="lazy"></a><figcaption>${escapeHtml(caption || file.name)}</figcaption></figure>`
      : `<figure class="attachment attachment--file"><a href="${url}">${escapeHtml(file.name)}</a><figcaption>${escapeHtml(caption)}</figcaption></figure>`
    let markup = `<action-text-attachment sgid="${file.id}" url="${url}" content-type="${file.type}" filename="${escapeHtml(file.name)}" filesize="${file.size}" previewable="${image}" caption="${escapeHtml(caption)}" alt="${escapeHtml(alt)}">${figure}</action-text-attachment>`
    value = value.slice(0, node.startIndex!) + markup + value.slice(node.endIndex! + 1)
  }
  let html = sanitizeHtml(value, {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'a', 'span', 'mark', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption', 'action-text-attachment', 'img'],
    allowedAttributes: { 'action-text-attachment': ['sgid', 'url', 'content-type', 'filename', 'filesize', 'previewable', 'caption', 'alt'], img: ['src', 'alt', 'loading'], a: ['href', 'title', 'rel', 'target'], ol: ['start'], li: ['value'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'], '*': ['style', 'class'] },
    allowedClasses: { '*': ['lexxy-content', 'lexxy-content__table-wrapper', 'horizontal-divider', 'highlight', 'table-wrapper', 'attachment', 'attachment--preview', 'attachment--file', 'attachment-gallery'] },
    allowedStyles: { '*': { 'text-align': [/^(left|right|center|justify)$/], color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d., %]+\)$/], 'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d., %]+\)$/] } },
    exclusiveFilter: frame => frame.tag === 'img' && !files.some(file => previewTypes.has(file.type) && frame.attribs.src === `/api/v1/files/${file.id}`),
    allowedSchemes: ['http', 'https', 'mailto'], allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener noreferrer' }) },
  })
  let text = sanitizeHtml(html.replace(/<\/(p|li|h[1-6]|blockquote|tr)>|<br\s*\/?\s*>/gi, '\n'), {
    allowedTags: [], allowedAttributes: {},
  }).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim()
  return { html, text }
}

function attachmentNodes(html: string) {
  let doc = parseDocument(html, { withStartIndices: true, withEndIndices: true })
  return DomUtils.getElementsByTagName('action-text-attachment', doc.children).filter(node => {
    for (let p = node.parent; p; p = p.parent) if (p.type === 'tag' && p.name === 'action-text-attachment') return false
    return node.startIndex !== null && node.endIndex !== null
  })
}
export function attachmentIds(html: string) {
  return [...new Set(attachmentNodes(html).map(node => node.attribs.sgid ?? ''))]
}
function escapeHtml(value: string) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

// Stored attachments use canonical consumer URLs. A renderer can select its own authenticated
// download route without changing stored content or treating ordinary text as a URL.
export function attachmentUrls(html: string, fileHref: (id: string) => string): string {
  if (!html.includes('action-text-attachment')) return html
  let doc = parseDocument(html)
  for (let attachment of DomUtils.getElementsByTagName('action-text-attachment', doc.children)) {
    let id = attachment.attribs.sgid
    if (!/^[a-f0-9-]{36}$/i.test(id ?? '')) continue
    let canonical = `/api/v1/files/${id}`
    for (let node of [attachment, ...DomUtils.getElementsByTagName('*', attachment.children)]) {
      for (let attribute of ['src', 'href', 'url']) {
        if (node.attribs[attribute] === canonical) node.attribs[attribute] = fileHref(id)
      }
    }
  }
  return DomUtils.getOuterHTML(doc)
}
