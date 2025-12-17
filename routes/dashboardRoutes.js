const express = require("express");
const dashboardController = require("../controllers/dashboardController");
const authMiddleware = require("../Middleware/authMiddleware");
const authorizeRoles = require("../Middleware/authorizeRoles");

const router = express.Router();

// كل الداشبورد يحتاج أدوار الأدمن فقط
router.get(
  "/stats",
  authMiddleware,
  authorizeRoles("admin"),
  dashboardController.getDashboardStats
);
router.get(
  "/all-activity",
  authMiddleware,
  authorizeRoles("admin"),
  dashboardController.getAllActivity
);
// 🟢 Get notifications
router.get(
  "/notifications",
  authMiddleware,
  authorizeRoles("admin"),
  dashboardController.getNotifications
);
// 🟢 الروت القديم اللي طلبته — تم إضافته كما هو
// router.get(
//   "/search",
//   authMiddleware,
//   authorizeRoles("admin"),
//   dashboardController.searchDashboard
// );

module.exports = router;
