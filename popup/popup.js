const SESSION_KEY = 'uwa_active_session';

document.getElementById('send').addEventListener('click', sendQuery);
document.getElementById('execute').addEventListener('click', runPlanAndExecute);
document.getElementById('global-send').addEventListener('click', runGlobalTask);
document.getElementById('options-link').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
document.getElementById('dismiss-task').addEventListener('click', dismissActiveTask);

// Restore and listen for session state (survives side panel close)
async function restoreSessionState() {
  const result = await chrome.storage.session.get([SESSION_KEY]);
  const state = result[SESSION_KEY];
  if (state) {
    renderActiveTask(state);
  } else {
    document.getElementById('active-task').classList.add('hidden');
  }
}

function renderActiveTask(state) {
  const container = document.getElementById('active-task');
  const goalEl = document.getElementById('active-task-goal');
  const statusEl = document.getElementById('active-task-status');
  const logsEl = document.getElementById('active-task-logs');
  const resultEl = document.getElementById('active-task-result');
  const dismissBtn = document.getElementById('dismiss-task');

  container.classList.remove('hidden');
  document.getElementById('response').classList.add('hidden');
  document.getElementById('recommendation').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');

  const typeLabel = state.type === 'global_task' ? 'Global Task' : 'Plan & Execute';
  goalEl.textContent = `${typeLabel}: ${state.goal || 'Unknown'}`;

  statusEl.textContent = state.status === 'running' ? 'Running…' : state.status === 'completed' ? 'Done' : 'Failed';
  statusEl.className = 'status-badge ' + state.status;

  const logs = state.logs || [];
  logsEl.innerHTML = logs.map((l) => `<div class="log-line">${escapeHtml(l.message)}</div>`).join('');
  logsEl.scrollTop = logsEl.scrollHeight;

  const isFinished = state.status === 'completed' || state.status === 'failed';
  if (isFinished) {
    if (state.status === 'completed') {
      if (state.type === 'global_task' && state.recommendation) {
        const rec = state.recommendation;
        const text = typeof rec === 'string' ? rec : (rec?.text || '');
        resultEl.innerHTML = text ? `<strong>Result</strong><br><br>${escapeHtml(text)}` : '';
        if (rec?.data) {
          const d = rec.data;
          resultEl.innerHTML += `<br><br><small>Price: $${d.price ?? '?'} | Balance: $${d.balance ?? '?'} | Free: ${!d.hasConflicts ? 'Yes' : 'No'}</small>`;
        }
        resultEl.className = 'active-task-result recommendation';
      } else {
        resultEl.textContent = state.summary || 'Done.';
        resultEl.className = 'active-task-result response';
      }
    } else {
      resultEl.textContent = state.error || 'Task failed.';
      resultEl.className = 'active-task-result error';
    }
    resultEl.classList.remove('hidden');
    dismissBtn.classList.remove('hidden');
  } else {
    resultEl.classList.add('hidden');
    dismissBtn.classList.add('hidden');
  }
}

async function dismissActiveTask() {
  await chrome.storage.session.remove([SESSION_KEY]);
  document.getElementById('active-task').classList.add('hidden');
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes[SESSION_KEY]) {
    const state = changes[SESSION_KEY].newValue;
    if (state) {
      renderActiveTask(state);
    } else {
      document.getElementById('active-task').classList.add('hidden');
    }
  }
});

// Apply theme from user preferences
chrome.storage.local.get(['userPreferences'], (r) => {
  const theme = r.userPreferences?.theme || 'system';
  const html = document.documentElement;
  html.classList.remove('theme-light', 'theme-dark');
  if (theme === 'light') html.classList.add('theme-light');
  else if (theme === 'dark') html.classList.add('theme-dark');
});

// Initial restore when panel opens
restoreSessionState();

// Mode tabs
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.mode + '-panel').classList.remove('hidden');
    document.getElementById('response').classList.add('hidden');
    document.getElementById('recommendation').classList.add('hidden');
    document.getElementById('error').classList.add('hidden');
  });
});

async function sendQuery() {
  const prompt = document.getElementById('prompt').value.trim();
  const responseEl = document.getElementById('response');
  const errorEl = document.getElementById('error');
  const sendBtn = document.getElementById('send');

  if (!prompt) return;

  responseEl.classList.add('hidden');
  errorEl.classList.add('hidden');
  sendBtn.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'AGENT_QUERY',
      prompt
    });

    if (result?.error) {
      errorEl.textContent = result.error;
      errorEl.classList.remove('hidden');
    } else {
      responseEl.textContent = result?.text || 'No response.';
      responseEl.classList.remove('hidden');
    }
  } catch (err) {
    errorEl.textContent = err.message || 'Failed to communicate with agent.';
    errorEl.classList.remove('hidden');
  } finally {
    sendBtn.disabled = false;
  }
}

async function runPlanAndExecute() {
  const goal = document.getElementById('goal').value.trim();
  const errorEl = document.getElementById('error');
  const executeBtn = document.getElementById('execute');

  if (!goal) return;

  errorEl.classList.add('hidden');
  executeBtn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      errorEl.textContent = 'No active tab found.';
      errorEl.classList.remove('hidden');
      return;
    }

    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
      errorEl.textContent = 'Cannot run on Chrome internal pages. Open a regular webpage.';
      errorEl.classList.remove('hidden');
      return;
    }

    await chrome.runtime.sendMessage({
      type: 'PLAN_AND_EXECUTE',
      goal,
      tabId: tab.id
    });
    // Result displayed via session state (active-task panel)
  } catch (err) {
    errorEl.textContent = err.message || 'Failed to run plan.';
    errorEl.classList.remove('hidden');
  } finally {
    executeBtn.disabled = false;
  }
}

async function runGlobalTask() {
  const goal = document.getElementById('global-prompt').value.trim();
  const errorEl = document.getElementById('error');
  const sendBtn = document.getElementById('global-send');

  if (!goal) return;

  errorEl.classList.add('hidden');
  sendBtn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      errorEl.textContent = 'No active tab found.';
      errorEl.classList.remove('hidden');
      return;
    }

    if (tab.url?.startsWith('chrome://')) {
      errorEl.textContent = 'Cannot run on Chrome internal pages.';
      errorEl.classList.remove('hidden');
      return;
    }

    await chrome.runtime.sendMessage({
      type: 'GLOBAL_TASK_QUERY',
      goal,
      tabId: tab.id,
    });
    // Result displayed via session state (active-task panel)
  } catch (err) {
    errorEl.textContent = err.message || 'Failed to run global task.';
    errorEl.classList.remove('hidden');
  } finally {
    sendBtn.disabled = false;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
