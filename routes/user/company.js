const express = require("express");
const router = express.Router();
const CompanyController = require("../../controllers/user/companyController");

router.post("/getUserCompany", CompanyController.getUserCompany);
router.post("/getUserSignatory", CompanyController.getUserSignatory);
router.post("/userDeleteSignatory", CompanyController.userDeleteSignatory);
router.post("/getcompanyAlldetail", CompanyController.getcompanyAlldetail);
router.post("/addSignatory", CompanyController.addSignatory);
router.post("/getUserdetails", CompanyController.getUserdetails);
module.exports = router;
