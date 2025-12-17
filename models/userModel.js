const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    email: {
      type: String,
      unique: true,
      required: true,
      lowercase: true,
      trim: true,
      match: /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/,
    },

    password: { type: String, required: true, minlength: 6 },

    role: {
      type: String,
       enum: [
        "buyer",
        "seller",
        "real_estate_developer",
        "admin",
      ],
      default: "buyer",
      required: true,
    },

    phone: {
      type: String,
      match: [/^\+?[0-9]{10,14}$/, "Invalid phone number"],
    },
    avatar: { type: String }, // صورة الملف الشخصي
    verified: { type: Boolean, default: false }, // ⬅️ أضفنا هذا الحقل
  },
  { timestamps: true }
);

// hide password in response
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model("User", userSchema);
