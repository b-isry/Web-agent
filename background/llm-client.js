/**
 * LLM Client - Direct OpenAI/Anthropic API integration
 * Handles agent queries with tool-calling support
 */

export class LLMClient {
  constructor(toolController) {
    this.toolController = toolController;
    this.provider = 'openai'; // 'openai' | 'anthropic'
    this.model = 'gpt-4o-mini';
  }

  /**
   * Load API configuration from storage
   */
  async _getConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['apiKey', 'provider', 'model', 'userPreferences'], resolve);
    });
  }

  /**
   * Resolve model dropdown value to API model ID
   */
  _resolveModel(provider, model) {
    const MODEL_MAP = {
      anthropic: { 'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022' },
      groq: { 'llama-3-70b': 'llama-3.1-70b-versatile' },
    };
    const map = MODEL_MAP[provider];
    return (map && map[model]) || model;
  }

  /**
   * Process a query for Plan-and-Execute (no tools, structured prompt)
   * @param {string} systemPrompt - System instructions
   * @param {string} userPrompt - User message
   * @returns {Promise<Object>} { text, error }
   */
  async processQueryForPlan(systemPrompt, userPrompt) {
    const config = await this._getConfig();
    if (!config.apiKey) {
      return { error: 'API key not configured.' };
    }
    this.provider = config.provider || 'openai';
    this.model = this._resolveModel(this.provider, config.model || 'gpt-4o-mini');

    try {
      if (this.provider === 'openai') {
        return await this._callOpenAIForPlan(config.apiKey, systemPrompt, userPrompt);
      }
      if (this.provider === 'anthropic') {
        return await this._callAnthropicForPlan(config.apiKey, systemPrompt, userPrompt);
      }
      if (this.provider === 'groq') {
        return await this._callGroqForPlan(config.apiKey, systemPrompt, userPrompt);
      }
      return { error: `Unknown provider: ${this.provider}` };
    } catch (err) {
      return { error: err.message };
    }
  }

  async _callOpenAIForPlan(apiKey, systemPrompt, userPrompt) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI API error: ${response.status}`);
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    return { text };
  }

  async _callGroqForPlan(apiKey, systemPrompt, userPrompt) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Groq API error: ${response.status}`);
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    return { text };
  }

  async _callAnthropicForPlan(apiKey, systemPrompt, userPrompt) {
    const response = await fetch(
      'https://api.anthropic.com/v1/messages?anthropic-version=2023-06-01',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.model.includes('claude') ? this.model : 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        })
      }
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Anthropic API error: ${response.status}`);
    }
    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    return { text };
  }

  /**
   * Process a user query through the LLM with tool-calling capability
   * @param {string} prompt - User prompt
   * @returns {Promise<Object>} Agent response
   */
  async processQuery(prompt) {
    const config = await this._getConfig();
    if (!config.apiKey) {
      return {
        error: 'API key not configured. Please set your API key in extension options.'
      };
    }

    this.provider = config.provider || 'openai';
    this.model = this._resolveModel(this.provider, config.model || 'gpt-4o-mini');

    const tools = this.toolController.listTools();
    const messages = [{ role: 'user', content: prompt }];

    try {
      if (this.provider === 'openai') {
        return await this._callOpenAI(config.apiKey, messages, tools);
      }
      if (this.provider === 'anthropic') {
        return await this._callAnthropic(config.apiKey, messages, tools);
      }
      if (this.provider === 'groq') {
        return await this._callGroq(config.apiKey, messages, tools);
      }
      return { error: `Unknown provider: ${this.provider}` };
    } catch (err) {
      console.error('[LLM Client] Error:', err);
      return { error: err.message };
    }
  }

  /**
   * OpenAI API call with tool support
   */
  async _callOpenAI(apiKey, messages, tools) {
    const openaiTools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema
      }
    }));

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools: openaiTools.length ? openaiTools : undefined,
        tool_choice: openaiTools.length ? 'auto' : undefined
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error('No response from OpenAI');
    }

    // Handle tool calls
    if (choice.message?.tool_calls?.length) {
      const toolResults = await this._executeToolCalls(choice.message.tool_calls);
      messages.push(choice.message);
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: choice.message.tool_calls
      });
      const toolContent = toolResults[0]?.content ?? JSON.stringify(toolResults[0]);
      messages.push({
        role: 'tool',
        tool_call_id: choice.message.tool_calls[0].id,
        content: toolContent
      });

      // Get final response after tool execution
      const followUp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages
        })
      });

      const followUpData = await followUp.json();
      const followUpChoice = followUpData.choices?.[0];
      return {
        text: followUpChoice?.message?.content || JSON.stringify(toolResults)
      };
    }

    return { text: choice.message?.content || '' };
  }

  /**
   * Groq API call (OpenAI-compatible)
   */
  async _callGroq(apiKey, messages, tools) {
    const openaiTools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema
      }
    }));

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools: openaiTools.length ? openaiTools : undefined,
        tool_choice: openaiTools.length ? 'auto' : undefined
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Groq API error: ${response.status}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error('No response from Groq');
    }

    if (choice.message?.tool_calls?.length) {
      const toolResults = await this._executeToolCalls(choice.message.tool_calls);
      messages.push(choice.message);
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: choice.message.tool_calls
      });
      const toolContent = toolResults[0]?.content ?? JSON.stringify(toolResults[0]);
      messages.push({
        role: 'tool',
        tool_call_id: choice.message.tool_calls[0].id,
        content: toolContent
      });

      const followUp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages
        })
      });

      const followUpData = await followUp.json();
      const followUpChoice = followUpData.choices?.[0];
      return {
        text: followUpChoice?.message?.content || JSON.stringify(toolResults)
      };
    }

    return { text: choice.message?.content || '' };
  }

  /**
   * Anthropic API call (basic - tool support can be extended)
   */
  async _callAnthropic(apiKey, messages, tools) {
    const response = await fetch(
      'https://api.anthropic.com/v1/messages?anthropic-version=2023-06-01',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.model.includes('claude') ? this.model : 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: messages.map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          }))
        })
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Anthropic API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    return { text };
  }

  /**
   * Execute tool calls from LLM response
   * Extracts text from MCP-style content for OpenAI compatibility
   */
  async _executeToolCalls(toolCalls) {
    const results = [];
    for (const tc of toolCalls) {
      let args = {};
      try {
        args = typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments || '{}')
          : tc.function.arguments || {};
      } catch {
        args = {};
      }
      const result = await this.toolController.callTool(tc.function.name, args);
      // MCP returns { content: [{ type: 'text', text: '...' }] } - extract text for LLM
      const text = result?.content?.[0]?.text ?? JSON.stringify(result);
      results.push({ content: text });
    }
    return results;
  }
}
