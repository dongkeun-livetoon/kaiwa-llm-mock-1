import { Hono } from 'hono';
import type { Env } from '../types';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

// Cerebras API call
async function callCerebras(apiKey: string, model: string, messages: ChatMessage[], temperature: number, maxTokens: number) {
  const supportedModels = [
    'llama-3.3-70b',
    'llama3.1-8b',
    'qwen-3-32b',
    'qwen-3-235b-a22b-instruct-2507',
    'gpt-oss-120b',
  ];

  const modelId = supportedModels.includes(model) ? model : 'llama-3.3-70b';

  const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: messages,
      temperature: temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cerebras API error (${response.status}): ${error}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };

  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Invalid response from Cerebras API');
  }

  let content = data.choices[0].message.content || '';

  // Clean up Qwen's thinking tags
  if (modelId.startsWith('qwen')) {
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
    content = content.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    content = content.trim();
  }

  return content;
}

// Gemini API call
async function callGemini(apiKey: string, model: string, messages: ChatMessage[], temperature: number, maxTokens: number) {
  const supportedModels = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'];
  const modelId = supportedModels.includes(model) ? model : 'gemini-2.5-flash';

  const systemMessage = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

  const contents = chatMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const adjustedMaxTokens = modelId.includes('2.5') ? maxTokens + 1024 : maxTokens;

  const requestBody: Record<string, unknown> = {
    contents: contents,
    generationConfig: {
      temperature: temperature,
      maxOutputTokens: adjustedMaxTokens,
    },
  };

  if (systemMessage) {
    requestBody.systemInstruction = {
      parts: [{ text: systemMessage.content }],
    };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${error}`);
  }

  const data = await response.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>
  };

  if (!data.candidates || data.candidates.length === 0) {
    throw new Error('Gemini returned no response candidates');
  }

  const candidate = data.candidates[0];

  if (candidate.finishReason === 'SAFETY') {
    throw new Error('Gemini blocked the response due to safety filters');
  }

  if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
    throw new Error('Gemini returned empty content');
  }

  return candidate.content.parts[0].text || '';
}

// Grok (xAI) API call
async function callGrok(apiKey: string, model: string, messages: ChatMessage[], temperature: number, maxTokens: number) {
  const supportedModels = [
    'grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning',
    'grok-4', 'grok-4-fast-non-reasoning',
    'grok-code-fast-1',
    'grok-3', 'grok-3-fast', 'grok-3-mini', 'grok-3-mini-fast',
    'grok-2-1212', 'grok-2-vision-1212',
  ];

  const modelId = supportedModels.includes(model) ? model : 'grok-3-mini-fast';

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: messages,
      temperature: temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Grok API error (${response.status}): ${error}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };

  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Invalid response from Grok API');
  }

  let content = data.choices[0].message.content || '';

  // Clean up Grok's internal XML tags
  content = content.replace(/<xai:[\s\S]*?<\/xai:[^>]+>/g, '');
  content = content.replace(/<tool_usage_card>[\s\S]*?<\/tool_usage_card>/g, '');
  content = content.replace(/<tool_usage>[\s\S]*?<\/tool_usage>/g, '');
  content = content.trim();

  if (!content) {
    throw new Error('Grok returned empty response - may have been filtered');
  }

  return content;
}

export const chatRoute = new Hono<{ Bindings: Env }>();

chatRoute.post('/api/chat', async (c) => {
  try {
    const body: ChatRequest = await c.req.json();
    const { model, messages, temperature = 0.7, maxTokens = 1024, systemPrompt } = body;

    const allMessages: ChatMessage[] = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    let response: string;

    const cerebrasModels = ['llama-3.3-70b', 'llama3.1-8b', 'qwen-3-32b', 'qwen-3-235b-a22b-instruct-2507', 'gpt-oss-120b'];
    const geminiModels = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'];
    const grokModels = [
      'grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning',
      'grok-4', 'grok-4-fast-non-reasoning',
      'grok-code-fast-1',
      'grok-3', 'grok-3-fast', 'grok-3-mini', 'grok-3-mini-fast',
      'grok-2-1212', 'grok-2-vision-1212',
    ];

    if (cerebrasModels.includes(model) || model.startsWith('llama') || model.startsWith('qwen') || model.startsWith('gpt-oss')) {
      if (!c.env.CEREBRAS_API_KEY) throw new Error('CEREBRAS_API_KEY is not set');
      response = await callCerebras(c.env.CEREBRAS_API_KEY, model, allMessages, temperature, maxTokens);
    } else if (geminiModels.includes(model) || model.startsWith('gemini')) {
      if (!c.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
      response = await callGemini(c.env.GEMINI_API_KEY, model, allMessages, temperature, maxTokens);
    } else if (grokModels.includes(model) || model.startsWith('grok')) {
      if (!c.env.GROK_API_KEY) throw new Error('GROK_API_KEY is not set');
      response = await callGrok(c.env.GROK_API_KEY, model, allMessages, temperature, maxTokens);
    } else {
      throw new Error(`Unsupported model: ${model}`);
    }

    return c.json({
      success: true,
      content: response,
      model: model,
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});
