import { form, get, post, route } from 'remix/routes'

export const routes = route({
  assets: get('/assets/*path'),
  home: '/',
  apiGuide: get('/api'),
  login: form('/login'),
  logout: post('/logout'),
  theme: post('/theme'),
  signup: form('/signup'),
  dashboard: route('/dashboard', {
    index: get('/'),
    account: get('/account'),
    notifications: get('/notifications'),
    insights: get('/insights'),
    cards: route('/cards', {
      new: get('/new'),
      show: get('/:boardId/:cardId'),
    }),
    boards: route('/boards', {
      index: get('/'),
      create: post('/'),
      new: get('/new'),
      show: get('/:boardId'),
      edit: get('/:boardId/edit'),
      webhooks: get('/:boardId/webhooks'),
      rename: post('/:boardId'),
      destroy: post('/:boardId/delete'),
      // Create and rename share one upsert so a rename can follow a still-pending create.
      upsertColumn: post('/:boardId/columns'),
      deleteColumn: post('/:boardId/columns/:columnId/delete'),
      // Create and move share one upsert, as in Trellix, so a drag can follow a pending create.
      upsertItem: post('/:boardId/items'),
      deleteItem: post('/:boardId/items/:itemId/delete'),
      uploadFile: post('/:boardId/items/:itemId/files'),
      file: get('/:boardId/files/:fileId'),
      deleteFile: post('/:boardId/files/:fileId/delete'),
    }),
  }),
})
