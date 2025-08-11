const express = require("express");
const router = express.Router();
const proposalAgentController = require("../../controllers/user/proposalAgentController");

// Define the POST /login route
router.post(
  "/createproposalAgent",
  proposalAgentController.createproposalAgent
);
router.post("/getProposalAgent", proposalAgentController.getProposalAgent);
router.post("/deleteAgent", proposalAgentController.deleteAgent);

module.exports = router;
