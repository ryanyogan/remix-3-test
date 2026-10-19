export const columnColors = ['blue', 'gray', 'tan', 'yellow', 'lime', 'aqua', 'violet', 'purple', 'pink'] as const
export type ColumnColor = typeof columnColors[number]

export interface ColumnData {
  color?: ColumnColor
  id: string
  name: string
  position: number
}

export interface FileData {
  id: string
  name: string
  type: string
  size: number
  // Still uploading: rendered from the pending mutation, with no server copy yet.
  pending?: boolean
}

export interface ItemData {
  id: string
  columnId: string
  title: string
  position: number
  files: FileData[]
  createdAt?: number
  updatedAt?: number
  assigneeId?: string | null
  author?: string
  detail?: {
    tags: string[]; pinned: boolean; priority: string; snoozedUntil: number
    hasDescription: boolean; steps: number; completedSteps: number; comments: number
  }
}

export interface BoardData {
  id: string
  name: string
  color: string
  columns: ColumnData[]
  items: ItemData[]
  watching?: boolean
}


export interface WorkspaceCard {
  id: string
  title: string
  boardId: string
  boardName: string
  color: string
  columnName: string
  tags: string[]
  pinned: boolean
  priority: string
  snoozedUntil: number
  updatedAt: number
  done: boolean
}

export interface WorkspaceBoard {
  id: string
  name: string
  color: string
  total: number
  done: number
  previews: { id: string; title: string }[]
}

export interface WorkspaceData {
  boards: WorkspaceBoard[]
  recent: WorkspaceCard[]
  pinned: WorkspaceCard[]
}

export interface NavigationData {
  boards: { id: string; name: string; color: string }[]
  tags: string[]
}

export interface ActivityEvent {
  id: string
  cardId: string
  title: string
  boardId: string
  boardName: string
  color: string
  kind: 'added' | 'updated' | 'moved' | 'done' | 'commented'
  detail: string
  actorId: string
  actorName: string
  at: number
}

export interface ActivityFilters {
  board?: string
  person?: string
  tag?: string
  view?: string
  before?: number
  beforeId?: string
}

export interface ActivityPage {
  events: ActivityEvent[]
  next: { before: number; beforeId: string } | null
}

export interface CardDetailData {
  assignee_id: string | null
  cover_file_id: string | null
  position: number
  id: string
  title: string
  column_id: string
  created_at: number
  updated_at: number
  description: string
  description_html: string
  author: string
  tags: string[]
  priority: string
  pinned: number
  snoozed_until: number
  steps: { id: string; title: string; completed: number }[]
  comments: { id: string; author: string; body: string; body_html: string; created_at: number }[]
  files: FileData[]
}
