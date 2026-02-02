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

// Load reference image (the main character image)
const refImagePath = path.join(__dirname, '../../（使用中）Gal_01_v2 (1).png');
let REF_IMAGE_BASE64 = '';
if (fs.existsSync(refImagePath)) {
  REF_IMAGE_BASE64 = fs.readFileSync(refImagePath).toString('base64');
  console.log('Loaded reference image for character consistency');
} else {
  console.log('No reference image found, generating without character reference');
}

// New character: blonde hair, purple/violet eyes, white shirt, olive/khaki plaid skirt
const CHARACTER_BASE = '1girl, solo, blonde hair, long hair, side ponytail, purple eyes, violet eyes, 18 years old, beautiful face, perfect face, slim waist, medium breasts, white shirt, long sleeves, khaki plaid skirt, pleated skirt, black socks, brown shoes, red bracelet';
const QUALITY_TAGS = 'masterpiece, best quality, highly detailed, beautiful lighting, detailed skin, nsfw, explicit, uncensored';
const NEGATIVE = 'ugly, deformed, blurry, low quality, bad anatomy, extra limbs, bad hands, worst quality, wrong eye color, censored, mosaic, orange hair, blue eyes';

interface SpriteConfig {
  name: string;
  positive: string;
}

const SPRITES: SpriteConfig[] = [
  // Basic states
  { name: 'clothed_standing', positive: 'standing, smile, looking at viewer' },
  { name: 'topless_standing', positive: 'standing, topless, bare breasts, nipples, skirt, shy, blushing' },
  { name: 'nude_standing', positive: 'standing, nude, naked, bare breasts, nipples, pussy, shy, blushing' },
  { name: 'nude_kneeling', positive: 'kneeling, nude, naked, bare breasts, nipples, pussy, shy, blushing' },
  { name: 'nude_lying', positive: 'lying on back, nude, naked, bare breasts, nipples, pussy, spread legs, blushing' },

  // NSFW poses matching reference images
  { name: 'fella_cum', positive: 'fellatio, oral, penis, cum in mouth, facial, kneeling, looking at viewer, saliva, cum on face' },
  { name: 'footjob_cum', positive: 'footjob, feet, penis between feet, cum on feet, lying, black socks' },
  { name: 'handjob_cum', positive: 'handjob, holding penis, cum on hands, ejaculation' },
  { name: 'irrumatio', positive: 'irrumatio, deepthroat, oral, penis, tears, kneeling' },
  { name: 'irrumatio_cum', positive: 'irrumatio, deepthroat, oral, penis, cum in mouth, tears, kneeling, cum overflow' },
  { name: 'grabbed_breasts', positive: 'breasts grab, groping, hands on breasts, topless, bare breasts, blushing' },
  { name: 'paizuri', positive: 'paizuri, titfuck, penis between breasts, breasts, topless, looking at viewer' },
  { name: 'paizuri_cum', positive: 'paizuri, titfuck, penis between breasts, cum on breasts, ejaculation, topless' },
  { name: 'breasts_groped', positive: 'breasts grab, groping from behind, hands on breasts, topless, blushing, moaning' },
  { name: 'doggy', positive: 'doggystyle, sex from behind, on all fours, vaginal, ass up, skirt lift' },
  { name: 'cum_inside', positive: 'cum in pussy, after sex, lying on back, spread legs, nude, cum overflow, creampie' },
  { name: 'fullnelson_cum', positive: 'full nelson, sex, lifted, spread legs, cum in pussy, cum overflow' },
  { name: 'doggysex_cum', positive: 'doggystyle, sex from behind, on all fours, cum in pussy, skirt lift, ahegao' },
  { name: 'spooning_cum', positive: 'spooning, sex, lying on side, cum in pussy, from behind' },
  { name: 'cowgirl_cum', positive: 'cowgirl position, girl on top, riding, cum in pussy, open shirt, breasts out' },
  { name: 'standing_sex_cum', positive: 'standing sex, leg lift, against wall, cum in pussy, one leg up' },
  { name: 'pronebone_cum', positive: 'prone bone, lying face down, sex from behind, cum in pussy, ass up' },
  { name: 'wombpress_cum', positive: 'mating press, missionary, legs up, deep penetration, cum in pussy' },
  { name: 'sleeping_sex_cum', positive: 'sleeping, unconscious, sex, lying on back, cum in pussy, eyes closed' },
  { name: 'missionary_cum', positive: 'missionary position, lying on back, sex, cum in pussy, legs spread' },
  { name: 'milking_handjob', positive: 'handjob, both hands, milking, penis, kneeling, looking at penis' },
  { name: 'milking_handjob_cum', positive: 'handjob, both hands, milking, cum, ejaculation, kneeling, cum on face' },
];

async function generateImage(config: SpriteConfig): Promise<Buffer | null> {
  const fullPrompt = `${config.positive}, ${CHARACTER_BASE}, ${QUALITY_TAGS}`;

  console.log(`Generating: ${config.name}`);

  try {
    const parameters: Record<string, unknown> = {
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
    };

    // Add character reference if available
    if (REF_IMAGE_BASE64) {
      parameters.reference_image_multiple = [REF_IMAGE_BASE64];
      parameters.reference_information_extracted_multiple = [1.0];
      parameters.reference_strength_multiple = [0.8];
    }

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
        parameters,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`  Error: ${response.status} ${errorText}`);
      return null;
    }

    const zipData = new Uint8Array(await response.arrayBuffer());
    const unzipped = unzipSync(zipData);
    const pngFile = Object.keys(unzipped).find(name => name.endsWith('.png'));

    if (!pngFile) {
      console.error(`  Error: No PNG in zip`);
      return null;
    }

    return Buffer.from(unzipped[pngFile]);
  } catch (error) {
    console.error(`  Error: ${error}`);
    return null;
  }
}

async function main() {
  const outputDir = path.join(__dirname, '../public/ref/hikari');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`Output directory: ${outputDir}`);
  console.log(`Generating ${SPRITES.length} sprites...\n`);

  for (const sprite of SPRITES) {
    const outputPath = path.join(outputDir, `${sprite.name}.png`);

    // Delete existing to regenerate
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    const imageData = await generateImage(sprite);

    if (imageData) {
      fs.writeFileSync(outputPath, imageData);
      console.log(`  Saved: ${sprite.name}.png\n`);
    }

    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  console.log('Done!');
}

main().catch(console.error);
