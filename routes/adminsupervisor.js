const express = require("express");
const router = express.Router();
const adminController = require("../controllers/admin/adminsupervisorController");

router.post("/sendtimeSheet", adminController.sendtimeSheet);
router.post(
  "/sendtimeSheetForUserEnd",
  adminController.sendtimeSheetForUserEnd
);
router.post("/checkcode", adminController.checkcode);
router.post("/gettimesheetData", adminController.gettimesheetData);
router.post("/updatesign", adminController.updatesign);
router.post("/bookmeet", adminController.bookmeet);
router.post("/resetnotification", adminController.resetnotification);
router.post(
  "/usertimesheetFolderYears",
  adminController.usertimesheetFolderYears
);
router.post("/usergetMonthbaseData", adminController.usergetMonthbaseData);
router.post("/usergetWeekbaseData", adminController.usergetWeekbaseData);

module.exports = router; // Correct export
