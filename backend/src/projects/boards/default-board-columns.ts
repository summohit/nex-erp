/** The columns every new board starts with. */
export const DEFAULT_BOARD_COLUMNS = [
  { name: 'To Do', color: '#6b7280', position: 0, isSystem: true, type: 'TODO' },
  { name: 'In Progress', color: '#3b82f6', position: 1, isSystem: true, type: 'IN_PROGRESS' },
  { name: 'In Review', color: '#8b5cf6', position: 2, isSystem: true, type: 'REVIEW' },
  { name: 'Done', color: '#22c55e', position: 3, isSystem: true, type: 'DONE' },
  { name: 'Archived', color: '#9ca3af', position: 4, isSystem: true, type: 'DONE' },
];
