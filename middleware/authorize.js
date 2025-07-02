const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");

dotenv.config(); // Make sure .env variables are loaded here too if this is a standalone file
const { APP_JWT_SECRET } = process.env;

const authorize = (req, res, next) => {
  // 1. Get the token from the Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: No token provided or invalid format." });
  }

  const token = authHeader.split(" ")[1]; // Get the token part after "Bearer "

  // 2. Verify the token
  try {
    const decoded = jwt.verify(token, APP_JWT_SECRET);
    // Attach the decoded user payload to the request object
    // This makes user data available in subsequent route handlers
    req.user = decoded;
    console.log("JWT authorized:", req.user); // For debugging
    next(); // Pass control to the next middleware or route handler
  } catch (err) {
    // If token verification fails (e.g., invalid, expired)
    console.error("JWT verification failed:", err.message);
    return res.status(401).json({ error: "Unauthorized: Invalid or expired token." });
  }
};

module.exports = authorize;