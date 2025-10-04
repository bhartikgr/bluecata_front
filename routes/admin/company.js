const express = require("express");
const router = express.Router();
const companyController = require("../../controllers/admin/companyController");
const upload = require("../../middlewares/uploadMiddleware");

router.post("/getUserallcompnay", companyController.getUserallcompnay);
router.post("/getUsercompnayInfo", companyController.getUsercompnayInfo);

router.post("/deletecompany", companyController.deletecompany);
router.post("/getcompanyInvestor", companyController.getcompanyInvestor);
module.exports = router;
