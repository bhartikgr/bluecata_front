const express = require("express");
const router = express.Router();
const capitalroundController = require("../../controllers/user/capitalroundController");

// Define the POST /login route
router.post(
  "/getallcountrySymbolList",
  capitalroundController.getallcountrySymbolList
);
router.post(
  "/CreateOrUpdateCapitalRound",
  capitalroundController.CreateOrUpdateCapitalRound
);
router.post(
  "/getCapitalRecordRound",
  capitalroundController.getCapitalRecordRound
);
router.post(
  "/SendRecordRoundToinvestor",
  capitalroundController.SendRecordRoundToinvestor
);
router.post(
  "/getInvestorCapitalMotionlist",
  capitalroundController.getInvestorCapitalMotionlist
);
router.post(
  "/getcheckCapitalMotionlist",
  capitalroundController.getcheckCapitalMotionlist
);
router.post(
  "/tersheetdownloadInvestor",
  capitalroundController.tersheetdownloadInvestor
);
router.post("/Capitalmotionviewed", capitalroundController.Capitalmotionviewed);
router.post(
  "/subscriptiondownloadInvestor",
  capitalroundController.subscriptiondownloadInvestor
);
router.post(
  "/investorrecordAuthorize",
  capitalroundController.investorrecordAuthorize
);
router.post("/getinvestorprofile", capitalroundController.getinvestorprofile);
router.post(
  "/updateInvestorProfile",
  capitalroundController.updateInvestorProfile
);
router.post("/getTotalcompany", capitalroundController.getTotalcompany);
router.post(
  "/getTotalCompanyIssuedShared",
  capitalroundController.getTotalCompanyIssuedShares
);
router.post(
  "/getlatestinvestorreport",
  capitalroundController.getlatestinvestorreport
);
router.post(
  "/getlatestinvestorDataroom",
  capitalroundController.getlatestinvestorDataroom
);
router.post(
  "/getInvestorCapitalMotionlistLatest",
  capitalroundController.getInvestorCapitalMotionlistLatest
);

router.post("/getEditrecordlist", capitalroundController.getEditrecordlist);
router.post("/EditcapitalRound", capitalroundController.EditcapitalRound);
router.post(
  "/getTotalInvestorReport",
  capitalroundController.getTotalInvestorReport
);

module.exports = router;
