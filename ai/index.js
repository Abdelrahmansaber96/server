/**
 * AI Module - Main Export
 * 
 * This module provides RAG (Retrieval-Augmented Generation) capabilities
 * for real estate property search using OpenAI embeddings and GPT-4
 */

const aiRoutes = require("./routes/ai.routes");
const embeddingsService = require("./services/embeddings.service");
const vectorSearchService = require("./services/vector-search.service");
const llmAgentService = require("./services/llm-agent.service");
const SYSTEM_PROMPT = require("./system-prompt");

module.exports = {
  // Routes
  aiRoutes,

  // Services
  embeddingsService,
  vectorSearchService,
  llmAgentService,

  // Config
  SYSTEM_PROMPT,
};
