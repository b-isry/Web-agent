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
