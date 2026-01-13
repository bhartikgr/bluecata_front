const express = require("express");
const router = express.Router();
const investorController = require("../../controllers/admin/investorController");
const upload = require("../../middlewares/uploadMiddleware");

router.post("/getallinvestor", investorController.getallinvestor);
router.post("/getInvestorDetails", investorController.getInvestorDetails);
module.exports = router;
