import {
  FormDataParseError,
  MaxFilesExceededError,
  MaxFileSizeExceededError,
  MaxHeaderSizeExceededError,
  MaxPartsExceededError,
  MaxTotalSizeExceededError,
} from 'remix/form-data-parser'
import { formData } from 'remix/middleware/form-data'

import { limits } from '../data/limits.ts'

// Parses form bodies once per request with bounded uploads (one file of at most 10 MB), and
// answers oversized or malformed bodies with 413/400 instead of an uncaught 500.
export function parseFormData(): ReturnType<typeof formData> {
  let parse = formData({
    maxFiles: 1,
    maxFileSize: limits.fileBytes,
    maxParts: 50,
    maxTotalSize: limits.fileBytes + 1024 * 1024,
  })

  return async (context, next) => {
    try {
      return await parse(context, next)
    } catch (error) {
      let response = limitResponse(error)
      if (response) return response
      throw error
    }
  }
}

function limitResponse(error: unknown): Response | undefined {
  if (error instanceof MaxFileSizeExceededError || error instanceof MaxTotalSizeExceededError) {
    return errorResponse(413, `Files must be ${limits.fileLabel} or smaller`)
  }
  if (
    error instanceof MaxFilesExceededError ||
    error instanceof MaxPartsExceededError ||
    error instanceof MaxHeaderSizeExceededError
  ) {
    return errorResponse(413, 'Upload one file at a time')
  }
  if (error instanceof FormDataParseError) return errorResponse(400, 'Could not read the form')
}

// JSON, because uploads only arrive from the enhanced board's fetch calls.
function errorResponse(status: number, message: string) {
  return Response.json({ error: message }, { status })
}
