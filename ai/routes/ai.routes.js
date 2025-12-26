const express = require("express");
const router = express.Router();
const aiController = require("../controllers/ai.controller");
const authMiddleware = require("../../Middleware/authMiddleware");
const optionalAuthMiddleware = require("../../Middleware/optionalAuthMiddleware");

// Test endpoint
router.get("/test", (req, res) => {
  console.log("✅ Test endpoint hit!");
  res.json({ success: true, message: "AI routes working!" });
});

// Main AI Query endpoint - attaches user context when token exists
router.post("/query", optionalAuthMiddleware, aiController.aiQuery);

// 🎤 Voice AI Query endpoint - optimized for speech
router.post("/voice", optionalAuthMiddleware, aiController.voiceQuery);

// Recommendations based on onboarding answers - requires authentication
router.post("/recommend", authMiddleware, aiController.recommendFromPreferences);

// Generate embedding for a specific property - Admin only
router.post("/generate-embedding/:propertyId", authMiddleware, aiController.generateEmbedding);

// Generate embeddings for all properties - Admin only
router.post("/generate-all-embeddings", authMiddleware, aiController.generateAllEmbeddings);

// Test vector search - Development only
router.post("/test-search", authMiddleware, aiController.testSearch);

module.exports = router;
