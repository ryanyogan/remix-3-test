import type { FileStorage } from 'remix/file-storage'
import { createContextKey } from 'remix/router'
import type { Middleware } from 'remix/router'

export const uploadsContext = createContextKey<FileStorage>()

export function loadUploads(storage: FileStorage): Middleware<{
  key: typeof uploadsContext
  value: FileStorage
  property: 'uploads'
}> {
  return (context, next) => {
    context.set(uploadsContext, storage, { property: 'uploads' })
    return next()
  }
}
