const express = require("express");
const router = express.Router();
const investorController = require("../../controllers/admin/investorController");
const upload = require("../../middlewares/uploadMiddleware");

router.post("/getallinvestor", investorController.getallinvestor);
router.post("/getInvestorDetails", investorController.getInvestorDetails);
router.post("/getinvestorProfile", investorController.getinvestorProfile);
router.post(
  "/getinvestorTotalCompany",
  investorController.getinvestorTotalCompany,
);
router.post("/getCompanyInvite", investorController.getCompanyInvite);
router.post("/getRoundParticipating", investorController.getRoundParticipating);
router.post("/getInvestorReport", investorController.getInvestorReport);
module.exports = router;
