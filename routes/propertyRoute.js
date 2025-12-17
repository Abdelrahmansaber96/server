const express = require("express");
const propertyController = require("../controllers/propertyController");
const authMiddleware = require("../Middleware/authMiddleware");
const uploadFiles = require("../Middleware/uploadMiddleware");
const authorizeRoles = require("../Middleware/authorizeRoles");

const route = express.Router();

// 🏠 إنشاء عقار (لـ seller أو real_estate_developer فقط)
route.post(
  "/",
  authMiddleware,
  authorizeRoles("seller", "real_estate_developer"),
  uploadFiles,
  propertyController.createProperty
);

// 🧍 جلب العقارات الخاصة بالمستخدم (seller/developer)
route.get(
  "/seller/me",
  authMiddleware,
  authorizeRoles("seller", "real_estate_developer"),
  propertyController.getSellerProperties
);

// 📋 جلب كل العقارات (مفتوح للجميع)
route.get("/", propertyController.getProperties);
// 📋 جلب كل العقارات اللي عملها المطورين العقاريين
route.get("/developers", propertyController.getDeveloperProperties);
// 🔥🔥 هنا ضيف incrementViews قبل :id
route.put("/:id/views", propertyController.incrementViews);
// 🔍 جلب عقار محدد (مفتوح للجميع)
route.get("/:id", propertyController.getPropertyById);

// ✏️ تحديث عقار (فقط لصاحب العقار أو مطور عقاري)
route.put(
  "/:id",
  authMiddleware,
  authorizeRoles("seller", "real_estate_developer"),
  uploadFiles,
  propertyController.updateProperty
);

// ❌ حذف عقار (فقط لصاحب العقار أو مطور عقاري)
route.delete(
  "/:id",
  authMiddleware,
  authorizeRoles("seller", "real_estate_developer"),
  propertyController.deleteProperty
);

module.exports = route;
