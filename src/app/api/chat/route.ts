import { NextRequest, NextResponse } from 'next/server';

const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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
  const modelMap: Record<string, string> = {
    'llama-3.3-70b': 'llama-3.3-70b',
    'llama-3.1-8b': 'llama3.1-8b',
    'qwen-3-32b': 'qwen-3-32b',
  };

  const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CEREBRAS_API_KEY}`,
    },
    body: JSON.stringify({
      model: modelMap[model] || model,
      messages: messages,
      temperature: temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cerebras API error: ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// Gemini API call
async function callGemini(model: string, messages: ChatMessage[], temperature: number, maxTokens: number) {
  const modelMap: Record<string, string> = {
    'gemini-2.0-flash': 'gemini-2.0-flash',
    'gemini-1.5-pro': 'gemini-1.5-pro',
    'gemini-1.5-flash': 'gemini-1.5-flash',
  };

  // Convert messages to Gemini format
  const systemMessage = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

  const contents = chatMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const requestBody: Record<string, unknown> = {
    contents: contents,
    generationConfig: {
      temperature: temperature,
      maxOutputTokens: maxTokens,
    },
  };

  if (systemMessage) {
    requestBody.systemInstruction = {
      parts: [{ text: systemMessage.content }],
    };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelMap[model] || model}:generateContent?key=${GEMINI_API_KEY}`,
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
    throw new Error(`Gemini API error: ${error}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const { model, messages, temperature = 0.7, maxTokens = 1024, systemPrompt } = body;

    // Add system prompt if provided
    const allMessages: ChatMessage[] = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    let response: string;

    // Determine provider based on model
    if (model.startsWith('llama') || model.startsWith('qwen')) {
      response = await callCerebras(model, allMessages, temperature, maxTokens);
    } else if (model.startsWith('gemini')) {
      response = await callGemini(model, allMessages, temperature, maxTokens);
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
