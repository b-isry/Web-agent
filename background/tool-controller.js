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
        description: 'Read user preferences stored in the browser extension\'s local storage. Returns theme, notification settings, language, and other user-configured options.',
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
      default:
        throw new Error(`Tool not implemented: ${name}`);
    }
  }

  /**
   * Read User Preferences from chrome.storage.local
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
}
