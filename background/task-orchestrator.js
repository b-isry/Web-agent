/**
 * Task Orchestrator - Runs multi-step global tasks (e.g., afford + free that day?)
 */

import { createTask, updateTask, addStepResult, clearTask, TaskStatus } from './task-state.js';
import {
  startGlobalTaskSession,
  appendGlobalTaskLog,
  updateGlobalTaskFromState,
  finishGlobalTaskSession,
} from './session-state.js';

export class TaskOrchestrator {
  constructor(llmClient, toolController) {
    this.llmClient = llmClient;
    this.toolController = toolController;
  }

  /**
   * Run a global task (extract price, check budget, check calendar, aggregate)
   */
  async run(goal, tabId) {
    const state = await createTask(goal, tabId);
    await startGlobalTaskSession(goal, tabId);
    await appendGlobalTaskLog('Starting global task...');

    try {
      // 1. Parse goal with LLM -> extract date intent
      await appendGlobalTaskLog('Parsing goal...');
      const parsed = await this._parseGoal(goal);
      const date = parsed.date || new Date().toISOString().slice(0, 10);

      // 2. Extract price from current tab
      await appendGlobalTaskLog('Extracting price from page...');
      const priceResult = await this._extractPriceFromTab(tabId);
      await addStepResult('extract_price', priceResult);
      const taskState = await this._getState();
      await updateGlobalTaskFromState(taskState);

      // 3. Check budget
      await appendGlobalTaskLog('Checking budget...');
      const budgetResult = await this._checkBudget();
      await addStepResult('check_budget', budgetResult);
      await updateGlobalTaskFromState(await this._getState());

      // 4. Check calendar
      await appendGlobalTaskLog('Checking calendar...');
      const calendarResult = await this._checkCalendar(date);
      await addStepResult('check_calendar', calendarResult);
      await updateGlobalTaskFromState(await this._getState());

      // 5. Aggregate and recommend
      await appendGlobalTaskLog('Generating recommendation...');
      const recommendation = await this._aggregateAndRecommend(
        goal,
        priceResult,
        budgetResult,
        calendarResult,
        date
      );

      await updateTask({
        status: TaskStatus.COMPLETED,
        recommendation,
        completedAt: Date.now(),
      });
      await finishGlobalTaskSession(true, recommendation, null);

      return { success: true, recommendation, state: await this._getState() };
    } catch (err) {
      await updateTask({
        status: TaskStatus.FAILED,
        error: err.message,
        completedAt: Date.now(),
      });
      await finishGlobalTaskSession(false, null, err.message);
      return { success: false, error: err.message, state: await this._getState() };
    }
  }

  async _getState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['uwa_global_task_state'], (r) => resolve(r.uwa_global_task_state));
    });
  }

  async _parseGoal(goal) {
    const response = await this.llmClient.processQueryForPlan(
      `Extract structured data from the user's goal. Respond with JSON only: { "date": "YYYY-MM-DD" or null if no date, "priceContext": "brief" }.
If the user says "that day" or similar, use today's date.`,
      `Goal: ${goal}`
    );
    if (response.error) return {};
    try {
      const match = response.text.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : {};
    } catch {
      return {};
    }
  }

  async _extractPriceFromTab(tabId) {
    const tryContentScript = () =>
      new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_CONTEXT' }, (response) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          if (!response?.success) resolve(null);
          else resolve(response.context);
        });
      });

    let ctx = await tryContentScript();
    if (!ctx) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['dist/content.js'],
        });
        await new Promise((r) => setTimeout(r, 100));
        ctx = await tryContentScript();
      } catch (_) {}
    }
    if (!ctx) {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const text = document.body?.innerText || document.body?.textContent || '';
          const m = text.match(/\$[\d,]+\.?\d*/);
          return m ? m[0] : null;
        },
      });
      const priceStr = result?.result;
      return {
        success: true,
        price: priceStr ? parsePrice(priceStr) : null,
        currency: 'USD',
        prices: priceStr ? [priceStr] : [],
        products: [],
      };
    }

    let price = null;
    if (ctx.products?.length) {
      const p = ctx.products[0].price;
      if (p) price = parsePrice(p);
    }
    if (!price && ctx.prices?.length) {
      price = parsePrice(ctx.prices[0]);
    }
    if (!price && ctx.title) {
      price = parsePriceFromText(ctx.title);
    }
    return { success: true, price, currency: 'USD', prices: ctx.prices, products: ctx.products };
  }

  async _checkBudget() {
    const result = await this.toolController.callTool('check_budget', {});
    const text = result?.content?.[0]?.text;
    if (!text) return { success: false, error: 'Could not read budget', balance: 0 };
    try {
      const data = JSON.parse(text);
      return {
        success: data.success ?? true,
        balance: data.balance ?? data.monthly_budget ?? 0,
        currency: data.currency ?? 'USD',
        available: data.available ?? (data.balance > 0),
      };
    } catch {
      return { success: false, error: 'Could not parse budget', balance: 0 };
    }
  }

  async _checkCalendar(date) {
    const result = await this.toolController.callTool('check_calendar', { date });
    const text = result?.content?.[0]?.text;
    if (!text) return { success: false, error: 'Could not read calendar', events: [] };
    try {
      const data = JSON.parse(text);
      return {
        success: data.success ?? false,
        date: data.date ?? date,
        events: data.events ?? [],
      };
    } catch {
      return { success: false, error: 'Could not parse calendar', events: [] };
    }
  }

  async _aggregateAndRecommend(goal, priceResult, budgetResult, calendarResult, date) {
    const price = priceResult.price ?? 0;
    const balance = budgetResult.balance ?? 0;
    const events = calendarResult.events ?? [];
    const canAfford = balance >= price;
    const hasConflicts = events.length > 0;

    const prompt = `The user asked: "${goal}"

Data gathered:
- Price from page: $${price || 'unknown'}
- Budget balance: $${balance}
- Can afford: ${canAfford}
- Date checked: ${date}
- Calendar events: ${events.length ? events.map((e) => e.title).join(', ') : 'None'}

Write a clear, concise recommendation (2-4 sentences). Say whether they can afford it and whether they're free that day. Be direct.`;

    const response = await this.llmClient.processQueryForPlan(
      'You are a helpful assistant. Summarize the data and give a clear recommendation.',
      prompt
    );

    return {
      text: response.error ? fallbackRecommendation(price, balance, events) : response.text,
      data: { price, balance, canAfford, events, hasConflicts, date },
    };
  }
}

function parsePrice(str) {
  if (typeof str !== 'string') return null;
  const num = parseFloat(str.replace(/[^0-9.]/g, ''));
  return isNaN(num) ? null : num;
}

function parsePriceFromText(text) {
  const m = text.match(/\$?([\d,]+\.?\d*)/);
  return m ? parseFloat(m[1].replace(/,/g, '')) : null;
}

function fallbackRecommendation(price, balance, events) {
  const canAfford = balance >= price;
  const free = events.length === 0;
  let msg = 'Based on the data: ';
  msg += canAfford ? `You can afford this ($${balance} available, $${price} cost). ` : `You may not afford this ($${balance} available, $${price} cost). `;
  msg += free ? 'You have no events that day.' : `You have ${events.length} event(s): ${events.map((e) => e.title).join(', ')}.`;
  return msg;
}

