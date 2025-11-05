const express = require("express");
const router = express.Router();
const upload = require("../../middlewares/uploadDocsMiddleware");
const fs = require("fs");
const path = require("path");
const inverstorController = require("../../controllers/user/inverstorController");

router.post("/getInvestorlist", inverstorController.getInvestorlist);
router.post("/Addnewinvenstor", inverstorController.Addnewinvenstor);
router.post("/getInvestoreditlist", inverstorController.getInvestoreditlist);
router.post("/deleteinvestor", inverstorController.deleteinvestor);
router.post("/SendreportToinvestor", inverstorController.SendreportToinvestor);
router.post("/getInvestorlistCrm", inverstorController.getInvestorlistCrm);
router.post("/checkInvestor", inverstorController.checkInvestor);
router.post(
  "/getInvestorReportUpdate",
  inverstorController.getInvestorReportUpdate
);
router.post(
  "/getInvestorlistCrmDuediligence",
  inverstorController.getInvestorlistCrmDuediligence
);
router.post(
  "/getInvestorReportDuediligence",
  inverstorController.getInvestorReportDuediligence
);
router.post(
  "/getinvestorReportsLock",
  inverstorController.getinvestorReportsLock
);
router.post(
  "/getDuediligenceDataroomLock",
  inverstorController.getDuediligenceDataroomLock
);
router.post(
  "/getInvestorlistCrmDuediligenceupdate",
  inverstorController.getInvestorlistCrmDuediligenceupdate
);
router.post("/getInvestorCompany", inverstorController.getInvestorCompany);
router.post(
  "/getInvestorReportslist",
  inverstorController.getInvestorReportslist
);
router.post(
  "/InvestorReportslistDownload",
  inverstorController.InvestorReportslistDownload
);
router.post(
  "/getreportsCapitalRound",
  inverstorController.getreportsCapitalRound
);
router.post(
  "/checkInvestorRecordround",
  inverstorController.checkInvestorRecordround
);
router.post("/checkInvestorRecord", inverstorController.checkInvestorRecord);
router.post(
  "/getInvestorReportCapitalRound",
  inverstorController.getInvestorReportCapitalRound
);
router.post("/getrecordRoundList", inverstorController.getrecordRoundList);
router.post("/recordRoundLock", inverstorController.recordRoundLock);
router.post(
  "/InvestorAuthorizeConfimataion",
  inverstorController.InvestorAuthorizeConfimataion
);
router.post(
  "/InvestorrequestToCompany",
  inverstorController.InvestorrequestToCompany
);
router.post(
  "/getInvestorAllRoundRecord",
  inverstorController.getInvestorAllRoundRecord
);
router.post("/getInvestmentList", inverstorController.getInvestmentList);
router.post("/verifyInvestment", inverstorController.verifyInvestment);
router.post("/fetchInvestorData", inverstorController.fetchInvestorData);
router.post(
  "/getcheckInvestorStatus",
  inverstorController.getcheckInvestorStatus
);
module.exports = router;
