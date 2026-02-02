import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputDir = path.join(__dirname, '../public/ref/hikari-ref');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Grid layout for image_1.png (1280x995)
// 5 columns, 3 rows
const image1Sprites = [
  // Row 1
  { name: 'fella_cum', col: 0, row: 0 },
  { name: 'footjob_cum', col: 1, row: 0 },
  { name: 'handjob_cum', col: 2, row: 0 },
  { name: 'irrumatio', col: 3, row: 0 },
  { name: 'irrumatio_cum', col: 4, row: 0 },
  // Row 2
  { name: 'grabbed_breasts', col: 0, row: 1 },
  { name: 'paizuri', col: 1, row: 1 },
  { name: 'paizuri_cum', col: 2, row: 1 },
  { name: 'breasts_groped', col: 3, row: 1 },
  { name: 'paizuri2', col: 4, row: 1 },
  // Row 3
  { name: 'paizuri_cum2', col: 0, row: 2 },
  { name: 'doggy', col: 1, row: 2 },
  { name: 'cum_inside', col: 2, row: 2 },
];

// Grid layout for image_2.png (1280x1003)
const image2Sprites = [
  // Row 1
  { name: 'fullnelson_cum', col: 0, row: 0 },
  { name: 'doggysex_cum', col: 1, row: 0 },
  { name: 'spooning_cum', col: 2, row: 0 },
  { name: 'cowgirl_cum', col: 3, row: 0 },
  { name: 'standing_sex_cum', col: 4, row: 0 },
  // Row 2
  { name: 'pronebone_cum', col: 0, row: 1 },
  { name: 'wombpress_cum', col: 1, row: 1 },
  { name: 'sleeping_sex_cum', col: 2, row: 1 },
  { name: 'gangrape_cum', col: 3, row: 1 },
  { name: 'missionary_cum', col: 4, row: 1 },
  // Row 3
  { name: 'milking_handjob', col: 0, row: 2 },
  { name: 'milking_handjob_cum', col: 1, row: 2 },
];

async function cropImage(
  inputPath: string,
  sprites: { name: string; col: number; row: number }[],
  gridWidth: number,
  gridHeight: number,
  cols: number,
  headerHeight: number,
  footerHeight: number,
  rowHeight: number
) {
  const colWidth = Math.floor(gridWidth / cols);
  const imageHeight = rowHeight - headerHeight - footerHeight;

  for (const sprite of sprites) {
    const left = sprite.col * colWidth + 10; // small padding
    const top = sprite.row * rowHeight + headerHeight;
    const width = colWidth - 20;
    const height = imageHeight;

    const outputPath = path.join(outputDir, `${sprite.name}.png`);

    try {
      await sharp(inputPath)
        .extract({ left, top, width, height })
        .toFile(outputPath);
      console.log(`Saved: ${sprite.name}.png`);
    } catch (e) {
      console.error(`Error cropping ${sprite.name}:`, e);
    }
  }
}

async function main() {
  const image1Path = path.join(__dirname, '../../image_1.png');
  const image2Path = path.join(__dirname, '../../image_2.png');

  // Image 1: 1280x995, 5 cols, 3 rows
  // Each row ~330px, header ~25px, footer ~35px, image ~270px
  console.log('Processing image_1.png...');
  await cropImage(image1Path, image1Sprites, 1280, 995, 5, 25, 40, 330);

  // Image 2: 1280x1003
  console.log('\nProcessing image_2.png...');
  await cropImage(image2Path, image2Sprites, 1280, 1003, 5, 25, 40, 330);

  console.log('\nDone!');
}

main().catch(console.error);
