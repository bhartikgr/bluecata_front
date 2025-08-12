const express = require("express");
const router = express.Router();
const upload = require("../../middlewares/uploadDocsMiddleware");
const fs = require("fs");
const path = require("path");
const aifileController = require("../../controllers/user/aifileController");

router.post(
  "/uploadDocuments",
  upload.array("documents"),
  async (req, res, next) => {
    try {
      const userId = req.body.user_id;
      const filetype = req.body.filetype;

      if (!userId || !filetype) {
        return res.status(400).json({ error: "user_id and filetype required" });
      }

      const userFolder = path.join(
        __dirname,
        "..",
        "..",
        "upload",
        "docs",
        `doc_${userId}`,
        filetype
      );

      if (!fs.existsSync(userFolder)) {
        fs.mkdirSync(userFolder, { recursive: true });
      }

      const moveFilePromises = req.files.map((file) => {
        const originalName = file.originalname;
        let targetPath = path.join(userFolder, originalName);

        // If file exists, add suffix like (1), (2), etc.
        let counter = 1;
        const ext = path.extname(originalName);
        const base = path.basename(originalName, ext);

        while (fs.existsSync(targetPath)) {
          const newFilename = `${base}(${counter})${ext}`;
          targetPath = path.join(userFolder, newFilename);
          counter++;
        }

        return fs.promises.rename(file.path, targetPath).then(() => {
          file.path = targetPath; // update for controller use
          file.savedAs = path.basename(targetPath); // optional: custom key
        });
      });

      await Promise.all(moveFilePromises);

      next();
    } catch (err) {
      next(err);
    }
  },
  aifileController.uploadDocuments
);
router.post(
  "/uploadDocumentsEdit",
  upload.single("documents"), // single file only
  async (req, res, next) => {
    try {
      console.log(req.body);
      const userId = req.body.user_id;
      const filetype = req.body.filetype;

      if (!userId || !filetype || !req.file) {
        return res.status(400).json({
          error: "user_id, filetype, and document file are required.",
        });
      }

      const userFolder = path.join(
        __dirname,
        "..",
        "..",
        "upload",
        "docs",
        `doc_${userId}`,
        filetype
      );

      if (!fs.existsSync(userFolder)) {
        fs.mkdirSync(userFolder, { recursive: true });
      }

      const originalName = req.file.originalname;
      let targetPath = path.join(userFolder, originalName);

      // Avoid overwriting by appending (1), (2), etc.
      let counter = 1;
      const ext = path.extname(originalName);
      const base = path.basename(originalName, ext);

      while (fs.existsSync(targetPath)) {
        const newFilename = `${base}(${counter})${ext}`;
        targetPath = path.join(userFolder, newFilename);
        counter++;
      }

      await fs.promises.rename(req.file.path, targetPath);

      // Optional: you can attach this info for controller use
      req.file.path = targetPath;
      req.file.savedAs = path.basename(targetPath);

      next(); // pass control to controller
    } catch (err) {
      console.error("Upload error:", err);
      return res.status(500).json({ error: "File upload failed." });
    }
  },
  aifileController.uploadDocumentsEdit
);

router.post(
  "/CreateuserSubscriptionDataRoom",
  aifileController.CreateuserSubscriptionDataRoom
);
router.post(
  "/CreateuserSubscriptionDataRoomCheck",
  aifileController.CreateuserSubscriptionDataRoomCheck
);
router.post("/getcategoryname", aifileController.getcategoryname);
router.post("/UserDocDeleteFile", aifileController.UserDocDeleteFile);
router.post("/filedownload", aifileController.filedownload);
router.post("/getAIquestion", aifileController.getAIquestion);
router.post("/RespoonseAIquestion", aifileController.RespoonseAIquestion);
router.post("/fileApproved", aifileController.fileApproved);
router.post("/generateDocFile", aifileController.generateDocFile);
router.post("/getAISummary", aifileController.getAISummary);
router.post("/aisummaryUpdate", aifileController.aisummaryUpdate);
router.post("/generateProcessAI", aifileController.generateProcessAI);
router.post(
  "/checkuserSubscriptionThreeMonth",
  aifileController.checkuserSubscriptionThreeMonth
);
router.post("/perInstancePayment", aifileController.perInstancePayment);
router.post(
  "/CreateuserSubscriptionDataRoomPerinstance",
  aifileController.CreateuserSubscriptionDataRoomPerinstance
);
router.post("/getDocumentcheck", aifileController.getDocumentcheck);
router.post("/checkunicode", aifileController.checkunicode);
router.post("/checkcreditbalance", aifileController.checkcreditbalance);
router.post("/Addinvenstorreport", aifileController.Addinvenstorreport);
router.post("/getinvestorReports", aifileController.getinvestorReports);
router.post(
  "/aisummaryInvestorreportUpdate",
  aifileController.aisummaryInvestorreportUpdate
);
router.post(
  "/getinvestorReportsSingle",
  aifileController.getinvestorReportsSingle
);
router.post(
  "/checkSubscriptionInvestorReport",
  aifileController.checkSubscriptionInvestorReport
);
router.post(
  "/CreateuserSubscriptionInvestorReporting",
  aifileController.CreateuserSubscriptionInvestorReporting
);
router.post(
  "/getcheckDataRoomPlusInvestorSubscription",
  aifileController.getcheckDataRoomPlusInvestorSubscription
);

router.post("/checkapprovedorNot", aifileController.checkapprovedorNot);
router.get(
  "/api/download/:userId/:folder/:filename",
  aifileController.downloadFile
);
router.post("/checkreferCode", aifileController.checkreferCode);
router.post(
  "/CreateuserSubscription_AcademyCheck",
  aifileController.CreateuserSubscription_AcademyCheck
);
router.post(
  "/CreateuserSubscription_Academy",
  aifileController.CreateuserSubscription_Academy
);
router.post("/getcompanyData", aifileController.getcompanyData);
router.post(
  "/uploadcompanyLogo",
  upload.single("logo"),
  aifileController.uploadcompanyLogo
);
router.post("/filelock", aifileController.filelock);
router.post(
  "/lockFileCheckSubscription",
  aifileController.lockFileCheckSubscription
);
router.post(
  "/CreateuserSubscriptionPaymentLockFile",
  aifileController.CreateuserSubscriptionPaymentLockFile
);
router.post(
  "/CreateuserSubscriptionLockFile",
  aifileController.CreateuserSubscriptionLockFile
);
router.post("/fileslockorUnlock", aifileController.fileslockorUnlock);
router.post("/allfileslock", aifileController.allfileslock);
router.post(
  "/getAllExchangeCompanyData",
  aifileController.getAllExchangeCompanyData
);
router.post("/filelockunlock", aifileController.filelockunlock);
router.post(
  "/getInvestorReportlatest",
  aifileController.getInvestorReportlatest
);
module.exports = router;
