const { Jimp } = require('jimp');

async function run() {
  const image = await Jimp.read('src/assets/logo.png');
  image.crop({ x: 30, y: 35, w: 110, h: 110 });
  
  // Pad to be a perfect centered square
  // create a new 1024x1024 image with white background
  const bg = new Jimp({ width: 1024, height: 1024, color: 0xffffffff });
  image.resize({ w: 800, h: 800 });
  bg.composite(image, 112, 112);
  
  await bg.write('src/assets/app_icon.png');
  console.log('App icon generated successfully');
}
run();
