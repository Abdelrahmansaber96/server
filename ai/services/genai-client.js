const { GoogleGenAI } = require("@google/genai");

const GEMINI_MODEL = "gemini-2.5-flash";
let genAI = null;

function getGeminiClient() {
  if (!genAI && process.env.GOOGLE_API_KEY) {
    genAI = new GoogleGenAI({
      apiKey: process.env.GOOGLE_API_KEY,
    });
  }
  return genAI;
}

function isGeminiConfigured() {
  return (
    !!process.env.GOOGLE_API_KEY &&
    process.env.GOOGLE_API_KEY !== "your-google-gemini-api-key-here"
  );
}

module.exports = {
  getGeminiClient,
  isGeminiConfigured,
  GEMINI_MODEL,
};
