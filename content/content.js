/**
 * Mozilla UWA - Content Script
 * Extracts page context (products, prices, interactive elements) and executes DOM actions
 */

// Price patterns: $X.XX, €X,XX, £X.XX, USD 10, etc.
const PRICE_PATTERNS = [
  /\$[\d,]+(?:\.\d{2})?/g,
  /€[\d.,]+/g,
  /£[\d.,]+/g,
  /USD\s*[\d,]+(?:\.\d{2})?/gi,
  /[\d,]+(?:\.\d{2})?\s*(?:USD|EUR|GBP)/gi
];

// Product container selectors (common e-commerce patterns)
const PRODUCT_SELECTORS = [
  '[data-product]',
  '[data-item]',
  '.product',
  '.product-item',
  '.product-card',
  '.item',
  '.listing',
  'article[class*="product"]',
  '[class*="ProductCard"]',
  '[class*="product-card"]'
];

/**
 * Extract the main content of the page: product names, prices, and interactive elements
 * @returns {Object} Structured page context for the LLM
 */
function extractPageContext() {
  const context = {
    url: window.location.href,
    title: document.title,
    products: [],
    prices: [],
    buttons: [],
    inputs: [],
    links: []
  };

  // Extract products (name + price when co-located)
  const productElements = new Set();
  for (const selector of PRODUCT_SELECTORS) {
    document.querySelectorAll(selector).forEach((el) => productElements.add(el));
  }

  // Fallback: use main content area
  const mainContent = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
  const extractRegion = productElements.size > 0 ? document : mainContent;

  // Find product-like blocks
  const blocks = extractRegion.querySelectorAll('[class*="product"], [class*="item"], [class*="card"], [data-product], [data-item], [class*="Product"], [class*="Item"]');
  const seenProducts = new Set();

  blocks.forEach((block, idx) => {
    const name = extractProductName(block);
    const price = extractPriceFromElement(block);
    if (name || price) {
      const key = `${name || ''}-${price || ''}`;
      if (!seenProducts.has(key)) {
        seenProducts.add(key);
        context.products.push({
          id: `product-${idx}`,
          name: name || 'Unknown',
          price: price || null,
          elementId: `product-${idx}`
        });
      }
    }
  });

  // If no structured products, scan for price + text combinations
  if (context.products.length === 0) {
    const allPrices = extractAllPrices(mainContent);
    context.prices = allPrices;
  }

  // Extract interactive elements with stable IDs
  const buttons = mainContent.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], [onclick]');
  buttons.forEach((el, idx) => {
    const text = getElementText(el);
    const id = `btn-${idx}`;
    el.setAttribute('data-uwa-id', id);
    context.buttons.push({
      id,
      text: text || el.value || el.ariaLabel || el.title || '(no label)',
      tagName: el.tagName,
      type: el.type || null
    });
  });

  const inputs = mainContent.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select');
  inputs.forEach((el, idx) => {
    const id = `input-${idx}`;
    el.setAttribute('data-uwa-id', id);
    context.inputs.push({
      id,
      type: el.type || el.tagName.toLowerCase(),
      name: el.name || null,
      placeholder: el.placeholder || null,
      label: getAssociatedLabel(el)
    });
  });

  // Links that look actionable (Add to Cart, Buy, etc.)
  const actionLinks = mainContent.querySelectorAll('a[href]');
  actionLinks.forEach((el, idx) => {
    const text = getElementText(el).toLowerCase();
    if (isActionLink(text)) {
      const id = `link-${idx}`;
      el.setAttribute('data-uwa-id', id);
      context.links.push({
        id,
        text: getElementText(el),
        href: el.href
      });
    }
  });

  return context;
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

function getElementText(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll('script, style').forEach((s) => s.remove());
  return (clone.textContent || '').trim().replace(/\s+/g, ' ');
}

function getAssociatedLabel(input) {
  if (input.id && document.querySelector(`label[for="${input.id}"]`)) {
    return document.querySelector(`label[for="${input.id}"]`).textContent?.trim() || null;
  }
  const parent = input.closest('label');
  if (parent) return parent.textContent?.trim() || null;
  return null;
}

function isActionLink(text) {
  const actions = ['add to cart', 'buy', 'purchase', 'checkout', 'subscribe', 'sign up', 'login', 'add'];
  return actions.some((a) => text.includes(a));
}

/**
 * Show a permission request card with Shadow DOM isolation.
 * @param {Object} action - The proposed action (e.g. { type: 'click', elementId: 'btn-0' })
 * @param {string} reasoning - The AI's intent/explanation
 * @param {string} [outcome] - Optional description of expected outcome
 * @returns {Promise<{ confirmed: boolean }>} Resolves when user clicks Confirm or Cancel
 */
function showPermissionCard(action, reasoning, outcome) {
  return new Promise((resolve) => {
    const containerId = 'uwa-permission-card-container';
    let container = document.getElementById(containerId);
    if (container) container.remove();

    container = document.createElement('div');
    container.id = containerId;
    container.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;pointer-events:none;';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.3);pointer-events:auto;';
    overlay.addEventListener('click', () => {
      container.remove();
      resolve({ confirmed: false });
    });

    const host = document.createElement('div');
    host.style.cssText = 'position:relative;z-index:1;pointer-events:auto;';
    container.appendChild(overlay);
    container.appendChild(host);

    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      .card {
        width: min(420px, 90vw);
        padding: 1.5rem;
        border-radius: 1rem;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.12);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        font-family: system-ui, -apple-system, sans-serif;
        color: #1f2937;
      }
      .card-title { font-size: 1.125rem; font-weight: 600; margin-bottom: 0.75rem; }
      .reasoning-section { margin-bottom: 1rem; }
      .reasoning-label { font-size: 0.75rem; font-weight: 500; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.375rem; }
      .reasoning-text { font-size: 0.875rem; line-height: 1.5; color: #374151; }
      .outcome { font-size: 0.8125rem; color: #6b7280; margin-bottom: 1rem; }
      .actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
      .btn {
        padding: 0.5rem 1rem;
        border-radius: 0.5rem;
        font-size: 0.875rem; font-weight: 500;
        cursor: pointer;
        border: none;
        transition: opacity 0.15s;
      }
      .btn:hover { opacity: 0.9; }
      .btn-confirm { background: #2563eb; color: white; }
      .btn-cancel { background: rgba(0, 0, 0, 0.08); color: #374151; }
    `;

    const actionLabel = action ? `${action.type || 'action'}${action.elementId ? ` on ${action.elementId}` : ''}` : 'Action';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-title">${escapeHtml(actionLabel)}</div>
      <div class="reasoning-section">
        <div class="reasoning-label">Reasoning</div>
        <div class="reasoning-text">${escapeHtml(reasoning || 'No reasoning provided.')}</div>
      </div>
      ${outcome ? `<div class="outcome">${escapeHtml(outcome)}</div>` : ''}
      <div class="actions">
        <button class="btn btn-cancel">Cancel</button>
        <button class="btn btn-confirm">Confirm</button>
      </div>
    `;

    shadow.appendChild(style);
    shadow.appendChild(card);

    card.querySelector('.btn-confirm').addEventListener('click', (e) => {
      e.stopPropagation();
      container.remove();
      resolve({ confirmed: true });
    });
    card.querySelector('.btn-cancel').addEventListener('click', (e) => {
      e.stopPropagation();
      container.remove();
      resolve({ confirmed: false });
    });

    document.body.appendChild(container);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Execute a DOM action (click, type, etc.)
 * @param {Object} action - { type: 'click'|'type', elementId: string, value?: string }
 * @returns {Object} Result of the action
 */
function executeDomAction(action) {
  const { type, elementId, value } = action;
  const el = document.querySelector(`[data-uwa-id="${elementId}"]`);

  if (!el) {
    return { success: false, error: `Element not found: ${elementId}` };
  }

  try {
    switch (type) {
      case 'click': {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.click();
        return { success: true, action: 'click', elementId };
      }
      case 'type': {
        el.focus();
        el.value = value ?? '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, action: 'type', elementId, value };
      }
      case 'scroll': {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { success: true, action: 'scroll', elementId };
      }
      default:
        return { success: false, error: `Unknown action type: ${type}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Message listener
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_PAGE_CONTEXT') {
    try {
      const context = extractPageContext();
      sendResponse({ success: true, context });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return false;
  }

  if (message.type === 'EXECUTE_DOM_ACTION') {
    try {
      const result = executeDomAction(message.action);
      sendResponse(result);
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return false;
  }

  return false;
});
