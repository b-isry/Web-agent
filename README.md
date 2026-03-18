# Mozilla UWA - Browser AI Agent

A Chrome Extension (Manifest V3) that implements a browser-level AI agent inspired by the Mozilla Web Agent API. Features an MCP-style Tool Controller for structured tool discovery and invocation.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Chrome Extension                                   │
├──────────────────────────────────────────────────────────────────────────┤
│  Popup UI              │  Background Service Worker                      │
│  • Ask (LLM query)     │  ├── LLM Client (OpenAI/Anthropic)               │
│  • Plan & Execute      │  ├── Tool Controller (MCP-style)                │
│  • Global Task         │  ├── Plan Executor (Plan-and-Execute loop)     │
│                        │  └── Task Orchestrator (Global Task State)       │
├────────────────────────┼─────────────────────────────────────────────────┤
│  Content Script        │  • Get page context (products, prices, buttons) │
│  (injected on pages)   │  • Execute DOM actions (click, type, scroll)    │
└────────────────────────┴─────────────────────────────────────────────────┘
```

## Features

- **Manifest V3** – Modern Chrome extension with service worker
- **LLM Integration** – Direct OpenAI or Anthropic API calls (no LangChain dependency for lighter bundle)
- **MCP Tool Controller** – Model Context Protocol structure:
  - `tools/list` – Discover available tools with name, description, inputSchema
  - `tools/call` – Execute tools by name with JSON arguments
- **Read User Preferences** – Tool that reads from `chrome.storage.local`
- **Legibility UI** – Before any write action (click, type), a Permission Request card overlays the page with:
  - What the agent wants to do
  - Why it's doing it (user's goal)
  - Expected outcome
  - **Approve** and **Modify** buttons (Modify allows editing text for type actions)
- **Global Task State** – Multi-step queries like "Can I afford this and am I free that day?":
  - Extracts price from current tab
  - Opens hidden tab to mock budget API to check funds
  - Opens hidden tab to mock calendar to check conflicts
  - Aggregates data and presents final recommendation in popup
- **Plan-and-Execute Loop** – Agent receives page context and decides which DOM elements to interact with:
  - Content script extracts products, prices, buttons, inputs, action links
  - LLM plans next action (click, type, scroll) or signals done
  - Actions executed via content script; loop repeats until goal achieved or max steps

## Setup

1. **Build the content script** (required for Legibility UI)
   ```bash
   npm install
   npm run build
   ```

2. **Load the extension**
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked" and select this folder

3. **Configure API key**
   - Click the extension icon → Settings (or right-click → Options)
   - Enter your OpenAI or Anthropic API key
   - Save

4. **Use the agent**
   - **Ask**: Type a prompt (e.g., "What are my current preferences?")
   - **Plan & Execute**: Enter a goal (e.g., "Click Add to Cart"), click "Run on Page" – the agent will read the current tab and interact with DOM elements
   - **Global Task**: Enter a goal (e.g., "Can I afford this and am I free that day?") – extracts price from the current tab, checks mock budget & calendar in background tabs, then shows an aggregated recommendation

## MCP Tool: read_user_preferences

| Field | Value |
|-------|-------|
| **name** | `read_user_preferences` |
| **description** | Read user preferences from local storage |
| **inputSchema** | `{ keys?: string[] }` – optional array of specific keys |

Returns theme, notifications, language, and other user-configured options.

## Project Structure

```
Mozilla UWA/
├── manifest.json
├── background/
│   ├── service-worker.js    # Entry point, message routing
│   ├── llm-client.js        # OpenAI/Anthropic API client
│   ├── tool-controller.js   # MCP-style tool registry & execution
│   ├── plan-executor.js     # Plan-and-Execute loop
│   ├── task-orchestrator.js # Global Task orchestration
│   └── task-state.js        # Global Task State persistence
├── mock/
│   ├── budget.html         # Mock budgeting page
│   └── calendar.html       # Mock calendar page
├── content/
│   └── content.js           # Page context extraction, DOM action execution
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── options/
│   ├── options.html
│   ├── options.css
│   └── options.js
└── README.md
```

## Adding More Tools

Extend `tool-controller.js`:

1. Add tool definition to `_registerTools()` with `name`, `description`, `inputSchema`
2. Add case in `callTool()` to route to your handler
3. Implement the handler method

## Security Notes

- API keys are stored in `chrome.storage.local` (local only)
- No data is sent to third parties except the chosen LLM provider
- User consent is required before tool execution (implicit via extension install)
