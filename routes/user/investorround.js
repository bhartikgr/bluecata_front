const express = require("express");
const router = express.Router();
const investorroundController = require("../../controllers/user/investorRoundController");
const uploadDocsMiddleware = require("../../middlewares/uploadDocsMiddleware");

// Define the POST /login route
router.post("/getcompanyDetails", investorroundController.getcompanyDetails);
router.post(
  "/getcompanyRoundSeperateDetail",
  investorroundController.getcompanyRoundSeperateDetail,
);

module.exports = router;
