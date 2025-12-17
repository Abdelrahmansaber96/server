const express = require("express");
const userController = require("../controllers/userController");
const authMiddleware = require("../Middleware/authMiddleware");
const uploadFiles = require("../Middleware/uploadMiddleware");

const route = express.Router();

// Register with avatar upload
route.post("/register", uploadFiles, userController.register);

// Login
route.post("/login", userController.login);

// Get users
route.get("/users", authMiddleware, userController.getAllUsers);

// Profile
route.get("/users/me", authMiddleware, userController.getProfile);
route.get("/users/:id", userController.getProfile);

// Update user with avatar upload
route.put("/users/:id", authMiddleware, uploadFiles, userController.updateUser);

// Delete user
route.delete("/users/:id", authMiddleware, userController.deleteUser);

// User views
route.get("/users/:id/views", authMiddleware, userController.getUserViews);

module.exports = route;
