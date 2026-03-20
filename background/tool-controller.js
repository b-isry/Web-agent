/**
 * MCP-style Tool Controller
 * Follows Model Context Protocol structure for tool discovery and invocation
 * @see https://modelcontextprotocol.io/specification
 */

export class ToolController {
  constructor() {
    this.tools = this._registerTools();
  }

  /**
   * Register available tools following MCP tool schema
   * Each tool has: name, description, inputSchema (JSON Schema)
   */
  _registerTools() {
    return [
      {
        name: 'read_user_preferences',
        description: 'Read user preferences stored in the browser extension\'s local storage. Returns theme, notification settings, language, monthly_budget, and other user-configured options.',
        inputSchema: {
          type: 'object',
          properties: {
            keys: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional: specific preference keys to retrieve. If omitted, returns all preferences.'
            }
          }
        }
      },
      {
        name: 'check_budget',
        description: 'Read the user\'s monthly budget from local storage. Returns the monthly_budget value the user has set in preferences. Does not depend on any external page.',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'check_calendar',
        description: 'Fetch events from the user\'s Google Calendar for a given date. Uses chrome.identity to authenticate with Google. Returns events for the specified date.',
        inputSchema: {
          type: 'object',
          properties: {
            date: {
              type: 'string',
              description: 'Date in YYYY-MM-DD format to fetch events for.'
            }
          },
          required: ['date']
        }
      }
    ];
  }

  /**
   * MCP tools/list - List available tools
   * @returns {Array} Tools with name, description, inputSchema
   */
  listTools() {
    return this.tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema
    }));
  }

  /**
   * MCP tools/call - Execute a tool by name
   * @param {string} name - Tool name
   * @param {Object} args - Tool arguments
   * @returns {Promise<Object>} Tool execution result
   */
  async callTool(name, args = {}) {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    switch (name) {
      case 'read_user_preferences':
        return this._readUserPreferences(args);
      case 'check_budget':
        return this._checkBudget(args);
      case 'check_calendar':
        return this._checkCalendar(args);
      default:
        throw new Error(`Tool not implemented: ${name}`);
    }
  }

  /**
   * Read User Preferences from chrome.storage.local
   * Includes theme, notifications, language, monthly_budget
   * @param {Object} args - { keys?: string[] } Optional specific keys
   * @returns {Promise<Object>} User preferences
   */
  async _readUserPreferences(args = {}) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['userPreferences'], (result) => {
        let preferences = result.userPreferences || {};

        if (args.keys && Array.isArray(args.keys) && args.keys.length > 0) {
          const filtered = {};
          for (const key of args.keys) {
            if (key in preferences) {
              filtered[key] = preferences[key];
            }
          }
          preferences = filtered;
        }

        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify(preferences, null, 2)
            }
          ]
        });
      });
    });
  }

  /**
   * Read monthly budget from chrome.storage.local (user sets in preferences)
   * @returns {Promise<Object>} MCP-style result with balance/budget info
   */
  async _checkBudget() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['userPreferences'], (result) => {
        const prefs = result.userPreferences || {};
        const monthlyBudget = parseFloat(prefs.monthly_budget) || 0;

        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                monthly_budget: monthlyBudget,
                balance: monthlyBudget,
                currency: 'USD',
                available: monthlyBudget > 0
              }, null, 2)
            }
          ]
        });
      });
    });
  }

  /**
   * Fetch events from Google Calendar API using chrome.identity.getAuthToken
   * @param {Object} args - { date: string } YYYY-MM-DD
   * @returns {Promise<Object>} MCP-style result with events
   */
  async _checkCalendar(args = {}) {
    const date = args.date || new Date().toISOString().slice(0, 10);

    return new Promise((resolve) => {
      chrome.identity.getAuthToken(
        { interactive: true, scopes: ['https://www.googleapis.com/auth/calendar.events.readonly'] },
        async (token) => {
          if (chrome.runtime.lastError || !token) {
            resolve({
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: 'Could not authenticate with Google. Sign in to your Google account in Chrome.',
                    events: [],
                    date
                  }, null, 2)
                }
              ]
            });
            return;
          }

          try {
            const timeMin = `${date}T00:00:00Z`;
            const timeMax = `${date}T23:59:59Z`;
            const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`;

            const response = await fetch(url, {
              headers: { Authorization: `Bearer ${token}` }
            });

            if (!response.ok) {
              const err = await response.json().catch(() => ({}));
              resolve({
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      success: false,
                      error: err.error?.message || `Calendar API error: ${response.status}`,
                      events: [],
                      date
                    }, null, 2)
                  }
                ]
              });
              return;
            }

            const data = await response.json();
            const events = (data.items || []).map((e) => ({
              title: e.summary || '(No title)',
              start: e.start?.dateTime || e.start?.date,
              end: e.end?.dateTime || e.end?.date
            }));

            resolve({
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    date,
                    events
                  }, null, 2)
                }
              ]
            });
          } catch (err) {
            resolve({
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    error: err.message,
                    events: [],
                    date
                  }, null, 2)
                }
              ]
            });
          }
        }
      );
    });
  }
}
