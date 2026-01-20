import { NextRequest, NextResponse } from 'next/server';

const NOVELAI_API_KEY = process.env.NOVELAI_API_KEY;

interface ImageGenerateRequest {
  prompt: string;
  negativePrompt?: string;
  characterId: string;
  width?: number;
  height?: number;
  referenceImage?: string; // base64
  referenceStrength?: number;
  nsfw?: boolean;
  nsfwLevel?: 'soft' | 'explicit';
}

// Character-specific base prompts for consistency
const CHARACTER_BASE_PROMPTS: Record<string, { positive: string; negative: string }> = {
  'hikari-001': {
    positive: 'gyaru girl, blonde long hair, pink and blue highlights, heart necklace, school uniform, energetic, bright smile, japanese high school girl, 18 years old',
    negative: 'ugly, deformed, blurry, low quality, bad anatomy, extra limbs, missing fingers',
  },
  'rio-001': {
    positive: 'gentle girl, blue-gray hair in ponytail, elegant, light blue cardigan, warm smile, kind eyes, 23 years old, japanese woman',
    negative: 'ugly, deformed, blurry, low quality, bad anatomy, extra limbs, missing fingers',
  },
};

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
      referenceStrength = 0.6,
      nsfw = false,
      nsfwLevel = 'soft',
    } = body;

    console.log('Image generation request:', { prompt, characterId, hasReference: !!referenceImage, nsfw, nsfwLevel });

    // Get character base prompt
    const charPrompt = CHARACTER_BASE_PROMPTS[characterId] || {
      positive: 'anime girl, high quality',
      negative: 'ugly, deformed, blurry, low quality',
    };

    // Build quality tags based on NSFW settings
    let qualityTags = 'masterpiece, best quality, highly detailed';
    let nsfwNegative = '';

    if (nsfw) {
      // Add NSFW-appropriate quality tags
      qualityTags += ', beautiful lighting, detailed skin';
      if (nsfwLevel === 'explicit') {
        qualityTags += ', nsfw';
      } else {
        qualityTags += ', suggestive, romantic';
      }
    } else {
      // Add SFW safety tags to negative
      nsfwNegative = ', nsfw, nude, naked, exposed, sexual, explicit';
    }

    // Combine prompts
    const fullPrompt = `${charPrompt.positive}, ${prompt}, ${qualityTags}`;
    const fullNegative = `${charPrompt.negative}, ${negativePrompt}${nsfwNegative}`;

    // NovelAI Image Generation API
    const requestBody: Record<string, unknown> = {
      input: fullPrompt,
      model: 'nai-diffusion-3', // NAI Diffusion Anime V3
      action: referenceImage ? 'img2img' : 'generate',
      parameters: {
        width,
        height,
        scale: 5, // CFG scale
        sampler: 'k_euler_ancestral',
        steps: 28,
        n_samples: 1,
        ucPreset: 0,
        qualityToggle: true,
        negative_prompt: fullNegative,
        seed: Math.floor(Math.random() * 2147483647),
      },
    };

    // Add reference image for img2img
    if (referenceImage) {
      requestBody.parameters = {
        ...requestBody.parameters as object,
        image: referenceImage,
        strength: referenceStrength,
        noise: 0.0,
      };
    }

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
      console.error('NovelAI API error:', error);
      return NextResponse.json(
        { success: false, error: `NovelAI API error (${response.status}): ${error}` },
        { status: response.status }
      );
    }

    // NovelAI returns a zip file with the image
    const zipBuffer = await response.arrayBuffer();

    // Extract image from zip (the image is the first file in the zip)
    const zipData = new Uint8Array(zipBuffer);

    // Find PNG signature in zip (simple extraction)
    // PNG starts with 89 50 4E 47 0D 0A 1A 0A
    let pngStart = -1;
    for (let i = 0; i < zipData.length - 8; i++) {
      if (zipData[i] === 0x89 && zipData[i + 1] === 0x50 &&
          zipData[i + 2] === 0x4E && zipData[i + 3] === 0x47) {
        pngStart = i;
        break;
      }
    }

    if (pngStart === -1) {
      return NextResponse.json(
        { success: false, error: 'Could not find image in response' },
        { status: 500 }
      );
    }

    // Extract PNG data (find IEND chunk)
    let pngEnd = zipData.length;
    for (let i = pngStart; i < zipData.length - 8; i++) {
      // IEND chunk ends with 49 45 4E 44 AE 42 60 82
      if (zipData[i] === 0x49 && zipData[i + 1] === 0x45 &&
          zipData[i + 2] === 0x4E && zipData[i + 3] === 0x44 &&
          zipData[i + 4] === 0xAE && zipData[i + 5] === 0x42) {
        pngEnd = i + 8; // Include CRC
        break;
      }
    }

    const pngData = zipData.slice(pngStart, pngEnd);
    const base64Image = Buffer.from(pngData).toString('base64');

    console.log('Image generated successfully, size:', pngData.length);

    return NextResponse.json({
      success: true,
      image: `data:image/png;base64,${base64Image}`,
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
