require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/userModel");

(async () => {
  try {
    // الاتصال بقاعدة البيانات
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ Connected to MongoDB");

    // بيانات الأدمن الافتراضية (عدّلهم لو حابب)
    const adminData = {
      name: "Super Admin",
      email: "admin@example.com",
      password: "Admin123!",
      role: "admin",
      phone: "+201000000000",
    };

    // تحقق إذا الأدمن موجود مسبقًا
    const existingAdmin = await User.findOne({ email: adminData.email });
    if (existingAdmin) {
      console.log("⚠️ Admin already exists.");
      mongoose.connection.close();
      return;
    }

    // تشفير الباسورد
    const hashedPassword = await bcrypt.hash(adminData.password, 10);

    // إنشاء الأدمن
    const newAdmin = new User({
      ...adminData,
      password: hashedPassword,
    });

    await newAdmin.save();

    console.log("✅ Admin created successfully!");
    console.log({
      email: adminData.email,
      password: adminData.password,
      role: adminData.role,
    });

    mongoose.connection.close();
  } catch (err) {
    console.error("❌ Error creating admin:", err.message);
    mongoose.connection.close();
  }
})();
