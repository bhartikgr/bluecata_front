const express = require("express");
const router = express.Router();
const companydashboardController = require("../../controllers/user/companydashboardController");
const uploadDocsMiddleware = require("../../middlewares/uploadDocsMiddleware");

// Define the POST /login route
router.post("/getroundChart", companydashboardController.getroundChart);
router.post(
  "/getInvitedInvestor",
  companydashboardController.getInvitedInvestor,
);

module.exports = router;
