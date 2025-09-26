const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const { format } = require("date-fns");
const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const mysql = require("mysql2/promise"); // 👈 only used in this API
const cron = require("node-cron");
const puppeteer = require("puppeteer");
const Tesseract = require("tesseract.js");
const pdfParse = require("pdf-parse");
const OpenAI = require("openai");
const { logToFile, logError } = require("../../logger");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const yahooFinance = require("yahoo-finance2").default;
const Stripe = require("stripe");
const stripe = new Stripe(
  "sk_test_51RUJzWAx6rm2q3pyUl86ZMypACukdO7IsZ0AbsWOcJqg9xWGccwcQwbQvfCaxQniDCWzNg7z2p4rZS1u4mmDDyou00DM7rK8eY"
);
const upload = require("../../middlewares/uploadMiddleware");
const ImageModule = require("docxtemplater-image-module-free");
const sizeOf = require("image-size");
require("dotenv").config();
//Email Detail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
//Email Detail
exports.uploadDocuments = async (req, res) => {
  const datasave = req.body;

  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const extractedTexts = [];
    const [lockedDocs] = await db.promise().query(
      `SELECT id FROM dataroomdocuments 
       WHERE subcategory_id = ? AND company_id = ? AND locked = 'Yes'`,
      [datasave.subcatgeoryId, datasave.company_id]
    );
    const isLocked = lockedDocs.length > 0;

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      let text = "";

      try {
        if (ext === ".pdf") {
          const buffer = fs.readFileSync(file.path);
          const data = await pdfParse(buffer);
          text = data.text;
        } else if (ext === ".docx") {
          const result = await mammoth.extractRawText({ path: file.path });
          text = result.value;
        } else if (ext === ".xlsx") {
          const workbook = xlsx.readFile(file.path);
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          text = xlsx.utils.sheet_to_csv(sheet);
        } else if (ext === ".txt") {
          text = fs.readFileSync(file.path, "utf-8");
        } else if (
          [".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".gif"].includes(ext)
        ) {
          // OCR for image files (Node.js)
          const {
            data: { text: ocrText },
          } = await Tesseract.recognize(file.path, "eng");
          text = ocrText;
        } else {
          extractedTexts.push({
            filename: file.originalname,
            text: null,
            error: "Unsupported file type",
          });
          continue;
        }

        extractedTexts.push({
          filename: file.originalname,
          text,
          fileSavedAs: file.savedAs,
          filePath: file.path,
          error: null,
        });
      } catch (err) {
        extractedTexts.push({
          filename: file.originalname,
          text: null,
          error: "Error extracting text: " + err.message,
        });
      }
    }

    // Check for any extraction failure
    const failedExtractions = extractedTexts.filter(
      (file) => file.text === null && file.error
    );

    if (failedExtractions.length > 0) {
      return res.status(200).json({
        message: "Some files failed to extract text",
        failedFiles: failedExtractions,
        status: "2",
      });
    }

    // Save extracted documents to DB
    const insertedDocuments = [];

    for (const fileObj of extractedTexts) {
      const uploadedAt = new Date();

      try {
        const [result] = await db.promise().query(
          `INSERT INTO dataroomdocuments 
           (company_id,created_by_id,created_by_role, category_id, subcategory_id, folder_name, doc_name, summary_txt, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            datasave.company_id,
            datasave.created_by_id,
            datasave.created_by_role,
            datasave.catgeoryId || 0,
            datasave.subcatgeoryId || 0,
            datasave.filetype,
            fileObj.fileSavedAs,
            null, // summary to be filled later
            uploadedAt,
          ]
        );

        insertedDocuments.push({
          doc_id: result.insertId,
          filename: fileObj.filename,
          locked: false,
          filetype: datasave.filetype,
        });
      } catch (dbError) {
        console.error("Error inserting document:", dbError);
      }
    }

    return res.json({
      status: "1",
      message: "Files uploaded and saved successfully",
      extractedTexts,
      insertedDocuments,
      locked: isLocked,
    });
  } catch (error) {
    console.error("Error in uploadDocuments:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.uploadDocumentsEdit = async (req, res) => {
  const datasave = req.body;

  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const ext = path.extname(file.originalname).toLowerCase();
    let text = "";
    let error = null;

    try {
      if (ext === ".pdf") {
        const buffer = fs.readFileSync(file.path);
        const data = await pdfParse(buffer);
        text = data.text;
      } else if (ext === ".docx") {
        const result = await mammoth.extractRawText({ path: file.path });
        text = result.value;
      } else if (ext === ".xlsx") {
        const workbook = xlsx.readFile(file.path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        text = xlsx.utils.sheet_to_csv(sheet);
      } else if (ext === ".txt") {
        text = fs.readFileSync(file.path, "utf-8");
      } else if (
        [".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".gif"].includes(ext)
      ) {
        // ✅ OCR for image formats
        const {
          data: { text: ocrText },
        } = await Tesseract.recognize(file.path, "eng+hin");

        text = ocrText ? ocrText.trim() : "";
      } else {
        error = "Unsupported file type";
      }
    } catch (extractionErr) {
      console.error("Text extraction error:", extractionErr);
      error = "Error extracting text";
    }

    if (error || !text) {
      return res.status(200).json({
        status: "2",
        message: "Failed to extract file content",
        failedFiles: [
          {
            filename: file.originalname,
            error: error || "Unknown error",
          },
        ],
      });
    }
    var datee = new Date();

    if (datasave.documentId) {
      await db.promise().query(
        `UPDATE dataroomdocuments
         SET doc_name = ?,updated_by_id=?,updated_by_role=?,updated_at=?
         WHERE id = ?`,
        [
          file.savedAs,
          datasave.updated_by_id,
          datasave.updated_by_role,
          datee,
          datasave.documentId,
        ]
      );
    }

    res.status(200).json({
      status: "1",
      message: "Document updated and extracted successfully",
      filename: file.originalname,
      fileSavedAs: file.savedAs,
      extractedText: text,
    });
  } catch (error) {
    console.error("Error in uploadDocumentsEdit:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.CreateuserSubscriptionDataRoomCheck = async (req, res) => {
  const { amount } = req.body;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "eur",
      automatic_payment_methods: { enabled: true },
    });

    if (paymentIntent.client_secret) {
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    }
  } catch (err) {
    console.error("Stripe Error:", err);
    res.status(500).json({ error: err.message });
  }
};
exports.CreateuserSubscriptionDataRoom = async (req, res) => {
  const {
    discount,
    created_by_id,
    code,
    amount,
    company_id,
    clientSecret,
    payment_status,
  } = req.body;
  var dd = req.body;
  try {
    const userInsertQuery = `
        INSERT INTO usersubscriptiondataroomone_time 
        (payment_status,start_date, end_date, price, company_id, clientSecret, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

    const startDate = new Date();

    // Add 3 months to start date
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 1);

    db.query(
      userInsertQuery,
      [
        payment_status,
        startDate,
        endDate,
        amount,
        company_id,
        clientSecret,
        startDate,
      ],
      async (err, result) => {
        if (err) {
          console.error("DB Insert Error:", err);
          return res.status(500).json({ error: "Database error" + dd });
        }
        const insertId = result.insertId;

        // 2️⃣ Log into audit_logs
        const auditQuery = `
          INSERT INTO audit_logs 
          (user_id, company_id, module, action, entity_id, entity_type, details, ip_address, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;

        const auditValues = [
          created_by_id, // user_id
          company_id,
          "package-subscription", // module
          "CREATE", // action
          insertId, // entity_id
          "Dataroom Management + Investor Reporting", // entity_type
          JSON.stringify(req.body), // details
          req.body.ip_address || null, // ip_address
        ];

        db.query(auditQuery, auditValues, (auditErr) => {
          if (auditErr) console.error("Audit log insert failed:", auditErr);
        });
        if (code !== "") {
          const query = "SELECT * FROM  discount_code where code = ?";
          const insertId = result.insertId;
          db.query(query, [code], (err, row) => {
            if (err) {
              return res.status(500).json({
                message: "Database query error",
                error: err,
              });
            }
            var referData = row[0];
            var usecount = row[0].used_count + 1;
            db.query(
              "UPDATE discount_code SET used_count = ? WHERE code=?",
              [usecount, code],
              (finalErr) => {
                if (finalErr) {
                  return res
                    .status(500)
                    .json({ message: "Update failed", error: finalErr });
                }
                db.query(
                  `INSERT INTO used_referral_code 
                                 (discount_code,table_type,table_id,discounts,company_id, discount_code_id, payment_type, created_at) 
                                 VALUES (?,?, ?, ?, ?, ?, ?, NOW())`,
                  [
                    code,
                    "usersubscriptiondataroomone_time",
                    insertId,
                    discount,
                    company_id,
                    referData.id,
                    "Dataroom_Plus_Investor_Report",
                  ],
                  (insertErr) => {
                    if (insertErr)
                      console.error("Document log insert failed", insertErr);
                  }
                );
              }
            );
          });
        }
        res.status(200).json({
          message: "",
          status: 1,
        });
      }
    );
  } catch (err) {
    console.error("Stripe Error:", err);
    res.status(500).json({ error: err.message });
  }
};
exports.CreateuserSubscriptionDataRoomPerinstance = async (req, res) => {
  const {
    code,
    amount,
    company_id,
    clientSecret,
    created_by_id,
    PayidOnetime,
    payment_status,
  } = req.body;

  try {
    const userInsertQuery = `
        INSERT INTO usersubscriptiondataroom_perinstance 
        (payment_status,usersubscriptiondataroomone_time_id, price, company_id, clientSecret, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `;

    const startDate = new Date();

    db.query(
      userInsertQuery,
      [
        payment_status,
        PayidOnetime,
        amount,
        company_id,
        clientSecret,
        startDate,
      ],
      async (err, result) => {
        if (err) {
          console.error("DB Insert Error:", err);
          return res.status(500).json({ error: "Database error" });
        }
        const insertId = result.insertId;

        // 2️⃣ Log into audit_logs
        const auditQuery = `
          INSERT INTO audit_logs
          (user_id, company_id, module, action, entity_id, entity_type, details, ip_address, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;

        const auditValues = [
          created_by_id,
          company_id,
          "package-subscription", // module
          "CREATE", // action
          insertId, // entity_id
          "Instance payment", // entity_type
          JSON.stringify(req.body), // details
          req.body.ip_address || null,
        ];

        db.query(auditQuery, auditValues, (auditErr) => {
          if (auditErr) console.error("Audit log insert failed:", auditErr);
        });
        if (code !== "") {
          const query = "SELECT * FROM  discount_code where code = ?";

          db.query(query, [code], (err, row) => {
            if (err) {
              return res.status(500).json({
                message: "Database query error",
                error: err,
              });
            }
            var referData = row[0];
            var usecount = row[0].used_count + 1;
            db.query(
              "UPDATE discount_code SET used_count = ? WHERE code=?",
              [usecount, code],
              (finalErr) => {
                if (finalErr) {
                  return res
                    .status(500)
                    .json({ message: "Update failed", error: finalErr });
                }
              }
            );
          });
        }
        res.status(200).json({
          message: "",
          status: 1,
        });
      }
    );
  } catch (err) {
    console.error("Stripe Error:", err);
    res.status(500).json({ error: err.message });
  }
};
exports.getcategoryname = (req, res) => {
  var cat_id = req.body.cat_id;
  const query = "SELECT * FROM  dataroomcategories where id = ?";

  db.query(query, [cat_id], (err, row) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      row: row,
    });
  });
};
//sendmailcheck();

exports.UserDocDeleteFile = (req, res) => {
  const company_id = req.body.company_id;
  const id = req.body.id;

  if (!company_id || !id) {
    return res.status(400).json({ message: "company_id and id are required" });
  }

  // 1. Find the document record by id and company_id
  const query =
    "SELECT * FROM dataroomdocuments WHERE id = ? AND company_id = ?";

  db.query(query, [id, company_id], (err, rows) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    if (rows.length === 0) {
      return res.status(404).json({ message: "Document not found" });
    }

    const doc = rows[0];
    // Construct the file path based on your folder structure
    // Example: assuming folder_name corresponds to a folder, and doc_name is the file
    // Adjust folder path as per your upload folder structure
    const filePath = path.join(
      __dirname,
      "..",
      "..",
      "upload",
      "docs",
      `doc_${company_id}`,
      doc.folder_name,
      doc.doc_name
    );

    // 2. Delete the file from filesystem
    fs.unlink(filePath, (fsErr) => {
      if (fsErr && fsErr.code !== "ENOENT") {
        // ENOENT means file doesn't exist - maybe already deleted, ignore if so
        return res.status(500).json({
          message: "Failed to delete file from server",
          error: fsErr,
        });
      }

      // 3. Delete the record from database
      const deleteQuery =
        "DELETE FROM dataroomdocuments WHERE id = ? AND company_id = ?";

      db.query(deleteQuery, [id, company_id], (deleteErr, result) => {
        if (deleteErr) {
          return res.status(500).json({
            message: "Failed to delete document record",
            error: deleteErr,
          });
        }

        return res.json({
          message: "Document deleted successfully",
          affectedRows: result.affectedRows,
        });
      });
    });
  });
};
// In aifileController.js
exports.filedownload = (req, res) => {
  const { company_id, folderName, filename } = req.body;

  const filePath = path.join(
    __dirname,
    "..",
    "..",
    "upload",
    "docs",
    `doc_${company_id}`,
    folderName,
    filename
  );

  if (fs.existsSync(filePath)) {
    return res.download(filePath, filename); // ✅ Triggers file download in browser
  } else {
    return res.status(404).json({ error: "File not found" });
  }
};

exports.getAIquestion = (req, res) => {
  const company_id = req.body.company_id;
  const id = req.body.id;

  if (!company_id || !id) {
    return res.status(400).json({ message: "company_id and id are required" });
  }

  // 1. Find the document record by id and company_id
  const query =
    "SELECT * FROM dataroomai_response WHERE dataroomai_summary_id = ? AND company_id = ?";

  db.query(query, [id, company_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    return res.status(200).json({ results: results });
  });
};
exports.RespoonseAIquestion = async (req, res) => {
  const responses = req.body;

  if (!Array.isArray(responses)) {
    return res.status(400).json({ error: "Invalid data format" });
  }

  const connection = db.promise();

  try {
    for (const item of responses) {
      const { questionId, answer } = item;

      if (!questionId || answer === undefined) continue;

      await connection.query(
        `UPDATE dataroomai_response 
         SET answer = ?, updated_at = ?,updated_by_id=?,updated_by_role=?
         WHERE id = ?`,
        [
          answer,
          new Date(),
          responses.updated_by_id,
          responses.updated_by_role,
          questionId,
        ]
      );
    }

    res.status(200).json({ message: "Responses updated" });
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
exports.fileApproved = async (req, res) => {
  const responses = req.body;
  db.query(
    "UPDATE dataroomdocuments SET status = ? WHERE category_id = ? And company_id =?",
    ["Yes", responses.id, responses.company_id],
    (finalErr) => {
      if (finalErr) {
        return res
          .status(500)
          .json({ message: "Update failed", error: finalErr });
      }
      return res.status(200).json({ message: "Updated successfully" });
    }
  );
};
function formatCurrentDate() {
  const date = new Date(); // current date
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  const getOrdinal = (n) => {
    if (n >= 11 && n <= 13) return "th";
    switch (n % 10) {
      case 1:
        return "st";
      case 2:
        return "nd";
      case 3:
        return "rd";
      default:
        return "th";
    }
  };

  return `${month} ${day}${getOrdinal(day)}, ${year}`;
}
const safedoc = (val) => (val?.toString().trim() ? val : "N/A");

exports.generateDocFile = async (req, res) => {
  const responses = req.body;

  try {
    db.query(
      `SELECT 
          company.*,
          CASE 
              WHEN ? = 'owner' THEN owner.first_name
              WHEN ? = 'signatory' THEN cs.first_name
              ELSE NULL
          END AS first_name,
          CASE 
              WHEN ? = 'owner' THEN owner.last_name
              WHEN ? = 'signatory' THEN cs.last_name
              ELSE NULL
          END AS last_name
      FROM 
          company
          LEFT JOIN users AS owner ON company.user_id = owner.id
          LEFT JOIN company_signatories AS cs ON company.id = cs.company_id
      WHERE 
          company.id = ?
      `,
      [
        responses.created_by_role,
        responses.created_by_role,
        responses.created_by_role,
        responses.created_by_role,
        responses.company_id,
      ],
      (err, result) => {
        if (err)
          return res
            .status(500)
            .json({ message: "DB query failed", error: err });
        if (!result || result.length === 0)
          return res.status(404).json({ message: "Company not found" });

        const company = result[0];

        db.query(
          `SELECT * FROM usersubscriptiondataroomone_time WHERE unique_code = ?`,
          [responses.code],
          (err, qaResultss) => {
            if (err || !qaResultss?.length) {
              return res
                .status(500)
                .json({ message: "One-time code not found", error: err });
            }

            const oneTimeId = qaResultss[0].id;

            db.query(
              `SELECT * 
             FROM investor_updates 
             WHERE company_id = ? AND type = 'Due Diligence Document' order by id desc`,
              [responses.company_id],
              async (err, versionResult) => {
                if (err) {
                  return res
                    .status(500)
                    .json({ message: "Version fetch failed", error: err });
                }

                const latestVersion = Number(versionResult[0]?.version || 0);
                const version = latestVersion + 1;
                //console.log(companyLogoPath);

                db.query(
                  `SELECT dataroomai_summary.*, company.company_logo,company.company_name FROM dataroomai_summary JOIN company ON company.id = dataroomai_summary.company_id WHERE dataroomai_summary.company_id = ? AND dataroomai_summary.uniqcode = ?`,
                  [responses.company_id, responses.code],
                  async (err, fileSummaryResults) => {
                    if (err)
                      return res.status(500).json({
                        message: "Management Summary fetch failed",
                        error: err,
                      });
                    var corp = fileSummaryResults[0].company_name;
                    await analyzePublicPeers(
                      responses.company_id,
                      responses.code,
                      corp,
                      version
                    );
                    var executiveSummary = fileSummaryResults[0].summary || "";
                    let companyLogoPath = null;
                    if (fileSummaryResults[0].company_logo !== null) {
                      var pathname = "upload/docs/doc_" + responses.company_id;
                      var fullPath = `http://blueprintcatalyst.com/api/${pathname}/${fileSummaryResults[0].company_logo}`;

                      if (fullPath) {
                        // if (fs.existsSync(fullPath)) {
                        companyLogoPath = fullPath;
                        //}
                      }
                    }

                    let managementSummary = "",
                      productOr_Summary = "",
                      salesmarketing = "",
                      operations = "",
                      regulatory = "",
                      technology = "",
                      riskmanagement = "",
                      finanicalinformation = "";

                    fileSummaryResults?.forEach((row) => {
                      const text = row.summary?.substring(0, 800) || "";
                      switch (row.category_id) {
                        case 1:
                          if (!managementSummary) managementSummary = text;
                          break;
                        case 2:
                          if (!productOr_Summary) productOr_Summary = text;
                          break;
                        case 3:
                          if (!salesmarketing) salesmarketing = text;
                          break;
                        case 4:
                          if (!technology) technology = text;
                          break;
                        case 5:
                          if (!operations) operations = text;
                          break;
                        case 6:
                          if (!regulatory) regulatory = text;
                          break;
                        case 7:
                          if (!riskmanagement) riskmanagement = text;
                          break;
                        case 8:
                          if (!finanicalinformation)
                            finanicalinformation = text;
                          break;
                      }
                    });

                    db.query(
                      `SELECT category_id, subcategory_id, summary 
                         FROM dataroomai_summary_subcategory 
                         WHERE company_id = ? AND uniqcode = ? 
                         ORDER BY id DESC`,
                      [responses.company_id, responses.code],
                      (err, advisorResults) => {
                        if (err)
                          return res.status(500).json({
                            message: "Advisor fetch failed",
                            error: err,
                          });

                        let boardOfadvisor = "N/A",
                          Intellectual = "N/A";

                        for (const row of advisorResults) {
                          if (row.category_id === 1 && row.subcategory_id === 3)
                            boardOfadvisor =
                              row.summary?.substring(0, 200) || "N/A";
                          else if (
                            row.category_id === 2 &&
                            row.subcategory_id === 6
                          )
                            Intellectual =
                              row.summary?.substring(0, 200) || "N/A";
                        }

                        db.query(
                          `SELECT questions, answer, category_id 
                             FROM dataroomai_response 
                             WHERE company_id = ? AND uniqcode = ?`,
                          [responses.company_id, responses.code],
                          (err, qaResults) => {
                            if (err)
                              return res.status(500).json({
                                message: "Q&A fetch failed",
                                error: err,
                              });
                            db.query(
                              `SELECT * from company_exchange_world_details where uniqcode =? And company_id =? order by id desc Limit 1`,
                              [responses.code, responses.company_id],
                              async (err, companyresults) => {
                                let canada_TSX = "N/A";
                                let USA_NASDAQ = "N/A";
                                let USA_NYSE = "N/A";
                                let England_FTSE = "N/A";
                                let Australia_ASX = "N/A";
                                let EU = "N/A";
                                let China_HKEX = "N/A";
                                let China_SSE = "N/A";
                                let Singapore_SGX = "N/A";
                                let India_NSE = "N/A";
                                let press_public_reaction = "N/A";
                                let miscUploads = "N/A";

                                if (companyresults.length > 0) {
                                  try {
                                    const data = companyresults[0];

                                    // Safely parse miscUploads
                                    let datamiscUploads = [];
                                    try {
                                      datamiscUploads = JSON.parse(
                                        data.miscUploads || "[]"
                                      );
                                    } catch (parseErr) {
                                      console.error(
                                        "Error parsing miscUploads:",
                                        parseErr
                                      );
                                      datamiscUploads = [];
                                    }

                                    miscUploads = truncatewordarray(
                                      datamiscUploads,
                                      600
                                    );
                                    press_public_reaction = truncateword(
                                      data.press_public_reaction,
                                      600
                                    );

                                    // Safely parse each stock value
                                    const stockFields = [
                                      "canada_TSX",
                                      "usa_NASDAQ",
                                      "usa_NYSE",
                                      "england_FTSE",
                                      "australia_ASX",
                                      "EU",
                                      "china_HKEX",
                                      "china_SSE",
                                      "singapore_SGX",
                                      "india_NSE",
                                    ];

                                    stockFields.forEach((field) => {
                                      const value = data[field];
                                      if (
                                        value !== undefined &&
                                        value !== null
                                      ) {
                                        switch (field) {
                                          case "usa_NASDAQ":
                                            USA_NASDAQ =
                                              parseAndTruncate(value);
                                            break;
                                          case "usa_NYSE":
                                            USA_NYSE = parseAndTruncate(value);
                                            break;
                                          case "canada_TSX":
                                            canada_TSX =
                                              parseAndTruncate(value);
                                            break;
                                          case "england_FTSE":
                                            England_FTSE =
                                              parseAndTruncate(value);
                                            break;
                                          case "australia_ASX":
                                            Australia_ASX =
                                              parseAndTruncate(value);
                                            break;
                                          case "EU":
                                            EU = parseAndTruncate(value);
                                            break;
                                          case "china_HKEX":
                                            China_HKEX =
                                              parseAndTruncate(value);
                                            break;
                                          case "china_SSE":
                                            China_SSE = parseAndTruncate(value);
                                            break;
                                          case "singapore_SGX":
                                            Singapore_SGX =
                                              parseAndTruncate(value);
                                            break;
                                          case "india_NSE":
                                            India_NSE = parseAndTruncate(value);
                                            break;
                                        }
                                      }
                                    });
                                  } catch (err) {
                                    console.error(
                                      "Error processing company results:",
                                      err
                                    );
                                  }
                                }

                                const getQA = (categoryId) =>
                                  (qaResults || [])
                                    .filter(
                                      (item) => item.category_id === categoryId
                                    )
                                    .slice(0, 3)
                                    .map((item, index) => ({
                                      index: index + 1,
                                      question: item.questions?.trim() || "N/A",
                                      answer: item.answer?.trim() || "N/A",
                                    }));

                                const questionAnswers = getQA(2);
                                const questionAnswersSalesMarketing = getQA(3);
                                const questionAnswersTechnology = getQA(4);
                                const questionAnswersOperations = getQA(5);
                                const questionAnswersRegulatory = getQA(6);
                                const questionAnswersfinancialinformation =
                                  getQA(8);

                                const templatePath = path.resolve(
                                  __dirname,
                                  "../../upload/temp/Due_Diligence_and_Company_Overview_Document_Keiretsu_Forum_Canada.docx"
                                );

                                const content = fs.readFileSync(
                                  templatePath,
                                  "binary"
                                );
                                const imageModule = new ImageModule({
                                  getImage,
                                  getSize,
                                  centered: true,
                                });
                                const zip = new PizZip(content);
                                const doc = new Docxtemplater(zip, {
                                  paragraphLoop: true,
                                  linebreaks: true,
                                  modules: [imageModule],
                                });

                                const currentDate = formatCurrentDate();

                                const fileName = generateFileName(
                                  company.company_name,
                                  version
                                );
                                const companyLogoBase64 =
                                  await prepareLogoValue(companyLogoPath); // or your logo URL
                                var corp_mail_address = [
                                  company.company_street_address,
                                  company.company_city,
                                  company.company_state,
                                  company.company_postal_code,
                                  company.company_country,
                                ]
                                  .filter(Boolean) // remove any undefined or empty parts
                                  .join(", "); // join with comma and space

                                doc.render({
                                  companyLogoBase64: companyLogoBase64,
                                  company_name: safedoc(company.company_name),
                                  contact_email: safedoc(company.email),
                                  contact_phone: safedoc(company.phone),
                                  company_website: safedoc(
                                    company.company_website
                                  ),
                                  city_step2: safedoc(company.company_city),
                                  company_country: safedoc(
                                    company.company_country
                                  ),
                                  company_mail_address:
                                    safedoc(corp_mail_address),
                                  website: safedoc(company.company_website),
                                  first_name: safedoc(company.first_name),
                                  last_name: safedoc(company.last_name),
                                  created_at: formatWithOrdinal(
                                    new Date(company.created_at)
                                  ),
                                  version: version,
                                  current_Date: currentDate,
                                  executiveSummary: safedoc(executiveSummary),
                                  managementSummary: safedoc(managementSummary),
                                  boardOfadvisor: safedoc(boardOfadvisor),
                                  productOr_Summary: safedoc(productOr_Summary),
                                  Intellectual: safedoc(Intellectual),
                                  salesmarketing: safedoc(salesmarketing),
                                  operations: safedoc(operations),
                                  regulatory: safedoc(regulatory),
                                  technology: safedoc(technology),
                                  riskmanagement: safedoc(riskmanagement),
                                  finanicalinformation:
                                    safedoc(finanicalinformation),
                                  qas: questionAnswers,
                                  salesMarketing: questionAnswersSalesMarketing,
                                  technologyInfrastructure:
                                    questionAnswersTechnology,
                                  questionAnswersOperations,
                                  questionAnswersRegulatory,
                                  questionAnswersfinancialinformation,
                                  canada_TSX: canada_TSX,
                                  USA_NASDAQ: USA_NASDAQ,
                                  USA_NYSE: USA_NYSE,
                                  England_FTSE: England_FTSE,
                                  Australia_ASX: Australia_ASX,
                                  EU: EU,
                                  China_HKEX: China_HKEX,
                                  China_SSE: China_SSE,
                                  Singapore_SGX: Singapore_SGX,
                                  India_NSE: India_NSE,
                                  miscUploads: miscUploads,
                                  press_public_reaction: press_public_reaction,
                                });

                                const buffer = doc
                                  .getZip()
                                  .generate({ type: "nodebuffer" });

                                // Save to DB
                                db.query(
                                  `INSERT INTO investor_updates (
                                    company_id, type, version, update_date, document_name,
                                    is_locked, created_at, updated_at
                                  ) VALUES (?, ?, ?, NOW(), ?, ?, NOW(), NOW())`,
                                  [
                                    responses.company_id,
                                    "Due Diligence Document",
                                    version,
                                    fileName,
                                    1,
                                  ],
                                  (insertErr, result) => {
                                    if (insertErr) {
                                      console.error(
                                        "Static insert failed:",
                                        insertErr.sqlMessage ||
                                          insertErr.message,
                                        insertErr
                                      );
                                    } else {
                                      console.log(
                                        "Static insert success:",
                                        result
                                      );
                                    }
                                  }
                                );

                                // db.query(
                                //   `INSERT INTO investor_updates (
                                //   user_id,type, version, update_date, document_name, is_locked, created_at, updated_at
                                // ) VALUES (?,'Dataroom', ?, NOW(), ?, 1, NOW(), NOW())`,
                                //   [responses.user_id, version, fileName],
                                //   (insertErr) => {
                                //     if (insertErr)
                                //       console.error(
                                //         "Document log insert failed",
                                //         insertErr
                                //       );
                                //   }
                                // );
                                // db.query(
                                //   "UPDATE dataroomdocuments SET docs_generate = ? WHERE user_id=?",
                                //   ["Yes", responses.user_id],
                                //   (finalErr) => {
                                //     if (finalErr) {
                                //       return res.status(500).json({
                                //         message: "Update failed",
                                //         error: finalErr,
                                //       });
                                //     }
                                //   }
                                // );
                                db.query(
                                  `INSERT INTO dataroom_generatedocument
                             (company_id, version, usersubscriptiondataroomone_time_id, document_name, created_at)
                             VALUES (?, ?, ?, ?, NOW())`,
                                  [
                                    responses.company_id,
                                    version,
                                    oneTimeId,
                                    fileName,
                                  ],
                                  (insertErr) => {
                                    if (insertErr)
                                      console.error(
                                        "Document log insert failed",
                                        insertErr
                                      );
                                  }
                                );

                                // Save to file system
                                const folderPath = path.join(
                                  __dirname,
                                  "..",
                                  "..",
                                  "upload",
                                  "docs",
                                  `doc_${responses.company_id}`,
                                  "investor_report"
                                );

                                fs.mkdirSync(folderPath, { recursive: true });

                                const filePath = path.join(
                                  folderPath,
                                  fileName
                                );
                                fs.writeFileSync(filePath, buffer);

                                // Update subscription status
                                db.query(
                                  `UPDATE usersubscriptiondataroomone_time
                                 SET status = ?
                                 WHERE company_id = ? AND unique_code = ?`,
                                  [
                                    "Inactive",
                                    responses.company_id,
                                    responses.code,
                                  ],
                                  (finalErr) => {
                                    if (finalErr)
                                      console.error(
                                        "Update status failed",
                                        finalErr
                                      );
                                  }
                                );

                                // Send the file as response
                                // ✅ Set headers BEFORE sending response
                                res.setHeader(
                                  "Access-Control-Expose-Headers",
                                  "Content-Disposition"
                                );
                                res.setHeader(
                                  "Content-Disposition",
                                  `attachment; filename="${fileName}"`
                                );
                                res.setHeader(
                                  "Content-Type",
                                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                );
                                res.send(buffer);
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
    );
  } catch (error) {
    console.error("Error generating document:", error);
    res.status(500).json({ message: "Internal Server Error", error });
  }
};
function safeValue(value, defaultValue = "N/A") {
  return value !== undefined && value !== null && value !== ""
    ? value
    : defaultValue;
}
async function prepareLogoValue(url) {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
    });
    const base64 = Buffer.from(response.data, "binary").toString("base64");

    // Get image extension (e.g. png or jpeg)
    const ext = url.split(".").pop().toLowerCase();
    const mimeType =
      ext === "png"
        ? "image/png"
        : ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : "image/png"; // fallback

    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error("Failed to load image:", error.message);
    return "";
  }
}

const truncateDescriptions = (list) =>
  (list || []).map((item) => ({
    ...item,
    description: truncateText(item.description),
  }));
const truncateText = (text, maxLength = 300) => {
  if (!text) return "N/A";
  return text.length > maxLength ? text.slice(0, maxLength) + "..." : text;
};
const truncateword = (text, maxWords = 600) => {
  if (!text) return "N/A";
  const words = text.split(/\s+/);
  return words.length > maxWords
    ? words.slice(0, maxWords).join(" ") + "..."
    : text;
};
const truncatewordarray = (textArray, maxWords = 600) => {
  if (!Array.isArray(textArray) || textArray.length === 0) return "N/A";
  const combinedText = textArray.join(" ");
  const words = combinedText.split(/\s+/);
  return words.length > maxWords
    ? words.slice(0, maxWords).join(" ") + "..."
    : combinedText;
};

const parseAndTruncate = (jsonString) => {
  try {
    const list = JSON.parse(jsonString || "[]");
    return Array.isArray(list)
      ? list.map((item) => ({
          ...item,
          description: truncateText(item.description),
        }))
      : "N/A";
  } catch (e) {
    return "N/A";
  }
};
// Image module config
function getImage(tagValue) {
  // Remove base64 header if it exists
  const base64Data = tagValue.replace(/^data:image\/\w+;base64,/, "");
  return Buffer.from(base64Data, "base64");
}

function getSize(imgBuffer) {
  try {
    const { width, height } = sizeOf(imgBuffer);
    const maxWidth = 500;

    if (width > maxWidth) {
      const ratio = maxWidth / width;
      return [maxWidth, height * ratio];
    }

    return [width, height];
  } catch (err) {
    console.error("Error getting image size:", err.message);
    // Return default size if there's an error
    return [100, 50];
  }
}
// Helper: Create file name
function generateFileName(companyName, version) {
  const sanitized = companyName.replace(/[^a-zA-Z0-9]/g, "_");
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${sanitized}_Diligence_${dateStr}_v${version}.docx`;
}

function formatWithOrdinal(dateObj) {
  const day = dateObj.getDate();
  const month = dateObj.toLocaleString("en-US", { month: "long" });
  const year = dateObj.getFullYear();

  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
      ? "nd"
      : day % 10 === 3 && day !== 13
      ? "rd"
      : "th";

  return `${month} ${day}${suffix}, ${year}`;
}

exports.getAISummary = async (req, res) => {
  const responses = req.body;
  try {
    db.query(
      "SELECT * FROM  dataroomai_summary WHERE category_id = ? And company_id =?",
      [responses.id, responses.company_id],
      (err, row) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB query failed", error: err });
        }
        if (row.length > 0) {
          res
            .status(200)
            .json({ results: row[0].summary, row: row, status: 1 });
        } else {
          res.status(200).json({ results: [], row: [], status: 2 });
        }
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error });
  }
};
exports.aisummaryUpdate = async (req, res) => {
  const responses = req.body;
  try {
    db.query(
      "UPDATE dataroomai_summary SET summary = ? WHERE id = ?",
      [responses.aisummary, responses.id],
      (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB query failed", error: err });
        }
        res.status(200).json({});
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error });
  }
};

exports.generateProcessAI = async (req, res) => {
  const { company_id, payid } = req.body;
  var reqdata = req.body;
  const uniqcode = generateUniqueCode();
  const createdAt = new Date();
  try {
    const [docs] = await db
      .promise()
      .query(
        `SELECT * FROM dataroomdocuments WHERE company_id = ? And locked =?`,
        [company_id, "Yes"]
      );

    if (!docs.length) {
      return res.status(200).json({
        message:
          "Please lock at least one document to generate a due diligence summary",
        status: "2",
      });
    }
    //return;
    // Group documents by category_id (section)
    const catGroups = {};
    for (const doc of docs) {
      const catId = doc.category_id;
      if (!catGroups[catId]) catGroups[catId] = [];
      catGroups[catId].push(doc);
    }
    const docIds = Object.values(catGroups)
      .flat()
      .map((doc) => doc.id);
    // return;
    if (docIds.length > 0) {
      const placeholders = docIds.map(() => "?").join(", ");

      const sql = `UPDATE dataroomdocuments SET locked = 'Yes', Ai_generate = 'Yes' WHERE id IN (${placeholders})`;

      try {
        const [result] = await db.promise().query(sql, docIds);
        //console.log("Update result:", result);
      } catch (err) {
        //console.error("Update failed:", err);
      }
    }

    const summaries = [];
    const sectionSummaries = [];

    // Iterate per section (category_id)
    for (const [category_id, groupDocs] of Object.entries(catGroups)) {
      const fileTexts = [];

      for (const doc of groupDocs) {
        const filePath = path.join(
          __dirname,
          "..",
          "..",
          "upload",
          "docs",
          `doc_${doc.company_id}`,
          doc.folder_name,
          doc.doc_name
        );

        if (!fs.existsSync(filePath)) continue;

        let content = "";
        const ext = path.extname(doc.doc_name).toLowerCase();

        try {
          if (ext === ".txt") {
            content = fs.readFileSync(filePath, "utf-8");
          } else if (ext === ".pdf") {
            const buffer = fs.readFileSync(filePath);
            const data = await pdfParse(buffer);
            content = data.text;
          } else if (ext === ".docx") {
            const result = await mammoth.extractRawText({ path: filePath });
            content = result.value;
          } else if (ext === ".xlsx") {
            const workbook = xlsx.readFile(filePath);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            content = xlsx.utils.sheet_to_csv(sheet);
          } else if (
            [".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".gif"].includes(ext)
          ) {
            // ✅ OCR for image files
            const {
              data: { text: ocrText },
            } = await Tesseract.recognize(filePath, "eng+hin");
            content = ocrText;
          } else {
            continue;
          }

          fileTexts.push(`File: ${doc.doc_name}\n${content}`);
        } catch (e) {
          console.error(`Error reading file: ${filePath}`, e);
        }
      }

      if (!fileTexts.length) continue;

      const combinedText = fileTexts.join("\n\n---\n\n").slice(0, 15000);
      const prompt = `You are an AI assistant helping with due diligence document analysis.\n\nHere is the combined content of multiple documents:\n\n${combinedText}\n\nPlease:\n1. Identify key sections or topics.\n2. Summarize each in no more than 1000 characters.\n3. Return the result as a JSON array in this format:\n[\n  {\n    "heading": "Section Heading",\n    "summary": "Summary text..."\n  }\n]`;

      const response = await openai.chat.completions.create({
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: "You summarize due diligence documents." },
          { role: "user", content: prompt },
        ],
        max_tokens: 1000,
      });

      const rawContent = response.choices[0].message.content;
      const match = rawContent.match(/\[\s*{[\s\S]*?}\s*\]/);
      let finalSummaries = [];

      try {
        // Use non-greedy match to avoid over-capturing if applicable
        const summaryMatch = match?.[0]?.match(/\[\s*[\s\S]*?\s*\]/);

        if (summaryMatch) {
          finalSummaries = JSON.parse(summaryMatch[0]);
        } else {
          console.warn("⚠️ No valid JSON array found in match.");
        }
      } catch (err) {
        console.error("❌ Failed to parse summary JSON:", err.message);
        console.debug("🔍 Raw matched content:", match?.[0] ?? "No match");
      }

      let fileSummary = "";
      finalSummaries.forEach((item) => {
        if (item.heading && item.summary) {
          fileSummary += `${item.heading}\n${item.summary}\n\n`;
        }
      });

      const [summaryResult] = await db.promise().query(
        `INSERT INTO dataroomai_summary 
         (created_by_id,created_by_role,uniqcode, usersubscriptiondataroomone_time_id, company_id, summary, category_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reqdata.created_by_id,
          reqdata.created_by_role,
          uniqcode,
          payid,
          company_id,
          fileSummary,
          category_id,
          createdAt,
        ]
      );

      const summaryId = summaryResult.insertId;
      summaries.push({ category_id, summary: fileSummary });
      sectionSummaries.push(fileSummary); // for executive summary

      // Generate 3 due diligence questions
      const qPrompt = `You are a due diligence analyst. Based on the following summary:\n\n"${fileSummary}"\n\nGenerate 3 important due diligence questions. Return them as a JSON array of strings.`;

      const qResponse = await openai.chat.completions.create({
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: "You generate due diligence questions." },
          { role: "user", content: qPrompt },
        ],
        max_tokens: 500,
      });

      let questions = [];

      try {
        // Non-greedy match to safely extract first JSON-like array
        const qMatch =
          qResponse.choices[0].message.content.match(/\[\s*[\s\S]*?\s*\]/);

        if (qMatch) {
          questions = JSON.parse(qMatch[0]);
        } else {
          console.warn("⚠️ No JSON array found in AI response.");
        }
      } catch (err) {
        console.error("❌ Failed to parse questions JSON:", err.message);
        console.debug("🔍 Raw matched content:", qMatch?.[0] ?? "No match");
      }

      for (const question of questions.slice(0, 3)) {
        await db.promise().query(
          `INSERT INTO dataroomai_response 
           (created_by_id,created_by_role,company_id, dataroomai_summary_id, uniqcode, category_id, questions, answer, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            reqdata.created_by_id,
            reqdata.created_by_role,
            company_id,
            summaryId,
            uniqcode,
            category_id,
            question,
            null,
            new Date(),
          ]
        );
      }
    }

    // ✅ Executive Summary
    const execPrompt = `You are a due diligence expert. Below are summaries from different sections:\n\n${sectionSummaries.join(
      "\n\n"
    )}\n\nGenerate a concise executive summary (max 1000 characters) that captures the key insights.`;

    const execResponse = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        {
          role: "system",
          content: "You generate executive due diligence summaries.",
        },
        { role: "user", content: execPrompt },
      ],
      max_tokens: 500,
    });

    const executiveSummary = execResponse.choices[0].message.content;

    // Optional: Save executive summary (if table exists)
    await db
      .promise()
      .query(
        `INSERT INTO dataroomai_executive_summary (created_by_id,created_by_role,uniqcode,usersubscriptiondataroomone_time_id, company_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          reqdata.created_by_role,
          reqdata.created_by_id,
          uniqcode,
          payid,
          company_id,
          executiveSummary,
          new Date(),
        ]
      );

    // Update status
    db.query(
      "UPDATE usersubscriptiondataroomone_time SET unique_code = ?, status = ? WHERE id = ?",
      [uniqcode, "Active", payid],
      (finalErr) => {
        if (finalErr) {
          return res
            .status(500)
            .json({ message: "Update failed", error: finalErr });
        }
      }
    );
    const [companyResult] = await db.promise().query(
      `
          SELECT cs.*, c.company_name 
          FROM company_signatories cs 
          JOIN company c ON cs.company_id = c.id 
          WHERE c.id = ?
        `,
      [company_id]
    );

    if (companyResult.length > 0) {
      let userEmail;
      let companyName = companyResult[0].company_name;

      if (reqdata.created_by_role === "signatory") {
        // Signatory case
        userEmail = companyResult[0].signatory_email;
      } else {
        // Owner case – get email from users table
        const [userResult] = await db
          .promise()
          .query(`SELECT email FROM users WHERE id = ?`, [
            reqdata.created_by_id,
          ]);

        if (userResult.length > 0) {
          userEmail = userResult[0].email;
        } else {
          return res.status(404).json({ message: "User not found" });
        }
      }

      await sendApprovalEmail({
        email: userEmail,
        companyName,
        uniqcode,
      });
    }

    db.query(
      "UPDATE dataroomdocuments SET docs_generate = ? WHERE company_id=?",
      ["Yes", company_id],
      (finalErr) => {
        if (finalErr) {
          return res.status(500).json({
            message: "Update failed",
            error: finalErr,
          });
        }
      }
    );
    db.query(
      `DELETE FROM subscription_statuslockfile WHERE company_id = ?`,
      [company_id],
      (deleteErr) => {
        if (deleteErr) {
          //console.error("Failed to delete lock file status", deleteErr);
        } else {
          //console.log("Old lock file status deleted successfully.");
        }
      }
    );
    return res.status(200).json({
      message: "Summaries and questions generated.",
      status: "1",
      summaries,
      executiveSummary,
      code: uniqcode,
    });
  } catch (error) {
    console.error("❌ Error in generateProcessAI:", error);
    return res.status(500).json({ message: "Internal server error", error });
  }
};
async function sendApprovalEmail({ email, companyName, uniqcode }) {
  const subject = `Due Diligence Summary Ready for Approval - Capavate`;
  const approvalLink = `http://blueprintcatalyst.com/approvalpage/${uniqcode}`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  // HTML Template (formatted like sendEmailResetpassword)
  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Approval Notification</title>
  </head>
  <body>
    <div style="width:600px; margin:0 auto; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; font-family:Verdana, Geneva, sans-serif;">
      <table style="width:100%; border-collapse: collapse;">
        <tr>
          <td style="background:#efefef; padding:10px; text-align:center;">
            <img src="http://blueprintcatalyst.com/api/upload/images/logo.png" alt="logo" style="width:130px;" />
          </td>
        </tr>
        <tr>
          <td style="padding:20px;">
            <h2 style="font-size:16px; color:#111;">Hello ${
              companyName || "User"
            },</h2>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              Your Due Diligence document summaries are ready for review.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              Please click the button below to view and approve:
            </p>
            <div style="margin:20px 0;">
              <a href="${approvalLink}" style="display:inline-block; padding:12px 24px; background-color:#1e3a8a; color:#fff; text-decoration:none; border-radius:6px;">
                View Approval Docs
              </a>
            </div>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              If the button above does not work, you can also copy and open this link manually:
            </p>
            <p style="font-size:14px; color:#111; word-break:break-word;">
              <a href="${approvalLink}">${approvalLink}</a>
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:0;">Regards,<br/>Capavate Team</p>
          </td>
        </tr>
      </table>
      <div style="text-align:center; font-size:12px; color:#999; padding:10px 0;">
        Capavate. Powered by Blueprint Catalyst Limited
      </div>
    </div>
  </body>
  </html>
  `;

  const mailOptions = {
    from: '"Capavate" <scale@blueprintcatalyst.com>',
    to: email,
    subject,
    html: htmlBody,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Approval email sent:", info.response);
    return true;
  } catch (error) {
    console.error("❌ Approval email send failed:", error);
    return false;
  }
}

function generateUniqueCode(length = 6) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

exports.checkuserSubscriptionThreeMonth = async (req, res) => {
  const responses = req.body;
  try {
    db.query(
      "SELECT * FROM usersubscriptiondataroomone_time WHERE company_id = ? AND end_date >= CURRENT_DATE ORDER BY id DESC;",
      [responses.company_id],
      (err, row) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB query failed", error: err });
        }

        res.status(200).json({ results: row });
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error });
  }
};
exports.perInstancePayment = async (req, res) => {
  const { company_id, payid } = req.body;
  try {
    // Step 1: Get total summaries
    db.query(
      "SELECT COUNT(*) AS summaryCount FROM dataroomai_executive_summary WHERE company_id = ? AND usersubscriptiondataroomone_time_id = ?",
      [company_id, payid],
      (err, summaryResults) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB summary query failed", error: err });
        }

        const totalSummaries = summaryResults[0].summaryCount;

        // Step 2: Get total per-instance payments
        db.query(
          "SELECT COUNT(*) AS paymentCount FROM usersubscriptiondataroom_perinstance WHERE company_id = ? AND usersubscriptiondataroomone_time_id = ?",
          [company_id, payid],
          (err, paymentResults) => {
            if (err) {
              return res
                .status(500)
                .json({ message: "DB payment query failed", error: err });
            }

            const paymentCount = paymentResults[0].paymentCount;

            const allowedFree = 1;
            const paidSummaries = totalSummaries - allowedFree;

            // Step 3: Business logic
            if (totalSummaries < allowedFree) {
              return res.status(200).json({
                status: "free",
                allowGeneration: true,
                totalSummaries,
                paymentCount,
              });
            }

            if (paidSummaries < paymentCount) {
              return res.status(200).json({
                status: "paid-allowed",
                allowGeneration: true,
                totalSummaries,
                paymentCount,
              });
            } else {
              return res.status(200).json({
                status: "need-payment",
                allowGeneration: false,
                totalSummaries,
                paymentCount,
              });
            }
          }
        );
      }
    );
  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error", error });
  }
};
exports.getDocumentcheck = async (req, res) => {
  const { company_id } = req.body;

  try {
    // Step 1: Get total summaries
    db.query(
      "SELECT * FROM dataroomdocuments WHERE company_id = ?",
      [company_id],
      (err, summaryResults) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB summary query failed", error: err });
        }

        return res.status(200).json({
          status: "",
          results: summaryResults,
        });
      }
    );
  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error", error });
  }
};
exports.getcompanyData = async (req, res) => {
  const { company_id } = req.body;

  try {
    // Step 1: Get total summaries
    db.query("SELECT * FROM company WHERE id = ?", [company_id], (err, row) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "DB summary query failed", error: err });
      }
      var pathname = "upload/docs/doc_" + company_id;
      const updatedResults = row.map((doc) => ({
        ...doc,
        downloadUrl:
          doc.company_logo && doc.company_logo.trim() !== ""
            ? `http://blueprintcatalyst.com/api/${pathname}/${doc.company_logo}`
            : "http://blueprintcatalyst.com/api/upload/docs/download.png",
      }));

      return res.status(200).json({
        status: "",
        results: updatedResults,
      });
    });
  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error", error });
  }
};
exports.checkunicode = async (req, res) => {
  const { company_id, code } = req.body;
  try {
    // Step 1: Get total summaries
    db.query(
      "SELECT * FROM usersubscriptiondataroomone_time WHERE company_id = ? And unique_code = ? And status =?",
      [company_id, code, "Active"],
      (err, summaryResults) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB summary query failed", error: err });
        }

        return res.status(200).json({
          status: "",
          results: summaryResults,
        });
      }
    );
  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error", error });
  }
};
exports.checkcreditbalance = async (req, res) => {
  const { company_id } = req.body;

  try {
    // Step 1: Get latest subscription
    db.query(
      `SELECT *
       FROM usersubscriptiondataroomone_time 
       WHERE company_id = ? And end_date >= CURRENT_DATE
       ORDER BY id DESC 
       LIMIT 1`,
      [company_id],
      (err, subscriptionResults) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Subscription query failed", error: err });
        }

        if (subscriptionResults.length === 0) {
          return res.status(200).json({ message: "No subscription found" });
        }

        const subscription = subscriptionResults[0];
        const subscriptionId = subscription.id;

        // Step 2: Count generated summaries
        db.query(
          `SELECT COUNT(*) AS total_generated 
           FROM dataroomai_summary 
           WHERE company_id = ? AND usersubscriptiondataroomone_time_id = ?`,
          [company_id, subscriptionId],
          (err, summaryCountResults) => {
            if (err) {
              return res
                .status(500)
                .json({ message: "Summary count query failed", error: err });
            }

            const totalGenerated = summaryCountResults[0].total_generated;
            const freeCredits = 2;
            const extraGenerations = Math.max(0, totalGenerated - freeCredits);
            const creditBalance = Math.max(0, freeCredits - totalGenerated);
            const amountDue = extraGenerations * 100;

            return res.status(200).json({
              status: "success",
              subscription_id: subscriptionId,
              total_generated: totalGenerated,
              credit_balance: creditBalance,
              extra_generations: extraGenerations,
              amount_due: amountDue,
              valid_until: subscription.end_date,
            });
          }
        );
      }
    );
  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error", error });
  }
};

const safe = (value) => {
  if (value === undefined || value === null || value === "") return null;
  return value;
};

exports.addinvenstorreport = async (req, res) => {
  logToFile("===== API START: addinvenstorreport =====");

  try {
    const {
      company_id,
      financialPerformance,
      operationalUpdates,
      marketCompetitive,
      customerProduct,
      fundraisingFinancial,
      futureOutlook,
    } = req.body;

    logToFile("Step 1: Validating input...");
    if (!company_id) {
      logError("Missing company_id");
      return res.status(400).json({
        success: false,
        message: "company_id is required.",
      });
    }

    logToFile("Step 2: Getting latest version from DB...");
    const versionQuery = `SELECT MAX(version) AS max_version FROM investor_updates WHERE company_id = ? And type =?`;
    db.query(
      versionQuery,
      [company_id, "Investor updates"],
      async (err, versionResults) => {
        if (err) {
          logError("DB version query error: " + err.message);
          return res.status(500).json({
            success: false,
            message: err,
          });
        }

        const latestVersion = Number(versionResults[0]?.max_version || 0);
        const newVersion = latestVersion + 1;
        logToFile(
          `Latest version: ${latestVersion}, New version: ${newVersion}`
        );

        let previousData = null;
        if (latestVersion > 0) {
          logToFile("Step 3: Fetching previous data...");
          const prevQuery = `
          SELECT financial_performance, operational_updates, market_competitive,
                 customer_product, fundraising_financial, future_outlook
          FROM investor_updates
          WHERE company_id = ? AND version = ? And type = ?
        `;
          const [prevResults] = await db
            .promise()
            .query(prevQuery, [company_id, latestVersion, "Investor updates"]);
          previousData = prevResults[0] || null;
        }

        logToFile("Step 4: Preparing OpenAI prompt...");
        const comparisonPrompt = previousData
          ? `
You are an AI assistant helping write investor updates. Compare the previous update with the latest update and summarize the differences clearly.

Previous Update:
- Financial: ${previousData.financial_performance}
- Operational: ${previousData.operational_updates}
- Market: ${previousData.market_competitive}
- Customer/Product: ${previousData.customer_product}
- Fundraising: ${previousData.fundraising_financial}
- Outlook: ${previousData.future_outlook}

Current Update:
- Financial: ${financialPerformance}
- Operational: ${operationalUpdates}
- Market: ${marketCompetitive}
- Customer/Product: ${customerProduct}
- Fundraising: ${fundraisingFinancial}
- Outlook: ${futureOutlook}

Write a detailed executive summary (~200 words) showing progress or changes.
`
          : `
You are an AI assistant helping prepare a professional investor update. Summarize the following information into an executive summary (~200 words).

Financial Performance: ${financialPerformance}
Operational Updates: ${operationalUpdates}
Market & Competitive Landscape: ${marketCompetitive}
Customer & Product Insights: ${customerProduct}
Fundraising & Financial Strategy: ${fundraisingFinancial}
Future Outlook & Strategy: ${futureOutlook}
`;

        logToFile("Step 5: Calling OpenAI API...");
        const chatResponse = await openai.chat.completions.create({
          model: "gpt-4-turbo",
          messages: [{ role: "user", content: comparisonPrompt }],
          temperature: 0.7,
        });
        logToFile("OpenAI API response received.");

        const executive_summary =
          chatResponse.choices[0].message.content.trim();

        logToFile("Step 6: Fetching company name...");
        const [companyResult] = await db
          .promise()
          .query("SELECT company_name FROM company WHERE id = ? LIMIT 1", [
            company_id,
          ]);
        const companyName =
          companyResult[0]?.company_name?.replace(/\s+/g, "_") || "company";

        const formattedDate = formatCustomDate(new Date());
        const pdfFileName = `${companyName}_investor_update_v${newVersion}_${formattedDate}.pdf`;

        logToFile("Step 7: Generating PDF with Puppeteer...");
        const folderPath = path.join(
          __dirname,
          "..",
          "..",
          "upload",
          "docs",
          `doc_${company_id}`,
          "investor_report"
        );
        fs.mkdirSync(folderPath, { recursive: true });

        const pdfFilePath = path.join(folderPath, pdfFileName);

        const htmlContent = `
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; padding: 30px; }
              h1, h2, h3 { color: #333; }
              p { line-height: 1.6; }
            </style>
          </head>
          <body>
            <h2>Investor Report for ${companyName}</h2>
            <p><strong>Version:</strong> ${newVersion}</p>
            <p><strong>Date:</strong> ${formattedDate}</p>
            <h3>Executive Summary:</h3>
            <p>${executive_summary.replace(/\n/g, "<br>")}</p>
          </body>
        </html>
      `;

        const browser = await puppeteer.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: "networkidle0" });
        await page.pdf({ path: pdfFilePath, format: "A4" });
        await browser.close();
        logToFile("PDF generated: " + pdfFileName);

        logToFile("Step 8: Inserting into DB...");
        const insertQuery = `
        INSERT INTO investor_updates (
          type,company_id, version, update_date,
          financial_performance, operational_updates, market_competitive,
          customer_product, fundraising_financial, future_outlook,
          executive_summary, document_name, is_locked, created_at, updated_at
        ) VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;

        const safe = (v) =>
          v === undefined || v === null || v === "" ? null : v;

        const values = [
          "Investor updates",
          safe(company_id),
          newVersion,
          safe(financialPerformance),
          safe(operationalUpdates),
          safe(marketCompetitive),
          safe(customerProduct),
          safe(fundraisingFinancial),
          safe(futureOutlook),
          safe(executive_summary),
          pdfFileName,
          0,
        ];

        db.query(insertQuery, values, (err, result) => {
          if (err) {
            logError("Insert failed: " + err.message);
            return res.status(500).json({
              success: false,
              message: "Insert failed.",
              error: err.message,
            });
          }

          logToFile("===== API END SUCCESS =====");
          const logQuery = `
    INSERT INTO audit_logs (
      user_id, company_id, module, action, entity_id, entity_type, details, ip_address, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;

          const logValues = [
            req.body.user_id || 0, // Assuming you store user in req.user
            company_id,
            "investorlist", // module
            "CREATE", // action
            "", // entity_id
            "investor_updates", // entity_type
            JSON.stringify({
              version: newVersion,
              document_name: pdfFileName,
              executive_summary: executive_summary.slice(0, 200) + "...", // limit size
            }),
            req.body.ip_address, // ip_address
          ];

          db.query(logQuery, logValues, (logErr) => {
            if (logErr) {
              logError("Audit log insert failed: " + logErr.message);
              // Don’t block the response if logging fails
            }
          });
          return res.status(200).json({
            success: true,
            message: `Investor report version ${newVersion} created and saved as PDF.`,
            document_name: pdfFileName,
            executive_summary,
          });
        });
      }
    );
  } catch (error) {
    logError("Unexpected error: " + error.message);
    return res.status(500).json({
      success: false,
      message: "Something went wrong.",
      error: error.message,
    });
  }
};
function formatCustomDate(date) {
  const month = format(date, "LLLL");
  const day = Number(format(date, "d"));
  const year = format(date, "yyyy");

  const suffix =
    day > 3 && day < 21 ? "th" : ["st", "nd", "rd"][(day % 10) - 1] || "th";

  return `${month}_${day}${suffix}_${year}`;
}
exports.getinvestorReports = (req, res) => {
  const company_id = req.body.company_id;

  const query = `
    SELECT investor_updates.*, company.company_name 
    FROM investor_updates 
    LEFT JOIN company ON company.id = investor_updates.company_id 
    WHERE investor_updates.company_id = ? And investor_updates.type =?
    ORDER BY investor_updates.id DESC;
  `;

  db.query(query, [company_id, "Investor updates"], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    var pathname = "upload/docs/doc_" + company_id;
    const updatedResults = results.map((doc) => ({
      ...doc,
      downloadUrl: `http://blueprintcatalyst.com/api/${pathname}/investor_report/${doc.document_name}`,
    }));

    res.status(200).json({
      results: updatedResults,
    });
  });
};
exports.getInvestorReportlatest = (req, res) => {
  const user_id = req.body.user_id;

  const query = `
    SELECT investor_updates.*, company.company_name
FROM investor_updates
LEFT JOIN company ON company.id = investor_updates.user_id
LEFT JOIN sharereport ON sharereport.investor_updates_id = investor_updates.id
WHERE investor_updates.user_id = ?
  AND sharereport.investor_updates_id IS NULL
ORDER BY investor_updates.id DESC;
;
  `;

  db.query(query, [user_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    var pathname = "upload/docs/doc_" + user_id;
    const updatedResults = results.map((doc) => ({
      ...doc,
      downloadUrl: `http://blueprintcatalyst.com/api/${pathname}/investor_report/${doc.document_name}`,
    }));
    res.status(200).json({
      results: updatedResults,
    });
  });
};

exports.downloadFile = (req, res) => {
  const { userId, folder, filename } = req.params;

  const filePath = path.join(
    __dirname,
    "..",
    "..",
    "upload",
    "docs",
    `doc_${userId}`,
    folder,
    filename
  );

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }

  res.download(filePath, filename, (err) => {
    if (err) {
      console.error("Download error:", err);
      res.status(500).send("Download failed");
    }
  });
};
exports.getinvestorReportsSingle = (req, res) => {
  var company_id = req.body.company_id;
  var id = req.body.id;
  const query = "SELECT * from investor_updates where company_id =?  And id=?";
  db.query(query, [company_id, id], (err, row) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    res.status(200).json({
      results: row,
    });
  });
};

exports.aisummaryInvestorreportUpdate = async (req, res) => {
  const responses = req.body;
  try {
    db.query(
      "UPDATE investor_updates SET executive_summary = ?, is_locked = ?  WHERE id = ?",
      [responses.aisummary, "1", responses.id],
      (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB query failed", error: err });
        }
        res.status(200).json({});
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error });
  }
};
exports.checkSubscriptionInvestorReport = async (req, res) => {
  const { company_id } = req.body;

  try {
    const subscriptionQuery = `
      SELECT * 
      FROM usersubscriptiondataroomone_time 
      WHERE company_id = ? 
        AND end_date >= CURRENT_DATE 
      ORDER BY id DESC
    `;

    const updateQuery = `
      SELECT * 
      FROM investor_updates 
      WHERE company_id = ? 
        AND type = 'Investor updates' 
        AND QUARTER(created_at) = QUARTER(CURRENT_DATE) 
        AND YEAR(created_at) = YEAR(CURRENT_DATE) 
      ORDER BY created_at DESC
    `;

    db.query(subscriptionQuery, [company_id], (err1, subResults) => {
      if (err1) {
        return res
          .status(500)
          .json({ message: "Subscription query failed", error: err1 });
      }

      db.query(updateQuery, [company_id], (err2, updateResults) => {
        if (err2) {
          return res
            .status(500)
            .json({ message: "Investor update query failed", error: err2 });
        }

        const hasSubscription = subResults.length > 0;
        const hasQuarterlyUpdate = updateResults.length > 0;

        const lastUpdateDate = hasQuarterlyUpdate
          ? updateResults[0].created_at
          : null;

        res.status(200).json({
          subscriptionActive: hasSubscription,
          updateAlreadySubmitted: hasQuarterlyUpdate,
          lastUpdateDate,
        });
      });
    });
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error });
  }
};

exports.CreateuserSubscriptionInvestorReporting = async (req, res) => {
  const { discount, amount, code, created_by_id, company_id, clientSecret } =
    req.body;

  try {
    const userInsertQuery = `
        INSERT INTO usersubscriptiondataroomone_time 
        (start_date, end_date, price, company_id, clientSecret, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `;

    const startDate = new Date();

    // Add 3 months to start date
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 12);

    db.query(
      userInsertQuery,
      [startDate, endDate, amount, company_id, clientSecret, startDate],
      async (err, result) => {
        if (err) {
          console.error("DB Insert Error:", err);
          return res.status(500).json({ error: "Database error" });
        }
        var insertId = result.insertId;
        const auditQuery = `
          INSERT INTO audit_logs
          (user_id, company_id, module, action, entity_id, entity_type, details, ip_address, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;
        const auditValues = [
          created_by_id || null,
          company_id || null,
          "package-subscription",
          "CREATE",
          insertId,
          "Dataroom Management + Investor Reporting",
          JSON.stringify(req.body),
          req.body.ip_address || null,
        ];
        db.query(auditQuery, auditValues, (auditErr) => {
          if (auditErr) console.error("Audit log insert failed:", auditErr);
        });

        // if (code !== "") {
        //   const query = "SELECT * FROM  discount_code where code = ?";
        //   const insertId = result.insertId;
        //   db.query(query, [code], (err, row) => {
        //     if (err) {
        //       return res.status(500).json({
        //         message: "Database query error",
        //         error: err,
        //       });
        //     }
        //     var usecount = row[0].used_count + 1;
        //     var referData = row[0];
        //     db.query(
        //       "UPDATE discount_code SET used_count = ? WHERE code=?",
        //       [usecount, code],
        //       (finalErr) => {
        //         if (finalErr) {
        //           return res
        //             .status(500)
        //             .json({ message: "Update failed", error: finalErr });
        //         }
        //         db.query(
        //           `INSERT INTO used_referral_code
        //                          (discount_code,table_type,table_id,discounts,user_id, discount_code_id, payment_type, created_at)
        //                          VALUES (?, ? ,? ,?, ?, ?, ?, NOW())`,
        //           [
        //             code,
        //             "userinvestorreporting_subscription",
        //             insertId,
        //             discount,
        //             user_id,
        //             referData.id,
        //             "Dataroom_Plus_Investor_Report",
        //           ],
        //           (insertErr) => {
        //             if (insertErr)
        //               console.error("Document log insert failed", insertErr);
        //           }
        //         );
        //       }
        //     );
        //   });
        // }
        res.status(200).json({
          message: "",
          status: 1,
        });
      }
    );
  } catch (err) {
    console.error("Stripe Error:", err);
    res.status(500).json({ error: err.message });
  }
};
exports.getcheckDataRoomPlusInvestorSubscription = async (req, res) => {
  const { company_id } = req.body;

  try {
    db.query(
      "SELECT MAX(end_date) AS active_until FROM ( SELECT end_date FROM usersubscriptiondataroomone_time WHERE company_id = ? UNION SELECT end_date FROM userinvestorreporting_subscription WHERE company_id = ? ) AS all_dates WHERE end_date >= CURDATE();",
      [company_id, company_id],
      (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB query failed", error: err });
        }
        res.status(200).json({ results: results });
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error });
  }
};
{
  /***This api use for all user Data delete Related***/
}

function sendReminder(to, companyName, message) {
  const subject = `Reminder: Data Room Deletion Notice for ${companyName}`;

  const body = `
    Dear ${companyName},

    This is a friendly reminder that your Data Room subscription has expired.

    ${message}

    If you wish to keep your files and continue allowing investor access, please renew your subscription before the deletion date.

    Regards,  
    Startup Portal Team
    `;

  const mailOptions = {
    from: '"BluePrint Catalyst" <scale@blueprintcatalyst.com>',
    to,
    subject,
    text: body,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending email:", error);
    else console.log("Reminder email sent:", info.response);
  });
}

{
  /***This api use for all user Data delete Related With Cron job Daily***/
}

exports.checkapprovedorNot = async (req, res) => {
  const responses = req.body;
  try {
    db.query(
      "SELECT * from dataroomdocuments where company_id = ? And status = ?",
      [responses.company_id, "No"],
      (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB query failed", error: err });
        }
        res.status(200).json({ results: results });
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error });
  }
};
exports.checkreferCode = async (req, res) => {
  const { code, type, email } = req.body;
  try {
    const query = `
      SELECT dc.*
FROM discount_code dc
LEFT JOIN shared_discount_code sdc
    ON sdc.discount_code = dc.code
WHERE dc.code = ?
  AND dc.exp_date >= CURRENT_DATE
  AND JSON_CONTAINS(dc.type, JSON_ARRAY(?))
  AND sdc.email = ?;

    `;

    db.query(query, [code, type, email], (err, rows) => {
      if (err) {
        return res.status(500).json({ message: "DB query failed", error: err });
      }
      res.status(200).json({ results: rows });
    });
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error });
  }
};

//Academy Payment
exports.CreateuserSubscription_AcademyCheck = async (req, res) => {
  const { amount } = req.body;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "eur",
      automatic_payment_methods: { enabled: true },
    });

    if (paymentIntent.client_secret) {
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    }
  } catch (err) {
    console.error("Stripe Error:", err);
    res.status(500).json({ error: err.message });
  }
};
exports.CreateuserSubscription_Academy = async (req, res) => {
  const {
    code,
    created_by_id,
    discount,
    amount,
    company_id,
    clientSecret,
    payment_status,
  } = req.body;
  var dd = req.body;
  try {
    const userInsertQuery = `
        INSERT INTO usersubscriptiondata_academy 
        (payment_status, price, company_id, clientSecret, created_at, start_date, end_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

    const startDate = new Date();

    // Add 3 months to start date
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 1);

    db.query(
      userInsertQuery,
      [
        payment_status,
        amount,
        company_id,
        clientSecret,
        startDate,
        startDate,
        endDate,
      ],
      async (err, result) => {
        if (err) {
          console.error("DB Insert Error:", err);
          return res.status(500).json({ error: "Database error" + dd });
        }
        const insertId = result.insertId;

        // 2️⃣ Log into audit_logs
        const auditQuery = `
          INSERT INTO audit_logs
          (user_id, company_id, module, action, entity_id, entity_type, details, ip_address, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;
        const auditValues = [
          created_by_id || null,
          company_id || null,
          "package-subscription",
          "CREATE",
          insertId,
          "Academy Subscription",
          JSON.stringify(req.body),
          req.body.ip_address || null,
        ];

        db.query(auditQuery, auditValues, (auditErr) => {
          if (auditErr) console.error("Audit log insert failed:", auditErr);
        });
        if (code !== "") {
          const resultId = result.insertId;
          const query = "SELECT * FROM  discount_code where code = ?";

          db.query(query, [code], (err, row) => {
            if (err) {
              return res.status(500).json({
                message: "Database query error",
                error: err,
              });
            }
            var usecount = row[0].used_count + 1;
            var referData = row[0];
            db.query(
              "UPDATE discount_code SET used_count = ? WHERE code=?",
              [usecount, code],
              (finalErr) => {
                if (finalErr) {
                  return res
                    .status(500)
                    .json({ message: "Update failed", error: finalErr });
                }
                db.query(
                  `INSERT INTO used_referral_code 
                                 (table_type,table_id,discount_code,discounts,company_id, discount_code_id, payment_type, created_at) 
                                 VALUES (?,?, ?, ?, ?, ?, ?, NOW())`,
                  [
                    "usersubscriptiondata_academy",
                    resultId,
                    code,
                    discount,
                    company_id,
                    referData.id,
                    "Academy",
                  ],
                  (insertErr) => {
                    if (insertErr)
                      console.error("Document log insert failed", insertErr);
                  }
                );
              }
            );
          });
        }
        res.status(200).json({
          message: "",
          status: 1,
        });
      }
    );
  } catch (err) {
    console.error("Stripe Error:", err);
    res.status(500).json({ error: err.message });
  }
};
//Academy Payment

exports.uploadcompanyLogo = async (req, res) => {
  try {
    const userId = req.body.user_id;

    if (!req.file || !userId) {
      return res
        .status(400)
        .json({ error: "Logo file or user_id is missing." });
    }

    const tempPath = req.file.path; // multer saved here initially
    const fileExt = path.extname(req.file.originalname);
    const finalFileName = Date.now() + fileExt;

    const userFolder = path.join(
      __dirname,
      "..",
      "..",
      "upload",
      "docs",
      `doc_${userId}`
    );

    if (!fs.existsSync(userFolder)) {
      fs.mkdirSync(userFolder, { recursive: true });
    }

    const finalPath = path.join(userFolder, finalFileName);

    // Move file from temp location to user folder
    fs.rename(tempPath, finalPath, (err) => {
      if (err) {
        console.error("File move error:", err);
        return res.status(500).json({ error: "Failed to move logo file." });
      }

      const relativePath = path.join(
        "upload",
        "docs",
        `doc_${userId}`,
        finalFileName
      );

      // Update company table with logo path
      const sql = "UPDATE company SET company_logo = ? WHERE id = ?";
      db.query(sql, [finalFileName, userId], (err, result) => {
        if (err) {
          console.error("DB update error:", err);
          return res.status(500).json({ error: "Database error." });
        }

        return res.status(200).json({
          message: "Logo uploaded and saved in database.",
          logoUrl: `/${relativePath}`, // for frontend usage
        });
      });
    });
  } catch (error) {
    console.error("Controller error:", error);
    return res.status(500).json({ error: "Server error." });
  }
};

exports.filelock = async (req, res) => {
  const { company_id, lockId } = req.body;

  const sql =
    "UPDATE dataroomdocuments SET locked = ? WHERE subcategory_id = ? AND company_id = ?";

  try {
    await db.promise().query(sql, ["Yes", lockId, company_id]);

    return res.status(200).json({
      message: "Document locked successfully.",
    });
  } catch (err) {
    console.error("DB update error:", err);
    return res.status(500).json({ error: "Database error." });
  }
};

exports.lockFileCheckSubscription = async (req, res) => {
  const company_id = req.body.company_id; // ensure you have user_id

  try {
    // Step 1: Check if AI document already generated
    db.query(
      "SELECT COUNT(*) AS doc_generated_count FROM dataroom_generatedocument WHERE company_id = ?",
      [company_id],
      (err, docGenResult) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Error fetching doc info", err });
        }

        const docGenerated = docGenResult[0].doc_generated_count;

        if (docGenerated === 0) {
          // User has not generated any AI summary yet
          return res.status(200).json({ allowEdit: true });
        }

        // Step 2: If generated, check if payment is done for unlock
        db.query(
          "SELECT * FROM subscription_statuslockfile WHERE company_id = ?",
          [company_id],
          (err, paymentResult) => {
            if (err) {
              return res
                .status(500)
                .json({ message: "Error checking payment", err });
            }
            if (paymentResult.length === 0) {
              var paid = true;
            } else {
              var paid = false;
            }

            return res.status(200).json({ allowEdit: paid });
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error });
  }
};

//Payment Lock file
exports.CreateuserSubscriptionPaymentLockFile = async (req, res) => {
  const { amount } = req.body;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "eur",
      automatic_payment_methods: { enabled: true },
    });

    if (paymentIntent.client_secret) {
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    }
  } catch (err) {
    console.error("Stripe Error:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.CreateuserSubscriptionLockFile = async (req, res) => {
  const { amount, user_id, clientSecret, payment_status } = req.body;
  var dd = req.body;
  try {
    const userInsertQuery = `
        INSERT INTO subscription_lockfile 
        (payment_status, price, user_id, clientSecret, created_at)
        VALUES (?, ?, ?, ?, ?)
      `;

    const startDate = new Date();

    // Add 3 months to start date
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 3);

    db.query(
      userInsertQuery,
      [payment_status, amount, user_id, clientSecret, startDate],
      async (err, result) => {
        if (err) {
          console.error("DB Insert Error:", err);
          return res.status(500).json({ error: "Database error" + dd });
        }
        db.query(
          `INSERT INTO subscription_statuslockfile 
                                 (user_id) 
                                 VALUES (?)`,
          [user_id],
          (insertErr) => {
            if (insertErr)
              console.error("Document log insert failed", insertErr);
          }
        );
        res.status(200).json({
          message: "",
          status: 1,
        });
      }
    );
  } catch (err) {
    console.error("Stripe Error:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.fileslockorUnlock = async (req, res) => {
  const { id } = req.body;
  db.query("SELECT * FROM dataroomdocuments WHERE id = ?", [id], (err, row) => {
    if (err) {
      return res.status(500).json({ message: "Error checking payment", err });
    }
    if (row.length > 0) {
      if (row[0].locked === "Yes") {
        db.query(
          "UPDATE dataroomdocuments SET locked = ? WHERE id=?",
          ["No", id],
          (finalErr) => {
            if (finalErr) {
              return res
                .status(500)
                .json({ message: "Update failed", error: finalErr });
            }
            return res
              .status(200)
              .json({ message: "Document successfully Unlocked" });
          }
        );
      } else {
        db.query(
          "UPDATE dataroomdocuments SET locked = ? WHERE id=?",
          ["Yes", id],
          (finalErr) => {
            if (finalErr) {
              return res
                .status(500)
                .json({ message: "Update failed", error: finalErr });
            }
            return res
              .status(200)
              .json({ message: "Document successfully locked" });
          }
        );
      }
    }
  });
};
exports.allfileslock = async (req, res) => {
  const { user_id } = req.body;

  db.query(
    "SELECT id FROM dataroomdocuments WHERE user_id = ?",
    [user_id],
    (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Error fetching documents", error: err });
      }

      if (results.length > 0) {
        const documentIds = results.map((doc) => doc.id);

        db.query(
          "UPDATE dataroomdocuments SET locked = 'Yes' WHERE id IN (?)",
          [documentIds],
          (updateErr, updateResult) => {
            if (updateErr) {
              return res
                .status(500)
                .json({ message: "Error locking documents", error: updateErr });
            }

            return res.status(200).json({
              message: `All documents locked successfully.`,
              status: "1",
            });
          }
        );
      } else {
        return res
          .status(200)
          .json({ message: "No documents found for this user.", status: "2" });
      }
    }
  );
};

exports.getAllExchangeCompanyData = (req, res) => {
  const companyName = req.body.company_name;
  const apiKey = "yEaVgvcEdVlcevvVWPiCXzCIONLDzzAF";

  if (!companyName) {
    return res.status(400).json({ error: "company_name is required" });
  }

  db.query("SELECT * FROM company_exchanges_data", (err, exchanges) => {
    if (err) {
      return res.status(500).json({ error: "DB error", details: err });
    }

    if (exchanges.length === 0) {
      return res.status(200).json({ error: "No exchanges found in database" });
    }

    const insertedCompanies = [];
    let pending = exchanges.length;

    exchanges.forEach((exch) => {
      axios
        .get(`https://financialmodelingprep.com/api/v3/search`, {
          params: {
            query: companyName,
            limit: 1,
            exchange: exch.exchange,
            apikey: apiKey,
          },
        })
        .then((searchRes) => {
          const result = searchRes.data[0];

          if (!result) {
            return insertEmptyCompany(exch, null, () => {
              if (--pending === 0) sendResponse();
            });
          }

          const symbol = result.symbol;
          Promise.all([
            axios.get(
              `https://financialmodelingprep.com/api/v3/profile/${symbol}?apikey=${apiKey}`
            ),
            axios.get(
              `https://financialmodelingprep.com/api/v3/income-statement/${symbol}?limit=1&apikey=${apiKey}`
            ),
            axios.get(
              `https://financialmodelingprep.com/api/v3/ratios/${symbol}?limit=1&apikey=${apiKey}`
            ),
            axios.get(
              `https://financialmodelingprep.com/api/v3/enterprise-values/${symbol}?limit=1&apikey=${apiKey}`
            ),
          ])
            .then(([profileRes, incomeRes, ratioRes, evRes]) => {
              const profile = profileRes.data[0] || {};
              const income = incomeRes.data[0] || {};
              const ratios = ratioRes.data[0] || {};
              const enterprise = evRes.data[0] || {};

              const name = `${profile.companyName || companyName} (${symbol})`;
              const description = profile.description?.slice(0, 300) || null;
              const website = profile.website || null;
              const marketCap = profile.mktCap || null;
              const peRatio = profile.pe || null;
              const revenues = income.revenue || null;
              const operatingExpense = income.operatingExpenses || null;
              const netIncome = income.netIncome || null;
              const ebitda = enterprise.ebitda || null;
              const netProfitMargin = ratios.netProfitMargin || null;
            })
            .catch(() => {
              insertEmptyCompany(exch, symbol, () => {
                if (--pending === 0) sendResponse();
              });
            });
        })
        .catch(() => {
          insertEmptyCompany(exch, null, () => {
            if (--pending === 0) sendResponse();
          });
        });
    });

    function insertEmptyCompany(exch, symbol = null, callback) {}

    function sendResponse() {
      if (insertedCompanies.length === 0) {
        return res.status(200).json({
          message: "No full company data found, but blank records inserted.",
          inserted: [],
        });
      }
      res.status(200).json({
        message: `${insertedCompanies.length} full company records inserted`,
        inserted: insertedCompanies,
      });
    }
  });
};

async function getCompanyData(symbol) {
  const API_KEY = "YOUR_API_KEY"; // FMP key
  const url = `https://financialmodelingprep.com/api/v3/profile/${symbol}?apikey=${API_KEY}`;

  const res = await axios.get(url);
  const data = res.data?.[0];

  if (!data) return null;

  return {
    companyName: data.companyName,
    description: data.description.slice(0, 300),
    website: data.website || "Not Available",
    yearFounded: data.founded || "Not Available",
    marketCap: data.mktCap || "Not Available",
    peRatio: data.pe || "Not Available",
  };
}

const exchangeCodeMap = {
  TSX: "TOR",
  NASDAQ: "NMS",
  NYSE: "NYQ",
  FTSE: "LSE",
  ASX: "ASX",
  Euronext: "ENX", // general - might vary by sub-market
  HKEX: "HKG",
  SSE: "SHH", // Shanghai main
  SGX: "SES",
  NSE: "NSI",
};

async function getStockData(symbol) {
  try {
    const result = await yahooFinance.quoteSummary(symbol, {
      modules: [
        "summaryProfile",
        "price",
        "financialData",
        "defaultKeyStatistics",
        "summaryDetail",
      ],
    });

    const profile = result.summaryProfile || {};
    const financial = result.financialData || {};
    const price = result.price || {};
    const summaryDetail = result.summaryDetail || {};

    return {
      symbol,
      name: price.longName || symbol,
      sector: profile.sector || "N/A",
      description: profile.longBusinessSummary?.slice(0, 300) || "N/A",
      website: profile.website || "N/A",
      founded: profile.companyOfficers?.[0]?.startYear || "N/A",
      marketCap: price.marketCap?.fmt || "N/A",
      peRatio: summaryDetail.trailingPE?.fmt || "N/A",
      revenue: financial.totalRevenue?.fmt || "N/A",
      operatingExpense: financial.operatingExpenses?.fmt || "N/A",
      netIncome: financial.netIncomeToCommon?.fmt || "N/A",
      ebitda: financial.ebitda?.fmt || "N/A",
      netProfitMargin: financial.profitMargins?.fmt || "N/A",
    };
  } catch (error) {
    console.error(`Error fetching data for ${symbol}:`, error.message);
    return null;
  }
}

async function searchCompany(companyName) {
  try {
    const result = await yahooFinance.search(companyName);
    return result.quotes || [];
  } catch (err) {
    console.error("Search error:", err.message);
    return [];
  }
}

async function getCompetitorsFromOpenAI({ name, sector, description }) {
  const prompt = `
You are a market research assistant helping with investment due diligence.

Company Name: ${name}
Sector: ${sector}
Description: ${description}

Your task is to identify direct and indirect *public* competitors to this company across global stock exchanges. Use domain knowledge, sector classification, and strategic similarities.

Provide up to **2 peer companies per exchange**, focusing on:
- Similar industry or digital/operational model
- Publicly listed only
- Known sector overlap, competitive offerings, or geographic expansion

List exchanges and company names in this exact JSON format:
{
  "TSX": ["Company A", "Company B"],
  "NASDAQ": ["Company C", "Company D"],
  ...
}

Target exchanges:
1. TSX
2. NASDAQ
3. NYSE
4. FTSE
5. ASX
6. Euronext
7. HKEX
8. SSE
9. SGX
10. NSE
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        { role: "system", content: "You summarize due diligence documents." },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const output = response.choices[0]?.message?.content?.trim();

    // Try parsing and fallback gracefully
    try {
      return JSON.parse(output);
    } catch (parseError) {
      console.warn("⚠️ Could not parse GPT response as JSON. Raw output:");
      console.log(output);
      return {};
    }
  } catch (err) {
    console.error("OpenAI API error:", err.message);
    return {};
  }
}

async function analyzePublicPeers(company_id, code, companyName, version) {
  let candidates = [];
  let primary = null;
  let prSummary = "N/A";
  let miscUploads = [];
  let peerData = {};

  try {
    candidates = await searchCompany(companyName);
    if (candidates.length > 0) {
      primary = await getStockData(candidates[0].symbol);

      if (primary) {
        prSummary = await getPRSummaryFromOpenAI({
          name: primary.name,
          description: primary.description,
          website: primary.website,
        });

        miscUploads = await getMiscUploadsFromOpenAI({
          name: primary.name,
          sector: primary.sector,
          description: primary.description,
          website: primary.website,
        });

        const competitorsByExchange = await getCompetitorsFromOpenAI({
          name: primary.name,
          sector: primary.sector,
          description: primary.description,
        });

        // Initialize peerData even if empty
        peerData = {};
        for (const [exchange, companies] of Object.entries(
          competitorsByExchange
        )) {
          peerData[exchange] = [];
          for (const name of companies) {
            const peerResults = await searchCompany(name);
            const peer = peerResults.find(
              (r) =>
                r.exchange && r.exchange.includes(exchangeCodeMap[exchange])
            );
            if (!peer) continue;

            const data = await getStockData(peer.symbol);
            if (data) peerData[exchange].push(data);
          }
        }
      }
    }
  } catch (err) {
    console.error("Error analyzing public peers:", err);
  }

  // Insert into DB ALWAYS, even if no data
  await insertPeerAnalysis(
    company_id,
    peerData, // empty object if no peers
    code,
    version,
    prSummary, // "N/A" if no summary
    miscUploads // empty array if no uploads
  );
}

async function getPRSummaryFromOpenAI({ name, sector, description }) {
  const prompt = `
You are a professional press and public relations analyst. Your task is to write a detailed 600-word summary of public and press sentiment about the following company, based on its business model, industry, and strategic context.

Company Name: ${name}
Sector: ${sector}
Description: ${description}

The summary should include:
- Public perception of the company
- Any reputational risks or PR challenges
- Highlights from press coverage (general themes)
- Industry sentiment and competitive positioning

Output should be a coherent, human-readable article of approximately 600 words.
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        { role: "system", content: "You write detailed PR reports." },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 1200,
    });

    return response.choices[0]?.message?.content?.trim() || "";
  } catch (err) {
    console.error("PR Summary OpenAI Error:", err.message);
    return "";
  }
}
async function getMiscUploadsFromOpenAI({
  name,
  sector,
  description,
  website,
}) {
  const prompt = `
You are a data room analyst preparing for investor due diligence.

Given the company information below, suggest 5 to 7 useful miscellaneous or additional uploads that could be included in a virtual data room. These should not be standard financials or legal docs, but strategic or operational materials useful for investors.

Company Name: ${name}
Sector: ${sector}
Website: ${website}
Description: ${description}

Output as a JSON array of titles, like:
[
  "Customer Satisfaction Survey Results",
  "Product Roadmap and Feature Pipeline",
  "Key Strategic Partnership Summaries"
]
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        { role: "system", content: "You help prepare investor datarooms." },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 1200,
    });

    const text = response.choices[0]?.message?.content?.trim();

    try {
      return JSON.parse(text);
    } catch (err) {
      console.warn(
        "⚠️ Could not parse miscellaneous uploads JSON. Raw output:",
        text
      );
      return [];
    }
  } catch (err) {
    console.error("OpenAI Misc Uploads Error:", err.message);
    return [];
  }
}

function insertPeerAnalysis(
  company_id,
  peerData,
  code,
  version,
  prSummary,
  miscUploads
) {
  return new Promise((resolve, reject) => {
    const formatted = {
      canada_TSX: JSON.stringify(peerData.TSX || []),
      usa_NASDAQ: JSON.stringify(peerData.NASDAQ || []),
      usa_NYSE: JSON.stringify(peerData.NYSE || []),
      england_FTSE: JSON.stringify(peerData.FTSE || []),
      australia_ASX: JSON.stringify(peerData.ASX || []),
      EU: JSON.stringify(peerData.Euronext || []),
      china_HKEX: JSON.stringify(peerData.HKEX || []),
      china_SSE: JSON.stringify(peerData.SSE || []),
      singapore_SGX: JSON.stringify(peerData.SGX || []),
      india_NSE: JSON.stringify(peerData.NSE || []),
    };
    var date = new Date();
    const userInsertQuery = `
  INSERT INTO company_exchange_world_details (
    version, company_id, uniqcode,
    canada_TSX, usa_NASDAQ, usa_NYSE,
    england_FTSE, australia_ASX, \`EU\`,
    china_HKEX, china_SSE, singapore_SGX, india_NSE,
    press_public_reaction, miscUploads,created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
    var mp = JSON.stringify(miscUploads || []);
    db.query(
      userInsertQuery,
      [
        version,
        company_id,
        code,
        formatted.canada_TSX,
        formatted.usa_NASDAQ,
        formatted.usa_NYSE,
        formatted.england_FTSE,
        formatted.australia_ASX,
        formatted.EU,
        formatted.china_HKEX,
        formatted.china_SSE,
        formatted.singapore_SGX,
        formatted.india_NSE,
        prSummary,
        mp,
        date,
      ],
      (err, result) => {
        if (err) {
          console.error("DB Insert Error:", err);
          return reject(err);
        }
        resolve(result);
      }
    );
  });
}
function checkdataa() {
  const query = "SELECT * FROM  company_exchange_world_details where id = ?";

  db.query(query, [7], (err, row) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    var data = row[0];
    var date = new Date();
    const userInsertQuery = `
  INSERT INTO \`company_exchange_world_details\` (
    version, user_id, uniqcode,
    canada_TSX, usa_NASDAQ, usa_NYSE,
    england_FTSE, australia_ASX, \`EU\`,
    china_HKEX, china_SSE, singapore_SGX, india_NSE,
    press_public_reaction, miscUploads,created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

    db.query(
      userInsertQuery,
      [
        data.version,
        data.user_id,
        data.uniqcode,
        data.canada_TSX,
        data.usa_NASDAQ,
        data.usa_NYSE,
        data.england_FTSE,
        data.australia_ASX,
        data.EU,
        data.china_HKEX,
        data.china_SSE,
        data.singapore_SGX,
        data.india_NSE,
        data.press_public_reaction,
        data.miscUploads,
        date,
      ],
      (err, result) => {
        if (err) {
          console.error("DB Insert Error:", err);
          return reject(err);
        }
      }
    );
    // console.log(row);
  });
}
//checkdataa();
// 🔽 Test with a dual-listed company
//searchCompany("TD Bank");

exports.filelockunlock = async (req, res) => {
  const { id } = req.body;

  db.query(
    "SELECT * FROM investor_updates WHERE id = ?",
    [id],
    (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Error fetching documents", error: err });
      }

      if (results.length > 0) {
        const data = results[0];
        let lk = "";
        let msg = "";
        if (data.is_locked === 0) {
          lk = 1;
          msg = "Document locked successfully";
        } else {
          lk = 0;
          msg = "Document Un locked successfully";
        }

        db.query(
          "UPDATE investor_updates SET is_locked = ? WHERE id =?",
          [lk, id],
          (updateErr, updateResult) => {
            if (updateErr) {
              return res
                .status(500)
                .json({ message: "Error locking documents", error: updateErr });
            }

            return res.status(200).json({
              message: msg,
              status: "1",
            });
          }
        );
      } else {
        return res
          .status(200)
          .json({ message: "No documents found for this user.", status: "2" });
      }
    }
  );
};
exports.checkApprovaldoc = async (req, res) => {
  const { company_id } = req.body;

  db.query(
    "SELECT * FROM usersubscriptiondataroomone_time WHERE company_id = ? AND end_date >= CURRENT_DATE ORDER BY id DESC;",
    [company_id],
    (err, results) => {
      if (err) {
        return res.status(500).json({ message: "DB query failed", error: err });
      }

      if (results.length > 0) {
        // Find the first record with status "Inactive"
        const inactiveRecord = results.find(
          (record) => record.status === "Active"
        );

        if (inactiveRecord) {
          return res
            .status(200)
            .json({ unique_code: inactiveRecord.unique_code, status: "1" });
        } else {
          return res
            .status(200)
            .json({ message: "No inactive records found", status: "2" });
        }
      } else {
        return res
          .status(200)
          .json({ message: "No records found", status: "2" });
      }
    }
  );
};
