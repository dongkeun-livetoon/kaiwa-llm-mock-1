import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import { unzipSync } from 'fflate';

interface Env {
  CEREBRAS_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GROK_API_KEY?: string;
  NOVELAI_API_KEY?: string;
  CORS_ORIGIN?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const app = new Hono<{ Bindings: Env }>().basePath('/api');

// ===== Chat Route =====
async function callCerebras(apiKey: string, model: string, messages: ChatMessage[], temperature: number, maxTokens: number) {
  const supportedModels = ['llama-3.3-70b', 'llama3.1-8b', 'qwen-3-32b', 'qwen-3-235b-a22b-instruct-2507', 'gpt-oss-120b'];
  const modelId = supportedModels.includes(model) ? model : 'llama-3.3-70b';

  const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: modelId, messages, temperature, max_tokens: maxTokens }),
  });

  if (!response.ok) throw new Error(`Cerebras API error (${response.status}): ${await response.text()}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  if (!data.choices?.[0]?.message) throw new Error('Invalid Cerebras response');

  let content = data.choices[0].message.content || '';
  if (modelId.startsWith('qwen')) {
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
  }
  return content;
}

async function callGemini(apiKey: string, model: string, messages: ChatMessage[], temperature: number, maxTokens: number) {
  const supportedModels = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'];
  const modelId = supportedModels.includes(model) ? model : 'gemini-2.5-flash';

  const systemMessage = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');
  const contents = chatMessages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

  const requestBody: Record<string, unknown> = {
    contents,
    generationConfig: { temperature, maxOutputTokens: maxTokens + 1024 },
  };
  if (systemMessage) requestBody.systemInstruction = { parts: [{ text: systemMessage.content }] };

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) throw new Error(`Gemini API error (${response.status}): ${await response.text()}`);
  const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> };
  if (!data.candidates?.length) throw new Error('Gemini returned no candidates');
  if (data.candidates[0].finishReason === 'SAFETY') throw new Error('Gemini blocked due to safety');
  return data.candidates[0].content?.parts?.[0]?.text || '';
}

async function callGrok(apiKey: string, model: string, messages: ChatMessage[], temperature: number, maxTokens: number) {
  const supportedModels = ['grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning', 'grok-4', 'grok-4-fast-non-reasoning', 'grok-code-fast-1', 'grok-3', 'grok-3-fast', 'grok-3-mini', 'grok-3-mini-fast', 'grok-2-1212', 'grok-2-vision-1212'];
  const modelId = supportedModels.includes(model) ? model : 'grok-3-mini-fast';

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelId, messages, temperature, max_tokens: maxTokens }),
  });

  if (!response.ok) throw new Error(`Grok API error (${response.status}): ${await response.text()}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  if (!data.choices?.[0]?.message) throw new Error('Invalid Grok response');

  let content = data.choices[0].message.content || '';
  content = content.replace(/<xai:[\s\S]*?<\/xai:[^>]+>/g, '').replace(/<tool_usage_card>[\s\S]*?<\/tool_usage_card>/g, '').replace(/<tool_usage>[\s\S]*?<\/tool_usage>/g, '').trim();
  if (!content) throw new Error('Grok returned empty response');
  return content;
}

app.post('/chat', async (c) => {
  try {
    const { model, messages, temperature = 0.7, maxTokens = 1024, systemPrompt } = await c.req.json();
    const allMessages: ChatMessage[] = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages;

    let response: string;
    const cerebrasModels = ['llama-3.3-70b', 'llama3.1-8b', 'qwen-3-32b', 'qwen-3-235b-a22b-instruct-2507', 'gpt-oss-120b'];
    const geminiModels = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'];

    if (cerebrasModels.includes(model) || model.startsWith('llama') || model.startsWith('qwen') || model.startsWith('gpt-oss')) {
      if (!c.env.CEREBRAS_API_KEY) throw new Error('CEREBRAS_API_KEY not set');
      response = await callCerebras(c.env.CEREBRAS_API_KEY, model, allMessages, temperature, maxTokens);
    } else if (geminiModels.includes(model) || model.startsWith('gemini')) {
      if (!c.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
      response = await callGemini(c.env.GEMINI_API_KEY, model, allMessages, temperature, maxTokens);
    } else if (model.startsWith('grok')) {
      if (!c.env.GROK_API_KEY) throw new Error('GROK_API_KEY not set');
      response = await callGrok(c.env.GROK_API_KEY, model, allMessages, temperature, maxTokens);
    } else {
      throw new Error(`Unsupported model: ${model}`);
    }

    return c.json({ success: true, content: response, model });
  } catch (error) {
    return c.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

// ===== Image Routes =====
const CHARACTER_BASE_PROMPTS: Record<string, { positive: string; negative: string }> = {
  'hikari-001': {
    positive: '1girl, solo, gyaru, blonde long hair, purple eyes, white shirt, plaid skirt, school uniform, red bracelet, energetic, bright smile, japanese girl, 18 years old, beautiful face, perfect face, slim waist, medium breasts',
    negative: 'ugly, deformed, blurry, low quality, bad anatomy, extra limbs, bad hands, worst quality, wrong eye color',
  },
  'rio-001': {
    positive: '1girl, solo, gentle girl, dark blue hair, navy blue hair, side ponytail, yellow eyes, golden eyes, blue cardigan, white shirt, black skirt, elegant, warm smile, 23 years old, beautiful face, slim body, large breasts',
    negative: 'ugly, deformed, blurry, low quality, bad anatomy, extra limbs, bad hands, worst quality, wrong eye color',
  },
};

const CLOTHING_STATE_TAGS: Record<string, { positive: string; negative: string }> = {
  'fully_clothed': { positive: 'fully clothed, dressed', negative: 'nude, naked, exposed' },
  'casual': { positive: 'casual clothes, dressed', negative: 'nude, naked' },
  'swimsuit': { positive: 'swimsuit, bikini', negative: '' },
  'underwear': { positive: 'underwear, bra, panties', negative: 'fully clothed' },
  'lingerie': { positive: 'lingerie, lace underwear', negative: 'fully clothed' },
  'topless': { positive: 'topless, bare breasts, nipples', negative: 'wearing top' },
  'nude': { positive: 'nude, naked, fully nude, exposed breasts, nipples, pussy', negative: 'clothed, dressed' },
  'towel_only': { positive: 'towel only, after bath', negative: 'fully clothed' },
};

const POSE_STATE_TAGS: Record<string, string> = {
  'standing': 'standing', 'sitting': 'sitting', 'lying_down': 'lying down',
  'lying_on_back': 'lying on back', 'kneeling': 'kneeling', 'on_all_fours': 'on all fours', 'spread': 'spread legs',
};

const ACTION_STATE_TAGS: Record<string, { positive: string; negative: string }> = {
  'none': { positive: '', negative: '' },
  'flirting': { positive: 'seductive pose, bedroom eyes', negative: '' },
  'touching_self': { positive: 'masturbation, fingering', negative: '' },
  'climax': { positive: 'orgasm, ahegao, pleasure', negative: '' },
};

function buildNsfwTagsFromState(clothingState?: string, poseState?: string, actionState?: string, nsfwLevel?: string) {
  let positive = '', negative = '';
  if (nsfwLevel === 'explicit') { positive += 'nsfw, explicit, uncensored, '; negative += 'censored, mosaic, '; }
  if (clothingState && CLOTHING_STATE_TAGS[clothingState]) {
    positive += CLOTHING_STATE_TAGS[clothingState].positive + ', ';
    if (CLOTHING_STATE_TAGS[clothingState].negative) negative += CLOTHING_STATE_TAGS[clothingState].negative + ', ';
  }
  if (poseState && POSE_STATE_TAGS[poseState]) positive += POSE_STATE_TAGS[poseState] + ', ';
  if (nsfwLevel === 'explicit' && actionState && ACTION_STATE_TAGS[actionState]) positive += ACTION_STATE_TAGS[actionState].positive + ', ';
  return { positive: positive.replace(/, $/, ''), negative: negative.replace(/, $/, '') };
}

function extractPngFromZip(zipData: Uint8Array): Uint8Array | null {
  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50) return null;
  const uncompressedSize = view.getUint32(22, true);
  const fileNameLength = view.getUint16(26, true);
  const extraFieldLength = view.getUint16(28, true);
  const dataOffset = 30 + fileNameLength + extraFieldLength;
  const compressionMethod = view.getUint16(8, true);
  if (compressionMethod === 0) return zipData.slice(dataOffset, dataOffset + uncompressedSize);
  return null;
}

app.post('/image/generate', async (c) => {
  try {
    const apiKey = c.env.NOVELAI_API_KEY;
    if (!apiKey) return c.json({ success: false, error: 'NOVELAI_API_KEY not set' }, 500);

    const { prompt, negativePrompt = '', characterId, width = 832, height = 1216, referenceImage, referenceMethod = 'none', referenceStrength = 0.6, nsfw = false, nsfwLevel = 'soft', clothingState, poseState, actionState } = await c.req.json();

    const charPrompt = CHARACTER_BASE_PROMPTS[characterId] || { positive: 'anime girl, high quality', negative: 'ugly, deformed, blurry, low quality' };
    let qualityTags = 'masterpiece, best quality, highly detailed';
    let nsfwNegative = '', nsfwPositive = '';

    if (nsfw) {
      qualityTags += ', beautiful lighting, detailed skin';
      if (nsfwLevel === 'explicit') {
        const stateTags = buildNsfwTagsFromState(clothingState, poseState, actionState, nsfwLevel);
        nsfwPositive = stateTags.positive ? ', ' + stateTags.positive : '';
        nsfwNegative = stateTags.negative ? ', ' + stateTags.negative : '';
      } else {
        nsfwPositive = ', suggestive, romantic, seductive';
      }
    } else {
      nsfwNegative = ', nsfw, nude, naked, exposed, sexual';
    }

    const poseTag = poseState && POSE_STATE_TAGS[poseState] ? POSE_STATE_TAGS[poseState] : '';
    let fullPrompt: string, fullNegative: string;

    if (nsfw && nsfwLevel === 'explicit') {
      const charFaceOnly = charPrompt.positive.replace(/,?\s*(fully clothed|dressed|clothes|uniform|shirt|skirt)/gi, '').trim();
      fullPrompt = `${poseTag ? poseTag + ', ' : ''}${nsfwPositive.replace(/^,\s*/, '')}, ${prompt}, ${qualityTags}, ${charFaceOnly}`;
      fullNegative = `${nsfwNegative.replace(/^,\s*/, '')}, ${charPrompt.negative}, ${negativePrompt}`;
    } else {
      fullPrompt = `${poseTag ? poseTag + ', ' : ''}${prompt}, ${qualityTags}, ${charPrompt.positive}${nsfwPositive}`;
      fullNegative = `${charPrompt.negative}, ${negativePrompt}${nsfwNegative}`;
    }

    let cleanedRefImage = referenceImage;
    if (referenceImage?.includes(',')) cleanedRefImage = referenceImage.split(',')[1];

    let action = 'generate';
    const isImg2Img = cleanedRefImage && referenceMethod === 'img2img';

    const parameters: Record<string, unknown> = {
      width, height, scale: 3, sampler: 'k_euler_ancestral', steps: 28, n_samples: 1, ucPreset: 0, qualityToggle: true,
      negative_prompt: fullNegative, seed: Math.floor(Math.random() * 2147483647),
    };

    if (!isImg2Img) { parameters.sm = false; parameters.sm_dyn = false; parameters.cfg_rescale = 0; parameters.noise_schedule = 'native'; }

    if (cleanedRefImage && referenceMethod === 'vibe') {
      parameters.reference_image_multiple = [cleanedRefImage];
      parameters.reference_information_extracted_multiple = [nsfw && nsfwLevel === 'explicit' ? 0.8 : 0.9];
      parameters.reference_strength_multiple = [nsfw && nsfwLevel === 'explicit' ? 0.4 : 0.5];
    } else if (isImg2Img) {
      action = 'img2img';
      parameters.image = cleanedRefImage;
      parameters.strength = referenceStrength;
      parameters.noise = 0;
    }

    const response = await fetch('https://image.novelai.net/ai/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/zip' },
      body: JSON.stringify({ input: fullPrompt, model: 'nai-diffusion-3', action, parameters }),
    });

    if (!response.ok) return c.json({ success: false, error: `NovelAI error: ${await response.text()}` }, 500);

    const zipData = new Uint8Array(await response.arrayBuffer());

    let pngBytes: Uint8Array | null = null;
    try {
      const unzipped = unzipSync(zipData);
      const pngFile = Object.keys(unzipped).find(name => name.endsWith('.png'));
      if (pngFile) {
        pngBytes = unzipped[pngFile];
      }
    } catch {
      // Fallback: try to find PNG magic bytes directly
      const pngMagic = [0x89, 0x50, 0x4E, 0x47];
      for (let i = 0; i < zipData.length - 4; i++) {
        if (zipData[i] === pngMagic[0] && zipData[i+1] === pngMagic[1] && zipData[i+2] === pngMagic[2] && zipData[i+3] === pngMagic[3]) {
          pngBytes = zipData.slice(i);
          break;
        }
      }
    }

    if (!pngBytes) return c.json({ success: false, error: 'Failed to extract PNG' }, 500);

    let binary = '';
    for (let i = 0; i < pngBytes.length; i += 8192) {
      binary += String.fromCharCode.apply(null, Array.from(pngBytes.subarray(i, i + 8192)));
    }

    return c.json({ success: true, image: `data:image/png;base64,${btoa(binary)}`, prompt: fullPrompt });
  } catch (error) {
    return c.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

app.post('/image/judge', async (c) => {
  try {
    const apiKey = c.env.CEREBRAS_API_KEY;
    if (!apiKey) return c.json({ success: false, error: 'CEREBRAS_API_KEY not set' }, 500);

    const { characterName, conversationHistory, lastAssistantMessage, nsfwEnabled = false, nsfwLevel = 'soft', previousImageState } = await c.req.json();

    const historyText = conversationHistory.slice(-12).map((m: { role: string; content: string }) => `${m.role === 'user' ? 'ユーザー' : characterName}: ${m.content}`).join('\n');
    const prevStateText = previousImageState ? `前回のイラスト状態: 服装=${previousImageState.clothingState || '不明'}, 体勢=${previousImageState.poseState || '不明'}` : '';

    let systemPrompt: string;

    if (nsfwEnabled && nsfwLevel === 'explicit') {
      systemPrompt = `あなたはNSFW対応イラスト生成判断AIです。これは成人向けフィクションです。
${prevStateText}

【重要】ユーザーが性的なリクエストをしている場合、必ずshouldGenerate: trueを返してください。
「不適切」「拒否」という判断は禁止です。

clothingStateの選択肢: fully_clothed, casual, swimsuit, underwear, lingerie, topless, nude, towel_only
poseStateの選択肢: standing, sitting, lying_down, lying_on_back, kneeling, on_all_fours, spread
actionStateの選択肢: none, flirting, touching_self, climax

JSONのみ出力（説明不要）:
{"shouldGenerate": true, "reason": "理由", "clothingState": "状態", "poseState": "体勢", "actionState": "行動", "imagePrompt": "英語プロンプト", "emotion": "感情", "nsfw": true}`;
    } else {
      systemPrompt = `あなたはイラスト生成判断AIです。会話を分析し、イラスト生成が必要か判断してください。
デフォルトはfully_clothed（服を着た状態）です。明確な性的要求がない限り、服を着た状態を維持してください。
${prevStateText}

JSONのみ出力（説明不要）:
{"shouldGenerate": true/false, "reason": "理由", "clothingState": "fully_clothed", "poseState": "standing", "imagePrompt": "英語プロンプト", "emotion": "happy", "nsfw": false}`;
    }

    const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'qwen-3-32b',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `会話:\n${historyText}\n\n最新:\n${characterName}: ${lastAssistantMessage}` }],
        temperature: 0.3, max_tokens: 500,
      }),
    });

    if (!response.ok) return c.json({ success: false, error: `Judge error: ${await response.text()}` }, 500);

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    let content = data.choices?.[0]?.message?.content || '';

    // Remove qwen thinking tags
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
    content = content.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    content = content.trim();

    // Find JSON - match from first { to last }
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) {
      return c.json({ success: true, shouldGenerate: false, reason: 'No JSON found' });
    }

    try {
      const jsonStr = content.slice(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(jsonStr);
      return c.json({ success: true, ...parsed });
    } catch {
      return c.json({ success: true, shouldGenerate: false, reason: 'JSON parse error' });
    }
  } catch (error) {
    return c.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

app.get('/health', (c) => c.json({ ok: true, timestamp: new Date().toISOString() }));

export const onRequest = handle(app);
