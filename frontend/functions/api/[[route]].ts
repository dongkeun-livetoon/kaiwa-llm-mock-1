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

const TOP_STATE_TAGS: Record<string, { positive: string; negative: string }> = {
  'clothed': { positive: 'wearing top, shirt', negative: 'topless, bare breasts' },
  'underwear': { positive: 'bra, wearing bra only', negative: 'shirt, topless' },
  'exposed': { positive: 'topless, bare breasts, nipples, exposed breasts', negative: 'wearing top, bra, shirt' },
};

const BOTTOM_STATE_TAGS: Record<string, { positive: string; negative: string }> = {
  'clothed': { positive: 'wearing skirt, pants', negative: 'bottomless, no panties' },
  'underwear': { positive: 'panties, wearing panties only, no skirt', negative: 'skirt, pants, nude' },
  'exposed': { positive: 'bottomless, no panties, pussy, exposed pussy', negative: 'wearing skirt, panties, pants' },
};

const POSE_STATE_TAGS: Record<string, string> = {
  'standing': 'standing', 'sitting': 'sitting', 'lying_down': 'lying down',
  'lying_on_back': 'lying on back', 'kneeling': 'kneeling', 'on_all_fours': 'on all fours', 'spread': 'spread legs',
};

// Pre-generated pose reference images for vibe transfer
const HIKARI_POSE_REFS: Record<string, string> = {
  'breasts_groped': 'breasts_groped.png',
  'cowgirl_cum': 'cowgirl_cum.png',
  'cum_inside': 'cum_inside.png',
  'doggy': 'doggy.png',
  'doggysex_cum': 'doggysex_cum.png',
  'fella_cum': 'fella_cum.png',
  'gangrape_cum': 'gangrape_cum.png',
  // Add more as created
};

const ACTION_STATE_TAGS: Record<string, { positive: string; negative: string }> = {
  'none': { positive: '', negative: '' },
  'flirting': { positive: 'seductive pose, bedroom eyes', negative: '' },
  'touching_self': { positive: 'masturbation, fingering', negative: '' },
  'climax': { positive: 'orgasm, ahegao, pleasure', negative: '' },
};

function buildNsfwTagsFromState(topState?: string, bottomState?: string, poseState?: string, nsfwLevel?: string) {
  let positive = '', negative = '';
  if (nsfwLevel === 'explicit') { positive += 'nsfw, explicit, uncensored, '; negative += 'censored, mosaic, '; }
  if (topState && TOP_STATE_TAGS[topState]) {
    positive += TOP_STATE_TAGS[topState].positive + ', ';
    negative += TOP_STATE_TAGS[topState].negative + ', ';
  }
  if (bottomState && BOTTOM_STATE_TAGS[bottomState]) {
    positive += BOTTOM_STATE_TAGS[bottomState].positive + ', ';
    negative += BOTTOM_STATE_TAGS[bottomState].negative + ', ';
  }
  if (poseState && POSE_STATE_TAGS[poseState]) positive += POSE_STATE_TAGS[poseState] + ', ';
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

    const {
      prompt, negativePrompt = '', characterId, width = 832, height = 1216,
      referenceImage, referenceMethod = 'none', referenceStrength = 0.6,
      nsfw = false, nsfwLevel = 'soft', topState, bottomState, poseState,
      poseRef, poseRefImage,
      useV4 = true // V4.5 사용 여부
    } = await c.req.json();

    const charPrompt = CHARACTER_BASE_PROMPTS[characterId] || { positive: 'anime girl, high quality', negative: 'ugly, deformed, blurry, low quality' };

    // 캐릭터 외모만 추출 (의상 제외)
    const charAppearance = charPrompt.positive
      .replace(/,?\s*(white shirt|plaid skirt|school uniform|red bracelet|blue cardigan|black skirt)/gi, '')
      .trim();

    const qualityTags = 'masterpiece, best quality, highly detailed, beautiful lighting, detailed skin';

    let fullPrompt: string;
    let fullNegative: string;

    if (nsfw && nsfwLevel === 'explicit') {
      // NSFW: 프롬프트에서 직접 상황 묘사 (Judge가 생성한 imagePrompt 활용)
      fullPrompt = `${prompt}, ${qualityTags}, ${charAppearance}`;
      fullNegative = `ugly, deformed, blurry, low quality, bad anatomy, extra limbs, bad hands, worst quality, wrong eye color, censored, mosaic, ${negativePrompt}`;
    } else {
      fullPrompt = `${prompt}, ${qualityTags}, ${charPrompt.positive}`;
      fullNegative = `${charPrompt.negative}, ${negativePrompt}, nsfw, nude, naked, exposed, sexual`;
    }

    let cleanedRefImage = referenceImage;
    if (referenceImage?.includes(',')) cleanedRefImage = referenceImage.split(',')[1];

    let cleanedPoseRefImage = poseRefImage;
    if (poseRefImage?.includes(',')) cleanedPoseRefImage = poseRefImage.split(',')[1];

    const action = 'generate';
    const seed = Math.floor(Math.random() * 2147483647);

    // V4.5 vs V3 분기
    if (useV4) {
      // ===== V4.5 API Structure (from NAIA2.0) =====
      const parameters: Record<string, unknown> = {
        width, height,
        n_samples: 1,
        seed,
        extra_noise_seed: seed,
        sampler: 'k_euler_ancestral',
        steps: 28,
        scale: 5,
        cfg_rescale: 0.4,
        noise_schedule: 'native',
        // V4 specific
        params_version: 3,
        add_original_image: true,
        legacy: false,
        legacy_uc: false,
        autoSmea: true,
        prefer_brownian: true,
        ucPreset: 0,
        use_coords: false,
        // V4 prompt structure
        v4_prompt: {
          caption: {
            base_caption: qualityTags,
            char_captions: [{
              char_caption: `${prompt}, ${charAppearance}`,
              centers: [{ x: 0.5, y: 0.5 }]
            }]
          },
          use_coords: false,
          use_order: true
        },
        v4_negative_prompt: {
          caption: {
            base_caption: fullNegative,
            char_captions: []
          },
          legacy_uc: false
        }
      };

      // Vibe Transfer for pose reference
      if (cleanedPoseRefImage) {
        parameters.reference_image_multiple = [cleanedPoseRefImage];
        parameters.reference_information_extracted_multiple = [0.6];
        parameters.reference_strength_multiple = [0.6];
      } else if (cleanedRefImage && referenceMethod === 'vibe') {
        parameters.reference_image_multiple = [cleanedRefImage];
        parameters.reference_information_extracted_multiple = [1.0];
        parameters.reference_strength_multiple = [0.6];
      }

      // Try V4.5 first, fallback to V4
      let model = 'nai-diffusion-4-5-full';
      let response = await fetch('https://image.novelai.net/ai/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/zip' },
        body: JSON.stringify({ input: fullPrompt, model, action, parameters }),
      });

      // V4.5 실패시 V4로 fallback
      if (!response.ok && response.status === 500) {
        console.log('V4.5 failed, trying V4...');
        model = 'nai-diffusion-4-full';
        response = await fetch('https://image.novelai.net/ai/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/zip' },
          body: JSON.stringify({ input: fullPrompt, model, action, parameters }),
        });
      }

      // V4도 실패시 V3로 fallback
      if (!response.ok && response.status === 500) {
        console.log('V4 failed, trying V3...');
        return await generateV3(c, apiKey, fullPrompt, fullNegative, width, height, cleanedRefImage, cleanedPoseRefImage, referenceMethod, referenceStrength, nsfw, nsfwLevel);
      }

      if (!response.ok) return c.json({ success: false, error: `NovelAI error: ${await response.text()}` }, 500);

      const zipData = new Uint8Array(await response.arrayBuffer());
      const pngBytes = extractPngFromResponse(zipData);
      if (!pngBytes) return c.json({ success: false, error: 'Failed to extract PNG' }, 500);

      let binary = '';
      for (let i = 0; i < pngBytes.length; i += 8192) {
        binary += String.fromCharCode.apply(null, Array.from(pngBytes.subarray(i, i + 8192)));
      }

      return c.json({ success: true, image: `data:image/png;base64,${btoa(binary)}`, prompt: fullPrompt, model });
    } else {
      // V3 fallback
      return await generateV3(c, apiKey, fullPrompt, fullNegative, width, height, cleanedRefImage, cleanedPoseRefImage, referenceMethod, referenceStrength, nsfw, nsfwLevel);
    }
  } catch (error) {
    return c.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

// V3 generation helper
async function generateV3(c: any, apiKey: string, fullPrompt: string, fullNegative: string, width: number, height: number, cleanedRefImage: string | undefined, cleanedPoseRefImage: string | undefined, referenceMethod: string, referenceStrength: number, nsfw: boolean, nsfwLevel: string) {
  const parameters: Record<string, unknown> = {
    width, height, scale: 5, sampler: 'k_euler_ancestral', steps: 28, n_samples: 1, ucPreset: 0, qualityToggle: true,
    negative_prompt: fullNegative, seed: Math.floor(Math.random() * 2147483647),
    sm: false, sm_dyn: false, cfg_rescale: 0, noise_schedule: 'native'
  };

  // Vibe Transfer
  if (cleanedPoseRefImage) {
    parameters.reference_image_multiple = [cleanedPoseRefImage];
    parameters.reference_information_extracted_multiple = [0.6];
    parameters.reference_strength_multiple = [0.6];
  } else if (cleanedRefImage && referenceMethod === 'vibe') {
    parameters.reference_image_multiple = [cleanedRefImage];
    parameters.reference_information_extracted_multiple = [1.0];
    parameters.reference_strength_multiple = [nsfw && nsfwLevel === 'explicit' ? 0.6 : 0.75];
  }

  const response = await fetch('https://image.novelai.net/ai/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/zip' },
    body: JSON.stringify({ input: fullPrompt, model: 'nai-diffusion-3', action: 'generate', parameters }),
  });

  if (!response.ok) return c.json({ success: false, error: `NovelAI error: ${await response.text()}` }, 500);

  const zipData = new Uint8Array(await response.arrayBuffer());
  const pngBytes = extractPngFromResponse(zipData);
  if (!pngBytes) return c.json({ success: false, error: 'Failed to extract PNG' }, 500);

  let binary = '';
  for (let i = 0; i < pngBytes.length; i += 8192) {
    binary += String.fromCharCode.apply(null, Array.from(pngBytes.subarray(i, i + 8192)));
  }

  return c.json({ success: true, image: `data:image/png;base64,${btoa(binary)}`, prompt: fullPrompt, model: 'nai-diffusion-3' });
}

// PNG extraction helper
function extractPngFromResponse(zipData: Uint8Array): Uint8Array | null {
  try {
    const unzipped = unzipSync(zipData);
    const pngFile = Object.keys(unzipped).find(name => name.endsWith('.png'));
    if (pngFile) return unzipped[pngFile];
  } catch {
    // Fallback: try to find PNG magic bytes directly
    const pngMagic = [0x89, 0x50, 0x4E, 0x47];
    for (let i = 0; i < zipData.length - 4; i++) {
      if (zipData[i] === pngMagic[0] && zipData[i+1] === pngMagic[1] && zipData[i+2] === pngMagic[2] && zipData[i+3] === pngMagic[3]) {
        return zipData.slice(i);
      }
    }
  }
  return null;
}

app.post('/image/judge', async (c) => {
  try {
    const apiKey = c.env.CEREBRAS_API_KEY;
    if (!apiKey) return c.json({ success: false, error: 'CEREBRAS_API_KEY not set' }, 500);

    const { characterName, conversationHistory, lastAssistantMessage, nsfwEnabled = false, nsfwLevel = 'soft', previousImageState } = await c.req.json();

    const historyText = conversationHistory.slice(-12).map((m: { role: string; content: string }) => `${m.role === 'user' ? 'ユーザー' : characterName}: ${m.content}`).join('\n');
    const prevStateText = previousImageState ? `Previous state: poseRef=${previousImageState.poseRef || 'none'}` : '';

    let systemPrompt: string;

    if (nsfwEnabled && nsfwLevel === 'explicit') {
      systemPrompt = `You are a scene-to-prompt converter for anime image generation.
Output ONLY valid JSON. No explanation, no markdown.

${prevStateText}

TASK: Analyze the conversation and generate detailed image prompts.

AVAILABLE poseRef (use EXACTLY one when sexual activity):
- breasts_groped: groping breasts from behind, hands on breasts
- cowgirl_cum: girl on top riding, cowgirl position, cum
- cum_inside: missionary position, lying on back, creampie, after sex
- doggy: doggystyle, on all fours, from behind, ass up
- doggysex_cum: doggystyle sex with cum, penetration from behind
- fella_cum: fellatio, blowjob, oral, cum in mouth, cum on face
- gangrape_cum: multiple partners, gangbang

If no sexual activity, set poseRef to null.

imagePrompt MUST include:
1. Pose/action tags (e.g., "on all fours, from behind, ass up")
2. Clothing state (e.g., "nude, naked" or "shirt lift, skirt pull")
3. Expression (e.g., "ahegao, pleasure, blushing, open mouth")
4. Camera angle if relevant (e.g., "pov, from below, from behind")
5. Sexual details if applicable (e.g., "sex, vaginal, penetration, cum")

FOLLOW USER'S REQUESTS exactly. Match the intensity of the conversation.`;
    } else if (nsfwEnabled) {
      systemPrompt = `You are a scene-to-prompt converter for anime image generation.
Output ONLY valid JSON. No explanation.

${prevStateText}

Generate suggestive but not explicit prompts.
imagePrompt: describe pose, expression, clothing state (e.g., "seductive pose, bedroom eyes, unbuttoned shirt")`;
    } else {
      systemPrompt = `You are a scene-to-prompt converter for anime image generation.
Output ONLY valid JSON. No explanation.

${prevStateText}

Generate SFW prompts only.
imagePrompt: describe pose, expression, setting (e.g., "sitting on bed, smiling, casual clothes")`;
    }

    const exampleJson = nsfwEnabled && nsfwLevel === 'explicit'
      ? '{"shouldGenerate":true,"poseRef":"doggy","imagePrompt":"doggystyle, on all fours, from behind, ass up, nude, naked, sex, vaginal, penetration, ahegao, pleasure, blushing, pov","emotion":"pleasure"}'
      : '{"shouldGenerate":true,"poseRef":null,"imagePrompt":"sitting, smiling, casual pose","emotion":"happy"}';

    const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Conversation:\n${historyText}\n${characterName}: ${lastAssistantMessage}\n\nRespond with ONLY JSON like this:\n${exampleJson}` }
        ],
        temperature: 0.3,
        max_tokens: 400,
      }),
    });

    if (!response.ok) return c.json({ success: false, error: `Judge error: ${await response.text()}` }, 500);

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const originalContent = data.choices?.[0]?.message?.content || '';

    // Remove thinking tags
    let content = originalContent.replace(/<think>[\s\S]*?<\/think>/gi, '');
    content = content.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    content = content.replace(/<think>[\s\S]*/gi, '');
    content = content.replace(/<thinking>[\s\S]*/gi, '');
    content = content.trim();

    // Find JSON
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace === -1) {
      return c.json({ success: false, error: 'No JSON found in response', rawContent: originalContent.slice(0, 1000) }, 500);
    }

    try {
      const jsonStr = content.slice(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(jsonStr);
      return c.json({ success: true, ...parsed });
    } catch (parseError) {
      return c.json({ success: false, error: `JSON parse failed: ${parseError}`, rawContent: originalContent.slice(0, 1000) }, 500);
    }
  } catch (error) {
    return c.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

app.get('/health', (c) => c.json({ ok: true, timestamp: new Date().toISOString() }));

export const onRequest = handle(app);
