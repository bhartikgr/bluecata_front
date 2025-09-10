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
router.post(
  "/marketplaceProposal",
  proposalAgentController.marketplaceProposal
);
router.post(
  "/sponsorshipProposal",
  proposalAgentController.sponsorshipProposal
);
router.post("/agentApplication", proposalAgentController.agentApplication);

router.post(
  "/proposalAgentfilter",
  proposalAgentController.proposalAgentfilter
);
router.post("/createAgentAccount", proposalAgentController.createAgentAccount);
router.post(
  "/proposalAgentassistant",
  proposalAgentController.proposalAgentassistant
);
router.post("/SponsorLead", proposalAgentController.SponsorLead);
router.post(
  "/SponsorshipProposalList",
  proposalAgentController.SponsorshipProposalList
);
router.post(
  "/MarketplaceProposalList",
  proposalAgentController.MarketplaceProposalList
);
router.post(
  "/MarketplaceProposalCreate",
  proposalAgentController.MarketplaceProposalCreate
);
router.post("/HostPurchaseCreate", proposalAgentController.HostPurchaseCreate);
router.post(
  "/getMarketplaceProposal",
  proposalAgentController.getMarketplaceProposal
);
router.post(
  "/getSponsorshipProposal",
  proposalAgentController.getSponsorshipProposal
);

router.post(
  "/AgentApplicationCreate",
  proposalAgentController.AgentApplicationCreate
);
module.exports = router;
