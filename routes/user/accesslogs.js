const express = require("express");
const router = express.Router();
const accesslogController = require("../../controllers/user/accesslogController");

// Define the POST /login route
router.post("/getCompanyLogs", accesslogController.getCompanyLogs);
router.post("/deleteLogs", accesslogController.deleteLogs);
router.post(
  "/getCompanyDiscountCoupon",
  accesslogController.getCompanyDiscountCoupon
);

module.exports = router;
