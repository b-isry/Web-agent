/**
 * Session State - Persists active task progress to chrome.storage.session
 * Survives side panel close/reopen until browser session ends
 */

const SESSION_KEY = 'uwa_active_session';

export const SessionTaskType = {
  PLAN_EXECUTE: 'plan_execute',
  GLOBAL_TASK: 'global_task',
};

export const SessionStatus = {
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

export async function getSessionState() {
  return new Promise((resolve) => {
    chrome.storage.session.get([SESSION_KEY], (r) => resolve(r[SESSION_KEY] || null));
  });
}

export async function setSessionState(state) {
  return new Promise((resolve) => {
    chrome.storage.session.set({ [SESSION_KEY]: state }, resolve);
  });
}

export async function clearSessionState() {
  return new Promise((resolve) => {
    chrome.storage.session.remove([SESSION_KEY], resolve);
  });
}

export async function startPlanExecuteSession(goal, tabId) {
  await setSessionState({
    type: SessionTaskType.PLAN_EXECUTE,
    goal,
    tabId,
    status: SessionStatus.RUNNING,
    startedAt: Date.now(),
    logs: [],
  });
}

export async function appendPlanExecuteLog(message) {
  const state = await getSessionState();
  if (!state || state.type !== SessionTaskType.PLAN_EXECUTE) return;
  const logs = [...(state.logs || []), { at: Date.now(), message }];
  await setSessionState({ ...state, logs });
}

export async function finishPlanExecuteSession(success, summary, error) {
  const state = await getSessionState();
  if (!state || state.type !== SessionTaskType.PLAN_EXECUTE) return;
  await setSessionState({
    ...state,
    status: success ? SessionStatus.COMPLETED : SessionStatus.FAILED,
    completedAt: Date.now(),
    summary: summary || null,
    error: error || null,
  });
}

export async function startGlobalTaskSession(goal, tabId) {
  await setSessionState({
    type: SessionTaskType.GLOBAL_TASK,
    goal,
    tabId,
    status: SessionStatus.RUNNING,
    startedAt: Date.now(),
    logs: [],
    steps: [],
  });
}

export async function appendGlobalTaskLog(message) {
  const state = await getSessionState();
  if (!state || state.type !== SessionTaskType.GLOBAL_TASK) return;
  const logs = [...(state.logs || []), { at: Date.now(), message }];
  await setSessionState({ ...state, logs });
}

export async function updateGlobalTaskFromState(taskState) {
  const state = await getSessionState();
  if (!state || state.type !== SessionTaskType.GLOBAL_TASK) return;
  await setSessionState({
    ...state,
    steps: taskState?.steps || state.steps,
    status: taskState?.status === 'completed' ? SessionStatus.COMPLETED
      : taskState?.status === 'failed' ? SessionStatus.FAILED
      : state.status,
    recommendation: taskState?.recommendation ?? state.recommendation,
    error: taskState?.error ?? state.error,
    completedAt: (taskState?.status === 'completed' || taskState?.status === 'failed') ? Date.now() : state.completedAt,
  });
}

export async function finishGlobalTaskSession(success, recommendation, error) {
  const state = await getSessionState();
  if (!state || state.type !== SessionTaskType.GLOBAL_TASK) return;
  await setSessionState({
    ...state,
    status: success ? SessionStatus.COMPLETED : SessionStatus.FAILED,
    completedAt: Date.now(),
    recommendation: recommendation || null,
    error: error || null,
  });
}
