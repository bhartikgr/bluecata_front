const express = require("express");
const router = express.Router();
const upload = require("../../middlewares/uploadDocsMiddleware");
const fs = require("fs");
const path = require("path");
const inverstmenthistoryController = require("../../controllers/user/inverstmenthistoryController");

router.post(
  "/getInvestmentHistorylist",
  inverstmenthistoryController.getInvestmentHistorylist,
);
router.post(
  "/getInvestmentHistoryWarrantlist",
  inverstmenthistoryController.getInvestmentHistoryWarrantlist,
);
router.post(
  "/getInvestmentHistoryWithWarrantlist",
  inverstmenthistoryController.getInvestmentHistoryWithWarrantlist,
);

module.exports = router;
