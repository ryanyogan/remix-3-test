import type { FileLike, FileStorage, ListOptions, ListResult } from 'remix/file-storage'
import { LazyFile } from 'remix/lazy-file'

// The slice of the Workers R2 binding this storage uses, so it typechecks without Workers types.
export interface R2Like {
  get(key: string, options?: { range: { offset: number; length: number } }): Promise<R2ObjectBodyLike | null>
  head(key: string): Promise<R2ObjectLike | null>
  put(
    key: string,
    value: ArrayBuffer,
    options: { httpMetadata: { contentType: string }; customMetadata: Record<string, string> },
  ): Promise<unknown>
  delete(key: string): Promise<void>
  list(options: {
    cursor?: string
    limit?: number
    prefix?: string
    include?: ('httpMetadata' | 'customMetadata')[]
  }): Promise<{ objects: R2ObjectLike[]; truncated: boolean; cursor?: string }>
}

interface R2ObjectLike {
  key: string
  size: number
  uploaded: Date
  httpMetadata?: { contentType?: string }
  customMetadata?: Record<string, string>
}

interface R2ObjectBodyLike extends R2ObjectLike {
  body: ReadableStream<Uint8Array<ArrayBuffer>>
}

// Stores files in an R2 bucket, keeping each file's name and lastModified as custom metadata.
export function createR2FileStorage(bucket: R2Like): FileStorage<File> {
  async function putFile(key: string, file: FileLike): Promise<File> {
    let buffer = await file.arrayBuffer()
    await bucket.put(key, buffer, {
      httpMetadata: { contentType: file.type },
      customMetadata: { name: file.name, lastModified: String(file.lastModified) },
    })
    return new File([buffer], file.name, { type: file.type, lastModified: file.lastModified })
  }

  return {
    // Reads only the metadata; the bytes stream from R2 when the file is read, a range at a time
    // for partial downloads, so a download never holds the whole file in the isolate's memory.
    async get(key) {
      let object = await bucket.head(key)
      if (!object) return null
      let { name, type, lastModified } = metadata(object)
      let content = {
        byteLength: object.size,
        stream(start = 0, end = object.size) {
          let { readable, writable } = new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>()
          let range = { offset: start, length: Math.max(0, end - start) }
          if (range.length === 0) void writable.close()
          else bucket.get(key, { range }).then(
            (body) => body ? body.body.pipeTo(writable) : writable.abort(new Error(`File ${key} is gone`)),
            (error) => writable.abort(error),
          ).catch(() => {})
          return readable
        },
      }
      return new LazyFile(content, name, { type, lastModified })
    },
    async has(key) {
      return (await bucket.head(key)) !== null
    },
    async list<opts extends ListOptions>(options?: opts): Promise<ListResult<opts>> {
      let { cursor, includeMetadata = false, limit, prefix } = options ?? {}
      let result = await bucket.list({
        cursor,
        limit,
        prefix,
        include: includeMetadata ? ['httpMetadata', 'customMetadata'] : undefined,
      })
      let files = result.objects.map((object) =>
        includeMetadata ? { key: object.key, size: object.size, ...metadata(object) } : { key: object.key },
      )
      return { cursor: result.truncated ? result.cursor : undefined, files } as ListResult<opts>
    },
    put: putFile,
    async remove(key) {
      await bucket.delete(key)
    },
    async set(key, file) {
      await putFile(key, file)
    },
  }
}

function metadata(object: R2ObjectLike) {
  let lastModified = Number(object.customMetadata?.lastModified)
  return {
    name: object.customMetadata?.name ?? object.key,
    type: object.httpMetadata?.contentType ?? '',
    lastModified: Number.isFinite(lastModified) ? lastModified : object.uploaded.getTime(),
  }
}
