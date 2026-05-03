import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  const models = ['gemini-3.1-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview-0220', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview'];
  for (const m of models) {
    try {
      await ai.models.generateContent({ model: m, contents: "hi" });
      console.log("Success: " + m);
    } catch (e: any) {
      console.log("Failed: " + m + " - " + e.message);
    }
  }
}
run();
