const express = require("express");
const authMiddleware = require("../Middleware/authMiddleware");
const negotiationController = require("../controllers/negotiationController");
const authorizeRoles = require("../Middleware/authorizeRoles");

const router = express.Router();

router.post("/", authMiddleware, negotiationController.startNegotiation);
router.get("/", authMiddleware, negotiationController.listNegotiations);
router.patch(
	"/:id/status",
	authMiddleware,
	authorizeRoles("seller", "developer", "admin"),
	negotiationController.updateNegotiationStatus
);
router.post("/:id/request-draft", authMiddleware, negotiationController.requestDraft);
router.post("/:id/generate-draft", authMiddleware, authorizeRoles("seller", "developer"), negotiationController.generateDraft);
router.post("/:id/send-draft", authMiddleware, authorizeRoles("seller", "developer"), negotiationController.sendDraft);
router.post("/:id/confirm", authMiddleware, authorizeRoles("buyer"), negotiationController.confirmReservation);

module.exports = router;
