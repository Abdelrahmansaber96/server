const jwt = require("jsonwebtoken");

function optionalAuthMiddleware(req, res, next) {
  const token = req.headers["authorization"];
  if (!token) {
    return next();
  }

  try {
    const cleanToken = token.startsWith("Bearer ") ? token.slice(7) : token;
    if (!cleanToken) {
      return next();
    }

    const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);
    req.user = decoded;
  } catch (error) {
    console.warn("⚠️  Optional auth skipped due to invalid token:", error.message);
  }

  return next();
}

module.exports = optionalAuthMiddleware;
