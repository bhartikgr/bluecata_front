const express = require("express");
const router = express.Router();
const registerController = require("../../controllers/user/registerController");
const uploadDocsMiddleware = require("../../middlewares/uploadDocsMiddleware");

// Define the POST /login route
router.post("/getallcountry", registerController.getallcountry);
router.post("/userRegister", registerController.userRegister);
router.post("/userLogin", registerController.userLogin);
router.post("/getModules", registerController.getModules);
router.post("/registerforZoom", registerController.registerforZoom);
router.post("/selectModule", registerController.selectModule);
router.post("/joinZoomMeeting", registerController.joinZoomMeeting);
router.post("/videolimitsave", registerController.videolimitsave);
router.post("/getcategories", registerController.getcategories);
router.post(
  "/uploadDocuments",
  uploadDocsMiddleware.array("documents"),
  registerController.uploadDocuments
);
router.post("/checkCompanyEmail", registerController.checkCompanyEmail);
router.post(
  "/getallSubscriptionPlan",
  registerController.getallSubscriptionPlan
);
router.post("/usersubscription", registerController.usersubscription);
router.post(
  "/checkmodulesubscription",
  registerController.checkmodulesubscription
);
router.post("/getzipcode", registerController.getzipcode);
router.post("/resetPassword", registerController.resetPassword);

router.post("/register_zoom", registerController.register_zoom);
router.post(
  "/get_registered_meetings",
  registerController.get_registered_meetings
);
router.post("/get_all_zoom_meetings", registerController.get_all_zoom_meetings);
router.post(
  "/sendAlluserReminderZoomLink",
  registerController.sendAlluserReminderZoomLink
);
router.post("/getcompanydetail", registerController.getcompanydetail);
router.get("/zoommeeting", registerController.zoommeeting);
router.post("/companydataUpdate", registerController.companydataUpdate);
router.post(
  "/getusersSubscriptionPlan",
  registerController.getusersSubscriptionPlan
);
router.post(
  "/get_combined_zoom_meetings",
  registerController.get_combined_zoom_meetings
);
router.post("/openZoomLink", registerController.openZoomLink);
router.post("/sendcontactInfo", registerController.sendcontactInfo);
router.post("/checkreferralCode", registerController.checkreferralCode);
router.post("/checkReferralUser", registerController.checkReferralUser);
router.post(
  "/getallsharedCodeByCompany",
  registerController.getallsharedCodeByCompany
);
router.post("/getallCodetrack", registerController.getallCodetrack);
router.post(
  "/getallCodetrackSingleDetail",
  registerController.getallCodetrackSingleDetail
);
router.post("/get_SessionMeeting", registerController.get_SessionMeeting);
module.exports = router;
