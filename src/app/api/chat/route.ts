import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROK_API_KEY = process.env.GROK_API_KEY;

// Debug logging
console.log('API Keys loaded:', {
  cerebras: CEREBRAS_API_KEY ? `${CEREBRAS_API_KEY.slice(0, 10)}...` : 'NOT SET',
  gemini: GEMINI_API_KEY ? `${GEMINI_API_KEY.slice(0, 10)}...` : 'NOT SET',
  grok: GROK_API_KEY ? `${GROK_API_KEY.slice(0, 10)}...` : 'NOT SET',
});

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
async function callCerebras(model: string, messages: ChatMessage[], temperature: number, maxTokens: number) {
  if (!CEREBRAS_API_KEY) {
    throw new Error('CEREBRAS_API_KEY is not set');
  }

  // Model IDs are passed directly - they match Cerebras API
  const supportedModels = [
    'llama-3.3-70b',
    'llama3.1-8b',
    'qwen-3-32b',
    'qwen-3-235b-a22b-instruct-2507',
    'gpt-oss-120b',
  ];

  const modelId = supportedModels.includes(model) ? model : 'llama-3.3-70b';
  console.log('Calling Cerebras with model:', modelId);

  const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CEREBRAS_API_KEY}`,
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
    console.error('Cerebras API error response:', error);
    throw new Error(`Cerebras API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  console.log('Cerebras response received:', JSON.stringify(data).slice(0, 200));

  // Safe access with error handling
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    console.error('Cerebras invalid response:', JSON.stringify(data));
    throw new Error('Invalid response from Cerebras API: ' + JSON.stringify(data).slice(0, 100));
  }

  let content = data.choices[0].message.content || '';

  // Clean up Qwen's thinking tags (Chain-of-Thought output)
  if (modelId.startsWith('qwen')) {
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
    content = content.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    content = content.trim();
  }

  return content;
}

// Gemini API call
async function callGemini(model: string, messages: ChatMessage[], temperature: number, maxTokens: number) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  // Gemini 2.5 models (latest)
  const supportedModels = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
  ];

  const modelId = supportedModels.includes(model) ? model : 'gemini-2.5-flash';
  console.log('Calling Gemini with model:', modelId);

  // Convert messages to Gemini format
  const systemMessage = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

  const contents = chatMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  // For Gemini 2.5 models, increase maxOutputTokens to account for thinking
  // Thinking typically uses 100-500 tokens, so we add buffer
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
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('Gemini API error response:', error);
    throw new Error(`Gemini API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  console.log('Gemini response received:', JSON.stringify(data).slice(0, 300));

  // Check for blocked or empty responses
  if (!data.candidates || data.candidates.length === 0) {
    console.error('Gemini no candidates:', JSON.stringify(data));
    throw new Error('Gemini returned no response candidates');
  }

  const candidate = data.candidates[0];

  // Check finish reason for issues
  if (candidate.finishReason === 'SAFETY') {
    throw new Error('Gemini blocked the response due to safety filters');
  }

  // Handle MAX_TOKENS with no content (edge case)
  if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
    if (candidate.finishReason === 'MAX_TOKENS') {
      throw new Error('Gemini response was empty (MAX_TOKENS reached immediately - try increasing maxTokens)');
    }
    console.error('Gemini empty content:', JSON.stringify(data));
    throw new Error('Gemini returned empty content');
  }

  return candidate.content.parts[0].text;
}

// Grok (xAI) API call - OpenAI compatible
async function callGrok(model: string, messages: ChatMessage[], temperature: number, maxTokens: number) {
  if (!GROK_API_KEY) {
    throw new Error('GROK_API_KEY is not set');
  }

  const supportedModels = [
    // Grok 4.1 series
    'grok-4-1-fast-reasoning',
    'grok-4-1-fast-non-reasoning',
    // Grok 4 series
    'grok-4',
    'grok-4-fast-non-reasoning',
    // Grok Code
    'grok-code-fast-1',
    // Grok 3 series
    'grok-3',
    'grok-3-fast',
    'grok-3-mini',
    'grok-3-mini-fast',
    // Grok 2 series
    'grok-2-1212',
    'grok-2-vision-1212',
  ];

  const modelId = supportedModels.includes(model) ? model : 'grok-3-mini-fast';
  console.log('Calling Grok with model:', modelId);

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROK_API_KEY}`,
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
    console.error('Grok API error response:', error);
    throw new Error(`Grok API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  console.log('Grok response received:', JSON.stringify(data).slice(0, 200));

  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    console.error('Grok invalid response:', JSON.stringify(data));
    throw new Error('Invalid response from Grok API: ' + JSON.stringify(data).slice(0, 100));
  }

  let content = data.choices[0].message.content || '';

  // Clean up Grok's internal XML tags that sometimes leak into responses
  content = content.replace(/<xai:[\s\S]*?<\/xai:[^>]+>/g, '');
  content = content.replace(/<tool_usage_card>[\s\S]*?<\/tool_usage_card>/g, '');
  content = content.replace(/<tool_usage>[\s\S]*?<\/tool_usage>/g, '');
  content = content.trim();

  // If response is empty after cleanup, Grok likely refused or had an error
  if (!content) {
    console.warn('Grok returned empty content, raw response:', JSON.stringify(data).slice(0, 500));
    throw new Error('Grok returned empty response - may have been filtered');
  }

  return content;
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const { model, messages, temperature = 0.7, maxTokens = 1024, systemPrompt } = body;

    console.log('Chat API request:', { model, messageCount: messages.length, hasSystemPrompt: !!systemPrompt });

    // Add system prompt if provided
    const allMessages: ChatMessage[] = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    let response: string;

    // Determine provider based on model
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
      response = await callCerebras(model, allMessages, temperature, maxTokens);
    } else if (geminiModels.includes(model) || model.startsWith('gemini')) {
      response = await callGemini(model, allMessages, temperature, maxTokens);
    } else if (grokModels.includes(model) || model.startsWith('grok')) {
      response = await callGrok(model, allMessages, temperature, maxTokens);
    } else {
      throw new Error(`Unsupported model: ${model}`);
    }

    return NextResponse.json({
      success: true,
      content: response,
      model: model,
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
