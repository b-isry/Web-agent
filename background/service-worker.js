/**
 * Mozilla UWA - Background Service Worker
 * Initializes LLM connection, MCP-style Tool Controller, and Plan-and-Execute loop
 */

import { ToolController } from './tool-controller.js';
import { LLMClient } from './llm-client.js';
import { PlanExecutor } from './plan-executor.js';
import { TaskOrchestrator } from './task-orchestrator.js';

// Initialize components when service worker starts
const toolController = new ToolController();
const llmClient = new LLMClient(toolController);
const planExecutor = new PlanExecutor(llmClient);
const taskOrchestrator = new TaskOrchestrator(llmClient, toolController);

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Listen for extension installation
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Mozilla UWA] Extension installed:', details.reason);
  if (details.reason === 'install') {
    // Set default user preferences
    chrome.storage.local.set({
      userPreferences: {
        theme: 'system',
        notifications: true,
        language: 'en'
      }
    });
  }
  // Open side panel when extension icon is clicked (instead of popup)
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    console.warn('[Mozilla UWA] sidePanel.setPanelBehavior:', err);
  }
});

// Handle messages from popup/content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'AGENT_QUERY') {
    llmClient.processQuery(message.prompt)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // Keep channel open for async response
  }

  if (message.type === 'TOOLS_LIST') {
    sendResponse({ tools: toolController.listTools() });
    return false;
  }

  if (message.type === 'TOOL_CALL') {
    toolController.callTool(message.name, message.arguments || {})
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'PLAN_AND_EXECUTE') {
    planExecutor.run(message.goal, message.tabId)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'GLOBAL_TASK_QUERY') {
    taskOrchestrator.run(message.goal, message.tabId)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'GET_TASK_STATE') {
    chrome.storage.local.get(['uwa_global_task_state'], (r) =>
      sendResponse(r.uwa_global_task_state || null)
    );
    return true;
  }

  return false;
});
