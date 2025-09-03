const express = require("express");
const router = express.Router();

let wss; // WebSocket server instance

const setWebSocketServer = (webSocketServer) => {
  wss = webSocketServer; // Assign the WebSocket server instance
};

const attachWebSocket = (req, res, next) => {
  req.wss = wss; // Attach the WebSocket server instance to the request
  next();
};
const admincontractController = require("../controllers/admin/admincontractController");
router.post(
  "/deletefoldercontract",
  admincontractController.deletefoldercontract
);
router.post("/savecontractfiles", admincontractController.savecontractfiles);
router.post("/checkidvalid", admincontractController.checkidvalid);
router.post(
  "/deletefoldercontractFiles",
  admincontractController.deletefoldercontractFiles
);
router.post("/searchfolder", admincontractController.searchfolder);
router.post(
  "/getcontrectfiledWithfolder",
  admincontractController.getcontrectfiledWithfolder
);
router.post(
  "/savecontractfileswithfolder",
  admincontractController.savecontractfileswithfolder
);
router.post("/getcontrectfiled", admincontractController.getcontrectfiled);
router.post(
  "/sendcontractFiles",
  attachWebSocket,
  admincontractController.sendcontractFiles
);
router.post(
  "/sendcontractFolder",
  attachWebSocket,
  admincontractController.sendcontractFolder
);

router.post("/searchfile", admincontractController.searchfile);
router.post("/searcfileemployee", admincontractController.searcfileemployee);
router.post(
  "/getusercontractDetail",
  admincontractController.getusercontractDetail
);
router.post(
  "/uploadcontractFiles",
  admincontractController.uploadcontractFiles
);
router.post("/getackdocData", admincontractController.getackdocData);
router.post("/docdelete", admincontractController.docdelete);
router.post(
  "/getusercontractDetailFolderdetail",
  admincontractController.getusercontractDetailFolderdetail
);

module.exports = { router, setWebSocketServer };
