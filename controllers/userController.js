const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const { createNotification } = require("./notificationController");
const Property = require("../models/propertyModel");

// 🟢 Register user
exports.register = async (req, res) => {
  try {
    let { name, email, password, role, phone } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ message: "name, email and password required" });
    }

    const existing = await User.findOne({ email });
    if (existing)
      return res.status(409).json({ message: "Email already registered" });

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    // الدور الافتراضي
    if (!role || !["buyer", "seller", "real_estate_developer"].includes(role)) {
      role = "buyer";
    }

    // 📌 حفظ صورة المستخدم لو مرفوعة
    let avatar = null;
    if (req.files && req.files.avatar && req.files.avatar[0]) {
      avatar = `${req.protocol}://${req.get("host")}/uploads/${
        req.files.avatar[0].filename
      }`;
    }

    const user = new User({
      name,
      email,
      password: hash,
      role,
      phone,
      avatar,
    });

    await user.save();

    // 🔔 إشعارات لكل الأدمنز
    const admins = await User.find({ role: "admin" }).select("_id");

    await Promise.all(
      admins.map((admin) =>
        createNotification({
          type: "success",
          title: "New User Registered",
          message: `${user.name} signed up as ${user.role}`,
          recipient: admin._id,
          recipientRole: "admin",
          referenceId: user._id,
          referenceType: "user",
        })
      )
    );

    console.log(`✅ Sent ${admins.length} notifications to admins`);

    res.status(201).json({
      message: "User created",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        avatar: user.avatar,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
// 🟠 Login user (returns JWT)
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "email and password required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: "Invalid credentials" });

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET not configured");
    }

    const payload = { id: user._id, role: user.role, email: user.email };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    });

    res.json({
      message: "Logged in",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        avatar: user.avatar, // ✅ أضف هذا
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// 🟣 Get all users (admin only)
exports.getAllUsers = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Only admin can view all users" });
    }

    const users = await User.find().select("-password");
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

// 🔵 Get user profile (for /me or by id)
exports.getProfile = async (req, res) => {
  try {
    const userId = req.params.id || req.user?.id;
    const user = await User.findById(userId).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

// 🟢 Update user (only self or admin)
exports.updateUser = async (req, res) => {
  try {
    const requester = req.user;
    const { id } = req.params;

    // console.log("📥 Update User Request:", {
    //   requesterId: requester.id,
    //   targetId: id,
    //   files: req.files,
    //   body: req.body,
    // });

    if (requester.id !== id && requester.role !== "admin") {
      return res.status(403).json({ message: "Not authorized" });
    }

    const updates = { ...req.body };

    // منع تغيير الدور
    if (requester.role !== "admin") {
      delete updates.role;
    }

    // تحديث الباسورد لو اتبعت
    if (updates.password) {
      const salt = await bcrypt.genSalt(10);
      updates.password = await bcrypt.hash(updates.password, salt);
    }

    // 📌 لو في صورة جديدة ارفعها
    if (req.files && req.files.avatar && req.files.avatar[0]) {
      const fullAvatarUrl = `${req.protocol}://${req.get("host")}/uploads/${
        req.files.avatar[0].filename
      }`;
      updates.avatar = fullAvatarUrl;
      // console.log("✅ Avatar uploaded:", updates.avatar);
    }

    const user = await User.findByIdAndUpdate(id, updates, {
      new: true,
    }).select("-password");

    if (!user) return res.status(404).json({ message: "User not found" });

    console.log("✅ User updated successfully:", user);

    res.json({ message: "Updated", user });
  } catch (err) {
    console.error("❌ Update User Error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

//  Delete user (only self or admin)
exports.deleteUser = async (req, res) => {
  try {
    const requester = req.user;
    const { id } = req.params;

    if (requester.id !== id && requester.role !== "admin") {
      return res.status(403).json({ message: "Not authorized" });
    }

    const user = await User.findByIdAndDelete(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};
exports.getUserViews = async (req, res) => {
  try {
    const userId = req.params.id; // خد الـ userId من ال params
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    let filter = {};

    if (user.role === "seller") filter.seller = userId;
    if (user.role === "real_estate_developer") filter.developer = userId;

    const totalViews = await Property.aggregate([
      { $match: filter },
      { $group: { _id: null, total: { $sum: "$views" } } },
    ]);

    const properties = await Property.find(filter).select("title views");

    res.json({
      totalViews: totalViews[0]?.total || 0,
      properties,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
