import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { unzipSync } from 'fflate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NOVELAI_API_KEY = process.env.NOVELAI_API_KEY;
if (!NOVELAI_API_KEY) {
  console.error('NOVELAI_API_KEY not set');
  process.exit(1);
}

// 1. Character appearance (Vibe Transfer)
const characterImagePath = path.join(__dirname, '../../（使用中）Gal_01_v2 (1).png');
const CHARACTER_BASE64 = fs.readFileSync(characterImagePath).toString('base64');
console.log('Loaded character image for vibe');

// 2. Pose reference (img2img base)
const poseImagePath = path.join(__dirname, '../public/ref/hikari-ref/doggy.png');
const POSE_BASE64 = fs.readFileSync(poseImagePath).toString('base64');
console.log('Loaded pose image for img2img');

// Character features only - NO clothing for nude poses
const CHARACTER_BASE = '1girl, solo, blonde hair, long hair, side ponytail, purple eyes, violet eyes, 18 years old, beautiful face, perfect face, slim waist, medium breasts';
const QUALITY_TAGS = 'masterpiece, best quality, highly detailed, beautiful lighting, detailed skin, nsfw, explicit';
const NEGATIVE = 'ugly, deformed, blurry, low quality, bad anatomy, extra limbs, bad hands, worst quality, wrong eye color, orange hair, blue eyes, censored, mosaic, clothed, clothes, shirt, skirt, dress, bra, panties';

async function main() {
  // Pose-specific prompt (doggy style) - nude
  const fullPrompt = `nude, naked, doggystyle, on all fours, from behind, ass up, bare back, ${CHARACTER_BASE}, ${QUALITY_TAGS}`;

  console.log('Prompt:', fullPrompt);
  console.log('\nGenerating with img2img (pose) + vibe (character)...');

  const params: Record<string, unknown> = {
    width: 832,
    height: 1216,
    scale: 5,
    sampler: 'k_euler_ancestral',
    steps: 28,
    n_samples: 1,
    ucPreset: 0,
    qualityToggle: true,
    negative_prompt: NEGATIVE,
    seed: Math.floor(Math.random() * 2147483647),
    sm: false,
    sm_dyn: false,
    cfg_rescale: 0,
    noise_schedule: 'native',
    // Multiple vibe transfer (total strength <= 1.0)
    // Character: high info (face/hair detail), Pose: low info (composition only)
    reference_image_multiple: [CHARACTER_BASE64, POSE_BASE64],
    reference_information_extracted_multiple: [1.0, 0.3],  // character: full detail, pose: composition only
    reference_strength_multiple: [0.6, 0.3],  // total = 0.9
  };

  const response = await fetch('https://image.novelai.net/ai/generate-image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${NOVELAI_API_KEY}`,
      'Accept': 'application/zip',
    },
    body: JSON.stringify({
      input: fullPrompt,
      model: 'nai-diffusion-3',
      action: 'generate',
      parameters: params,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.log('Error:', response.status, text);
    return;
  }

  const zipData = new Uint8Array(await response.arrayBuffer());
  const unzipped = unzipSync(zipData);
  const pngFile = Object.keys(unzipped).find(name => name.endsWith('.png'));

  if (pngFile) {
    const outputPath = path.join(__dirname, '../public/ref/hikari/test_new_char.png');
    fs.writeFileSync(outputPath, Buffer.from(unzipped[pngFile]));
    console.log('Saved:', outputPath);
  }
}

main().catch(console.error);
