const multer = require("multer");
const path = require("path");
const fs = require("fs");

// إنشاء مجلد "uploads" لو مش موجود
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// إعداد التخزين
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueName + path.extname(file.originalname));
  },
});

// السماح فقط بالصور و PDF
const fileFilter = (req, file, cb) => {
  const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error("Only images and PDF files are allowed"), false);
};

// إعداد الرفع
const upload = multer({ storage, fileFilter });

// تحديد أسماء الحقول
const uploadFiles = upload.fields([
  { name: "images", maxCount: 10 },
  { name: "documents", maxCount: 5 },
  { name: "avatar", maxCount: 1 }, // ⭐ إضافة رفع صورة المستخدم
]);

module.exports = uploadFiles;
