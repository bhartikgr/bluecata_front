const express = require("express");
const router = express.Router();
const vendorbrowserController = require("../../controllers/user/vendorbrowserController");

// Define the POST /login route
router.post("/getVendorbrowser", vendorbrowserController.getVendorbrowser);
router.post(
  "/getVendorbrowserProfile",
  vendorbrowserController.getVendorbrowserProfile
);
router.post("/getbrowserEvents", vendorbrowserController.getbrowserEvents);
router.post(
  "/createeventTovendor",
  vendorbrowserController.createeventTovendor
);
router.post("/EventForVendors", vendorbrowserController.EventForVendors);

router.post(
  "/VendorProfileEntity",
  vendorbrowserController.VendorProfileEntity
);
router.post("/VendorOffer", vendorbrowserController.VendorOffer);
router.post("/VendorProfile", vendorbrowserController.VendorProfile);
router.post("/ServiceListing", vendorbrowserController.ServiceListing);
router.post("/Servicecreate", vendorbrowserController.Servicecreate);
router.post("/editingService", vendorbrowserController.editingService);
router.post(
  "/ServiceListingDelete",
  vendorbrowserController.ServiceListingDelete
);
router.post("/VendorProfileGet", vendorbrowserController.VendorProfileGet);
router.post(
  "/VendorProfileCreate",
  vendorbrowserController.VendorProfileCreate
);
router.post(
  "/VendorProfileupdate",
  vendorbrowserController.VendorProfileupdate
);

router.post(
  "/VendorProfileUpdateImage",
  vendorbrowserController.VendorProfileUpdateImage
);
router.post(
  "/VendorProfileUpdateGalleryImage",
  vendorbrowserController.VendorProfileUpdateGalleryImage
);
router.post("/VendorLeadsGet", vendorbrowserController.VendorLeadsGet);
router.post(
  "/VendorProfileEntityList50",
  vendorbrowserController.VendorProfileEntityList50
);
router.post(
  "/getvendorRegisterdata",
  vendorbrowserController.getvendorRegisterdata
);
router.post(
  "/VendorProfileEntityUpdate",
  vendorbrowserController.VendorProfileEntityUpdate
);
router.post("/getUserDetail", vendorbrowserController.getUserDetail);
router.post("/getServiceListing", vendorbrowserController.getServiceListing);
router.post("/VendorLeadCreate", vendorbrowserController.VendorLeadCreate);
router.post("/VendorLeadUpdate", vendorbrowserController.VendorLeadUpdate);
router.post("/VendorLeadsGetall", vendorbrowserController.VendorLeadsGetall);
router.post(
  "/VendorProfiledashboard",
  vendorbrowserController.VendorProfiledashboard
);

module.exports = router;
