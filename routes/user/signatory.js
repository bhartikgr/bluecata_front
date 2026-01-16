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
router.post("/signatorylogin", signatoryController.signatorylogin);
router.post("/joinedCompany", signatoryController.joinedCompany);
router.post(
  "/signatoryAccessLastLogin",
  signatoryController.signatoryAccessLastLogin
);
module.exports = router;
