const express = require("express");
const authMiddleware = require("../Middleware/authMiddleware");
const matchingController = require("../controllers/matchingController");

const router = express.Router();

router.get("/top", authMiddleware, matchingController.getTopMatches);

module.exports = router;
