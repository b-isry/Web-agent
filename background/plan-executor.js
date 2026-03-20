/**
 * Plan-and-Execute Loop
 * LLM receives page context and decides which DOM elements to interact with
 */

import {
  startPlanExecuteSession,
  appendPlanExecuteLog,
  finishPlanExecuteSession,
} from './session-state.js';

export class PlanExecutor {
  constructor(llmClient) {
    this.llmClient = llmClient;
    this.maxSteps = 10;
  }

  /**
   * Run the Plan-and-Execute loop
   * @param {string} goal - User goal (e.g., "Click Add to Cart")
   * @param {number} tabId - Active tab ID for content script messaging
   * @returns {Promise<Object>} Final result
   */
  async run(goal, tabId) {
    const history = [];
    let step = 0;

    await startPlanExecuteSession(goal, tabId);
    await appendPlanExecuteLog('Starting plan execution...');

    while (step < this.maxSteps) {
      step++;
      await appendPlanExecuteLog(`Step ${step}/${this.maxSteps}: Getting page context...`);

      // 1. Get current page context from content script
      const contextResult = await this._getPageContext(tabId);
      if (!contextResult.success) {
        await finishPlanExecuteSession(false, null, `Failed to get page context: ${contextResult.error}`);
        return { success: false, error: `Failed to get page context: ${contextResult.error}` };
      }

      const context = contextResult.context;
      const contextSummary = this._formatContextForLLM(context);

      // 2. Ask LLM what to do next
      const systemPrompt = `You are a browser automation agent. Given the current page context and the user's goal, decide the next action.

Respond with a JSON object only, no other text. Choose ONE of:

1. To perform an action:
{"action":"click","elementId":"btn-2"}
{"action":"type","elementId":"input-0","value":"search term"}
{"action":"scroll","elementId":"product-0"}

2. To finish (goal achieved or impossible):
{"done":true,"summary":"Brief description of what was accomplished"}

Available element IDs come from the context. Use the exact id from buttons, inputs, or links.
If the goal cannot be achieved with available elements, respond with done:true and explain.`;

      const userPrompt = `Goal: ${goal}

Current page context:
${contextSummary}

Previous actions: ${history.length ? JSON.stringify(history) : 'None'}

What is the next action? Respond with JSON only.`;

      await appendPlanExecuteLog(`Step ${step}: Asking LLM for next action...`);
      const response = await this.llmClient.processQueryForPlan(systemPrompt, userPrompt);
      if (response.error) {
        await finishPlanExecuteSession(false, null, response.error);
        return { success: false, error: response.error };
      }

      const decision = this._parseDecision(response.text);
      if (!decision) {
        await finishPlanExecuteSession(false, null, `Could not parse LLM decision: ${response.text}`);
        return { success: false, error: `Could not parse LLM decision: ${response.text}` };
      }

      if (decision.done) {
        const summary = decision.summary || 'Goal completed';
        await finishPlanExecuteSession(true, summary, null);
        return {
          success: true,
          summary,
          steps: history.length
        };
      }

      await appendPlanExecuteLog(`Step ${step}: Executing ${decision.action} on ${decision.elementId}...`);
      // 3. Execute the action via content script (with permission request for write actions)
      const execResult = await this._executeAction(tabId, decision, goal, context);
      if (!execResult.success) {
        await appendPlanExecuteLog(`Step ${step}: Action failed - ${execResult.error}`);
        history.push({ action: decision, result: execResult });
        // Continue loop - LLM might adapt on next iteration
        if (step >= this.maxSteps) {
          await finishPlanExecuteSession(false, null, execResult.error);
          return { success: false, error: execResult.error, steps: history.length };
        }
        continue;
      }

      await appendPlanExecuteLog(`Step ${step}: Action succeeded`);
      history.push({ action: decision, result: execResult });

      // Small delay to let the page update
      await new Promise((r) => setTimeout(r, 500));
    }

    const errMsg = `Max steps (${this.maxSteps}) reached without completing goal`;
    await finishPlanExecuteSession(false, null, errMsg);
    return {
      success: false,
      error: errMsg,
      steps: history.length
    };
  }

  async _getPageContext(tabId) {
    const tryGet = () =>
      new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_CONTEXT' }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { success: false, error: 'No response' });
          }
        });
      });

    let result = await tryGet();
    if (!result.success && result.error?.includes('Receiving end')) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['dist/content.js']
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['dist/content.css']
      });
      result = await tryGet();
    }
    return result;
  }

  async _executeAction(tabId, action, goal, context) {
    const isWriteAction = ['click', 'type'].includes(action.action);
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(
        tabId,
        {
          type: 'EXECUTE_DOM_ACTION',
          action,
          goal,
          context,
          requirePermission: isWriteAction,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { success: false, error: 'No response' });
          }
        }
      );
    });
  }

  _formatContextForLLM(context) {
    const parts = [];

    if (context.products?.length) {
      parts.push('Products: ' + JSON.stringify(context.products));
    }
    if (context.prices?.length) {
      parts.push('Prices found: ' + context.prices.join(', '));
    }
    if (context.buttons?.length) {
      parts.push('Buttons: ' + JSON.stringify(context.buttons));
    }
    if (context.inputs?.length) {
      parts.push('Inputs: ' + JSON.stringify(context.inputs));
    }
    if (context.links?.length) {
      parts.push('Action links: ' + JSON.stringify(context.links));
    }

    parts.push(`URL: ${context.url}`);
    parts.push(`Title: ${context.title}`);

    return parts.join('\n');
  }

  _parseDecision(text) {
    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = text.trim();
      const match = jsonStr.match(/\{[\s\S]*\}/);
      if (match) jsonStr = match[0];
      const parsed = JSON.parse(jsonStr);

      if (parsed.done === true) {
        return { done: true, summary: parsed.summary || '' };
      }
      if (parsed.action && parsed.elementId) {
        return {
          action: parsed.action,
          elementId: parsed.elementId,
          value: parsed.value
        };
      }
      return null;
    } catch {
      return null;
    }
  }
}
