const { Jimp } = require('jimp');
const fs = require('fs');

const basePath = 'ios/NexMobileApp/Images.xcassets/AppIcon.appiconset';
const icons = [
  { size: 20, scale: 2 },
  { size: 20, scale: 3 },
  { size: 29, scale: 2 },
  { size: 29, scale: 3 },
  { size: 40, scale: 2 },
  { size: 40, scale: 3 },
  { size: 60, scale: 2 },
  { size: 60, scale: 3 },
  { size: 1024, scale: 1 }
];

async function run() {
  const icon = await Jimp.read('src/assets/app_icon.png');
  const contents = {
    images: [],
    info: { author: "xcode", version: 1 }
  };

  for (const item of icons) {
    const actualSize = item.size * item.scale;
    const filename = `icon-${item.size}@${item.scale}x.png`;
    
    const resized = icon.clone().resize({ w: actualSize, h: actualSize });
    await resized.write(`${basePath}/${filename}`);
    
    contents.images.push({
      idiom: item.size === 1024 ? 'ios-marketing' : 'iphone',
      scale: `${item.scale}x`,
      size: `${item.size}x${item.size}`,
      filename: filename
    });
    console.log(`Generated iOS ${filename}`);
  }

  fs.writeFileSync(`${basePath}/Contents.json`, JSON.stringify(contents, null, 2));
}
run();
