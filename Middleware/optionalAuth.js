const jwt = require("jsonwebtoken");

module.exports = function optionalAuth(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return next();
  }

  try {
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    if (!token) {
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
  } catch (error) {
    console.warn("Optional auth skipped due to invalid token", error.message);
  }

  next();
};
