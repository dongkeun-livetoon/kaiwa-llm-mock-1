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
  referenceImage?: string; // base64
  referenceMethod?: 'none' | 'vibe';
  referenceStrength?: number;
  nsfw?: boolean;
  nsfwLevel?: 'soft' | 'explicit';
}

// Character-specific base prompts for consistency
const CHARACTER_BASE_PROMPTS: Record<string, { positive: string; negative: string }> = {
  'hikari-001': {
    positive: '1girl, solo, gyaru, blonde long hair, pink and blue highlights in hair, heart necklace, energetic, bright smile, japanese girl, 18 years old, beautiful face, perfect face, slim waist, medium breasts, beautiful body, thighs, tan skin',
    negative: 'ugly, deformed, blurry, low quality, bad anatomy, extra limbs, missing fingers, bad hands, worst quality, jpeg artifacts, silver hair, gray hair, white hair',
  },
  'rio-001': {
    positive: '1girl, solo, gentle girl, dark blue hair, navy blue hair, blue hair in ponytail, blue eyes, elegant, warm smile, kind eyes, 23 years old, japanese woman, beautiful face, perfect face, slim body, large breasts, beautiful body, long legs, fair skin',
    negative: 'ugly, deformed, blurry, low quality, bad anatomy, extra limbs, missing fingers, bad hands, worst quality, jpeg artifacts, silver hair, gray hair, white hair, blonde hair',
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
      referenceMethod = 'none',
      referenceStrength = 0.6,
      nsfw = false,
      nsfwLevel = 'soft',
    } = body;

    console.log('Image generation request:', { prompt, characterId, referenceMethod, hasReference: !!referenceImage, nsfw, nsfwLevel });

    // Get character base prompt
    const charPrompt = CHARACTER_BASE_PROMPTS[characterId] || {
      positive: 'anime girl, high quality',
      negative: 'ugly, deformed, blurry, low quality',
    };

    // Build quality tags based on NSFW settings
    let qualityTags = 'masterpiece, best quality, highly detailed';
    let nsfwNegative = '';
    let nsfwPositive = '';

    if (nsfw) {
      // Add NSFW-appropriate quality tags
      qualityTags += ', beautiful lighting, detailed skin, perfect anatomy';
      if (nsfwLevel === 'explicit') {
        // Full explicit mode - maximum quality for NSFW
        nsfwPositive = ', nsfw, explicit, uncensored, nude, naked, bare skin, detailed nipples, detailed body, erotic, lewd, pornographic';
        // Remove censorship from negative
        nsfwNegative = ', censored, mosaic, bar censor, light rays censorship';
      } else {
        nsfwPositive = ', suggestive, romantic, seductive, sexy, ecchi';
      }
    } else {
      // Add SFW safety tags to negative
      nsfwNegative = ', nsfw, nude, naked, exposed, sexual, explicit, nipples, genitals';
    }

    // Combine prompts
    const fullPrompt = `${charPrompt.positive}, ${prompt}, ${qualityTags}${nsfwPositive}`;
    const fullNegative = `${charPrompt.negative}, ${negativePrompt}${nsfwNegative}`;

    // NovelAI Image Generation API
    // Using nai-diffusion-3 for compatibility (V4+ requires newer subscription)
    const parameters: Record<string, unknown> = {
      width,
      height,
      scale: 5, // CFG scale - lower is more creative, higher follows prompt more
      sampler: 'k_euler_ancestral',
      steps: 28,
      n_samples: 1,
      ucPreset: 0, // 0 = Heavy (recommended for anime)
      qualityToggle: true,
      negative_prompt: fullNegative,
      seed: Math.floor(Math.random() * 2147483647),
      // V3 specific - disable unwanted defaults
      sm: false, // SMEA sampler
      sm_dyn: false, // Dynamic SMEA
      cfg_rescale: 0, // CFG rescale
      noise_schedule: 'native', // Use native noise schedule
    };

    // Add Vibe Transfer for character consistency (if enabled)
    if (referenceImage && referenceMethod === 'vibe') {
      parameters.reference_image_multiple = [referenceImage];
      parameters.reference_information_extracted_multiple = [1]; // Extract style info
      parameters.reference_strength_multiple = [referenceStrength]; // Apply strength
    }
    // 'none' - no reference, pure text2image

    const requestBody = {
      input: fullPrompt,
      model: 'nai-diffusion-3',
      action: 'generate',
      parameters,
    };

    console.log('NovelAI request:', { referenceMethod, hasVibe: !!referenceImage && referenceMethod === 'vibe', width, height });

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

    // NovelAI returns a zip file with the image
    const zipBuffer = await response.arrayBuffer();

    console.log('NovelAI response size:', zipBuffer.byteLength, 'bytes');

    // Use fflate to extract the image (Edge Runtime compatible)
    let unzipped: Record<string, Uint8Array>;
    try {
      unzipped = unzipSync(new Uint8Array(zipBuffer));
    } catch (zipError) {
      // Not a ZIP, try to read as text for error message
      const textContent = new TextDecoder().decode(new Uint8Array(zipBuffer).slice(0, 500));
      console.error('Failed to parse ZIP:', zipError, 'Content:', textContent);
      return NextResponse.json(
        { success: false, error: `Failed to parse response as ZIP: ${textContent.slice(0, 200)}` },
        { status: 500 }
      );
    }

    // Find the first PNG file in the ZIP
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

    // Convert Uint8Array to base64 (chunk to avoid stack overflow)
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
