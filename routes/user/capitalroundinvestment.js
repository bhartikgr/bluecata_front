const express = require("express");
const router = express.Router();
const capitalroundInvestmentController = require("../../controllers/user/capitalroundInvestmentController");

// Define the POST /login route
router.post(
  "/getRoundZeroCurrency",
  capitalroundInvestmentController.getRoundZeroCurrency,
);

module.exports = router;
