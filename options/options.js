document.getElementById('save').addEventListener('click', saveOptions);

async function loadOptions() {
  const result = await chrome.storage.local.get([
    'apiKey',
    'provider',
    'model',
    'userPreferences'
  ]);

  document.getElementById('apiKey').value = result.apiKey || '';
  document.getElementById('provider').value = result.provider || 'openai';
  document.getElementById('model').value = result.model || 'gpt-4o-mini';

  const prefs = result.userPreferences || {};
  document.getElementById('theme').value = prefs.theme || 'system';
  document.getElementById('notifications').checked = prefs.notifications !== false;
  document.getElementById('language').value = prefs.language || 'en';
}

async function saveOptions() {
  const apiKey = document.getElementById('apiKey').value.trim();
  const provider = document.getElementById('provider').value;
  const model = document.getElementById('model').value.trim();
  const theme = document.getElementById('theme').value;
  const notifications = document.getElementById('notifications').checked;
  const language = document.getElementById('language').value.trim();

  await chrome.storage.local.set({
    apiKey: apiKey || undefined,
    provider,
    model: model || (provider === 'openai' ? 'gpt-4o-mini' : 'claude-3-5-sonnet-20241022'),
    userPreferences: {
      theme,
      notifications,
      language: language || 'en'
    }
  });

  const status = document.getElementById('status');
  status.textContent = 'Saved!';
  status.classList.remove('error');
  setTimeout(() => {
    status.textContent = '';
  }, 2000);
}

loadOptions();
