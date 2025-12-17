const express = require("express");
const router = express.Router();
const unitController = require("../controllers/unitController");
const authMiddleware = require("../Middleware/authMiddleware");

/**
 * Unit Routes - مسارات الوحدات العقارية
 */

// 🔓 Public Routes (للعملاء)
// البحث عن وحدات
router.get("/search", unitController.searchUnits);

// جلب وحدات مشروع معين (يجب أن يكون قبل /:unitId)
router.get("/project/:projectId", unitController.getProjectUnits);

// إحصائيات وحدات المشروع
router.get("/project/:projectId/stats", unitController.getProjectUnitStats);

// جلب وحدة بالتفاصيل (يجب أن يكون بعد /project routes)
router.get("/:unitId", unitController.getUnitById);

// 🔒 Protected Routes (تحتاج تسجيل دخول)

// للمطور: إنشاء وحدة (يجب أن يكون قبل /:unitId routes)
router.post("/project/:projectId", authMiddleware, unitController.createUnit);

// للمطور: إنشاء وحدات متعددة
router.post("/project/:projectId/bulk", authMiddleware, unitController.createBulkUnits);

// للمشتري: حجز وحدة
router.post("/:unitId/book", authMiddleware, unitController.bookUnit);

// للمشتري: طلب زيارة
router.post("/:unitId/visit", authMiddleware, unitController.requestVisit);

// للمطور: تحديث وحدة
router.put("/:unitId", authMiddleware, unitController.updateUnit);
router.patch("/:unitId", authMiddleware, unitController.updateUnit); // PATCH support

// للمطور: حذف وحدة
router.delete("/:unitId", authMiddleware, unitController.deleteUnit);

// للمطور: تأكيد دفع العربون
router.post("/:unitId/confirm-deposit", authMiddleware, unitController.confirmDeposit);

// للمطور/المشتري: إلغاء حجز
router.post("/:unitId/cancel-booking", authMiddleware, unitController.cancelBooking);

// للمطور: تأكيد البيع
router.post("/:unitId/mark-sold", authMiddleware, unitController.markAsSold);

module.exports = router;
