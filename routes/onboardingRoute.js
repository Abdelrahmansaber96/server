const express = require("express");
const authMiddleware = require("../Middleware/authMiddleware");
const onboardingController = require("../controllers/onboardingController");

const router = express.Router();

router.get("/me", authMiddleware, onboardingController.getMyOnboarding);
router.post("/", authMiddleware, onboardingController.saveOrUpdate);

module.exports = router;
