document.getElementById('send').addEventListener('click', sendQuery);
document.getElementById('execute').addEventListener('click', runPlanAndExecute);
document.getElementById('global-send').addEventListener('click', runGlobalTask);
document.getElementById('options-link').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

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
  const responseEl = document.getElementById('response');
  const errorEl = document.getElementById('error');
  const executeBtn = document.getElementById('execute');

  if (!goal) return;

  responseEl.classList.add('hidden');
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

    const result = await chrome.runtime.sendMessage({
      type: 'PLAN_AND_EXECUTE',
      goal,
      tabId: tab.id
    });

    if (result?.error) {
      errorEl.textContent = result.error;
      errorEl.classList.remove('hidden');
    } else {
      responseEl.textContent = result.summary || 'Done.';
      responseEl.classList.remove('hidden');
    }
  } catch (err) {
    errorEl.textContent = err.message || 'Failed to run plan.';
    errorEl.classList.remove('hidden');
  } finally {
    executeBtn.disabled = false;
  }
}

async function runGlobalTask() {
  const goal = document.getElementById('global-prompt').value.trim();
  const responseEl = document.getElementById('response');
  const recEl = document.getElementById('recommendation');
  const errorEl = document.getElementById('error');
  const progressEl = document.getElementById('global-progress');
  const sendBtn = document.getElementById('global-send');

  if (!goal) return;

  responseEl.classList.add('hidden');
  recEl.classList.add('hidden');
  errorEl.classList.add('hidden');
  progressEl.classList.remove('hidden');
  progressEl.textContent = 'Extracting price from page...';
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

    progressEl.textContent = 'Checking budget...';
    const result = await chrome.runtime.sendMessage({
      type: 'GLOBAL_TASK_QUERY',
      goal,
      tabId: tab.id,
    });

    progressEl.classList.add('hidden');

    if (result?.error) {
      errorEl.textContent = result.error;
      errorEl.classList.remove('hidden');
    } else if (result?.recommendation) {
      const rec = result.recommendation;
      const text = typeof rec === 'string' ? rec : (rec.text || '');
      recEl.innerHTML = `<strong>Recommendation</strong><br><br>${escapeHtml(text)}`;
      if (rec?.data) {
        const d = rec.data;
        recEl.innerHTML += `<br><br><small>Price: $${d.price ?? '?'} | Balance: $${d.balance ?? '?'} | Free: ${!d.hasConflicts ? 'Yes' : 'No'}</small>`;
      }
      recEl.classList.remove('hidden');
    } else {
      responseEl.textContent = JSON.stringify(result);
      responseEl.classList.remove('hidden');
    }
  } catch (err) {
    progressEl.classList.add('hidden');
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
