const express = require("express");
const router = express.Router();
const sponserController = require("../../controllers/user/sponserController");

// Define the POST /login route
router.post("/getSponsers", sponserController.getSponsers);
router.post("/localloadProposal", sponserController.localloadProposal);
router.post("/register", sponserController.register);
router.post("/login", sponserController.login);
router.post("/getEvents", sponserController.getEvents);
router.post("/localloadEvents", sponserController.localloadEvents);
router.post("/proposalData", sponserController.proposalData);
router.post("/hostpurchase", sponserController.hostpurchase);

router.post(
  "/getSponsorshipProposal",
  sponserController.getSponsorshipProposal
);
router.post("/registerwithgoogle", sponserController.registerwithgoogle);
router.post("/loginwithgoogle", sponserController.loginwithgoogle);
router.post("/emailBlast", sponserController.emailBlast);
router.post("/getsponsoruser", sponserController.getsponsoruser);
router.post("/getallproposal", sponserController.getallproposal);
router.post("/getproposalbrowser", sponserController.getproposalbrowser);
router.post("/uploadimageVideo", sponserController.uploadimageVideo);
router.post("/getbrowserevents", sponserController.getbrowserevents);
router.post(
  "/getsponsorSubscriptiondetail",
  sponserController.getsponsorSubscriptiondetail
);
router.post("/paymentCharge", sponserController.paymentCharge);
router.post("/paymentSave", sponserController.paymentSave);
router.post("/sponsorPaymentCharge", sponserController.sponsorPaymentCharge);
router.post("/sponsorPaymentSave", sponserController.sponsorPaymentSave);
router.post("/updaterole", sponserController.updaterole);
router.post("/getallevents", sponserController.getallevents);
router.post("/paymentSaveStripe", sponserController.paymentSaveStripe);
router.post(
  "/getlocksubscriptionDetail",
  sponserController.getlocksubscriptionDetail
);
router.post("/proposalcount", sponserController.proposalcount);
router.post("/getUnlockproposal", sponserController.getUnlockproposal);
router.post(
  "/UnlockproposalStatusUpdate",
  sponserController.UnlockproposalStatusUpdate
);
router.post(
  "/sponsorPaymentSavePaypal",
  sponserController.sponsorPaymentSavePaypal
);
router.post("/getproposalDetailEdit", sponserController.getproposalDetailEdit);
router.post("/proposalDataEdit", sponserController.proposalDataEdit);

router.post(
  "/getSponsorshipProposalHostpage",
  sponserController.getSponsorshipProposalHostpage
);
router.post("/updateSponsorSetup", sponserController.updateSponsorSetup);
router.post("/getuser", sponserController.getuser);
router.post("/updatePayout", sponserController.updatesponserPayout);

module.exports = router;
