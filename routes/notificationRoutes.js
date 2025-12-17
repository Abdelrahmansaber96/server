const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const authMiddleware = require("../Middleware/authMiddleware");

// كل الراوتات دي محمية بـ protect
router.get("/", authMiddleware, notificationController.getNotifications);
router.put("/read/:id", authMiddleware, notificationController.markAsRead);
router.put("/read-all", authMiddleware, notificationController.markAllAsRead);

module.exports = router;
