const express = require("express");
const paymentController = require("../controllers/paymentController");
const authMiddleware = require("../Middleware/authMiddleware");

const route = express.Router();

route.post("/payments", authMiddleware, paymentController.createPayment);
route.patch(
  "/payments/:id/status",
  authMiddleware,
  paymentController.updatePaymentStatus
);
route.get("/payments", authMiddleware, paymentController.getPayments);

module.exports = route;
