const express = require("express");
const router = express.Router();
const customiseRosterController = require("../controllers/users/customiseRosterController");

router.post("/getallclient", customiseRosterController.getallclient);
router.post("/getAllminesite", customiseRosterController.getAllminesite);
router.post(
  "/createCustomiseRoster",
  customiseRosterController.createCustomiseRoster
);
router.post("/activeRoster", customiseRosterController.activeRoster);
router.post("/getuserallRoster", customiseRosterController.getuserallRoster);
router.post("/getCoverageRoster", customiseRosterController.getCoverageRoster);

module.exports = router; // Correct export
