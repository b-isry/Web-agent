/**
 * Global Task State - Persists multi-step task progress and results
 */

const STORAGE_KEY = 'uwa_global_task_state';

export const TaskStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

export const StepType = {
  EXTRACT_PRICE: 'extract_price',
  CHECK_BUDGET: 'check_budget',
  CHECK_CALENDAR: 'check_calendar',
  AGGREGATE: 'aggregate',
};

export async function getTaskState() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      resolve(result[STORAGE_KEY] || null);
    });
  });
}

export async function setTaskState(state) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: state }, resolve);
  });
}

export async function createTask(goal, tabId) {
  const state = {
    id: crypto.randomUUID(),
    goal,
    tabId,
    status: TaskStatus.RUNNING,
    startedAt: Date.now(),
    steps: [],
    data: {},
    recommendation: null,
    error: null,
  };
  await setTaskState(state);
  return state;
}

export async function updateTask(updates) {
  const state = await getTaskState();
  if (!state) return null;
  const next = { ...state, ...updates };
  await setTaskState(next);
  return next;
}

export async function addStepResult(stepType, result) {
  const state = await getTaskState();
  if (!state) return null;
  const steps = [...(state.steps || []), { type: stepType, result, at: Date.now() }];
  const data = { ...state.data, [stepType]: result };
  return updateTask({ steps, data });
}

export async function clearTask() {
  return new Promise((resolve) => {
    chrome.storage.local.remove([STORAGE_KEY], resolve);
  });
}
