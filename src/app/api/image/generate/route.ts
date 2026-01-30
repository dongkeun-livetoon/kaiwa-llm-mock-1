import { NextRequest, NextResponse } from 'next/server';
import { unzipSync } from 'fflate';

export const runtime = 'edge';

const NOVELAI_API_KEY = process.env.NOVELAI_API_KEY;

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
  // New state-based fields from judge
  clothingState?: string;
  poseState?: string;
  actionState?: string;
}

// Character-specific base prompts for consistency
const CHARACTER_BASE_PROMPTS: Record<string, { positive: string; negative: string }> = {
  'hikari-001': {
    positive: '1girl, solo, gyaru, blonde long hair, purple eyes, white shirt, plaid skirt, school uniform, red bracelet, black shoes, black socks, energetic, bright smile, japanese girl, 18 years old, beautiful face, perfect face, slim waist, medium breasts, beautiful body, thighs, fair skin',
    negative: 'ugly, deformed, blurry, low quality, bad anatomy, extra limbs, missing fingers, bad hands, worst quality, jpeg artifacts, silver hair, gray hair, white hair, blue hair, dark hair, wrong eye color',
  },
  'rio-001': {
    positive: '1girl, solo, gentle girl, dark blue hair, navy blue hair, side ponytail, yellow eyes, golden eyes, blue cardigan, white shirt, black skirt, yellow hair clips, white socks, black shoes, elegant, warm smile, kind eyes, 23 years old, japanese woman, beautiful face, perfect face, slim body, large breasts, beautiful body, long legs, fair skin',
    negative: 'ugly, deformed, blurry, low quality, bad anatomy, extra limbs, missing fingers, bad hands, worst quality, jpeg artifacts, silver hair, gray hair, white hair, blonde hair, wrong eye color, blue eyes',
  },
};

// State to NovelAI tag mappings
const CLOTHING_STATE_TAGS: Record<string, { positive: string; negative: string }> = {
  'fully_clothed': { positive: 'fully clothed, dressed', negative: 'nude, naked, exposed' },
  'casual': { positive: 'casual clothes, dressed', negative: 'nude, naked' },
  'formal': { positive: 'formal dress, elegant outfit', negative: 'nude, naked' },
  'swimsuit': { positive: 'swimsuit, bikini', negative: '' },
  'underwear': { positive: 'underwear, bra, panties, lingerie', negative: 'fully clothed' },
  'lingerie': { positive: 'lingerie, lace underwear, sexy lingerie', negative: 'fully clothed' },
  'topless': { positive: 'topless, bare breasts, exposed breasts, nipples, no bra', negative: 'fully clothed, wearing top' },
  'bottomless': { positive: 'bottomless, no panties, exposed pussy, bare legs', negative: 'fully clothed, wearing pants, wearing skirt' },
  'nude': { positive: 'nude, naked, fully nude, completely naked, bare skin, exposed breasts, nipples, pussy, vagina, detailed pussy', negative: 'clothed, dressed' },
  'partially_dressed': { positive: 'partially dressed, clothes falling off, disheveled clothes', negative: '' },
  'towel_only': { positive: 'towel only, wrapped in towel, after bath', negative: 'fully clothed' },
  'apron_only': { positive: 'naked apron, apron only, bare back, sideboob', negative: 'fully clothed' },
};

const POSE_STATE_TAGS: Record<string, string> = {
  'standing': 'standing',
  'sitting': 'sitting',
  'lying_down': 'lying down',
  'lying_on_back': 'lying on back, on back',
  'lying_on_stomach': 'lying on stomach, on stomach',
  'kneeling': 'kneeling',
  'on_all_fours': 'on all fours, doggy position',
  'bent_over': 'bent over, leaning forward',
  'straddling': 'straddling, cowgirl position',
  'spread': 'spread legs, legs apart, spread pussy',
  'curled_up': 'curled up, fetal position',
};

const ACTION_STATE_TAGS: Record<string, { positive: string; negative: string }> = {
  'none': { positive: '', negative: '' },
  'flirting': { positive: 'flirting, seductive pose, bedroom eyes', negative: '' },
  'undressing': { positive: 'undressing, taking off clothes, stripping', negative: '' },
  'touching_self': { positive: 'masturbation, touching self, fingering, hand between legs', negative: '' },
  'being_touched': { positive: 'being touched, groped, hands on body', negative: '' },
  'kissing': { positive: 'kissing, lips parted', negative: '' },
  'foreplay': { positive: 'foreplay, intimate, aroused, wet', negative: '' },
  'intercourse': { positive: 'sex, penetration, intercourse', negative: '' },
  'climax': { positive: 'orgasm, climax, ahegao, pleasure, moaning, trembling', negative: '' },
  'afterglow': { positive: 'after sex, exhausted, satisfied, cum, messy', negative: '' },
};

// Build NSFW tags from state
function buildNsfwTagsFromState(
  clothingState?: string,
  poseState?: string,
  actionState?: string,
  nsfwLevel?: string
): { positive: string; negative: string } {
  let positive = '';
  let negative = '';

  // Base NSFW tags for explicit mode
  if (nsfwLevel === 'explicit') {
    positive += 'nsfw, explicit, uncensored, ';
    negative += 'censored, mosaic, bar censor, light rays censorship, ';
  }

  // Clothing state tags
  if (clothingState && CLOTHING_STATE_TAGS[clothingState]) {
    const tags = CLOTHING_STATE_TAGS[clothingState];
    positive += tags.positive + ', ';
    if (tags.negative) negative += tags.negative + ', ';
  }

  // Pose state tags
  if (poseState && POSE_STATE_TAGS[poseState]) {
    positive += POSE_STATE_TAGS[poseState] + ', ';
  }

  // Action state tags (explicit only)
  if (nsfwLevel === 'explicit' && actionState && ACTION_STATE_TAGS[actionState]) {
    const tags = ACTION_STATE_TAGS[actionState];
    positive += tags.positive + ', ';
    if (tags.negative) negative += tags.negative + ', ';
  }

  return {
    positive: positive.replace(/, $/, ''),
    negative: negative.replace(/, $/, ''),
  };
}

export async function POST(request: NextRequest) {
  try {
    if (!NOVELAI_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'NOVELAI_API_KEY is not set' },
        { status: 500 }
      );
    }

    const body: ImageGenerateRequest = await request.json();
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

    console.log('Image generation request:', {
      prompt, characterId, referenceMethod,
      hasReference: !!referenceImage, nsfw, nsfwLevel,
      clothingState, poseState, actionState
    });

    // Get character base prompt
    const charPrompt = CHARACTER_BASE_PROMPTS[characterId] || {
      positive: 'anime girl, high quality',
      negative: 'ugly, deformed, blurry, low quality',
    };

    // Build quality tags
    let qualityTags = 'masterpiece, best quality, highly detailed';
    let nsfwNegative = '';
    let nsfwPositive = '';

    if (nsfw) {
      qualityTags += ', beautiful lighting, detailed skin, perfect anatomy';

      if (nsfwLevel === 'explicit') {
        // Use state-based tag generation
        const stateTags = buildNsfwTagsFromState(clothingState, poseState, actionState, nsfwLevel);
        nsfwPositive = stateTags.positive ? ', ' + stateTags.positive : '';
        nsfwNegative = stateTags.negative ? ', ' + stateTags.negative : '';

        // Fallback if no state provided
        if (!clothingState && !poseState && !actionState) {
          nsfwPositive = ', nsfw, explicit, uncensored, nude, naked, bare skin, detailed nipples, detailed body, erotic, lewd, pussy, vagina, detailed pussy, spread legs, visible pussy';
          nsfwNegative = ', censored, mosaic, bar censor, light rays censorship, covered pussy';
        }
      } else {
        nsfwPositive = ', suggestive, romantic, seductive, sexy, ecchi';
      }
    } else {
      nsfwNegative = ', nsfw, nude, naked, exposed, sexual, explicit, nipples, genitals';
    }

    // Combine prompts - order matters for NovelAI (앞에 있는 태그가 더 강함)
    // 자세 태그를 앞에 배치해서 vibe의 서있는 자세 override
    let fullPrompt: string;
    let fullNegative: string;

    // 자세 태그 추출 (poseState가 있으면 앞에 배치)
    const poseTag = poseState && POSE_STATE_TAGS[poseState] ? POSE_STATE_TAGS[poseState] : '';

    if (nsfw && nsfwLevel === 'explicit') {
      // NSFW: 자세 먼저, 그다음 explicit tags, scene, character
      const charFaceOnly = charPrompt.positive
        .replace(/,?\s*(fully clothed|dressed|clothes|outfit|uniform|shirt|skirt|pants|dress)/gi, '')
        .trim();
      fullPrompt = `${poseTag ? poseTag + ', ' : ''}${nsfwPositive.replace(/^,\s*/, '')}, ${prompt}, ${qualityTags}, ${charFaceOnly}`;
      fullNegative = `${nsfwNegative.replace(/^,\s*/, '')}, ${charPrompt.negative}, ${negativePrompt}, wrong hair color, different character`;
    } else {
      // SFW: 자세 먼저, 그다음 scene, character
      fullPrompt = `${poseTag ? poseTag + ', ' : ''}${prompt}, ${qualityTags}, ${charPrompt.positive}${nsfwPositive}`;
      fullNegative = `${charPrompt.negative}, ${negativePrompt}${nsfwNegative}, wrong hair color, different character, inconsistent appearance`;
    }

    // Strip base64 header if present
    let cleanedRefImage = referenceImage;
    if (referenceImage && referenceImage.includes(',')) {
      cleanedRefImage = referenceImage.split(',')[1];
    }

    // Determine action based on reference method
    let action = 'generate';
    const isImg2Img = cleanedRefImage && referenceMethod === 'img2img';

    // NovelAI Image Generation API
    const parameters: Record<string, unknown> = {
      width,
      height,
      scale: 3, // 낮춤 - 텍스트 프롬프트 영향 줄이고 vibe 강화
      sampler: 'k_euler_ancestral',
      steps: 28,
      n_samples: 1,
      ucPreset: 0,
      qualityToggle: true,
      negative_prompt: fullNegative,
      seed: Math.floor(Math.random() * 2147483647),
    };

    // V3 specific parameters - only for text2image/vibe
    if (!isImg2Img) {
      parameters.sm = false;
      parameters.sm_dyn = false;
      parameters.cfg_rescale = 0;
      parameters.noise_schedule = 'native';
    }

    if (cleanedRefImage && referenceMethod === 'vibe') {
      parameters.reference_image_multiple = [cleanedRefImage];

      // 화풍은 유지하되 자세는 프롬프트 따르게
      // information 높으면 스타일 강함, strength 낮추면 프롬프트(자세) 더 반영
      if (nsfw && nsfwLevel === 'explicit') {
        parameters.reference_information_extracted_multiple = [0.8]; // 스타일 추출
        parameters.reference_strength_multiple = [0.4]; // 낮춰서 프롬프트 자세 반영
      } else {
        parameters.reference_information_extracted_multiple = [0.9]; // 스타일 추출
        parameters.reference_strength_multiple = [0.5]; // 낮춰서 프롬프트 자세 반영
      }
    } else if (isImg2Img) {
      action = 'img2img';
      parameters.image = cleanedRefImage;
      parameters.strength = referenceStrength;
      parameters.noise = 0;
      parameters.extra_noise_seed = Math.floor(Math.random() * 2147483647);
    }

    const requestBody = {
      input: fullPrompt,
      model: 'nai-diffusion-3',
      action,
      parameters,
    };

    console.log('NovelAI request:', {
      action,
      referenceMethod,
      hasImage: !!cleanedRefImage,
      imageLength: cleanedRefImage?.length || 0,
      width,
      height,
      fullPrompt: fullPrompt.slice(0, 200) + '...',
    });

    const response = await fetch('https://image.novelai.net/ai/generate-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NOVELAI_API_KEY}`,
        'Accept': 'application/zip',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('NovelAI API error:', response.status, error);
      return NextResponse.json(
        { success: false, error: `NovelAI API error (${response.status}): ${error}` },
        { status: response.status }
      );
    }

    const zipBuffer = await response.arrayBuffer();
    console.log('NovelAI response size:', zipBuffer.byteLength, 'bytes');

    let unzipped: Record<string, Uint8Array>;
    try {
      unzipped = unzipSync(new Uint8Array(zipBuffer));
    } catch (zipError) {
      const textContent = new TextDecoder().decode(new Uint8Array(zipBuffer).slice(0, 500));
      console.error('Failed to parse ZIP:', zipError, 'Content:', textContent);
      return NextResponse.json(
        { success: false, error: `Failed to parse response as ZIP: ${textContent.slice(0, 200)}` },
        { status: 500 }
      );
    }

    const fileNames = Object.keys(unzipped);
    console.log('Files in ZIP:', fileNames);

    const pngFile = fileNames.find(name => name.endsWith('.png'));
    if (!pngFile) {
      console.error('No PNG file found in ZIP. Files:', fileNames);
      return NextResponse.json(
        { success: false, error: `No PNG file in ZIP. Files: ${fileNames.join(', ')}` },
        { status: 500 }
      );
    }

    const pngBytes = unzipped[pngFile];
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < pngBytes.length; i += chunkSize) {
      const chunk = pngBytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const pngData = btoa(binary);
    console.log('Image extracted successfully:', pngFile, 'base64 length:', pngData.length);

    return NextResponse.json({
      success: true,
      image: `data:image/png;base64,${pngData}`,
      prompt: fullPrompt,
    });
  } catch (error) {
    console.error('Image generation error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
