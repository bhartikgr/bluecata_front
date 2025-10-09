const express = require("express");
const router = express.Router();
const signatorydashboardController = require("../../controllers/user/signatorydashboardController");

// Define the POST /login route
router.post(
  "/getSignatoryDetails",
  signatorydashboardController.getSignatoryDetails
);
router.post(
  "/getSignatoryCompanyList",
  signatorydashboardController.getSignatoryCompanyList
);

module.exports = router;
