// middlewares/authorizeRoles.js

module.exports = (...allowedRoles) => {
  return (req, res, next) => {
    try {
      // Ensure user exists (auth middleware should already set req.user)
      if (!req.user || !req.user.role) {
        return res.status(401).json({ message: "Unauthorized: No user found" });
      }

      // Check if user's role is allowed
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          message: "Access denied: You don't have permission for this action",
        });
      }

      // ✅ If role allowed, continue
      next();
    } catch (err) {
      console.error("Authorization error:", err);
      res.status(500).json({ message: "Server error during authorization" });
    }
  };
};
