/**
 * Mozilla UWA - Content Script (with Legibility UI)
 * Entry point: extraction, execution, permission request overlay
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import './legibility.css';
import { PermissionRequestCard } from './PermissionRequestCard';

// Inline extraction & execution (kept in sync with original content.js logic)
const PRICE_PATTERNS = [
  /\$[\d,]+(?:\.\d{2})?/g,
  /€[\d.,]+/g,
  /£[\d.,]+/g,
  /USD\s*[\d,]+(?:\.\d{2})?/gi,
  /[\d,]+(?:\.\d{2})?\s*(?:USD|EUR|GBP)/gi,
];
const PRODUCT_SELECTORS = [
  '[data-product]', '[data-item]', '.product', '.product-item',
  '.product-card', '.item', '.listing', 'article[class*="product"]',
  '[class*="ProductCard"]', '[class*="product-card"]',
];

function getElementText(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll('script, style').forEach((s) => s.remove());
  return (clone.textContent || '').trim().replace(/\s+/g, ' ');
}

function extractProductName(el) {
  const nameSelectors = ['h1', 'h2', 'h3', '.product-name', '.product-title', '[class*="name"]', '[class*="title"]'];
  for (const sel of nameSelectors) {
    const found = el.querySelector(sel) || (el.matches(sel) ? el : null);
    if (found) {
      const text = getElementText(found);
      if (text && text.length < 200) return text.trim();
    }
  }
  return getElementText(el).slice(0, 100) || null;
}

function extractPriceFromElement(el) {
  const text = el.textContent || '';
  for (const pattern of PRICE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

function extractAllPrices(container) {
  const prices = [];
  const text = container?.textContent || '';
  for (const pattern of PRICE_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) prices.push(...matches);
  }
  return [...new Set(prices)];
}

function getAssociatedLabel(input) {
  if (input.id && document.querySelector(`label[for="${input.id}"]`)) {
    return document.querySelector(`label[for="${input.id}"]`).textContent?.trim() || null;
  }
  const parent = input.closest('label');
  return parent ? parent.textContent?.trim() || null : null;
}

function isActionLink(text) {
  const actions = ['add to cart', 'buy', 'purchase', 'checkout', 'subscribe', 'sign up', 'login', 'add'];
  return actions.some((a) => text.includes(a));
}

function extractPageContext() {
  const context = { url: window.location.href, title: document.title, products: [], prices: [], buttons: [], inputs: [], links: [] };
  const productElements = new Set();
  for (const selector of PRODUCT_SELECTORS) {
    document.querySelectorAll(selector).forEach((el) => productElements.add(el));
  }
  const mainContent = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
  const extractRegion = productElements.size > 0 ? document : mainContent;
  const blocks = extractRegion.querySelectorAll('[class*="product"], [class*="item"], [class*="card"], [data-product], [data-item], [class*="Product"], [class*="Item"]');
  const seenProducts = new Set();

  blocks.forEach((block, idx) => {
    const name = extractProductName(block);
    const price = extractPriceFromElement(block);
    if (name || price) {
      const key = `${name || ''}-${price || ''}`;
      if (!seenProducts.has(key)) {
        seenProducts.add(key);
        context.products.push({ id: `product-${idx}`, name: name || 'Unknown', price: price || null, elementId: `product-${idx}` });
      }
    }
  });

  if (context.products.length === 0) {
    context.prices = extractAllPrices(mainContent);
  }

  const buttons = mainContent.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], [onclick]');
  buttons.forEach((el, idx) => {
    const id = `btn-${idx}`;
    el.setAttribute('data-uwa-id', id);
    context.buttons.push({ id, text: getElementText(el) || el.value || el.ariaLabel || el.title || '(no label)', tagName: el.tagName, type: el.type || null });
  });

  const inputs = mainContent.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select');
  inputs.forEach((el, idx) => {
    const id = `input-${idx}`;
    el.setAttribute('data-uwa-id', id);
    context.inputs.push({ id, type: el.type || el.tagName.toLowerCase(), name: el.name || null, placeholder: el.placeholder || null, label: getAssociatedLabel(el) });
  });

  const actionLinks = mainContent.querySelectorAll('a[href]');
  actionLinks.forEach((el, idx) => {
    const text = getElementText(el).toLowerCase();
    if (isActionLink(text)) {
      const id = `link-${idx}`;
      el.setAttribute('data-uwa-id', id);
      context.links.push({ id, text: getElementText(el), href: el.href });
    }
  });

  return context;
}

function executeDomAction(action) {
  const { type, elementId, value } = action;
  const el = document.querySelector(`[data-uwa-id="${elementId}"]`);
  if (!el) return { success: false, error: `Element not found: ${elementId}` };
  try {
    switch (type) {
      case 'click':
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.click();
        return { success: true, action: 'click', elementId };
      case 'type':
        el.focus();
        el.value = value ?? '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, action: 'type', elementId, value };
      case 'scroll':
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { success: true, action: 'scroll', elementId };
      default:
        return { success: false, error: `Unknown action type: ${type}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getElementLabelFromContext(context, elementId) {
  const all = [...(context.buttons || []), ...(context.inputs || []), ...(context.links || [])];
  const found = all.find((e) => e.id === elementId);
  return found?.text || found?.label || found?.placeholder || elementId;
}

// Legibility UI: permission request before write actions
const WRITE_ACTIONS = ['click', 'type'];
let legibilityRoot = null;
let permissionResolve = null;

function showPermissionRequest(action, goal, context) {
  return new Promise((resolve) => {
    permissionResolve = resolve;
    const elementLabel = getElementLabelFromContext(context, action.elementId);

    let rootEl = document.getElementById('uwa-legibility-root');
    if (!rootEl) {
      const div = document.createElement('div');
      div.id = 'uwa-legibility-container';
      rootEl = document.createElement('div');
      rootEl.id = 'uwa-legibility-root';
      div.appendChild(rootEl);
      document.body.appendChild(div);
      legibilityRoot = createRoot(rootEl);
    }

    legibilityRoot.render(
      React.createElement(PermissionRequestCard, {
        action,
        goal,
        elementLabel,
        onApprove: (approvedAction) => {
          unmountLegibility();
          resolve({ approved: true, action: approvedAction });
        },
        onReject: () => {
          unmountLegibility();
          resolve({ approved: false });
        },
      })
    );
  });
}

function unmountLegibility() {
  const wrapper = document.getElementById('uwa-legibility-container');
  if (wrapper) {
    wrapper.remove();
    legibilityRoot = null;
  }
}

// Message listener
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_PAGE_CONTEXT') {
    try {
      sendResponse({ success: true, context: extractPageContext() });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return false;
  }

  if (message.type === 'EXECUTE_DOM_ACTION') {
    const { action, goal, context, requirePermission } = message;

    const runExecute = (actionToRun) => {
      try {
        const result = executeDomAction(actionToRun);
        sendResponse(result);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    };

    if (requirePermission && WRITE_ACTIONS.includes(action.action)) {
      showPermissionRequest(action, goal, context).then(({ approved, action: approvedAction }) => {
        if (approved) {
          runExecute(approvedAction);
        } else {
          sendResponse({ success: false, error: 'User rejected the action' });
        }
      });
      return true;
    }

    runExecute(action);
    return false;
  }

  return false;
});
