const express = require("express");
const router = express.Router();
const coverageTimesheetController = require("../controllers/users/coverageTimesheetController");

router.post(
  "/getCoverageTimeSheet",
  coverageTimesheetController.getCoverageTimeSheet
);
router.post(
  "/getCoverageAttendance",
  coverageTimesheetController.getCoverageAttendance
);
router.post(
  "/getWeeklyDataTimesheet",
  coverageTimesheetController.getWeeklyDataTimesheet
);
router.post(
  "/employeAttendanceForm",
  coverageTimesheetController.employeAttendanceForm
);
router.post(
  "/sendtimeSheetForUserEnd",
  coverageTimesheetController.sendtimeSheetForUserEnd
);
router.post("/sendtimeSheet", coverageTimesheetController.sendtimeSheet);

module.exports = router; // Correct export
