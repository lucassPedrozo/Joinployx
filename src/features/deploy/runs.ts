import type { WorkflowRun } from '../../shared/deploy'

const activeStatuses = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending'])

export const isRunActive = (run: WorkflowRun) => activeStatuses.has(run.status)
