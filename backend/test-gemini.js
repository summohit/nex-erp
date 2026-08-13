const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'YOUR_API_KEY' });

async function list() {
  try {
    const response = await ai.models.list();
    for (const model of response) {
      console.log(model.name);
    }
  } catch (e) {
    console.error(e);
  }
}

list();
