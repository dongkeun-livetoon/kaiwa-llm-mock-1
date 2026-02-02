import { Hono } from 'hono';
import type { Env } from '../types';

// Note: fflate needs to be added to package.json
// For now using pako or inline solution

interface ImageGenerateRequest {
  prompt: string;
  negativePrompt?: string;
  characterId: string;
  width?: number;
  height?: number;
  referenceImage?: string;
  referenceMethod?: 'none' | 'vibe' | 'img2img';
  referenceStrength?: number;
  nsfw?: boolean;
  nsfwLevel?: 'soft' | 'explicit';
  clothingState?: string;
  poseState?: string;
  actionState?: string;
}

interface JudgeRequest {
  characterId: string;
  characterName: string;
  conversationHistory: { role: string; content: string }[];
  lastAssistantMessage: string;
  nsfwEnabled?: boolean;
  nsfwLevel?: 'soft' | 'explicit';
  previousImageState?: {
    clothingState?: string;
    poseState?: string;
    locationState?: string;
    actionState?: string;
  };
}

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
  'standing': 'standing',
  'sitting': 'sitting',
  'lying_down': 'lying down',
  'lying_on_back': 'lying on back',
  'kneeling': 'kneeling',
  'on_all_fours': 'on all fours',
  'spread': 'spread legs',
};

const ACTION_STATE_TAGS: Record<string, { positive: string; negative: string }> = {
  'none': { positive: '', negative: '' },
  'flirting': { positive: 'seductive pose, bedroom eyes', negative: '' },
  'touching_self': { positive: 'masturbation, fingering', negative: '' },
  'climax': { positive: 'orgasm, ahegao, pleasure', negative: '' },
};

function buildNsfwTagsFromState(
  clothingState?: string,
  poseState?: string,
  actionState?: string,
  nsfwLevel?: string
): { positive: string; negative: string } {
  let positive = '';
  let negative = '';

  if (nsfwLevel === 'explicit') {
    positive += 'nsfw, explicit, uncensored, ';
    negative += 'censored, mosaic, ';
  }

  if (clothingState && CLOTHING_STATE_TAGS[clothingState]) {
    const tags = CLOTHING_STATE_TAGS[clothingState];
    positive += tags.positive + ', ';
    if (tags.negative) negative += tags.negative + ', ';
  }

  if (poseState && POSE_STATE_TAGS[poseState]) {
    positive += POSE_STATE_TAGS[poseState] + ', ';
  }

  if (nsfwLevel === 'explicit' && actionState && ACTION_STATE_TAGS[actionState]) {
    const tags = ACTION_STATE_TAGS[actionState];
    positive += tags.positive + ', ';
  }

  return {
    positive: positive.replace(/, $/, ''),
    negative: negative.replace(/, $/, ''),
  };
}

// Simple ZIP extraction for single PNG file (NovelAI returns simple ZIP)
function extractPngFromZip(zipData: Uint8Array): Uint8Array | null {
  // ZIP local file header signature: 0x04034b50
  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);

  if (view.getUint32(0, true) !== 0x04034b50) {
    return null;
  }

  const compressedSize = view.getUint32(18, true);
  const uncompressedSize = view.getUint32(22, true);
  const fileNameLength = view.getUint16(26, true);
  const extraFieldLength = view.getUint16(28, true);

  const dataOffset = 30 + fileNameLength + extraFieldLength;
  const compressionMethod = view.getUint16(8, true);

  if (compressionMethod === 0) {
    // No compression
    return zipData.slice(dataOffset, dataOffset + uncompressedSize);
  }

  // For DEFLATE (method 8), we'd need pako/fflate
  // NovelAI typically uses no compression for images
  console.log('ZIP uses compression method:', compressionMethod);
  return null;
}

export const imageRoute = new Hono<{ Bindings: Env }>();

// Image generation endpoint
imageRoute.post('/api/image/generate', async (c) => {
  try {
    const apiKey = c.env.NOVELAI_API_KEY;
    if (!apiKey) {
      return c.json({ success: false, error: 'NOVELAI_API_KEY is not set' }, 500);
    }

    const body: ImageGenerateRequest = await c.req.json();
    const {
      prompt,
      negativePrompt = '',
      characterId,
      width = 832,
      height = 1216,
      referenceImage,
      referenceMethod = 'none',
      referenceStrength = 0.6,
      nsfw = false,
      nsfwLevel = 'soft',
      clothingState,
      poseState,
      actionState,
    } = body;

    const charPrompt = CHARACTER_BASE_PROMPTS[characterId] || {
      positive: 'anime girl, high quality',
      negative: 'ugly, deformed, blurry, low quality',
    };

    let qualityTags = 'masterpiece, best quality, highly detailed';
    let nsfwNegative = '';
    let nsfwPositive = '';

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

    let fullPrompt: string;
    let fullNegative: string;

    if (nsfw && nsfwLevel === 'explicit') {
      const charFaceOnly = charPrompt.positive.replace(/,?\s*(fully clothed|dressed|clothes|uniform|shirt|skirt)/gi, '').trim();
      fullPrompt = `${poseTag ? poseTag + ', ' : ''}${nsfwPositive.replace(/^,\s*/, '')}, ${prompt}, ${qualityTags}, ${charFaceOnly}`;
      fullNegative = `${nsfwNegative.replace(/^,\s*/, '')}, ${charPrompt.negative}, ${negativePrompt}`;
    } else {
      fullPrompt = `${poseTag ? poseTag + ', ' : ''}${prompt}, ${qualityTags}, ${charPrompt.positive}${nsfwPositive}`;
      fullNegative = `${charPrompt.negative}, ${negativePrompt}${nsfwNegative}`;
    }

    let cleanedRefImage = referenceImage;
    if (referenceImage && referenceImage.includes(',')) {
      cleanedRefImage = referenceImage.split(',')[1];
    }

    let action = 'generate';
    const isImg2Img = cleanedRefImage && referenceMethod === 'img2img';

    const parameters: Record<string, unknown> = {
      width,
      height,
      scale: 3,
      sampler: 'k_euler_ancestral',
      steps: 28,
      n_samples: 1,
      ucPreset: 0,
      qualityToggle: true,
      negative_prompt: fullNegative,
      seed: Math.floor(Math.random() * 2147483647),
    };

    if (!isImg2Img) {
      parameters.sm = false;
      parameters.sm_dyn = false;
      parameters.cfg_rescale = 0;
      parameters.noise_schedule = 'native';
    }

    if (cleanedRefImage && referenceMethod === 'vibe') {
      parameters.reference_image_multiple = [cleanedRefImage];
      if (nsfw && nsfwLevel === 'explicit') {
        parameters.reference_information_extracted_multiple = [0.8];
        parameters.reference_strength_multiple = [0.4];
      } else {
        parameters.reference_information_extracted_multiple = [0.9];
        parameters.reference_strength_multiple = [0.5];
      }
    } else if (isImg2Img) {
      action = 'img2img';
      parameters.image = cleanedRefImage;
      parameters.strength = referenceStrength;
      parameters.noise = 0;
    }

    const response = await fetch('https://image.novelai.net/ai/generate-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/zip',
      },
      body: JSON.stringify({
        input: fullPrompt,
        model: 'nai-diffusion-3',
        action,
        parameters,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return c.json({ success: false, error: `NovelAI API error: ${error}` }, response.status as 400 | 500);
    }

    const zipBuffer = await response.arrayBuffer();
    const zipData = new Uint8Array(zipBuffer);

    // Try simple extraction first
    let pngBytes = extractPngFromZip(zipData);

    if (!pngBytes) {
      // Fallback: try to find PNG magic bytes directly
      const pngMagic = [0x89, 0x50, 0x4E, 0x47];
      for (let i = 0; i < zipData.length - 4; i++) {
        if (zipData[i] === pngMagic[0] && zipData[i+1] === pngMagic[1] &&
            zipData[i+2] === pngMagic[2] && zipData[i+3] === pngMagic[3]) {
          pngBytes = zipData.slice(i);
          break;
        }
      }
    }

    if (!pngBytes) {
      return c.json({ success: false, error: 'Failed to extract PNG from response' }, 500);
    }

    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < pngBytes.length; i += chunkSize) {
      const chunk = pngBytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const pngData = btoa(binary);

    return c.json({
      success: true,
      image: `data:image/png;base64,${pngData}`,
      prompt: fullPrompt,
    });
  } catch (error) {
    console.error('Image generation error:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

// Image judge endpoint
imageRoute.post('/api/image/judge', async (c) => {
  try {
    const apiKey = c.env.CEREBRAS_API_KEY;
    if (!apiKey) {
      return c.json({ success: false, error: 'CEREBRAS_API_KEY is not set' }, 500);
    }

    const body: JudgeRequest = await c.req.json();
    const {
      characterName,
      conversationHistory,
      lastAssistantMessage,
      nsfwEnabled = false,
      nsfwLevel = 'soft',
      previousImageState,
    } = body;

    const recentHistory = conversationHistory.slice(-12);
    const historyText = recentHistory
      .map(m => `${m.role === 'user' ? 'ユーザー' : characterName}: ${m.content}`)
      .join('\n');

    const previousStateText = previousImageState
      ? `前回のイラスト状態: 服装=${previousImageState.clothingState || '不明'}, 体勢=${previousImageState.poseState || '不明'}`
      : '';

    let systemPrompt = `あなたはイラスト生成判断AIです。会話を分析し、イラスト生成が必要か判断してください。
デフォルトはfully_clothed（服を着た状態）です。明確な性的要求がない限り、服を着た状態を維持してください。
${previousStateText}

JSON形式で回答:
{"shouldGenerate": true/false, "reason": "理由", "clothingState": "fully_clothed", "poseState": "standing", "imagePrompt": "英語プロンプト", "emotion": "happy", "nsfw": false}`;

    if (nsfwEnabled && nsfwLevel === 'explicit') {
      systemPrompt += '\nNSFW許可: ユーザーが明確に性的要求をした場合のみ対応。';
    }

    const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'qwen-3-32b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `会話:\n${historyText}\n\n最新:\n${characterName}: ${lastAssistantMessage}` },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return c.json({ success: false, error: `Judge API error: ${error}` }, 500);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content || '';

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      return c.json({ success: true, shouldGenerate: false, reason: 'Failed to parse response' });
    }

    const judgeResult = JSON.parse(jsonMatch[0]);
    return c.json({ success: true, ...judgeResult });
  } catch (error) {
    console.error('Judge error:', error);
    return c.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
