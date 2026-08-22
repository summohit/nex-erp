const { Jimp } = require('jimp');

const sizes = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192
};

async function run() {
  const icon = await Jimp.read('src/assets/app_icon.png');
  for (const [res, size] of Object.entries(sizes)) {
    const resized = icon.clone().resize({ w: size, h: size });
    await resized.write(`android/app/src/main/res/mipmap-${res}/ic_launcher.png`);
    await resized.write(`android/app/src/main/res/mipmap-${res}/ic_launcher_round.png`);
    console.log(`Generated Android ${res}`);
  }
}
run();
