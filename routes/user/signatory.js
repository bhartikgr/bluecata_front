const express = require("express");
const router = express.Router();
const signatoryController = require("../../controllers/user/signatoryController");

// Define the POST /login route
router.post(
  "/signatoryinvitationLink",
  signatoryController.signatoryinvitationLink
);
router.post(
  "/acceptInvitationSignatory",
  signatoryController.acceptInvitationSignatory
);

module.exports = router;
