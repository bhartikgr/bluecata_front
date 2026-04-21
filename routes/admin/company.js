const express = require("express");
const router = express.Router();
const companyController = require("../../controllers/admin/companyController");
const upload = require("../../middlewares/uploadMiddleware");

router.post("/getUserallcompnay", companyController.getUserallcompnay);
router.post("/getUsercompnayInfo", companyController.getUsercompnayInfo);

router.post("/deletecompany", companyController.deletecompany);
router.post("/getcompanyInvestor", companyController.getcompanyInvestor);
router.post("/getInvestorInfo", companyController.getInvestorInfo);
router.post(
  "/getcompnayInvestorReporting",
  companyController.getcompnayInvestorReporting,
);
router.post("/getCompanyReport", companyController.getCompanyReport);
router.post("/getCompnayRecordRound", companyController.getCompnayRecordRound);
router.post(
  "/getCompanyRecordRoundDetails",
  companyController.getCompanyRecordRoundDetails,
);
router.post("/getallcompnay", companyController.getallcompnay);
router.post(
  "/getCompanyTotalRoundInvestor",
  companyController.getCompanyTotalRoundInvestor,
);
router.post(
  "/getCompanyAllInvestment",
  companyController.getCompanyAllInvestment,
);
router.post(
  "/getCompanyFundinground",
  companyController.getCompanyFundinground,
);
router.post("/getCompanyDocument", companyController.getCompanyDocument);
module.exports = router;
