// Size limits shared by the request schemas, table hooks, upload parser, and form inputs.
export const limits = {
  name: 100,
  cardTitle: 500,
  fileName: 255,
  filesPerCard: 10,
  fileBytes: 10 * 1024 * 1024,
  fileLabel: '10 MB',
}
