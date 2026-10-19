import type { CardDetailData } from '@trellix/contracts'
import { attachmentUrls } from '@trellix/data/rich-text'
import { routes } from '../../../routes.ts'

export function webCard(card: CardDetailData): CardDetailData {
  let html = (value: string) =>
    attachmentUrls(value, (fileId) => routes.dashboard.uploads.file.href({ fileId }))
  return {
    ...card,
    description_html: html(card.description_html),
    comments: card.comments.map((comment) => ({ ...comment, body_html: html(comment.body_html) })),
  }
}
