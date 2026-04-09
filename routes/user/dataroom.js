const express = require("express");
const router = express.Router();
const dataroomController = require("../../controllers/user/dataroomController");
const uploadDocsMiddleware = require("../../middlewares/uploadDocsMiddleware");

// Define the POST /login route
router.post(
  "/getInvestorDataRoomList",
  dataroomController.getInvestorDataRoomList,
);
router.post("/getreportstatusUpdate", dataroomController.getreportstatusUpdate);
module.exports = router;
