const Notification = require("../models/notificationModel");

// ============================
// Get notifications for logged-in user
// ============================
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    console.log("📥 Get notifications for user:", userId);

    // 👇 جيب الإشعارات الخاصة بالـ user ده بس
    const notifications = await Notification.find({
      recipient: userId, // 👈 الأهم
    })
      .sort({ createdAt: -1 })
      .limit(50);

    console.log(
      `✅ Found ${notifications.length} notifications for user: ${userId}`
    );

    res.json({
      message: "Notifications retrieved",
      data: notifications,
    });
  } catch (err) {
    console.error("❌ Error fetching notifications:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// ============================
// Mark single notification as read
// ============================
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id || req.user.id;

    // 👇 تأكد إن الإشعار بتاع الـ user ده
    const notification = await Notification.findOne({
      _id: id,
      recipient: userId, // 👈 تأمين
    });

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    notification.read = true;
    await notification.save();

    res.json({ message: "Notification marked as read", data: notification });
  } catch (err) {
    console.error("❌ Error marking notification:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// ============================
// Mark all notifications as read
// ============================
exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    // 👇 عدّل بس الإشعارات بتاعت الـ user ده
    await Notification.updateMany(
      {
        recipient: userId, // 👈 مهم
        read: false,
      },
      { read: true }
    );

    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    console.error("❌ Error marking all notifications:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// ============================
// Create notification helper (Updated)
// ============================
exports.createNotification = async ({
  type = "info",
  title,
  message,
  recipient,
  recipientRole = null,
  referenceId = null,
  referenceType = null,
}) => {
  try {
    if (!recipient) {
      console.error("❌ Recipient is required for notification");
      return null;
    }

    const notification = new Notification({
      type,
      title,
      message,
      recipient,
      recipientRole,
      referenceId,
      referenceType,
    });

    await notification.save();

    console.log(`✅ Notification created for user: ${recipient}`);
    console.log(`📧 Title: ${title}`);
    console.log(`💬 Message: ${message}`);

    // 🔔 Real-time emit
    if (global.io) {
      global.io
        .to(recipient.toString()) // user room
        .emit("new-notification", notification);
    }

    return notification;
  } catch (err) {
    console.error("❌ Error creating notification:", err.message);
    return null;
  }
};
