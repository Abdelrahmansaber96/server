const express = require("express");
const aiFiltersController = require("../controllers/aiFiltersController");

const router = express.Router();

router.post("/interview/start", aiFiltersController.startInterview);
router.post("/interview/answer", aiFiltersController.processAnswer);
router.get("/recommendations", aiFiltersController.getAiRecommendations);

module.exports = router;
