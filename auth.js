const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {
  // ✅ Debug logging
  console.log("=== AUTH MIDDLEWARE DEBUG ===");
  console.log("Headers:", req.headers);
  console.log("Authorization header:", req.headers.authorization);

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    console.log("❌ No Authorization header");
    return res.status(401).json({
      success: false,
      message: "No token provided",
    });
  }

  // Check format
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    console.log("❌ Invalid format. Expected: Bearer <token>");
    return res.status(401).json({
      success: false,
      message: "Invalid token format",
    });
  }

  const token = parts[1];
  console.log("✅ Token received:", token.substring(0, 50) + "...");
  console.log("JWT_SECRET exists:", !!process.env.JWT_SECRET);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("✅ Token verified successfully:", decoded);
    req.user = decoded;
    next();
  } catch (error) {
    console.error("❌ Token verification failed:", error.message);
    console.error("Error name:", error.name);

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired",
      });
    }
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token signature",
      });
    }

    return res.status(401).json({
      success: false,
      message: "Authentication failed",
    });
  }
};

module.exports = authMiddleware;
