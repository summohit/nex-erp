const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'YOUR_API_KEY' });

async function testModel(modelName) {
  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: 'Hello',
    });
    console.log(`SUCCESS with ${modelName}:`, response.text);
    return true;
  } catch (e) {
    console.log(`FAILED with ${modelName}:`, e.message);
    return false;
  }
}

async function runTests() {
  const modelsToTest = [
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-2.0-flash',
    'gemini-3.0-flash',
    'gemini-3.1-flash-live-preview',
    'gemini-2.5-flash-native-audio-latest'
  ];
  for (const m of modelsToTest) {
    const success = await testModel(m);
    if (success) break;
  }
}

runTests();
