import { createController } from 'remix/router'
import { stageEditorUpload, discardEditorUpload, readEditorFile } from '@trellix/data/operations'
import { requireUser } from '../../../middleware/require-user.tsx'
import { routes } from '../../../routes.ts'
import { dataResponse, downloadResponse } from '../data-response.ts'

export default createController(routes.dashboard.uploads, {
  middleware: requireUser(),
  actions: {
    create: (context) =>
      dataResponse(context, async (services) => {
        let file = await stageEditorUpload(services, context.formData)
        return { ...file, url: routes.dashboard.uploads.file.href({ fileId: file.id }) }
      }),
    discard: (context) =>
      dataResponse(context, (services) => discardEditorUpload(services, context.params)),
    file: (context) =>
      dataResponse(context, async (services) =>
        downloadResponse(context.request, await readEditorFile(services, context.params)),
      ),
  },
})
