const express = require("express");
const router = express.Router();
const dashboardController = require("../../controllers/admin/dashboardController");
const upload = require("../../middlewares/uploadMiddleware");
// Define the POST /login route
router.post("/getTotalUsers", dashboardController.getTotalUsers);
router.post(
  "/getTotalUsersDashboard",
  dashboardController.getTotalUsersDashboard
);
router.post("/getTotalCompany", dashboardController.getTotalCompany);

router.post("/getTotalmodule", dashboardController.getTotalmodule);
router.post(
  "/getTotalactivemeeting",
  dashboardController.getTotalactivemeeting
);

module.exports = router;
