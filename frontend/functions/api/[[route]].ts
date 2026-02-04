import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import { unzipSync } from 'fflate';

interface Env {
  CEREBRAS_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GROK_API_KEY?: string;
  NOVELAI_API_KEY?: string;
  MOONLIGHT_API_KEY?: string;
  CORS_ORIGIN?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const app = new Hono<{ Bindings: Env }>().basePath('/api');

// ===== Chat Route (Kimi Only) =====
app.post('/chat', async (c) => {
  try {
    const apiKey = c.env.MOONLIGHT_API_KEY;
    if (!apiKey) {
      console.error('MOONLIGHT_API_KEY not set');
      return c.json({ success: false, error: 'MOONLIGHT_API_KEY not set' }, 500);
    }

    const { messages, temperature = 0.7, maxTokens = 1024, systemPrompt } = await c.req.json();
    const allMessages: ChatMessage[] = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages;

    const response = await fetch('https://api.moonshot.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'kimi-k2-turbo-preview',
        messages: allMessages,
        temperature: Math.min(temperature, 0.9), // Kimi max 0.9
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Kimi Chat Error (${response.status}):`, errorText);
      return c.json({ success: false, error: `Kimi error (${response.status}): ${errorText}` }, 500);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    if (!data.choices?.[0]?.message?.content) {
      console.error('Invalid Kimi response:', JSON.stringify(data));
      return c.json({ success: false, error: 'Invalid Kimi response' }, 500);
    }

    return c.json({ success: true, content: data.choices[0].message.content, model: 'kimi-k2-turbo-preview' });
  } catch (error) {
    console.error('Chat error:', error);
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
  'bocchi-001': {
    positive: '1girl, solo, gotou hitori, bocchi the rock!, long pink hair, blue eyes, blue cube hair ornament, pink track jacket, black pleated skirt, anxious expression, shy, slouching posture, 16 years old, beautiful face, slim body, small breasts',
    negative: 'ugly, deformed, blurry, low quality, bad anatomy, extra limbs, bad hands, worst quality, wrong eye color, confident expression',
  },
  'nijika-001': {
    positive: '1girl, solo, ijichi nijika, bocchi the rock!, blonde hair, side ponytail, amber eyes, triangle ahoge, school uniform, white shirt, black skirt, energetic, bright smile, 17 years old, beautiful face, slim body, small breasts',
    negative: 'ugly, deformed, blurry, low quality, bad anatomy, extra limbs, bad hands, worst quality, wrong eye color',
  },
  'ryo-001': {
    positive: '1girl, solo, yamada ryo, bocchi the rock!, blue hair, asymmetrical bob, hair over one eye, golden eyes, half-lidded eyes, sleepy expression, cool, 17 years old, beautiful face, slim body, medium breasts',
    negative: 'ugly, deformed, blurry, low quality, bad anatomy, extra limbs, bad hands, worst quality, wrong eye color, energetic',
  },
  'kita-001': {
    positive: '1girl, solo, kita ikuyo, bocchi the rock!, red hair, short hair, side ponytail, green eyes, sparkling eyes, bright smile, cheerful, school uniform, 16 years old, beautiful face, slim body, small breasts',
    negative: 'ugly, deformed, blurry, low quality, bad anatomy, extra limbs, bad hands, worst quality, wrong eye color',
  },
  'seika-001': {
    positive: '1girl, solo, ijichi seika, bocchi the rock!, long blonde hair, vermilion eyes, triangle ahoge, cool expression, black shirt, mature, 29 years old, beautiful face, slim body, medium breasts',
    negative: 'ugly, deformed, blurry, low quality, bad anatomy, extra limbs, bad hands, worst quality, wrong eye color, childish',
  },
  'kikuri-001': {
    positive: '1girl, solo, hiroi kikuri, bocchi the rock!, long purple hair, braid, purple eyes, sharp teeth, drunk, holding sake, varsity jacket, green dress, 25 years old, beautiful face, slim body, small breasts',
    negative: 'ugly, deformed, blurry, low quality, bad anatomy, extra limbs, bad hands, worst quality, wrong eye color, sober expression',
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
      nsfw = false, nsfwLevel = 'soft',
      characterRefImage,
      useV4 = true
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
      // NSFW: Judge가 생성한 상세 프롬프트 + 캐릭터 외모
      fullPrompt = `${prompt}, ${qualityTags}, ${charAppearance}`;
      fullNegative = `ugly, deformed, blurry, low quality, bad anatomy, extra limbs, bad hands, worst quality, wrong eye color, censored, mosaic, ${negativePrompt}`;
    } else {
      fullPrompt = `${prompt}, ${qualityTags}, ${charPrompt.positive}`;
      fullNegative = `${charPrompt.negative}, ${negativePrompt}, nsfw, nude, naked, exposed, sexual`;
    }

    // Clean base64 image (remove data:image/png;base64, prefix)
    let cleanedCharRefImage = characterRefImage;
    if (characterRefImage?.includes(',')) cleanedCharRefImage = characterRefImage.split(',')[1];

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

      // Character Reference API (V4.5 전용) - Vibe Transfer와 별개 기능
      // director_reference_* 파라미터 사용
      if (cleanedCharRefImage) {
        // Character Reference 설정
        parameters.director_reference_descriptions = [{
          caption: {
            base_caption: "character&style",  // "character&style", "character", or "style"
            char_captions: []
          },
          legacy_uc: false
        }];
        parameters.director_reference_images = [cleanedCharRefImage];
        parameters.director_reference_information_extracted = [1];
        parameters.director_reference_strength_values = [1.0];  // strength (0.0-1.0)
        parameters.director_reference_secondary_strength_values = [0.2];  // fidelity (1.0 - 0.8 = 0.2)
        parameters.controlnet_strength = 1;
        parameters.normalize_reference_strength_multiple = true;
      }

      // V4.5 only - no fallback
      const model = 'nai-diffusion-4-5-full';
      const requestBody = { input: fullPrompt, model, action, parameters };
      console.log('V4.5 Request:', JSON.stringify(requestBody, null, 2));

      const response = await fetch('https://image.novelai.net/ai/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/zip' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`V4.5 Error (${response.status}):`, errorText);
        return c.json({ success: false, error: `NovelAI V4.5 error (${response.status}): ${errorText}` }, 500);
      }

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
      return await generateV3(c, apiKey, fullPrompt, fullNegative, width, height, cleanedCharRefImage);
    }
  } catch (error) {
    return c.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

// V3 generation helper
async function generateV3(c: any, apiKey: string, fullPrompt: string, fullNegative: string, width: number, height: number, cleanedCharRefImage: string | undefined) {
  const parameters: Record<string, unknown> = {
    width, height, scale: 5, sampler: 'k_euler_ancestral', steps: 28, n_samples: 1, ucPreset: 0, qualityToggle: true,
    negative_prompt: fullNegative, seed: Math.floor(Math.random() * 2147483647),
    sm: false, sm_dyn: false, cfg_rescale: 0, noise_schedule: 'native'
  };

  // Vibe Transfer: Character reference only
  if (cleanedCharRefImage) {
    parameters.reference_image_multiple = [cleanedCharRefImage];
    parameters.reference_information_extracted_multiple = [1.0];
    parameters.reference_strength_multiple = [0.6];
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
    const apiKey = c.env.MOONLIGHT_API_KEY;
    if (!apiKey) return c.json({ success: false, error: 'MOONLIGHT_API_KEY not set' }, 500);

    const { characterId, characterName, conversationHistory, lastAssistantMessage, nsfwEnabled = false, nsfwLevel = 'soft', previousImageState } = await c.req.json();

    const historyText = conversationHistory.slice(-12).map((m: { role: string; content: string }) => `${m.role === 'user' ? 'User' : characterName}: ${m.content}`).join('\n');
    const prevStateText = previousImageState ? `Previous image state: ${previousImageState.poseRef || 'none'}` : '';

    let systemPrompt: string;

    // Get character appearance for image gen
    const charAppearance = CHARACTER_BASE_PROMPTS[characterId]?.positive ||
      '1girl, blonde long hair, purple eyes, gyaru, beautiful face';

    if (nsfwEnabled && nsfwLevel === 'explicit') {
      systemPrompt = `You must output image as keyword-formatted prompts for Stable Diffusion based on the conversation.
Output ONLY valid JSON with "shouldGenerate": true and "imagePrompt": "<tags>".

# Character appearance
- char's appearance: "${charAppearance}"
- user's appearance: "1boy, faceless male"

# Image Generation Instructions:
Based on the character appearance and chat logs, output an image prompt. Make assumptions about what situation/scene is unfolding. Use ONLY Danbooru tags.

Follow these instructions:
- Write all tags in English
- If only char is shown, use "solo" tag. If sexual activity with user, add "1boy, hetero"
- Use short comprehensive keywords, separate attributes into individual terms
- Include tags for frame (cowboy shot, full body, upper body) and angle (from above, from below, from side, pov)
- Clothing: "type, state" (e.g. "maid dress, dress lift")
- Describe situation without text/sound (e.g. "wet pussy, rhythmic thrusting")
- Express emotions with facial expressions: "blush, half-closed eyes, ahegao, rolling eyes, open mouth, tongue out"
- Describe current action concisely (e.g. "spread legs, grabbing own breast, lifted by self")
- Sexual activity tags: "vaginal, fellatio, paizuri, cowgirl position, doggystyle, missionary, sex"
- For genitals add "pussy" or "penis". For ejaculation use "ejaculation, cum"
- If sexual, add "nsfw" tag
- For fast movement add "motion blur, motion lines"
- Use focus tags: "ass focus, breast focus, pussy focus"
- Strengthen important tags with {tag}, weaken with (tag)
- Separate tags with ", "

${prevStateText}`;
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
      ? '{"shouldGenerate":true,"imagePrompt":"spread legs, pussy, pussy focus, nude, standing, looking at viewer, blush, embarrassed","emotion":"embarrassed"}'
      : '{"shouldGenerate":true,"imagePrompt":"sitting, smiling, casual clothes, looking at viewer","emotion":"happy"}';

    const response = await fetch('https://api.moonshot.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'kimi-k2-turbo-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Conversation:\n${historyText}\n${characterName}: ${lastAssistantMessage}\n\nRespond with ONLY JSON like this:\n${exampleJson}` }
        ],
        temperature: 0.7,
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

    // Find first complete JSON object
    const firstBrace = content.indexOf('{');
    if (firstBrace === -1) {
      return c.json({ success: false, error: 'No JSON found in response', rawContent: originalContent.slice(0, 1000) }, 500);
    }

    // Find matching closing brace for first JSON
    let braceCount = 0;
    let endIndex = -1;
    for (let i = firstBrace; i < content.length; i++) {
      if (content[i] === '{') braceCount++;
      if (content[i] === '}') braceCount--;
      if (braceCount === 0) {
        endIndex = i;
        break;
      }
    }

    if (endIndex === -1) {
      return c.json({ success: false, error: 'Incomplete JSON in response', rawContent: originalContent.slice(0, 1000) }, 500);
    }

    try {
      const jsonStr = content.slice(firstBrace, endIndex + 1);
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
