const express = require("express");
const adminController = require("../controllers/adminController");
const authMiddleware = require("../Middleware/authMiddleware");
const authorizeRoles = require("../Middleware/authorizeRoles");

const router = express.Router();

// 👤 Users
router.get(
  "/users",
  authMiddleware,
  authorizeRoles("admin"),
  adminController.getAllUsers
);
router.put(
  "/users/:id/role",
  authMiddleware,
  authorizeRoles("admin"),
  adminController.updateUserRole
);
router.delete(
  "/users/:id",
  authMiddleware,
  authorizeRoles("admin"),
  adminController.deleteUser
);

// 🏠 Properties (All Mixed – old)
router.get(
  "/properties",
  authMiddleware,
  authorizeRoles("admin"),
  adminController.getAllProperties
);

// 🆕 🏠 Seller Properties Only
router.get(
  "/properties/seller",
  authMiddleware,
  authorizeRoles("admin"),
  adminController.getSellerProperties
);

// 🆕 🏗 Developer Projects Only
router.get(
  "/properties/developer",
  authMiddleware,
  authorizeRoles("admin"),
  adminController.getDeveloperProjects
);

// 📊 Total Property Views
router.get(
  "/properties/analytics/total-views",
  authMiddleware,
  authorizeRoles("admin"),
  adminController.getTotalViews
);

// 📊 Performance Metrics
router.get(
  "/properties/analytics/performance",
  authMiddleware,
  authorizeRoles("admin"),
  adminController.getPerformanceMetrics
);

// 📊 Admin analytics
router.get(
  "/analytics",
  authMiddleware,
  authorizeRoles("admin"),
  adminController.getAnalyticsData
);

// ✔ Verify Property
router.put(
  "/properties/:id/verify",
  authMiddleware,
  authorizeRoles("admin"),
  adminController.verifyProperty
);

// ✔ Delete Property
router.delete(
  "/properties/:id",
  authMiddleware,
  authorizeRoles("admin"),
  adminController.deleteProperty
);

module.exports = router;
