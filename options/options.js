document.getElementById('save').addEventListener('click', saveOptions);
document.getElementById('toggle-theme').addEventListener('click', toggleTheme);

function applyTheme(theme) {
  const html = document.documentElement;
  html.classList.remove('theme-light', 'theme-dark');
  if (theme === 'light') html.classList.add('theme-light');
  else if (theme === 'dark') html.classList.add('theme-dark');
}

async function loadOptions() {
  const result = await chrome.storage.local.get([
    'apiKey',
    'provider',
    'model',
    'userPreferences'
  ]);

  document.getElementById('apiKey').value = result.apiKey || '';
  document.getElementById('provider').value = result.provider || 'openai';
  const model = result.model || 'gpt-4o-mini';
  const modelEl = document.getElementById('model');
  modelEl.value = ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet', 'llama-3-70b'].includes(model)
    ? model
    : 'gpt-4o-mini';

  const prefs = result.userPreferences || {};
  const theme = prefs.theme || 'system';
  document.getElementById('theme').value = theme;
  applyTheme(theme);
  document.getElementById('notifications').checked = prefs.notifications !== false;
  document.getElementById('language').value = prefs.language || 'en';
  document.getElementById('monthly_budget').value = prefs.monthly_budget ?? '';
}

function toggleTheme() {
  const themeEl = document.getElementById('theme');
  const current = themeEl.value;
  const next = current === 'light' ? 'dark' : current === 'dark' ? 'light' : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
  themeEl.value = next;
  applyTheme(next);
  chrome.storage.local.get(['userPreferences'], (r) => {
    const prefs = r.userPreferences || {};
    chrome.storage.local.set({
      userPreferences: { ...prefs, theme: next }
    });
  });
}

async function saveOptions() {
  const apiKey = document.getElementById('apiKey').value.trim();
  const provider = document.getElementById('provider').value;
  const model = document.getElementById('model').value.trim();
  const theme = document.getElementById('theme').value;
  const notifications = document.getElementById('notifications').checked;
  const language = document.getElementById('language').value.trim();
  const monthlyBudget = document.getElementById('monthly_budget').value.trim();
  const monthly_budget = monthlyBudget ? parseFloat(monthlyBudget) : undefined;

  await chrome.storage.local.set({
    apiKey: apiKey || undefined,
    provider,
    model: model || (provider === 'openai' ? 'gpt-4o-mini' : provider === 'groq' ? 'llama-3-70b' : 'claude-3-5-sonnet'),
    userPreferences: {
      theme,
      notifications,
      language: language || 'en',
      monthly_budget
    }
  });

  applyTheme(theme);

  const status = document.getElementById('status');
  status.textContent = 'Saved!';
  status.classList.remove('error');
  setTimeout(() => {
    status.textContent = '';
  }, 2000);
}

loadOptions();
