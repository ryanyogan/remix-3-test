import { form, get, post, route } from 'remix/routes'

export const routes = route({
  assets: get('/assets/*path'),
  home: '/',
  login: form('/login'),
  logout: post('/logout'),
  signup: form('/signup'),
  dashboard: route('/dashboard', {
    index: get('/'),
    account: get('/account'),
    boards: route('/boards', {
      index: get('/'),
      create: post('/'),
      show: get('/:boardId'),
      rename: post('/:boardId'),
      destroy: post('/:boardId/delete'),
      // Create and rename share one upsert so a rename can follow a still-pending create.
      upsertColumn: post('/:boardId/columns'),
      // Create and move share one upsert, as in Trellix, so a drag can follow a pending create.
      upsertItem: post('/:boardId/items'),
      deleteItem: post('/:boardId/items/:itemId/delete'),
      uploadFile: post('/:boardId/items/:itemId/files'),
      file: get('/:boardId/files/:fileId'),
      deleteFile: post('/:boardId/files/:fileId/delete'),
    }),
  }),
})
