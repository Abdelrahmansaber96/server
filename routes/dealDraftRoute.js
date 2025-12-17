const express = require("express");
const authMiddleware = require("../Middleware/authMiddleware");
const dealDraftController = require("../controllers/dealDraftController");

const router = express.Router();

router.post("/from-negotiation", authMiddleware, dealDraftController.createDraftFromNegotiation);
router.post("/confirm", authMiddleware, dealDraftController.confirmReservation);
router.get("/", authMiddleware, dealDraftController.listDrafts);

module.exports = router;
