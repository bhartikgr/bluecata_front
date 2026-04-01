const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const OpenAI = require("openai");
const multer = require("multer");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Make sure this is set in your .env file
});
const Tesseract = require("tesseract.js");
const xlsx = require("xlsx");
const mammoth = require("mammoth");

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
// Storage for term sheet files
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const userId = req.body.company_id; // get user ID from request body
    const filetype = "companyRound"; // e.g., "termsheetFile" or "subscriptiondocument"

    const userFolder = path.join(
      __dirname,
      "..",
      "..",
      "upload",
      "docs",
      `doc_${userId}`,
      filetype,
    );

    // Create folder if it doesn't exist
    if (!fs.existsSync(userFolder)) {
      fs.mkdirSync(userFolder, { recursive: true });
    }

    cb(null, userFolder);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });
exports.getallcountrySymbolList = (req, res) => {
  db.query(
    "SELECT * FROM country_symbol order by name asc",
    async (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      res.status(200).json({
        message: "",
        results: results,
      });
    },
  );
};
// For multiple files: term sheet and subscription documents
async function extractFileText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  try {
    if (ext === ".txt") {
      return fs.readFileSync(filePath, "utf-8");
    }
    if (ext === ".pdf") {
      const data = await pdfParse(fs.readFileSync(filePath));
      return data.text;
    }
    if (ext === ".docx") {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    }
    if (ext === ".xlsx") {
      const workbook = xlsx.readFile(filePath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      return xlsx.utils.sheet_to_csv(sheet);
    }
    if ([".jpg", ".jpeg", ".png"].includes(ext)) {
      const {
        data: { text },
      } = await Tesseract.recognize(filePath, "eng+hin");
      return text;
    }
  } catch (error) {}

  return "";
}
// ============================================================
// DELETE WARRANT API
// ============================================================

const deleteWarrantData = (warrantData) => {
  return new Promise((resolve, reject) => {
    const { roundrecord_id, company_id } = warrantData;

    // First get warrant IDs
    const getWarrantIdsSql = `SELECT id FROM warrants WHERE company_id = ? AND roundrecord_id = ?`;

    db.query(
      getWarrantIdsSql,
      [company_id, roundrecord_id],
      (err, warrants) => {
        if (err) {
          console.error("Error fetching warrant IDs:", err);
          return reject(err);
        }

        if (warrants && warrants.length > 0) {
          const warrantIds = warrants.map((w) => w.id);

          // Delete from round_investors
          const deleteRoundInvestorsSql = `
          DELETE FROM round_investors 
          WHERE warrant_id IN (?) AND round_id = ? AND company_id = ?
        `;

          db.query(
            deleteRoundInvestorsSql,
            [warrantIds, roundrecord_id, company_id],
            (err2) => {
              if (err2) {
                console.error("Error deleting from round_investors:", err2);
                // Continue with warrant deletion even if this fails
              }

              // Delete from warrants
              const deleteWarrantSql = `DELETE FROM warrants WHERE company_id = ? AND roundrecord_id = ?`;

              db.query(
                deleteWarrantSql,
                [company_id, roundrecord_id],
                (err3, result) => {
                  if (err3) {
                    console.error("Error deleting warrant:", err3);
                    return reject(err3);
                  }
                  resolve({
                    success: true,
                    message: "Warrant deleted successfully",
                    affectedRows: result.affectedRows,
                  });
                },
              );
            },
          );
        } else {
          resolve({
            success: true,
            message: "No warrants found to delete",
            affectedRows: 0,
          });
        }
      },
    );
  });
};
exports.warrantDataUpdate = (req, res) => {
  const {
    roundrecord_id,
    company_id,
    investor_id,
    warrant_coverage_percentage,
    warrant_status,
    expiration_date,
    notes,
    warrantType,
    warrant_fixed_shares,
    hasWarrants_preferred,
  } = req.body;
  // First check if record exists
  const checkSql =
    "SELECT * FROM warrants WHERE roundrecord_id = ? AND company_id = ?";

  db.query(checkSql, [roundrecord_id, company_id], (checkErr, checkResult) => {
    if (checkErr) {
      console.error("Error checking warrant:", checkErr);
      return res.status(500).json({
        success: false,
        message: "Error checking warrant",
        error: checkErr,
      });
    }

    // Prepare common values

    if (checkResult.length === 0) {
      if (hasWarrants_preferred === true) {
        const insertSql = `
        INSERT INTO warrants (
          warrant_fixed_shares,
          warrantType,
          roundrecord_id,
          company_id,
          investor_id,
          warrant_coverage_percentage,
          warrant_status,
          issued_date,
          expiration_date,
          notes,
          created_at,
          updated_at
        ) VALUES ( ?, ?, ?, ?, ?, ?,  ?, NOW(), ?, ?, NOW(), NOW())
      `;

        const insertValues = [
          warrant_fixed_shares,
          warrantType,
          roundrecord_id,
          company_id,
          investor_id || 0,
          warrant_coverage_percentage || 0,
          warrant_status || "pending",
          expiration_date || null, // ✅ expiration_date
          notes || null, // ✅ notes
        ];

        db.query(insertSql, insertValues, (insertErr, insertResult) => {
          if (insertErr) {
            console.error("Error inserting warrant:", insertErr);
            return res.status(500).json({
              success: false,
              message: "Error inserting warrant",
              error: insertErr,
            });
          }

          // Second, insert into round_investors table
          var warrantId = insertResult.insertId;

          return res.status(200).json({
            success: true,
            message: "Warrant inserted successfully",
            operation: "insert",
            affectedRows: insertResult.affectedRows,
          });
        });
      } else {
        return res.status(200).json({
          success: true,
          message: "Warrant inserted successfully",
          operation: "",
          affectedRows: "",
        });
      }
    } else {
      // Record exists - UPDATE
      if (hasWarrants_preferred === false) {
        // Step 1: Get warrant IDs from warrants table
        const getWarrantIdsSql = `
            SELECT id FROM warrants 
            WHERE roundrecord_id = ? AND company_id = ?
          `;

        db.query(
          getWarrantIdsSql,
          [roundrecord_id, company_id],
          (err2, warrants) => {
            if (err2) {
              console.error("Error fetching warrant IDs:", err2);
              return res.status(500).json({
                success: false,
                message: "Error fetching warrant IDs",
                error: err2,
              });
            }

            if (warrants && warrants.length > 0) {
              const warrantIds = warrants.map((w) => w.id);

              // Step 2: Delete from round_investors using warrant_ids
              const deleteRoundInvestorsSql = `
                DELETE FROM round_investors 
                WHERE warrant_id IN (?) AND round_id = ? AND company_id = ?
              `;

              db.query(
                deleteRoundInvestorsSql,
                [warrantIds, roundrecord_id, company_id],
                (err3, result3) => {
                  if (err3) {
                    console.error(
                      "Error deleting round_investors records:",
                      err3,
                    );
                    return res.status(500).json({
                      success: false,
                      message: "Error deleting round_investors records",
                      error: err3,
                    });
                  }

                  // Step 3: Delete from warrants table
                  const deleteWarrantsSql = `
                    DELETE FROM warrants 
                    WHERE roundrecord_id = ? AND company_id = ?
                  `;

                  db.query(
                    deleteWarrantsSql,
                    [roundrecord_id, company_id],
                    (err, result) => {
                      if (err) {
                        console.error("Error deleting warrants:", err);
                        return res.status(500).json({
                          success: false,
                          message: "Error deleting warrants",
                          error: err,
                        });
                      }

                      return res.status(200).json({
                        success: true,
                        message:
                          "Warrants and associated records deleted successfully",
                        deletedRoundInvestors: result3.affectedRows,
                        deletedWarrants: result.affectedRows,
                        warrantIds: warrantIds,
                      });
                    },
                  );
                },
              );
            } else {
              // No warrants found
              return res.status(200).json({
                success: true,
                message: "No warrants found to delete",
                deletedWarrants: 0,
                deletedRoundInvestors: 0,
              });
            }
          },
        );
      } else {
        // First, get warrant IDs for this round
        const getWarrantIdsSql = `
          SELECT id FROM warrants 
          WHERE roundrecord_id = ? AND company_id = ?
        `;

        db.query(
          getWarrantIdsSql,
          [roundrecord_id, company_id],
          (err, warrants) => {
            if (err) {
              console.error("Error fetching warrant IDs:", err);
              return res.status(500).json({
                success: false,
                message: "Error fetching warrant IDs",
                error: err,
              });
            }

            if (!warrants || warrants.length === 0) {
              return res.status(404).json({
                success: false,
                message: "No warrants found to update",
              });
            }

            const warrantIds = warrants[0]?.id;
            // Update warrants
            const updateSql = `
              UPDATE warrants 
              SET 
                warrant_fixed_shares = ?,
                warrantType = ?,
                company_id = ?,
                investor_id = ?,
                warrant_coverage_percentage = ?,
                warrant_status = ?,
                expiration_date = ?,
                updated_at = NOW()
              WHERE roundrecord_id = ? AND company_id = ?
            `;

            const updateValues = [
              warrant_fixed_shares,
              warrantType,
              company_id,
              0,
              warrant_coverage_percentage,
              warrant_status,
              expiration_date,
              roundrecord_id,
              company_id,
            ];

            db.query(updateSql, updateValues, (updateErr, updateResult) => {
              if (updateErr) {
                console.error("Error updating warrant:", updateErr);
                return res.status(500).json({
                  success: false,
                  message: "Error updating warrant",
                  error: updateErr,
                });
              }
              return res.status(200).json({
                success: true,
                message:
                  "Round investor record already exists, skipping insertion",
                operation: "skip",
                existingId: "",
                warrantId: "",
              });
            });
          },
        );
      }
    }
  });
};
// Helper function to update/create warrant data (internal use only)
const updateWarrantDataInternal = (warrantData) => {
  return new Promise((resolve, reject) => {
    const {
      roundrecord_id,
      company_id,
      warrant_coverage_percentage,
      warrant_status,
      expiration_date,
      warrantType,
      warrant_fixed_shares,
      warrant_coverage_percentage_main,
    } = warrantData;
    let formattedExpirationDate = null;
    if (expiration_date) {
      formattedExpirationDate = formatDateForMySQL(expiration_date);
    }
    const checkSql =
      "SELECT * FROM warrants WHERE roundrecord_id = ? AND company_id = ?";

    db.query(
      checkSql,
      [roundrecord_id, company_id],
      (checkErr, checkResult) => {
        if (checkErr) {
          console.error("Error checking warrant:", checkErr);
          return reject(checkErr);
        }

        if (checkResult.length === 0) {
          // Insert new warrant
          const insertSql = `
          INSERT INTO warrants (
          warrant_coverage_percentage_main,
            warrant_fixed_shares,
            warrantType,
            roundrecord_id,
            company_id,
            investor_id,
            warrant_coverage_percentage,
            warrant_status,
            issued_date,
            expiration_date,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW(), NOW())
        `;

          const insertValues = [
            warrant_coverage_percentage_main,
            warrant_fixed_shares,
            warrantType,
            roundrecord_id,
            company_id,
            0,
            warrant_coverage_percentage || 0,
            warrant_status || "pending",
            formattedExpirationDate || null,
          ];

          db.query(insertSql, insertValues, (insertErr, insertResult) => {
            if (insertErr) {
              console.error("Error inserting warrant:", insertErr);
              return reject(insertErr);
            }
            resolve({
              success: true,
              operation: "insert",
              warrantId: insertResult.insertId,
            });
          });
        } else {
          // Update existing warrant
          const updateSql = `
          UPDATE warrants 
          SET 
          warrant_coverage_percentage_main=?,
            warrant_fixed_shares = ?,
            warrantType = ?,
            warrant_coverage_percentage = ?,
            warrant_status = ?,
            expiration_date = ?,
            updated_at = NOW()
          WHERE roundrecord_id = ? AND company_id = ?
        `;

          const updateValues = [
            warrant_coverage_percentage_main,
            warrant_fixed_shares,
            warrantType,
            warrant_coverage_percentage || 0,
            warrant_status || "pending",
            formattedExpirationDate || null,
            roundrecord_id,
            company_id,
          ];

          db.query(updateSql, updateValues, (updateErr, updateResult) => {
            if (updateErr) {
              console.error("Error updating warrant:", updateErr);
              return reject(updateErr);
            }
            resolve({
              success: true,
              operation: "update",
              affectedRows: updateResult.affectedRows,
            });
          });
        }
      },
    );
  });
};
// Function to convert date from 'DD/MonthName/YYYY' to 'YYYY-MM-DD'
const formatDateForMySQL = (dateString) => {
  if (!dateString) return null;

  // If already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString;
  }

  // Handle format: '02/April/2026' or '02-April-2026'
  const datePattern = /^(\d{2})[/-]([A-Za-z]+)[/-](\d{4})$/;
  const match = dateString.match(datePattern);

  if (match) {
    const day = match[1];
    const monthName = match[2];
    const year = match[3];

    // Month name to number mapping
    const monthMap = {
      January: "01",
      February: "02",
      March: "03",
      April: "04",
      May: "05",
      June: "06",
      July: "07",
      August: "08",
      September: "09",
      October: "10",
      November: "11",
      December: "12",
      Jan: "01",
      Feb: "02",
      Mar: "03",
      Apr: "04",
      May: "05",
      Jun: "06",
      Jul: "07",
      Aug: "08",
      Sep: "09",
      Oct: "10",
      Nov: "11",
      Dec: "12",
    };

    const month = monthMap[monthName];
    if (month) {
      return `${year}-${month}-${day}`;
    }
  }

  // Handle format: '02/04/2026' (DD/MM/YYYY)
  const slashPattern = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  const slashMatch = dateString.match(slashPattern);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;
  }

  console.warn("Unrecognized date format:", dateString);
  return null;
};
exports.CreateOrUpdateCapitalRound = (req, res) => {
  const uploadFields = upload.fields([
    { name: "termsheetFile", maxCount: 10 },
    { name: "subscriptiondocument", maxCount: 10 },
  ]);

  uploadFields(req, res, async (err) => {
    if (err) {
      return res.status(500).json({ message: "File upload error", error: err });
    }
    const {
      round_target_money,
      round_investments,
      optionPoolPercent,
      pre_money,
      post_money,
      ip_address,
      id,
      roundStatus,
      instrument_type_data,
      created_by_id,
      created_by_role,
      shareClassType,
      description,
      liquidationOther,
      liquidationpreferences,
      nameOfRound,
      shareclassother,
      instrumentType,
      customInstrument,
      roundsize,
      currency,
      issuedshares,
      rights,
      liquidation,
      convertible,
      convertibleType,
      voting,
      generalnotes,
      dateroundclosed,
      company_id,
      round_type,
      founder_data,
      total_founder_shares,
      founder_count,
      ClientIP,
      investorPostMoney,
      optionPoolPercent_post,

      hasWarrants_preferred,
      warrantType,
      warrant_coverage_percentage,
      warrant_fixed_shares,
      warrant_exercise_type,
      warrant_adjustment_percent,
      warrant_adjustment_direction,
      expirationDate_preferred,
      warrant_coverage_percentage_main,
    } = req.body;
    let lock = "No";
    if (roundStatus === "CLOSED") {
      lock = "No";
    } else {
      lock = "No";
    }
    const clientIp = ip_address || ClientIP;

    const newTermsheetFiles =
      req.files && req.files["termsheetFile"]
        ? req.files["termsheetFile"].map((f) => f.filename)
        : [];

    const newSubscriptionDocs =
      req.files && req.files["subscriptiondocument"]
        ? req.files["subscriptiondocument"].map((f) => f.filename)
        : [];

    let parsedInstrumentData = {};
    try {
      parsedInstrumentData = instrument_type_data
        ? JSON.parse(instrument_type_data)
        : {};
    } catch (e) {
      parsedInstrumentData = {};
    }

    // ============================================================
    // UPDATE MODE - WITH CASCADE RECALCULATION
    // ============================================================
    if (id && id !== "undefined" && id !== null && id !== "") {
      let processedDateRoundClosed = dateroundclosed;
      if (Array.isArray(dateroundclosed)) {
        processedDateRoundClosed =
          dateroundclosed.find(
            (date) => date && date.trim() !== "" && date !== "null",
          ) || null;
      } else if (dateroundclosed === "null" || dateroundclosed === "") {
        processedDateRoundClosed = null;
      }
      let processedFounderData = null;

      if (founder_data) {
        if (typeof founder_data === "string") {
          // If it's already a string, use it as is (assuming it's valid JSON)
          processedFounderData = founder_data;
        } else {
          // If it's an object, stringify it
          processedFounderData = JSON.stringify(founder_data);
        }
      }
      db.query(
        "SELECT termsheetFile, subscriptiondocument FROM roundrecord WHERE id = ?",
        [id],
        async (err, results) => {
          if (err) {
            return res.status(500).json({ message: "DB fetch error", err });
          }
          if (!results.length) {
            return res.status(404).json({ message: "Record not found" });
          }

          const existingTermsheetFiles = results[0].termsheetFile;
          const existingSubscriptionDocs = results[0].subscriptiondocument;

          let sql = `UPDATE roundrecord SET 
            round_target_money=?, round_investments=?,optionPoolPercent_post=?, investorPostMoney=?, optionPoolPercent=?, pre_money=?, post_money=?, 
            company_id=?, roundStatus=?, instrument_type_data=?, created_by_id=?, created_by_role=?, 
            dateroundclosed=?, nameOfRound=?, shareClassType=?, shareclassother=?, description=?, 
            instrumentType=?, customInstrument=?, roundsize=?, currency=?, rights=?, 
            liquidationpreferences=?, liquidation=?, liquidationOther=?, convertible=?, convertibleType=?, 
            voting=?, generalnotes=?, updated_by_id=?, updated_by_role=?, round_type=?, founder_data=?, 
            total_founder_shares=?, founder_count=?, is_locked =?`;

          const values = [
            round_target_money,
            round_investments,
            optionPoolPercent_post,
            investorPostMoney,
            optionPoolPercent,
            pre_money,
            post_money,
            company_id,
            roundStatus || "",
            JSON.stringify(parsedInstrumentData),
            created_by_id,
            created_by_role,
            processedDateRoundClosed,
            nameOfRound || "",
            shareClassType || "",
            shareclassother || "",
            description || "",
            instrumentType || "",
            customInstrument || "",
            roundsize || "",
            currency || "",
            rights || "",
            liquidationpreferences || "",
            liquidation || "",
            liquidationOther || "",
            convertible || "",
            convertibleType || "",
            voting || "",
            generalnotes || "",
            created_by_id,
            created_by_role,
            round_type || "Investment",
            processedFounderData || null,
            total_founder_shares || null,
            founder_count || null,
            lock,
          ];

          let finalTermsheetFiles = newTermsheetFiles;
          let finalSubscriptionDocs = newSubscriptionDocs;

          if (newTermsheetFiles.length === 0 && existingTermsheetFiles) {
            try {
              finalTermsheetFiles = JSON.parse(existingTermsheetFiles);
            } catch {}
          }

          if (newSubscriptionDocs.length === 0 && existingSubscriptionDocs) {
            try {
              finalSubscriptionDocs = JSON.parse(existingSubscriptionDocs);
            } catch {}
          }

          sql += `, termsheetFile=?, subscriptiondocument=?`;
          values.push(JSON.stringify(finalTermsheetFiles));
          values.push(JSON.stringify(finalSubscriptionDocs));

          sql += " WHERE id=?";
          values.push(id);

          db.query(sql, values, async (err) => {
            if (err) {
              return res.status(500).json({ message: "DB update error", err });
            }

            if (hasWarrants_preferred === "true") {
              const warrantdata = {
                warrant_coverage_percentage:
                  parseFloat(warrant_coverage_percentage) || 0,
                warrant_exercise_type:
                  warrant_exercise_type || "next_round_adjusted",
                warrant_adjustment_percent:
                  parseFloat(warrant_adjustment_percent) || 0,
                warrant_adjustment_direction:
                  warrant_adjustment_direction || "decrease",
                warrant_status: "pending",
                warrantType: warrantType,
                warrant_fixed_shares: warrant_fixed_shares,
                expiration_date: expirationDate_preferred || null,
                roundrecord_id: id,
                company_id: company_id,
                share_class_type: shareClassType,
                instrument_type: instrumentType,
                round_name: nameOfRound,
                warrant_coverage_percentage_main:
                  parseFloat(warrant_coverage_percentage_main) || 0,
              };
              try {
                await updateWarrantDataInternal(warrantdata);
              } catch (warrantErr) {
                console.error("Error updating/creating warrant:", warrantErr);
                // Don't fail the main operation, just log the error
              }
            }
            if (hasWarrants_preferred === "false") {
              const warrantUpdateDataa = {
                warrant_coverage_percentage:
                  parseFloat(warrant_coverage_percentage) || 0,
                warrant_exercise_type:
                  warrant_exercise_type || "next_round_adjusted",
                warrant_adjustment_percent:
                  parseFloat(warrant_adjustment_percent) || 0,
                warrant_adjustment_direction:
                  warrant_adjustment_direction || "decrease",
                warrant_status: "pending",
                warrantType: warrantType,
                warrant_fixed_shares: warrant_fixed_shares,
                expiration_date: expirationDate_preferred || null,
                roundrecord_id: id,
                company_id: company_id,
                share_class_type: shareClassType,
                instrument_type: instrumentType,
                round_name: nameOfRound,
              };

              try {
                await deleteWarrantData(warrantUpdateDataa);
              } catch (warrantErr) {
                console.error("Error updating/creating warrant:", warrantErr);
                // Don't fail the main operation, just log the error
              }
            }
            // ⚠️ DECLARE CASCADE VARIABLES OUTSIDE TRY-CATCH
            let subsequentRounds = [];
            let cascadeSuccess = true;
            let cascadeError = null;

            // ⚠️ CRITICAL: CASCADE RECALCULATION

            try {
              var currentRound = req.body;
              // Step 1: Update current round
              await calculateAndUpdateIssuedShares(
                {
                  round_investments: round_investments,
                  id: id,
                  company_id,
                  optionPoolPercent,
                  pre_money,
                  post_money,
                  roundsize,
                  issuedshares,
                  round_type: round_type || "Investment",
                  instrumentType,
                  investorPostMoney,
                  optionPoolPercent_post,
                  currentRound,
                },
                true,
              );

              // Step 2: Cascade recalculate all subsequent rounds
              const cascadeResult = await recalculateCascade(company_id, id);

              cascadeSuccess = cascadeResult.success;
              cascadeError = "";
            } catch (error) {
              console.error(`\n❌ UPDATE ERROR:`, error);
              cascadeSuccess = false;
              cascadeError = error.message;
            }

            // >>> AI EXECUTIVE SUMMARY START <
            let allFileText = "";

            for (const f of finalTermsheetFiles) {
              allFileText += await extractFileText(
                path.join(
                  "upload",
                  "docs",
                  `doc_${company_id}`,
                  "companyRound",
                  f,
                ),
              );
            }
            for (const f of finalSubscriptionDocs) {
              allFileText += await extractFileText(
                path.join(
                  "upload",
                  "docs",
                  `doc_${company_id}`,
                  "companyRound",
                  f,
                ),
              );
            }

            const capitalRoundData = `
              Round Name: ${nameOfRound}
              Type: ${round_type}
              Pre Money: ${pre_money}
              Post Money: ${post_money}
              Round Size: ${roundsize} ${currency}
              Issued Shares: ${issuedshares}
              Rights: ${rights}
              Liquidation Pref: ${liquidationpreferences}
              Convertible: ${convertible} (${convertibleType})
              Voting: ${voting}
              General Notes: ${generalnotes}
              Option Pool: ${optionPoolPercent}
              Investor Post Money: ${investorPostMoney}
            `;

            const prompt = `
            You are an investment analyst. Create a 1000-character executive summary from:

            ### Round Details
            ${capitalRoundData}

            ### Documents
            ${allFileText}

            Return clean text only.
            `;

            let executiveSummary = "";

            await db
              .promise()
              .query(`UPDATE roundrecord SET executive_summary=? WHERE id=?`, [
                executiveSummary,
                id,
              ]);
            // >>> AI EXECUTIVE SUMMARY END <

            // INSERT ACCESS LOG FOR UPDATE
            insertAccessLog({
              userId: created_by_id,
              userRole: created_by_role,
              companyId: company_id,
              action: "UPDATE",
              targetTable: "roundrecord",
              targetId: id,
              description: `Updated round record: ${nameOfRound}`,
              ip: clientIp,
              country_name: req.body.country_name,
            });

            // INSERT AUDIT LOG
            insertAuditLog({
              userId: created_by_id,
              companyId: company_id,
              module: "capital_round",
              action: "UPDATE",
              entityId: id,
              entityType: "roundrecord",
              details: {
                nameOfRound,
                roundsize,
                currency,
                round_type: round_type || "Investment",
                total_founder_shares,
                founder_count,
              },
              ip: clientIp,
              country_name: req.body.country_name,
            });

            // ✅ NOW subsequentRounds is accessible here
            return res.status(200).json({
              message: cascadeSuccess
                ? "Record updated successfully with cascade recalculation"
                : "Record updated but some cascades failed",
              id,
              executive_summary: executiveSummary,
              cascaded_rounds: subsequentRounds.length,
              cascade_success: cascadeSuccess,
              cascade_error: cascadeError,
            });
          });
        },
      );
    }

    // ============================================================
    // INSERT MODE - NO CASCADE NEEDED
    // ============================================================
    else {
      let processedFounderData = null;

      if (founder_data) {
        if (typeof founder_data === "string") {
          // If it's already a string, use it as is (assuming it's valid JSON)
          processedFounderData = founder_data;
        } else {
          // If it's an object, stringify it
          processedFounderData = JSON.stringify(founder_data);
        }
      }
      const sql = `
      INSERT INTO roundrecord (
        round_target_money,
        round_investments,
        optionPoolPercent_post,
        investorPostMoney,
        optionPoolPercent,
        pre_money,
        post_money,
        company_id,
        created_by_id,
        created_by_role,
        updated_by_id,
        updated_by_role,
        round_type,
        nameOfRound,
        shareClassType,
        shareclassother,
        description,
        instrumentType,
        instrument_type_data,
        customInstrument,
        roundsize,
        currency,
        issuedshares,
        rights,
        liquidationpreferences,
        liquidation,
        liquidationOther,
        convertible,
        convertibleType,
        voting,
        termsheetFile,
        subscriptiondocument,
        generalnotes,
        dateroundclosed,
        roundStatus,
        is_shared,
        is_locked,
        created_at,
        founder_data,
        total_founder_shares,
        founder_count
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      `;

      let processedDateRoundClosed = dateroundclosed;
      if (Array.isArray(processedDateRoundClosed)) {
        processedDateRoundClosed =
          processedDateRoundClosed.find((x) => x.trim() !== "") || null;
      }

      const parsedFounderCount = founder_count ? parseInt(founder_count) : null;
      const parsedTotalFounderShares = total_founder_shares
        ? parseInt(total_founder_shares)
        : null;

      // ✅ REMOVE warrant_status from instrument_type_data
      if (parsedInstrumentData.warrant_status) {
        delete parsedInstrumentData.warrant_status;
      }

      const values = [
        round_target_money,
        round_investments,
        optionPoolPercent_post, // 1
        investorPostMoney, // 2
        optionPoolPercent, // 3
        pre_money || null, // 4
        post_money || null, // 5
        company_id, // 6
        created_by_id, // 7
        created_by_role, // 8
        0, // 9  updated_by_id
        null, // 10 updated_by_role
        round_type || "Investment", // 11
        nameOfRound || "", // 12
        shareClassType || "", // 13
        shareclassother || "", // 14
        description || "", // 15
        instrumentType || "", // 16
        JSON.stringify(parsedInstrumentData), // 17
        customInstrument || "", // 18
        roundsize || "", // 19
        currency || "", // 20
        issuedshares || "", // 21
        rights || "", // 22
        liquidationpreferences || "", // 23
        liquidation || "", // 24
        liquidationOther || "", // 25
        convertible || "", // 26
        convertibleType || "", // 27
        voting || "", // 28
        JSON.stringify(newTermsheetFiles), // 29
        JSON.stringify(newSubscriptionDocs), // 30
        generalnotes || "", // 31
        processedDateRoundClosed, // 32
        roundStatus || "", // 33
        "No", // 34
        lock, // 35
        new Date(), // 36
        processedFounderData || null, // 37
        parsedTotalFounderShares, // 38
        parsedFounderCount, // 39
      ];

      db.query(sql, values, async (err, result) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB insert error", error: err });
        }

        const newId = result.insertId;
        var currentRound = req.body;
        if (hasWarrants_preferred === "true") {
          const warrantInsertData = {
            roundrecord_id: newId,
            company_id: company_id,
            investor_id: 0,
            warrant_coverage_percentage:
              parseFloat(warrant_coverage_percentage) || 0,
            warrant_exercise_type:
              warrant_exercise_type || "next_round_adjusted",
            warrant_adjustment_percent:
              parseFloat(warrant_adjustment_percent) || 0,
            warrant_adjustment_direction:
              warrant_adjustment_direction || "decrease",
            warrant_status: "pending",
            warrantType: warrantType,
            warrant_fixed_shares: warrant_fixed_shares,
            issued_date: new Date().toISOString().split("T")[0],
            expiration_date: expirationDate_preferred || null,
            notes: null,
            share_class_type: shareClassType,
            instrument_type: instrumentType,
            round_name: nameOfRound,
            warrant_coverage_percentage_main:
              parseFloat(warrant_coverage_percentage_main) || 0,
          };

          try {
            await createWarrantDataInternal(warrantInsertData);
          } catch (warrantErr) {
            console.error("Error creating warrant:", warrantErr);
            // Continue execution even if warrant creation fails
          }
        }
        // Calculate shares for new round
        try {
          await calculateAndUpdateIssuedShares(
            {
              round_investments: round_investments,
              id: newId,
              company_id,
              optionPoolPercent,
              pre_money,
              post_money,
              roundsize,
              issuedshares,
              round_type,
              instrumentType,
              investorPostMoney,
              optionPoolPercent_post,
              currentRound,
            },
            false,
          ); // isUpdate = false for CREATE
        } catch (calcError) {
          console.error(`❌ Error calculating new round ${newId}:`, calcError);
        }

        // ✅ CRITICAL: Check if this is a Preferred Equity round
        // If yes, then exercise ALL pending warrants from previous rounds

        // >>> AI EXECUTIVE SUMMARY START <
        let allFileText = "";

        for (const f of newTermsheetFiles) {
          allFileText += await extractFileText(
            path.join("upload", "docs", `doc_${company_id}`, "companyRound", f),
          );
        }
        for (const f of newSubscriptionDocs) {
          allFileText += await extractFileText(
            path.join("upload", "docs", `doc_${company_id}`, "companyRound", f),
          );
        }

        const capitalRoundData = `
          Round Name: ${nameOfRound}
          Type: ${round_type}
          Pre Money: ${pre_money}
          Post Money: ${post_money}
          Round Size: ${roundsize} ${currency}
          Issued Shares: ${issuedshares}
          Rights: ${rights}
          Liquidation Pref: ${liquidationpreferences}
          Convertible: ${convertible} (${convertibleType})
          Voting: ${voting}
          General Notes: ${generalnotes}
          Option Pool: ${optionPoolPercent}
          Investor Post Money: ${investorPostMoney}
        `;

        const prompt = `
          You are an investment analyst. Create a 1000-character executive summary from:
          ### Round Details
          ${capitalRoundData}
          ### Documents
          ${allFileText}
          Return clean text only.
        `;

        let executiveSummary = "";

        await db
          .promise()
          .query(`UPDATE roundrecord SET executive_summary=? WHERE id=?`, [
            executiveSummary,
            newId,
          ]);
        // >>> AI EXECUTIVE SUMMARY END <

        // INSERT ACCESS LOG FOR CREATE
        insertAccessLog({
          userId: created_by_id,
          userRole: created_by_role,
          companyId: company_id,
          action: "CREATE",
          targetTable: "roundrecord",
          targetId: newId,
          description: `Created round record: ${nameOfRound}`,
          ip: clientIp,
          country_name: req.body.country_name,
        });

        // INSERT AUDIT LOG
        insertAuditLog({
          userId: created_by_id,
          companyId: company_id,
          module: "capital_round",
          action: "CREATE",
          entityId: newId,
          entityType: "roundrecord",
          details: {
            nameOfRound,
            roundsize,
            currency,
            round_type: round_type || "Investment",
            total_founder_shares: parsedTotalFounderShares,
            founder_count: parsedFounderCount,
          },
          ip: clientIp,
          country_name: req.body.country_name,
        });

        return res.status(200).json({
          message: "Record created successfully",
          id: newId,
          executive_summary: executiveSummary,
          warrant_created: parsedInstrumentData.hasWarrants_preferred || false,
          warrants_exercised:
            instrumentType === "Preferred Equity"
              ? "Pending warrants from previous rounds will be exercised"
              : "N/A",
        });
      });
    }
  });
};

async function recalculateCascade(company_id, start_round_id) {
  try {
    // Step 1: Get all rounds from start_round_id onwards
    const getAllRoundsQuery = `
      SELECT *
      FROM roundrecord 
      WHERE company_id = ? 
        AND id >= ?
        AND round_type = 'Investment'
      ORDER BY id ASC
    `;

    const allRounds = await new Promise((resolve, reject) => {
      db.query(
        getAllRoundsQuery,
        [company_id, start_round_id],
        (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        },
      );
    });

    if (allRounds.length === 0) {
      return { success: true, processed: 0 };
    }

    let processedCount = 0;
    let errors = [];

    // Step 2: Recalculate each round in sequence
    for (const round of allRounds) {
      try {
        // Get COMPLETE fresh data for this round
        const getRoundDataQuery = `
          SELECT 
            rr.*,
            (SELECT total_shares_after 
             FROM roundrecord 
             WHERE company_id = rr.company_id 
               AND id < rr.id 
             ORDER BY id DESC 
             LIMIT 1) as calculated_total_before
          FROM roundrecord rr
          WHERE rr.id = ?
        `;

        const roundData = await new Promise((resolve, reject) => {
          db.query(getRoundDataQuery, [round.id], (err, results) => {
            if (err) reject(err);
            else resolve(results && results.length > 0 ? results[0] : null);
          });
        });

        if (!roundData) {
          continue;
        }

        // Parse instrument data
        let instrumentData = {};
        try {
          instrumentData = roundData.instrument_type_data
            ? typeof roundData.instrument_type_data === "string"
              ? JSON.parse(roundData.instrument_type_data)
              : roundData.instrument_type_data
            : {};
        } catch (e) {
          instrumentData = {};
        }

        // Get actual total_shares_before from previous round
        const getActualTotalBeforeQuery = `
          SELECT total_shares_after as total_shares_before
          FROM roundrecord 
          WHERE company_id = ? 
            AND id < ?
          ORDER BY id DESC 
          LIMIT 1
        `;

        const actualBeforeData = await new Promise((resolve, reject) => {
          db.query(
            getActualTotalBeforeQuery,
            [roundData.company_id, roundData.id],
            (err, results) => {
              if (err) reject(err);
              else resolve(results && results.length > 0 ? results[0] : null);
            },
          );
        });

        const total_shares_before = actualBeforeData
          ? parseInt(actualBeforeData.total_shares_before)
          : parseInt(roundData.calculated_total_before) || 0;

        // Get round0 shares
        const round0Query = `
          SELECT total_founder_shares 
          FROM roundrecord 
          WHERE company_id = ? 
            AND round_type = 'Round 0'
          LIMIT 1
        `;

        const round0Data = await new Promise((resolve, reject) => {
          db.query(round0Query, [roundData.company_id], (err, results) => {
            if (err) reject(err);
            else resolve(results && results.length > 0 ? results[0] : null);
          });
        });

        const round0_shares = round0Data
          ? parseInt(round0Data.total_founder_shares)
          : 100000;

        // Prepare calculation parameters
        const params = {
          id: roundData.id,
          round_investments: roundData.round_investments,
          company_id: roundData.company_id,
          preMoney: parseFloat(roundData.pre_money) || 0,
          roundSize: parseFloat(roundData.roundsize) || 0,
          optionPoolPercentValue: parseFloat(roundData.optionPoolPercent) || 0,
          total_shares_before: total_shares_before,
          round0_shares: round0_shares,
          investorPostMoney: roundData.investorPostMoney,
          optionPoolPercent_post: roundData.optionPoolPercent_post,
          instrumentData: instrumentData,
          isUpdate: true,
          currentRound: roundData,
        };

        // Call appropriate handler
        if (roundData.instrumentType === "Common Stock") {
          await handleCommonStockCalculation(params, true);
        } else if (roundData.instrumentType === "Preferred Equity") {
          await handlePreferredEquityCalculation(params, true);
        } else if (roundData.instrumentType === "Safe") {
          await handleSafeCalculation(params, true);
        } else if (roundData.instrumentType === "Convertible Note") {
          await handleConvertibleNoteCalculation(params, true);
        } else if (roundData.round_type === "Round 0") {
          await handleRound0Calculation(params);
        }

        processedCount++;

        // Small delay
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (roundError) {
        console.error(`❌ Error in Round ${round.id}:`, roundError);
        errors.push({
          round_id: round.id,
          error: roundError.message,
        });
      }
    }

    return {
      success: errors.length === 0,
      processed: processedCount,
      errors: errors,
    };
  } catch (error) {
    console.error("CASCADE RECALCULATION FAILED:", error);
    return {
      success: false,
      processed: 0,
      errors: [{ error: error.message }],
    };
  }
}
function calculateAndUpdateIssuedShares(roundData, isUpdate = false) {
  const {
    round_investments,
    id,
    company_id,
    optionPoolPercent,
    pre_money,
    post_money,
    roundsize,
    issuedshares,
    investorPostMoney,
    round_type,
    instrumentType,
    optionPoolPercent_post,
    currentRound,
  } = roundData;

  // STEP 1: Get total shares BEFORE this round
  const getTotalSharesBeforeQuery = `
   WITH last_investment AS (
  -- 🔹 Get the most recent investment round (Preferred or Common) before current round
  SELECT 
    id,
    total_shares_after
  FROM roundrecord
  WHERE company_id = ?
    AND instrumentType IN ('Preferred Equity', 'Common Stock')
    AND round_type = 'Investment'
    AND id < ?
  ORDER BY id DESC
  LIMIT 1
),

round0 AS (
  -- 🔹 Total founder shares from Round 0
  SELECT 
    COALESCE(total_founder_shares, 0) AS round0_shares
  FROM roundrecord
  WHERE company_id = ?
    AND round_type = 'Round 0'
  LIMIT 1
),

previous_investments AS (
  -- 🔹 Sum of previous issued shares and option pools (before current round)
  SELECT
    COALESCE(SUM(
      CASE 
        WHEN instrumentType IN ('Common Stock', 'Preferred Equity')
        THEN CAST(issuedshares AS UNSIGNED)
        ELSE 0
      END
    ), 0) AS prev_investment_shares,

    COALESCE(SUM(CAST(option_pool_shares AS UNSIGNED)), 0) AS prev_option_shares
  FROM roundrecord
  WHERE company_id = ?
    AND round_type = 'Investment'
    AND id < ?
),

converted AS (
  -- 🔹 Total SAFE/Convertible shares converted before current round
  SELECT 
    COALESCE(SUM(converted_shares), 0) AS total_converted
  FROM conversion_tracking
  WHERE company_id = ?
    AND conversion_round_id < ?
)

SELECT
  r0.round0_shares,
  pi.prev_investment_shares,
  pi.prev_option_shares,
  conv.total_converted,
  li.total_shares_after AS last_investment_total,

  -- 🔑 Pre-money total shares calculation
  CASE
    -- Use last investment round total if exists
    WHEN li.total_shares_after IS NOT NULL THEN li.total_shares_after

    -- Otherwise, sum Round0 + previous investments + option pool + converted SAFE
    ELSE r0.round0_shares
       + pi.prev_investment_shares
       + pi.prev_option_shares
       + conv.total_converted
  END AS total_shares_before_calc

FROM round0 r0
CROSS JOIN previous_investments pi
CROSS JOIN converted conv
LEFT JOIN last_investment li ON 1=1;


  `;

  db.query(
    getTotalSharesBeforeQuery,
    [company_id, id, company_id, company_id, id, company_id, id],
    async (err, results) => {
      if (err) {
        console.error("Error getting total shares before:", err);
        return;
      }

      const round0_shares = parseInt(results[0]?.round0_shares) || 0;
      const previous_investment_shares =
        parseInt(results[0]?.previous_investment_shares) || 0;
      const previous_option_shares =
        parseInt(results[0]?.previous_option_shares) || 0;
      const total_converted_shares = parseInt(results[0]?.total_converted) || 0;

      let total_shares_befores =
        round0_shares +
        previous_investment_shares +
        previous_option_shares +
        total_converted_shares;
      let total_shares_before =
        parseInt(results[0]?.total_shares_before_calc) || 0;
      // STEP 2: Get current round data
      const getCurrentRoundQuery = `SELECT instrument_type_data FROM roundrecord WHERE id = ?`;
      db.query(getCurrentRoundQuery, [id], async (err, roundResults) => {
        if (err || !roundResults.length) {
          console.error("Error getting round data:", err);
          return;
        }

        let instrumentData = {};
        try {
          instrumentData = roundResults[0].instrument_type_data
            ? JSON.parse(roundResults[0].instrument_type_data)
            : {};
        } catch (e) {
          instrumentData = {};
        }

        // Parse input values
        const preMoney = parseFloat(pre_money) || 0;
        const roundSize = parseFloat(roundsize) || 0;
        const optionPoolPercentValue = parseFloat(optionPoolPercent) || 0;

        // Call appropriate handler based on instrument type
        if (instrumentType === "Common Stock") {
          handleCommonStockCalculation({
            round_investments,
            id,
            company_id,
            preMoney,
            roundSize,
            optionPoolPercentValue,
            total_shares_before,
            round0_shares,
            isUpdate,
            optionPoolPercent_post,
            currentRound,
          });
        } else if (instrumentType === "Preferred Equity") {
          handlePreferredEquityCalculation({
            round_investments,
            id,
            company_id,
            preMoney,
            roundSize,
            optionPoolPercentValue,
            total_shares_before,
            round0_shares,
            investorPostMoney,
            instrumentData,
            isUpdate,
            optionPoolPercent_post,
            currentRound,
          });
        } else if (instrumentType === "Safe") {
          handleSafeCalculation({
            round_investments,
            id,
            company_id,
            preMoney,
            roundSize,
            optionPoolPercentValue,
            total_shares_before,
            instrumentData,
            isUpdate,
            optionPoolPercent_post,
          });
        } else if (instrumentType === "Convertible Note") {
          handleConvertibleNoteCalculation({
            round_investments,
            id,
            company_id,
            preMoney,
            roundSize,
            optionPoolPercentValue,
            total_shares_before,
            instrumentData,
            isUpdate,
            optionPoolPercent_post,
          });
        } else if (round_type === "Round 0") {
          handleRound0Calculation({
            id,
            issuedshares,
            instrumentData,
          });
        }
      });
    },
  );
}

// ============================================
// SEPARATE HANDLER FUNCTIONS
// ============================================
// ============================================
// GET FOUNDER DATA FROM ROUND 0 - COMPLETELY DYNAMIC
// ============================================
async function getFounderDataFromRound0(company_id) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT *
      FROM roundrecord 
      WHERE company_id = ? 
        AND round_type = 'Round 0'
      LIMIT 1
    `;

    db.query(query, [company_id], (err, results) => {
      if (err) {
        console.error("❌ Error fetching founder data:", err);
        resolve(null);
      } else if (results.length === 0) {
        resolve(null);
      } else {
        try {
          let founderData = results[0].founder_data;

          // Parse if string
          if (typeof founderData === "string") {
            founderData = JSON.parse(founderData);
          }

          resolve({
            founder_data: founderData,
            total_founder_shares: results[0].total_founder_shares,
            founder_count: results[0].founder_count,
            round0Name: results[0].nameOfRound,
          });
        } catch (error) {
          console.error("❌ Error parsing founder data:", error);
          resolve(null);
        }
      }
    });
  });
}
// ============================================
// COMMON STOCK ROUND - COMPLETELY DYNAMIC (NO STATIC DATA)
async function handleCommonStockCalculation(params, updateFlag = false) {
  const {
    round_investments,
    id,
    company_id,
    preMoney,
    roundSize,
    optionPoolPercentValue,
    total_shares_before,
    round0_shares,
    isUpdate: isUpdateFromParams = false,
    optionPoolPercent_post,
    currentRound,
  } = params;

  const isUpdate = updateFlag || isUpdateFromParams;

  // ==================== VALIDATE INPUTS ====================
  const preMoneyVal = parseFloat(preMoney) || 0;
  const roundSizeVal = parseFloat(roundSize) || 0;
  const preMoneyPoolPercent = parseFloat(optionPoolPercentValue) || 0;
  const postMoneyPoolTarget = parseFloat(optionPoolPercent_post) || 0;
  let round0Shares = parseInt(round0_shares) || 0;

  if (preMoneyVal <= 0 || roundSizeVal <= 0 || round0Shares <= 0) {
    return { success: false, error: "Invalid inputs for calculation" };
  }

  // ==================== GET ROUND 0 FOUNDER DATA ====================
  let founderList = [];
  let founderData = null;
  let totalFounderShares = 0;
  let round0 = null;
  let round0Name = "Round 0";
  let round0Shareclassstype = "";

  try {
    const round0Data = await getFounderDataFromRound0(company_id);
    if (round0Data && round0Data.founder_data) {
      founderData = round0Data.founder_data;
      totalFounderShares = round0Data.total_founder_shares || 0;
      round0Name = round0Data.round0Name;
      round0Shareclassstype = round0Data.shareClassType;

      if (founderData.founders && Array.isArray(founderData.founders)) {
        founderList = founderData.founders.map((founder, index) => ({
          name:
            `${founder.firstName || ""} ${founder.lastName || ""}`.trim() ||
            `Founder ${index + 1}`,
          shares: parseFloat(founder.shares) || 0,
          email: founder.email || "",
          phone: founder.phone || "",
          voting: founder.voting || "voting",
          share_type: founder.shareType || "common",
          founder_code: `F${index + 1}`,
          shareClassType:
            founder.shareClassType ||
            round0Data.shareClassType ||
            "Common Shares",
          instrumentType:
            founder.instrumentType ||
            round0Data.instrumentType ||
            "Common Stock",
          roundName: round0Data.nameOfRound || "Round 0",
          roundId: round0Data.id || null,
          round_id: round0Data.id || null,
          investment: founder.investment || 0,
          share_price: founder.share_price || 0,
          original_founder_data: founder,
        }));
      }
    }
  } catch (error) {
    console.error("❌ Error fetching founder data:", error);
  }

  // ==================== GET PREVIOUS ROUNDS ====================
  const previousRounds = await getPreviousRoundsForCompany(company_id, id);
  const sortedPreviousRounds = [...previousRounds].sort((a, b) => b.id - a.id);
  const latestPreviousRound = sortedPreviousRounds[0];

  const hasInvestmentRoundBefore = previousRounds.some(
    (round) =>
      round.instrumentType === "Preferred Equity" ||
      round.instrumentType === "Common Stock" ||
      round.instrumentType === "Safe" ||
      round.instrumentType === "Convertible Note",
  );
  const isPreviousRoundRound0 = latestPreviousRound?.round_type === "Round 0";
  round0Name = latestPreviousRound?.nameOfRound || round0Name;

  // ==================== GET DATA FROM LATEST PREVIOUS ROUND ====================
  let existingOptionPoolShares = 0;
  let totalPreMoneyShares = round0Shares;
  let previousInvestorsList = [];
  let previousInvestorsTotalShares = 0;
  let previousWarrantsList = [];
  let previousWarrantsTotalShares = 0;
  let currentRoundWarrantsList = [];
  let currentRoundWarrantsTotalShares = 0;
  if (latestPreviousRound) {
    const round = latestPreviousRound;
    existingOptionPoolShares =
      parseInt(round.total_option_pool) ||
      parseInt(round.option_pool_shares) ||
      0;
    totalPreMoneyShares = parseInt(round.total_shares_after) || round0Shares;

    // ✅ Sirf latest round ke investors fetch karo
    const roundInvestors = await new Promise((resolve, reject) => {
      db.query(
        `SELECT * FROM round_investors 
       WHERE round_id = ? AND company_id = ? AND cap_table_type = 'post' 
       AND (investor_type = 'current' OR investor_type = 'converted' or investor_type = 'previous' or investor_type = 'warrant' or investor_type = 'warrant not exercised')
       ORDER BY id ASC`,
        [round.id, company_id], // ✅ round.id use kiya (latest round)
        (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        },
      );
    });

    // ✅ Process investors from latest round only
    roundInvestors.forEach((inv) => {
      if (
        inv.investor_type === "warrant" ||
        inv.investor_type === "warrant not exercised"
      ) {
        previousWarrantsList.push({
          type: "warrant",
          name: `${inv.first_name || ""} ${inv.last_name || ""}`.trim(),
          investor_details: {
            firstName: inv.first_name || "",
            lastName: inv.last_name || "",
            email: inv.email || "",
            phone: inv.phone || "",
          },
          shares: inv.shares,
          investor_type: inv.investor_type,
          investment: parseFloat(inv.investment_amount || 0),
          share_price: parseFloat(inv.share_price || 0),
          share_class_type: inv.share_class_type,
          instrument_type: inv.instrument_type,
          round_name: inv.round_name,
          round_id: round.id,
          warrant_id: inv.warrant_id,
          is_previous: true,
        });
      } else {
        previousInvestorsList.push({
          type: "investor",
          name: `${inv.first_name || ""} ${inv.last_name || ""}`.trim(),
          investor_details: {
            firstName: inv.first_name || "",
            lastName: inv.last_name || "",
            email: inv.email || "",
            phone: inv.phone || "",
          },
          shares: inv.shares,
          investment: parseFloat(inv.investment_amount || 0),
          share_price: parseFloat(inv.share_price || 0),
          share_class_type: inv.share_class_type,
          instrument_type: inv.instrument_type,
          round_name: inv.round_name,
          round_id: round.id,
          is_previous: true,
        });
      }
    });

    previousInvestorsTotalShares = previousInvestorsList.reduce(
      (sum, inv) => sum + (inv.shares || 0),
      0,
    );
    previousWarrantsTotalShares = previousWarrantsList.reduce(
      (sum, warrant) => sum + (warrant.shares || 0),
      0,
    );
  }
  // ==================== GET CURRENT ROUND WARRANTS ====================
  try {
    const currentRoundWarrants = await new Promise((resolve, reject) => {
      db.query(
        `SELECT w.* 
         FROM warrants w
         WHERE w.roundrecord_id = ? AND w.company_id = ?`,
        [id, company_id],
        (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        },
      );
    });

    // Parse investors list for names
    let roundInvestorsList = [];
    try {
      if (round_investments) {
        roundInvestorsList =
          typeof round_investments === "string"
            ? JSON.parse(round_investments)
            : round_investments;
      }
    } catch (e) {
      console.error("Error parsing round_investments:", e);
    }

    currentRoundWarrants.forEach((warrant, index) => {
      let investorName = "Warrant Holder";
      let investorEmail = "";
      let investorPhone = "";
      let investorFirstName = "";
      let investorLastName = "";

      if (roundInvestorsList && roundInvestorsList.length > 0) {
        const investor = roundInvestorsList[0];
        investorFirstName = "";
        investorLastName = "";
        investorName = "Warrant Holder";
        investorEmail = "";
        investorPhone = "";
      }
      currentRoundWarrantsList.push({
        type: "warrant",
        name: investorName,
        investor_details: {
          firstName: investorFirstName,
          lastName: investorLastName,
          email: investorEmail,
          phone: investorPhone,
        },
        shares: warrant.shares || 0,
        investor_type: "warrant not exercised",
        investment: 0,
        share_price: 0,
        share_class_type: null,
        instrument_type: null,
        round_name: currentRound?.nameOfRound || "",
        round_id: id,
        warrant_id: warrant.id,
        is_previous: false,
      });
    });

    currentRoundWarrantsTotalShares = currentRoundWarrantsList.reduce(
      (sum, warrant) => sum + (warrant.shares || 0),
      0,
    );
  } catch (error) {
    console.error("❌ Error fetching current round warrants:", error);
  }

  // ==================== GET ALREADY CONVERTED ROUNDS ====================
  const alreadyConvertedRounds = await getAlreadyConvertedRounds(
    company_id,
    id,
  );
  const alreadyConvertedIds = alreadyConvertedRounds.map((r) =>
    parseInt(r.original_round_id),
  );

  // ==================== CALCULATE SHARE PRICE ====================
  const sharePrice = preMoneyVal / totalPreMoneyShares;

  // ==================== CONVERT SAFE + CONVERTIBLE NOTES ====================
  // ✅ Per-investor conversion — round_investors se pending records fetch karo
  let totalConvertedShares = 0;
  let totalConvertedInvestment = 0;
  let conversionDetails = [];
  const yearsBetween = 2; // default — maturity_date se calculate kar sakte ho

  // ==================== FETCH PREVIOUS PENDING SAFEs / NOTES ====================
  // ✅ round_pending_instruments NAHI — round_investors se fetch karo
  let previousPendingSafes = [];

  if (
    latestPreviousRound &&
    (latestPreviousRound.instrumentType === "Safe" ||
      latestPreviousRound.instrumentType === "Convertible Note")
  ) {
    try {
      // ✅ Use latestPreviousRound.id instead of pendingRound.id
      const pendingRows = await new Promise((resolve, reject) => {
        db.query(
          `SELECT ri.*,
                r.nameOfRound    AS round_name_ref,
                r.instrumentType AS round_instrument_type,
                r.shareClassType AS round_share_class_type
         FROM round_investors ri
         LEFT JOIN roundrecord r ON r.id = ri.round_id
         WHERE ri.company_id     = ?
           AND ri.round_id       = ?
           AND ri.investor_type  = 'pending'
           AND ri.is_pending     = 1
           AND ri.cap_table_type = 'post'
         ORDER BY ri.id ASC`,
          [company_id, latestPreviousRound.id], // ✅ Sirf latest round ID
          (err, results) => {
            if (err) reject(err);
            else resolve(results || []);
          },
        );
      });

      pendingRows.forEach((row) => {
        const inv =
          typeof row.investor_details === "string"
            ? JSON.parse(row.investor_details || "{}")
            : row.investor_details || {};

        previousPendingSafes.push({
          type: "pending",
          name:
            `${row.first_name || ""} ${row.last_name || ""}`.trim() ||
            inv.firstName ||
            "Pending Investor",
          instrument_type:
            row.instrument_type || latestPreviousRound.instrumentType,
          shares: 0,
          new_shares: 0,
          existing_shares: 0,
          total: 0,
          potential_shares: parseInt(row.potential_shares) || 0,
          investment: parseFloat(row.investment_amount) || 0,
          investment_amount: parseFloat(row.investment_amount) || 0,
          principal: parseFloat(row.investment_amount) || 0,
          interest_accrued: parseFloat(row.interest_accrued) || 0,
          total_conversion_amount:
            parseFloat(row.total_conversion_amount) ||
            parseFloat(row.investment_amount) ||
            0,
          conversion_price: parseFloat(row.conversion_price) || 0,
          discount_rate: parseFloat(row.discount_rate) || 0,
          valuation_cap: parseFloat(row.valuation_cap) || 0,
          interest_rate: parseFloat(row.interest_rate) || 0,
          years: parseFloat(row.years) || 0,
          maturity_date: row.maturity_date || "",
          percentage: 0,
          percentage_formatted: "0.00%",
          value: 0,
          value_formatted: "0.00",
          is_pending: true,
          is_converted: false,
          round_id: row.round_id,

          shareClassType:
            row.round_share_class_type ||
            row.share_class_type ||
            row.instrument_type ||
            latestPreviousRound.instrumentType ||
            "",
          instrument_type:
            row.instrument_type || latestPreviousRound.instrumentType || "",
          round_id: row.round_id,
          round_name:
            row.round_name_ref || latestPreviousRound.nameOfRound || "",
          pending_instrument_id: row.id,
          investor_details: {
            firstName: row.first_name || inv.firstName || "",
            lastName: row.last_name || inv.lastName || "",
            email: row.email || inv.email || "",
            phone: row.phone || inv.phone || "",
          },
          email: row.email || inv.email || "",
          phone: row.phone || inv.phone || "",
        });
      });
    } catch (error) {
      console.error("❌ Error fetching pending instruments:", error);
      previousPendingSafes = [];
    }
  } else {
  }

  // ==================== PARSE INVESTORS FROM round_investments ====================
  let investorsList = [];
  try {
    if (round_investments) {
      investorsList =
        typeof round_investments === "string"
          ? JSON.parse(round_investments)
          : round_investments;
    }
  } catch (e) {
    console.error("Error parsing round_investments:", e);
  }

  // ==================== CALCULATION BASED ON ROUND TYPE ====================
  let total_option_pool = 0;
  let previous_investors_total = 0;
  let optionPoolShares = 0;
  let preMoneyTotalSharesCalc = 0;
  let totalPostShares = 0;
  let newInvestorShares = 0;
  let updatedSharePrice = 0;
  let newOptionShares = 0;
  let seriesAInvestorShares = 0;
  let total_shares_befores = 0;
  const postMoneyValuation = preMoneyVal + roundSizeVal;

  if (hasInvestmentRoundBefore) {
    preMoneyTotalSharesCalc = totalPreMoneyShares;

    const totalExistingShares = round0Shares + previousInvestorsTotalShares;
    const investorOwnership = roundSizeVal / postMoneyValuation;
    const targetOptionPercent = postMoneyPoolTarget / 100;
    const existingOwnershipAfter = 1 - investorOwnership - targetOptionPercent;

    totalPostShares = Math.round(totalExistingShares / existingOwnershipAfter);
    const totalNewSharesThisRound = totalPostShares - preMoneyTotalSharesCalc;
    const targetTotalOptionShares = Math.round(
      totalPostShares * targetOptionPercent,
    );

    newOptionShares = Math.max(
      0,
      targetTotalOptionShares - existingOptionPoolShares,
    );
    seriesAInvestorShares = totalNewSharesThisRound - newOptionShares;
    newInvestorShares = seriesAInvestorShares;
    updatedSharePrice =
      preMoneyVal / (preMoneyTotalSharesCalc + newOptionShares);

    previous_investors_total = previousInvestorsTotalShares;
    total_option_pool = existingOptionPoolShares + newOptionShares;
    total_shares_befores = preMoneyTotalSharesCalc;
  } else if (isPreviousRoundRound0) {
    const totalSharesWithConverted = round0Shares + totalConvertedShares;

    optionPoolShares = Math.round(
      (totalSharesWithConverted / (1 - preMoneyPoolPercent / 100)) *
        (preMoneyPoolPercent / 100),
    );

    preMoneyTotalSharesCalc = totalSharesWithConverted + optionPoolShares;
    const investorPostMoneyOwnership =
      (roundSizeVal / postMoneyValuation) * 100;

    totalPostShares = Math.round(
      preMoneyTotalSharesCalc / (1 - investorPostMoneyOwnership / 100),
    );

    newInvestorShares = totalPostShares - preMoneyTotalSharesCalc;
    updatedSharePrice = roundSizeVal / newInvestorShares;

    previous_investors_total = newInvestorShares;
    total_option_pool = optionPoolShares;
    total_shares_befores = preMoneyTotalSharesCalc;
  } else {
    optionPoolShares = Math.round(
      (round0Shares / (1 - preMoneyPoolPercent / 100)) *
        (preMoneyPoolPercent / 100),
    );

    preMoneyTotalSharesCalc =
      round0Shares + optionPoolShares + totalConvertedShares;
    const investorPostMoneyOwnership =
      (roundSizeVal / postMoneyValuation) * 100;

    totalPostShares = Math.round(
      preMoneyTotalSharesCalc / (1 - investorPostMoneyOwnership / 100),
    );

    newInvestorShares = totalPostShares - preMoneyTotalSharesCalc;
    updatedSharePrice = roundSizeVal / newInvestorShares;

    previous_investors_total = newInvestorShares;
    total_option_pool = optionPoolShares;
    total_shares_befores = total_shares_before;
  }
  // ==================== HELPER FUNCTION FOR WARRANT ITEM ====================
  const buildWarrantItem = (warrant, totalShares, valuation, cur) => {
    const ownership = warrant.shares / totalShares;
    const rawPercentage = ownership * 100;
    let investorType = "warrant";
    if (warrant.investor_type === "warrant not exercised") {
      investorType = "warrant not exercised";
    }
    return {
      type: "investor",
      name: warrant.name,
      investor_details: warrant.investor_details,
      shares: warrant.shares,
      new_shares: warrant.shares,
      existing_shares: 0,
      total: warrant.shares,
      email: warrant.investor_details?.email || "",
      phone: warrant.investor_details?.phone || "",
      percentage_raw: rawPercentage,
      percentage: rawPercentage.toFixed(2) + "%",
      percentage_formatted: rawPercentage.toFixed(2) + "%",
      value: ((rawPercentage * valuation) / 100).toFixed(2),
      investment: warrant.investment,
      investment_amount: warrant.investment,
      share_price: warrant.share_price,
      is_previous: false,
      is_warrant: true,
      is_new_investment: true,
      is_converted: false,
      investor_type: investorType,
      share_class_type: warrant.share_class_type,
      instrument_type: warrant.instrument_type,
      round_name: warrant.round_name,
      round_id: warrant.round_id,
      warrant_id: warrant.warrant_id,
    };
  };
  // ==================== PREPARE INVESTORS LIST WITH SHARES ====================
  const investorsWithShares = investorsList.map((inv) => {
    const amount = parseFloat(inv.amount) || 0;
    const shares = Math.round(amount / updatedSharePrice);
    const exactPercentage = (shares / totalPostShares) * 100;
    const exactValue = (exactPercentage * postMoneyValuation) / 100;

    return {
      ...inv,
      shares,
      share_price: updatedSharePrice,
      type: "investor",
      is_new_investment: true,
      percentage: exactPercentage.toFixed(2) + "%",
      value: exactValue.toFixed(2),
      shareClassType: currentRound.shareClassType || "Series",
      instrumentType: currentRound.instrumentType || "Common Stock",
      roundName: currentRound.nameOfRound || "Current Round",
      round_id: currentRound.id,
      investor_details: {
        firstName: inv.firstName || "",
        lastName: inv.lastName || "",
        email: inv.email || "",
        phone: inv.phone || "",
      },
    };
  });

  // ==================== PRE-MONEY CAP TABLE ====================
  // ==================== PRE-MONEY CAP TABLE ====================
  const preMoneyCapTable = {
    total_shares: preMoneyTotalSharesCalc,
    pending_instruments: previousPendingSafes,
    founders: {
      list: founderList.map((f) => {
        const ownership = f.shares / preMoneyTotalSharesCalc;
        const rawPercentage = ownership * 100;
        return {
          ...f,
          roundName: round0Name,
          share_class_type: round0Shareclassstype,
          percentage_raw: rawPercentage,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
        };
      }),
      roundName: round0Name,
      share_class_type: round0Shareclassstype,
      total_shares: round0Shares,
      total_percentage_raw: (round0Shares / preMoneyTotalSharesCalc) * 100,
      total_percentage:
        ((round0Shares / preMoneyTotalSharesCalc) * 100).toFixed(2) + "%",
      total_value: (
        ((round0Shares / preMoneyTotalSharesCalc) * 100 * preMoneyVal) /
        100
      ).toFixed(2),
    },

    option_pool: (() => {
      const opShares = existingOptionPoolShares + (optionPoolShares || 0);
      const ownership = opShares / preMoneyTotalSharesCalc;
      const rawPercentage = ownership * 100;
      return {
        shares: opShares,
        existing_shares: existingOptionPoolShares,
        new_shares: optionPoolShares || 0,
        percentage_raw: rawPercentage,
        percentage: rawPercentage.toFixed(2) + "%",
        value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
        shareClassType: "Option Pool",
        instrumentType: "Options",
        roundName: "Option Pool",
        is_option_pool: true,
      };
    })(),

    previous_investors:
      previousInvestorsList.length > 0
        ? (() => {
            const groupOwnership =
              previousInvestorsTotalShares / preMoneyTotalSharesCalc;
            const groupRawPercentage = groupOwnership * 100;
            return {
              name: "Previous Investors",
              total_shares: previousInvestorsTotalShares,
              percentage_raw: groupRawPercentage,
              percentage: groupRawPercentage.toFixed(2) + "%",
              total_value: ((groupRawPercentage * preMoneyVal) / 100).toFixed(
                2,
              ),
              items: previousInvestorsList.map((inv) => {
                const ownership = inv.shares / preMoneyTotalSharesCalc;
                const rawPercentage = ownership * 100;
                return {
                  ...inv,
                  percentage_raw: rawPercentage,
                  percentage: rawPercentage.toFixed(2) + "%",
                  value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
                };
              }),
              is_grouped: false,
            };
          })()
        : null,

    converted:
      totalConvertedShares > 0
        ? (() => {
            const ownership = totalConvertedShares / preMoneyTotalSharesCalc;
            const rawPercentage = ownership * 100;
            return {
              name: "Converted Note Investors",
              shares: totalConvertedShares,
              percentage_raw: rawPercentage,
              percentage: rawPercentage.toFixed(2) + "%",
              value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
            };
          })()
        : null,

    warrants:
      previousWarrantsList.length > 0
        ? {
            name: "Warrants",
            total_shares: previousWarrantsTotalShares,
            percentage_raw:
              (previousWarrantsTotalShares / preMoneyTotalSharesCalc) * 100,
            percentage:
              (
                (previousWarrantsTotalShares / preMoneyTotalSharesCalc) *
                100
              ).toFixed(2) + "%",
            total_value: (
              ((previousWarrantsTotalShares / preMoneyTotalSharesCalc) *
                100 *
                preMoneyVal) /
              100
            ).toFixed(2),
            items: previousWarrantsList.map((w) =>
              buildWarrantItem(
                w,
                preMoneyTotalSharesCalc,
                preMoneyVal,
                currentRound?.currency || "USD",
              ),
            ),
          }
        : null,

    pre_money_valuation: preMoneyVal,
    share_price: (preMoneyVal / preMoneyTotalSharesCalc).toFixed(4),

    items: [
      // Founders
      ...founderList.map((f) => {
        const ownership = f.shares / preMoneyTotalSharesCalc;
        const rawPercentage = ownership * 100;
        return {
          type: "founder",
          name: f.name,
          shares: f.shares,
          new_shares: 0,
          total: f.shares,
          existing_shares: f.shares,
          email: f.email,
          phone: f.phone,
          founder_code: f.founder_code,
          percentage_raw: rawPercentage,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
          shareClassType: f.shareClassType || "Common Shares",
          instrumentType: f.instrumentType || "Common Stock",
          roundName: round0Name,
          round_id: f.round_id || null,
          is_option_pool: false,
          is_previous: false,
          is_converted: false,
        };
      }),

      // Option Pool
      (() => {
        const opShares = existingOptionPoolShares + (optionPoolShares || 0);
        const ownership = opShares / preMoneyTotalSharesCalc;
        const rawPercentage = ownership * 100;
        return {
          type: "option_pool",
          name: "Employee Option Pool",
          shares: opShares,
          new_shares: optionPoolShares || 0,
          existing_shares: existingOptionPoolShares,
          total: opShares,
          is_option_pool: true,
          percentage_raw: rawPercentage,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
          shareClassType: "Option Pool",
          instrumentType: "Options",
          roundName: "Option Pool",
        };
      })(),

      // Previous Investors
      ...previousInvestorsList.map((inv) => {
        const ownership = inv.shares / preMoneyTotalSharesCalc;
        const rawPercentage = ownership * 100;
        return {
          type: "investor",
          name: inv.name,
          investor_details: inv.investor_details,
          shares: inv.shares,
          new_shares: 0,
          existing_shares: inv.shares,
          total: inv.shares,
          percentage_raw: rawPercentage,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
          investment: inv.investment,
          share_price: inv.share_price,
          is_previous: true,
          is_new_investment: false,
          is_converted: false,
          share_class_type: inv.share_class_type,
          instrument_type: inv.instrument_type,
          round_name: inv.round_name,
          round_id: inv.round_id,
        };
      }),

      // Previous Warrants
      ...previousWarrantsList.map((w) =>
        buildWarrantItem(
          w,
          preMoneyTotalSharesCalc,
          preMoneyVal,
          currentRound?.currency || "USD",
        ),
      ),

      // Converted Investors (pre-money mein converted shares dikhao)
      ...(totalConvertedShares > 0
        ? (() => {
            const ownership = totalConvertedShares / preMoneyTotalSharesCalc;
            const rawPercentage = ownership * 100;
            return [
              {
                type: "investor",
                name: "Converted Note Investors",
                shares: totalConvertedShares,
                new_shares: 0,
                existing_shares: totalConvertedShares,
                total: totalConvertedShares,
                is_converted: true,
                is_previous: false,
                percentage_raw: rawPercentage,
                percentage: rawPercentage.toFixed(2) + "%",
                value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
                shareClassType: "Convertible",
                instrumentType: "Convertible Note",
                roundName: "Conversion Round",
              },
            ];
          })()
        : []),
      ...previousPendingSafes,
    ],
  };

  // ==================== POST-MONEY CAP TABLE ====================
  const postMoneyCapTable = {
    total_shares: totalPostShares,
    pending_instruments: previousPendingSafes,
    founders: {
      list: founderList.map((f) => {
        const ownership = f.shares / totalPostShares;
        const rawPercentage = ownership * 100;
        return {
          ...f,
          roundName: currentRound.nameOfRound,
          share_class_type: round0Shareclassstype,
          shares: f.shares,
          new_shares: 0,
          total: f.shares,
          percentage_raw: rawPercentage,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
          shareClassType: f.shareClassType || "Common Shares",
          instrumentType: f.instrumentType || "Common Stock",
          round_id: round0?.id || null,
        };
      }),
      total_shares: round0Shares,
      total_percentage_raw: (round0Shares / totalPostShares) * 100,
      total_percentage:
        ((round0Shares / totalPostShares) * 100).toFixed(2) + "%",
      total_value: (
        ((round0Shares / totalPostShares) * 100 * postMoneyValuation) /
        100
      ).toFixed(2),
      roundName: round0Name,
      share_class_type: round0Shareclassstype,
      round_id: round0?.id || null,
      shareClassType: "Common Shares",
      instrumentType: "Common Stock",
    },

    previous_investors:
      previousInvestorsList.length > 0
        ? (() => {
            const groupOwnership =
              previousInvestorsTotalShares / totalPostShares;
            const groupRawPercentage = groupOwnership * 100;
            return {
              name: "Previous Investors",
              total_shares: previousInvestorsTotalShares,
              new_shares: 0,
              total: previousInvestorsTotalShares,
              percentage_raw: groupRawPercentage,
              percentage: groupRawPercentage.toFixed(2) + "%",
              total_value: (
                (groupRawPercentage * postMoneyValuation) /
                100
              ).toFixed(2),
              items: previousInvestorsList.map((inv) => {
                const ownership = inv.shares / totalPostShares;
                const rawPercentage = ownership * 100;
                return {
                  ...inv,
                  existing_shares: inv.shares,
                  new_shares: 0,
                  total: inv.shares,
                  percentage_raw: rawPercentage,
                  percentage: rawPercentage.toFixed(2) + "%",
                  value: ((rawPercentage * postMoneyValuation) / 100).toFixed(
                    2,
                  ),
                };
              }),
              is_grouped: false,
            };
          })()
        : null,

    converted_investors:
      totalConvertedShares > 0
        ? (() => {
            const ownership = totalConvertedShares / totalPostShares;
            const rawPercentage = ownership * 100;
            return {
              name: "Converted Note Investors",
              shares: totalConvertedShares,
              new_shares: totalConvertedShares,
              total: totalConvertedShares,
              percentage_raw: rawPercentage,
              percentage: rawPercentage.toFixed(2) + "%",
              value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
              investment: totalConvertedInvestment,
              shareClassType: "Convertible",
              instrumentType: "Convertible Note",
              roundName: "Conversion Round",
              items: conversionDetails.map((conv) => ({
                ...conv,
                shareClassType: "Convertible",
                instrumentType: conv.instrument_type || "Convertible Note",
                roundName: conv.investor_name || "Convertible Round",
                roundId: conv.original_round_id,
                round_id: conv.original_round_id,
              })),
            };
          })()
        : null,

    investors: (() => {
      const ownership = newInvestorShares / totalPostShares;
      const rawPercentage = ownership * 100;
      return {
        name: hasInvestmentRoundBefore
          ? "Series A Investors"
          : "Common Stock Investors",
        shares: newInvestorShares,
        new_shares: newInvestorShares,
        total: newInvestorShares,
        percentage_raw: rawPercentage,
        percentage: rawPercentage.toFixed(2) + "%",
        value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
        investment: roundSizeVal,
        shareClassType: currentRound.shareClassType || "Series",
        instrumentType: currentRound.instrumentType || "Common Stock",
        roundName: currentRound.nameOfRound || "Current Round",
        roundId: currentRound.id,
        round_id: currentRound.id,
        items: investorsWithShares,
      };
    })(),

    option_pool: (() => {
      const opShares =
        existingOptionPoolShares +
        (optionPoolShares || 0) +
        (newOptionShares || 0);
      const ownership = opShares / totalPostShares;
      const rawPercentage = ownership * 100;
      return {
        shares: opShares,
        existing_shares: existingOptionPoolShares + (optionPoolShares || 0),
        new_shares: newOptionShares || 0,
        total: opShares,
        percentage_raw: rawPercentage,
        percentage: rawPercentage.toFixed(2) + "%",
        value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
        shareClassType: "Option Pool",
        instrumentType: "Options",
        roundName: "Option Pool",
        is_option_pool: true,
      };
    })(),

    warrants:
      currentRoundWarrantsList.length > 0
        ? {
            name: "Warrants",
            total_shares: currentRoundWarrantsTotalShares,
            new_shares: currentRoundWarrantsTotalShares,
            total: currentRoundWarrantsTotalShares,
            percentage_raw:
              (currentRoundWarrantsTotalShares / totalPostShares) * 100,
            percentage:
              (
                (currentRoundWarrantsTotalShares / totalPostShares) *
                100
              ).toFixed(2) + "%",
            total_value: (
              ((currentRoundWarrantsTotalShares / totalPostShares) *
                100 *
                postMoneyValuation) /
              100
            ).toFixed(2),
            items: currentRoundWarrantsList.map((w) =>
              buildWarrantItem(
                w,
                totalPostShares,
                postMoneyValuation,
                currentRound?.currency || "USD",
              ),
            ),
          }
        : null,

    items: [
      // Founders
      ...founderList.map((f) => {
        const ownership = f.shares / totalPostShares;
        const rawPercentage = ownership * 100;
        return {
          type: "founder",
          name: f.name,
          shares: f.shares,
          new_shares: 0,
          total: f.shares,
          email: f.email,
          phone: f.phone,
          founder_code: f.founder_code,
          percentage_raw: rawPercentage,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
          shareClassType: f.shareClassType || "Common Shares",
          instrumentType: f.instrumentType || "Common Stock",
          roundName: "Round 0",
          roundId: round0?.id || null,
          round_id: round0?.id || null,
        };
      }),

      // Previous Investors
      ...previousInvestorsList.map((inv) => {
        const ownership = inv.shares / totalPostShares;
        const rawPercentage = ownership * 100;
        return {
          type: "investor",
          name: inv.name,
          investor_details: inv.investor_details,
          shares: inv.shares,
          new_shares: 0,
          total: inv.shares,
          percentage_raw: rawPercentage,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
          investment: inv.investment,
          share_price: inv.share_price,
          is_previous: true,
          share_class_type: inv.share_class_type,
          instrument_type: inv.instrument_type,
          round_name: inv.round_name,
          round_id: inv.round_id,
        };
      }),

      // Previous Warrants
      ...previousWarrantsList.map((w) =>
        buildWarrantItem(
          w,
          totalPostShares,
          postMoneyValuation,
          currentRound?.currency || "USD",
        ),
      ),

      // Current Round Warrants
      ...currentRoundWarrantsList.map((w) =>
        buildWarrantItem(
          w,
          totalPostShares,
          postMoneyValuation,
          currentRound?.currency || "USD",
        ),
      ),

      // Converted Investors
      ...(totalConvertedShares > 0
        ? (() => {
            const ownership = totalConvertedShares / totalPostShares;
            const rawPercentage = ownership * 100;
            return [
              {
                type: "investor",
                name: "Converted Note Investors",
                shares: totalConvertedShares,
                new_shares: totalConvertedShares,
                total: totalConvertedShares,
                is_converted: true,
                percentage_raw: rawPercentage,
                percentage: rawPercentage.toFixed(2) + "%",
                value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
                shareClassType: "Convertible",
                instrumentType: "Convertible Note",
                roundName: "Conversion Round",
              },
            ];
          })()
        : []),

      // New Investors
      ...investorsWithShares.map((inv) => {
        const ownership = inv.shares / totalPostShares;
        const rawPercentage = ownership * 100;
        return {
          type: "investor",
          name:
            inv.name || [inv.firstName, inv.lastName].filter(Boolean).join(" "),
          investor_details: {
            firstName: inv.firstName || "",
            lastName: inv.lastName || "",
            email: inv.email || "",
            phone: inv.phone || "",
          },
          shares: inv.shares,
          new_shares: inv.shares,
          total: inv.shares,
          percentage_raw: rawPercentage,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
          investment: parseFloat(inv.amount) || 0,
          share_price: updatedSharePrice,
          is_new_investment: true,
          shareClassType: inv.shareClassType,
          instrumentType: inv.instrumentType,
          roundName: inv.roundName,
          roundId: inv.roundId,
          round_id: inv.roundId,
        };
      }),

      // Option Pool
      (() => {
        const opShares =
          existingOptionPoolShares +
          (optionPoolShares || 0) +
          (newOptionShares || 0);
        const ownership = opShares / totalPostShares;
        const rawPercentage = ownership * 100;
        return {
          type: "option_pool",
          name: "Employee Option Pool",
          shares: opShares,
          existing_shares: existingOptionPoolShares + (optionPoolShares || 0),
          new_shares: newOptionShares || 0,
          total: opShares,
          is_option_pool: true,
          percentage_raw: rawPercentage,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
          shareClassType: "Option Pool",
          instrumentType: "Options",
          roundName: "Option Pool",
        };
      })(),
      ...previousPendingSafes,
    ],

    post_money_valuation: postMoneyValuation,
    share_price: (postMoneyValuation / totalPostShares).toFixed(4),
    roundName: currentRound.nameOfRound,
    roundId: currentRound.id,
    round_id: currentRound.id,
    shareClassType: currentRound.shareClassType,
    instrumentType: currentRound.instrumentType,
    currency: currentRound.currency,
  };

  // ==================== PREPARE ROUND INVESTMENTS FOR DATABASE ====================
  const roundInvestmentsString =
    typeof round_investments === "string"
      ? round_investments
      : JSON.stringify(round_investments || []);

  // ==================== DATABASE UPDATE ====================
  const dbUpdateData = {
    total_option_pool: total_option_pool.toString(),
    total_founder_shares: totalFounderShares.toString(),
    previous_investors_total: previous_investors_total.toString(),
    share_price: updatedSharePrice.toFixed(4),
    issuedshares: (newInvestorShares + (newOptionShares || 0)).toString(),
    investorPostMoney: ((newInvestorShares / totalPostShares) * 100).toFixed(2),
    pre_money: preMoneyVal.toString(),
    post_money: postMoneyValuation.toString(),
    roundsize: roundSizeVal.toString(),
    conversion_shares: totalConvertedShares.toString(),
    total_converted_shares: totalConvertedShares.toString(),
    option_pool_shares: (optionPoolShares || newOptionShares || 0).toString(),
    option_pool_percentage: (
      postMoneyPoolTarget || preMoneyPoolPercent
    ).toFixed(2),
    total_shares_before: total_shares_befores.toString(),
    total_shares_after: totalPostShares.toString(),
    founder_data: founderData ? JSON.stringify(founderData) : null,
    round_investments: roundInvestmentsString,
    pre_money_cap_table: JSON.stringify(preMoneyCapTable),
    post_money_cap_table: JSON.stringify(postMoneyCapTable),
    updated_at: new Date(),
  };

  try {
    await updateRoundRecordDataCommonPreferred(id, dbUpdateData);

    // ✅ STEP 1: Pehle conversions save karo
    // if (conversionDetails.length > 0) {
    //   await saveConversionsToTracking(conversionDetails, id, company_id);
    // }

    // ✅ STEP 2: Phir cap table save karo
    await saveCapTableData(
      "price",
      id,
      company_id,
      preMoneyCapTable,
      postMoneyCapTable,
      preMoneyTotalSharesCalc,
      totalPostShares,
      preMoneyVal,
      postMoneyValuation,
    );

    return {
      success: true,
      data: dbUpdateData,
      roundId: id,
      pre_money_cap_table: preMoneyCapTable,
      post_money_cap_table: postMoneyCapTable,
      conversions: conversionDetails,
    };
  } catch (error) {
    console.error("❌ DATABASE ERROR:", error);
    return { success: false, error: error.message };
  }
}

// ==================== HELPER: Use pre-calculated values directly ====================
// Yeh functions ab recalculate NAHI karte — directly item ki value use karte hain

async function insertFounderDirect(
  connection,
  roundId,
  companyId,
  type,
  founder,
) {
  // ✅ founder object mein already percentage aur value calculated hai
  const percentage_numeric = parseFloat(founder.percentage) || 0;
  const percentage_formatted = founder.percentage || "0.00%";
  const value = parseFloat(founder.value) || 0;

  return new Promise((resolve, reject) => {
    connection.query(
      `INSERT INTO round_founders 
      (round_id, company_id, cap_table_type, founder_code, first_name, last_name, 
       email, phone, shares, voting, share_type, share_class_type, 
       instrument_type, round_name, investment, share_price, 
       percentage_numeric, percentage_formatted, value, original_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        roundId,
        companyId,
        type,
        founder.founder_code,
        founder.original_founder_data?.firstName ||
          founder.name?.split(" ")[0] ||
          "",
        founder.original_founder_data?.lastName ||
          founder.name?.split(" ").slice(1).join(" ") ||
          "",
        founder.email || "",
        founder.phone || "",
        parseInt(founder.shares) || 0,
        founder.voting || "voting",
        founder.share_type || "common",
        founder.shareClassType || "Common Shares",
        founder.instrumentType || "Common Stock",
        founder.roundName || "Round 0",
        parseFloat(founder.investment) || 0,
        parseFloat(founder.share_price) || 0,
        percentage_numeric, // ✅ from item directly
        percentage_formatted, // ✅ from item directly
        value, // ✅ from item directly — no recalculation
        JSON.stringify(founder.original_founder_data || {}),
      ],
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
}

async function insertOptionPoolDirect(
  connection,
  roundId,
  companyId,
  type,
  optionPool,
) {
  // ✅ optionPool object mein already percentage aur value calculated hai
  const percentage_numeric = parseFloat(optionPool.percentage) || 0;
  const percentage_formatted = optionPool.percentage || "0.00%";
  const value = parseFloat(optionPool.value) || 0;

  return new Promise((resolve, reject) => {
    connection.query(
      `INSERT INTO round_option_pools 
      (round_id, company_id, cap_table_type, shares, existing_shares, new_shares, 
       total_shares, percentage_numeric, percentage_formatted, value, 
       share_class_type, instrument_type, round_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        roundId,
        companyId,
        type,
        parseInt(optionPool.shares) || 0,
        parseInt(optionPool.existing_shares) || 0, // ✅ ?? not || (0 valid hai)
        parseInt(optionPool.new_shares) || 0, // ✅ ?? not ||
        parseInt(optionPool.total || optionPool.shares) || 0,
        percentage_numeric, // ✅ from item directly
        percentage_formatted, // ✅ from item directly
        value, // ✅ from item directly — no recalculation
        optionPool.shareClassType || "Option Pool",
        optionPool.instrumentType || "Options",
        optionPool.roundName || "Option Pool",
      ],
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
}

async function insertPreviousInvestorDirect(
  connection,
  roundId,
  companyId,
  inv,
) {
  // ✅ inv object mein already percentage aur value calculated hai
  const percentage_numeric = parseFloat(inv.percentage) || 0;
  const percentage_formatted = inv.percentage || "0.00%";
  const value = parseFloat(inv.value) || 0;

  return new Promise((resolve, reject) => {
    connection.query(
      `INSERT INTO round_investors 
      (round_id, company_id, cap_table_type, investor_type, first_name, last_name,
       email, phone, shares, total_shares, investment_amount, share_price,
       percentage_numeric, percentage_formatted, value, is_previous, investor_details,
       share_class_type, instrument_type, round_name, round_id_ref)
      VALUES (?, ?, 'post', 'previous', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, ?, ?, ?, ?, ?)`,
      [
        roundId,
        companyId,
        inv.investor_details?.firstName || inv.firstName || "",
        inv.investor_details?.lastName || inv.lastName || "",
        inv.investor_details?.email || inv.email || "",
        inv.investor_details?.phone || inv.phone || "",
        parseInt(inv.shares) || 0,
        parseInt(inv.total || inv.shares) || 0,
        parseFloat(inv.investment) || 0,
        parseFloat(inv.share_price) || 0,
        percentage_numeric, // ✅ from item directly
        percentage_formatted, // ✅ from item directly
        value, // ✅ from item directly — no recalculation
        JSON.stringify(inv.investor_details || {}),
        inv.share_class_type || inv.shareClassType || "",
        inv.instrument_type || inv.instrumentType || "",
        inv.round_name || inv.roundName || "",
        inv.round_id || inv.roundId || null,
      ],
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
}
// Function to get warrant data from warrants table
async function getWarrantDataByInvestor(connection, roundId, inv) {
  return new Promise((resolve, reject) => {
    connection.query(
      `SELECT * FROM warrants 
       WHERE roundrecord_id = ? 
       AND (expiration_date IS NULL OR expiration_date > CURDATE())
       LIMIT 1`,
      [roundId],
      (err, results) => {
        if (err) {
          console.error("Error fetching warrant data:", err);
          reject(err);
        } else {
          resolve(results[0] || null);
        }
      },
    );
  });
}
// Function to calculate warrant values from warrant data
async function calculateWarrantFromData(warrantData, inv) {
  let potentialShares = 0;
  let adjustedPrice = 0;
  let finalValue = 0;
  let calculationMethod = "";

  // Get existing shares from inv (investor's current shares)
  const existingShares = parseFloat(inv.shares) || 0;
  const sharePrice = parseFloat(inv.share_price) || 0;
  const coveragePercentage =
    parseFloat(warrantData.warrant_coverage_percentage_main) || 0;

  if (warrantData.warrantType === "percentage") {
    // Percentage based warrant with discount
    const discountPercentage =
      parseFloat(warrantData.warrant_coverage_percentage) || 0;

    // Calculate coverage shares
    const coverageDecimal = coveragePercentage / 100;
    potentialShares = existingShares * coverageDecimal;

    // Apply discount to get adjusted price
    const discountDecimal = 1 - discountPercentage / 100;
    adjustedPrice = sharePrice * discountDecimal;

    // Calculate final value
    finalValue = potentialShares * adjustedPrice;
    calculationMethod = "percentage_with_discount";
  } else if (warrantData.warrantType === "fixed") {
    // Fixed price warrant (no discount)
    const fixedWarrantPrice = parseFloat(warrantData.warrant_fixed_shares) || 0;

    // Calculate coverage shares
    const coverageDecimal = coveragePercentage / 100;
    potentialShares = existingShares * coverageDecimal;

    // Fixed price (no discount applied)
    adjustedPrice = fixedWarrantPrice;

    // Calculate final value
    finalValue = potentialShares * fixedWarrantPrice;
    calculationMethod = "fixed_price";
  }

  return {
    potentialShares,
    adjustedPrice,
    finalValue,
    calculationMethod,
    existingShares,
    sharePrice,
    coveragePercentage,
    warrantType: warrantData.warrantType,
  };
}
// Function to check if investor has warrant in warrants table
async function checkInvestorWarrant(connection, roundId, inv) {
  return new Promise((resolve, reject) => {
    // Get investor_id from inv object
    const investorId = inv.investor_id || inv.id;

    let query = `
      SELECT * FROM warrants 
      WHERE roundrecord_id = ? 
    `;

    let params = [roundId];

    // If investor_id exists, filter by it
    if (investorId) {
      query += ` AND investor_id = ?`;
      params.push(investorId);
    }

    connection.query(query, params, (err, results) => {
      if (err) {
        console.error("Error checking warrant:", err);
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
}
// Function to check if warrant is expired
async function isWarrantExpired(warrant) {
  if (!warrant.expiration_date) return false; // No expiry date

  // Convert expiration_date to Date object
  let expiryDate;

  // Handle different date formats
  if (typeof warrant.expiration_date === "string") {
    // Format: '02/April/2026' or '2026-04-02'
    if (warrant.expiration_date.includes("/")) {
      const [day, month, year] = warrant.expiration_date.split("/");
      expiryDate = new Date(`${month} ${day}, ${year}`);
    } else {
      expiryDate = new Date(warrant.expiration_date);
    }
  } else {
    expiryDate = new Date(warrant.expiration_date);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isExpired = expiryDate < today;

  return isExpired;
}
// Function to calculate warrant values based on investor data
async function calculateWarrantFromInvestorData(warrant, inv) {
  let potentialShares = 0;
  let adjustedPrice = 0;
  let finalValue = 0;
  let calculationMethod = "";

  // Get investor's existing shares and share price
  const existingShares = parseFloat(inv.shares) || 0;
  const sharePrice = parseFloat(inv.share_price) || 0;
  const coveragePercentage =
    parseFloat(warrant.warrant_coverage_percentage_main) || 0;

  if (warrant.warrantType === "percentage") {
    // Percentage based warrant with discount
    const discountPercentage =
      parseFloat(warrant.warrant_coverage_percentage) || 0;

    // Calculate coverage shares
    const coverageDecimal = coveragePercentage / 100;
    potentialShares = existingShares * coverageDecimal;

    // Apply discount to get adjusted price
    const discountDecimal = 1 - discountPercentage / 100;
    adjustedPrice = sharePrice * discountDecimal;

    // Calculate final value
    finalValue = potentialShares * adjustedPrice;
    calculationMethod = "percentage_with_discount";
  } else if (warrant.warrantType === "fixed") {
    // Fixed price warrant (no discount)
    const fixedWarrantPrice = parseFloat(warrant.warrant_fixed_shares) || 0;

    // Calculate coverage shares
    const coverageDecimal = coveragePercentage / 100;
    potentialShares = existingShares * coverageDecimal;

    // Fixed price (no discount applied)
    adjustedPrice = fixedWarrantPrice;

    // Calculate final value
    finalValue = potentialShares * fixedWarrantPrice;
    calculationMethod = "fixed_price";
  }

  return {
    potentialShares,
    adjustedPrice,
    finalValue,
    calculationMethod,
    existingShares,
    sharePrice,
    coveragePercentage,
    warrantType: warrant.warrantType,
    discountPercentage: warrant.warrant_coverage_percentage || 0,
    fixedPrice: warrant.warrant_fixed_shares || 0,
  };
}
async function insertNewInvestorDirect(connection, roundId, companyId, inv) {
  // ✅ inv object mein already percentage aur value calculated hai

  const percentage_numeric = parseFloat(inv.percentage) || 0;
  const percentage_formatted = inv.percentage || "0.00%";
  const value = parseFloat(inv.value) || 0;

  return new Promise((resolve, reject) => {
    connection.query(
      `INSERT INTO round_investors 
      (round_id, company_id, cap_table_type, investor_type, first_name, last_name,
       email, phone, shares, new_shares, total_shares, investment_amount, share_price,
       percentage_numeric, percentage_formatted, value, is_new_investment, investor_details,
       share_class_type, instrument_type, round_name, round_id_ref)
      VALUES (?, ?, 'post', 'current', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, ?, ?, ?, ?, ?)`,
      [
        roundId,
        companyId,
        inv.firstName || inv.investor_details?.firstName || "",
        inv.lastName || inv.investor_details?.lastName || "",
        inv.email || inv.investor_details?.email || "",
        inv.phone || inv.investor_details?.phone || "",
        parseInt(inv.shares) || 0,
        parseInt(inv.new_shares || inv.shares) || 0,
        parseInt(inv.total || inv.shares) || 0,
        parseFloat(inv.amount || inv.investment) || 0,
        parseFloat(inv.share_price) || 0,
        percentage_numeric, // ✅ from item directly
        percentage_formatted, // ✅ from item directly
        value, // ✅ from item directly — no recalculation
        JSON.stringify(inv.investor_details || {}),
        inv.shareClassType,
        inv.instrumentType,
        inv.roundName,
        inv.round_id || inv.roundId,
      ],
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
}
async function insertWarrantExercised(connection, roundId, companyId, inv) {
  // ✅ inv object mein already percentage aur value calculated hai
  const warrantData = await checkInvestorWarrant(connection, roundId, inv);

  // If warrant exists, calculate and insert warrant entry first
  if (warrantData && warrantData.length > 0) {
    for (const warrant of warrantData) {
      // Check if warrant is expired
      const isExpired = await isWarrantExpired(warrant);

      if (!isExpired) {
        // Calculate warrant values based on warrant type
        const warrantCalculation = await calculateWarrantFromInvestorData(
          warrant,
          inv,
        );

        // Insert warrant as separate entry
        await insertWarrantEntry(
          connection,
          roundId,
          companyId,
          inv,
          warrant,
          warrantCalculation,
        );
      }
    }
  }
}
// Function to insert warrant as separate entry in round_investors
async function insertWarrantEntry(
  connection,
  roundId,
  companyId,
  inv,
  warrant,
  calculation,
) {
  return new Promise((resolve, reject) => {
    const percentage_numeric =
      parseFloat(warrant.warrant_coverage_percentage_main) || 0;
    const percentage_formatted = `${percentage_numeric}%`;
    const value = calculation.finalValue;
    const warrantInvestorName =
      `${inv.firstName || ""} ${inv.lastName || ""} (Warrant)`.trim();
    const deleteQuery = `
      DELETE FROM round_investors 
      WHERE warrant_id = ? And round_id = ?
      AND investor_type = 'warrant not exercised'
    `;

    connection.query(
      deleteQuery,
      [warrant.id, roundId],
      (deleteErr, deleteResult) => {
        if (deleteErr) {
          console.error("Error deleting existing warrant record:", deleteErr);
          return reject(deleteErr);
        }

        if (deleteResult.affectedRows > 0) {
          console.log(
            `Deleted ${deleteResult.affectedRows} existing warrant record(s) for warrant_id: ${warrant.id}`,
          );
        }

        // ✅ Step 2: Insert new warrant record
        const query = `
        INSERT INTO round_investors 
        (warrant_id, round_id, company_id, cap_table_type, investor_type, first_name, last_name,
         email, phone, shares, new_shares, total_shares, investment_amount, share_price,
         percentage_numeric, percentage_formatted, value, is_new_investment, investor_details,
         share_class_type, instrument_type, round_name, round_id_ref)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

        const values = [
          warrant.id,
          roundId,
          companyId,
          "post",
          "warrant",
          inv.firstName,
          inv.lastName || "",
          inv.email || "",
          inv.phone || "",
          Math.round(calculation.potentialShares),
          Math.round(calculation.potentialShares),
          Math.round(calculation.potentialShares),
          0,
          calculation.adjustedPrice,
          percentage_numeric,
          percentage_formatted,
          value,
          1,
          JSON.stringify({
            original_investor: {
              id: inv.investor_id || inv.id,
              name: `${inv.firstName} ${inv.lastName}`,
              email: inv.email,
              existing_shares: calculation.existingShares,
              share_price: calculation.sharePrice,
            },
            warrant_details: {
              id: warrant.id,
              type: warrant.warrantType,
              coverage_percentage: warrant.warrant_coverage_percentage_main,
              discount_percentage: warrant.warrant_coverage_percentage,
              fixed_price: warrant.warrant_fixed_shares,
              expiration_date: warrant.expiration_date,
            },
            calculation_details: calculation,
          }),
          warrant.share_class_type || "Warrant",
          "Warrant",
          warrant.round_name || inv.roundName || "",
          warrant.roundrecord_id || roundId,
        ];

        // Validate count
        if (values.length !== 23) {
          console.error(
            `Value count mismatch! Expected 23, got ${values.length}`,
          );
          return reject(
            new Error(
              `Value count mismatch: expected 23, got ${values.length}`,
            ),
          );
        }

        connection.query(query, values, (err, result) => {
          if (err) {
            console.error("Error inserting warrant entry:", err);
            reject(err);
          } else {
            resolve(result);
          }
        });
      },
    );
  });
}
// Helper function to calculate years between two dates
const calculateYearsToMaturity = (maturityDate) => {
  if (!maturityDate) return null;

  const today = new Date();
  const maturity = new Date(maturityDate);

  // Calculate difference in milliseconds
  const diffTime = maturity - today;

  // Convert to years (milliseconds in a year = 1000 * 60 * 60 * 24 * 365.25)
  const diffYears = diffTime / (1000 * 60 * 60 * 24 * 365.25);

  return diffYears;
};
async function insertConvertedInvestorDirect(
  connection,
  roundId,
  companyId,
  type, // 'pre' or 'post'
  converted,
) {
  // ✅ Agar converted object mein items array hai to first item lo
  const item =
    converted.items && converted.items.length > 0
      ? converted.items[0]
      : converted;

  const firstName =
    item.investor_details?.firstName ||
    item.firstName ||
    item.name?.split(" ")[0] ||
    "";
  const lastName =
    item.investor_details?.lastName ||
    item.lastName ||
    item.name?.split(" ").slice(1).join(" ") ||
    "";
  const email = item.investor_details?.email || item.email || "";
  const phone = item.investor_details?.phone || item.phone || "";

  const percentage_numeric =
    parseFloat(item.percentage) || parseFloat(converted.percentage) || 0;
  const percentage_formatted =
    item.percentage_formatted || converted.percentage || "0.00%";
  const value = parseFloat(item.value) || parseFloat(converted.value) || 0;
  const investment =
    parseFloat(item.investment) || parseFloat(converted.investment) || 0;
  const conversionPrice = parseFloat(item.conversion_price) || 0;
  const discountRate = parseFloat(item.discount_rate) || 0;
  const valuationCap = parseFloat(item.valuation_cap) || 0;
  const interestRate = item.interest_rate || 0;
  //const years = item.years || 0;
  const interestAccrued = item.interest_accrued || 0;
  const totalConversionAmount =
    item.total_conversion_amount ||
    item.principal_plus_interest ||
    investment ||
    0;
  const maturityDate = item.maturity_date || null;
  const potentialShares =
    parseInt(item.shares) || parseInt(converted.shares) || 0;
  const roundIdRef = item.original_round_id || item.round_id || null;
  let years = 0;
  if (item.maturity_date !== null) {
    years = calculateYearsToMaturity(item.maturity_date || null);
  } else {
    years = 0;
  }

  return new Promise((resolve, reject) => {
    connection.query(
      `INSERT INTO round_investors 
      (round_id, company_id, cap_table_type, investor_type,
       first_name, last_name, email, phone,
       shares, new_shares, total_shares,
       investment_amount, share_price,
       percentage_numeric, percentage_formatted, value,
       is_converted, is_pending,
       potential_shares, conversion_price, discount_rate, valuation_cap,
       interest_rate, years, interest_accrued, total_conversion_amount, maturity_date,
       share_class_type, instrument_type, round_name, round_id_ref, investor_details)
      VALUES (?, ?, ?, 'converted',
              ?, ?, ?, ?,
              ?, ?, ?,
              ?, ?,
              ?, ?, ?,
              1, 0,
              ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?)`,
      [
        roundId,
        companyId,
        type,
        firstName,
        lastName,
        email,
        phone,
        potentialShares, // shares
        potentialShares, // new_shares
        potentialShares, // total_shares
        investment, // investment_amount
        conversionPrice, // share_price
        percentage_numeric, // percentage_numeric
        percentage_formatted, // percentage_formatted
        value, // value
        potentialShares, // potential_shares
        conversionPrice, // conversion_price
        discountRate, // discount_rate
        valuationCap, // valuation_cap
        interestRate, // interest_rate
        years, // years
        interestAccrued, // interest_accrued
        totalConversionAmount, // total_conversion_amount
        maturityDate, // maturity_date
        converted.shareClassType || item.shareClassType || "Convertible",
        converted.instrumentType || item.instrument_type || "Safe",
        converted.roundName || item.roundName || "Conversion Round",
        roundIdRef,
        JSON.stringify(item.investor_details || {}),
      ],
      (err) => {
        if (err) {
          console.error("❌ Error inserting converted investor:", err);
          reject(err);
        } else {
          resolve();
        }
      },
    );
  });
}

// insertConversion unchanged — raw data save karta hai
async function insertConversion(connection, roundId, companyId, conv) {
  return new Promise((resolve, reject) => {
    // Extract investor details

    const investorDetails = conv.investor_details || {};
    const firstName =
      investorDetails.firstName ||
      conv.firstName ||
      conv.investor_name?.split(" ")[0] ||
      "";
    const lastName =
      investorDetails.lastName ||
      conv.lastName ||
      conv.investor_name?.split(" ").slice(1).join(" ") ||
      "";
    const email = investorDetails.email || conv.email || "";
    const phone = investorDetails.phone || conv.phone || "";

    connection.query(
      `INSERT INTO round_conversions 
      (round_id, company_id, original_round_id, 
       first_name, last_name, email, phone,
       instrument_type, investment_amount, converted_shares, 
       conversion_price, principal_plus_interest, discount_rate, 
       valuation_cap, interest_rate, investor_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        roundId, // round_id
        companyId, // company_id
        conv.original_round_id, // original_round_id
        firstName, // first_name
        lastName, // last_name
        email, // email
        phone, // phone
        conv.instrument_type || "", // instrument_type
        parseFloat(conv.investment) || 0, // investment_amount
        parseInt(conv.shares) || 0, // converted_shares
        parseFloat(conv.conversion_price) || 0, // conversion_price
        isFinite(parseFloat(conv.principal_plus_interest))
          ? parseFloat(conv.principal_plus_interest)
          : 0, // principal_plus_interest
        parseFloat(conv.discount_rate) || 0, // discount_rate
        parseFloat(conv.valuation_cap) || 0, // valuation_cap
        parseFloat(conv.interest_rate) || 0, // interest_rate
        conv.investor_name || "", // investor_name
      ],
      (err) => {
        if (err) {
          console.error("❌ Error inserting conversion:", err);
          reject(err);
        } else {
          resolve();
        }
      },
    );
  });
}

async function insertCapTableItemDirect(
  connection,
  roundId,
  companyId,
  type,
  item,
) {
  // ✅ item object mein already percentage aur value calculated hai
  const percentage_numeric = parseFloat(item.percentage) || 0;
  const percentage_formatted = item.percentage || "0.00%";
  const value = parseFloat(item.value) || 0;

  return new Promise((resolve, reject) => {
    const values = [
      roundId,
      companyId,
      type,
      item.type || "other",
      (item.name || "").substring(0, 255),
      parseInt(item.shares) || 0,
      parseInt(item.new_shares) || 0,
      parseInt(item.total || item.shares) || 0,
      percentage_numeric, // ✅ from item directly
      percentage_formatted, // ✅ from item directly
      value, // ✅ from item directly — no recalculation
      item.founder_code || null,
      item.email || null,
      item.phone || null,
      JSON.stringify(item.investor_details || {}),
      parseFloat(item.investment) || 0,
      parseFloat(item.share_price) || 0,
      item.is_previous ? 1 : 0,
      type === "post" ? (item.is_new_investment ? 1 : 0) : 0,
      item.is_converted ? 1 : 0,
      parseInt(item.existing_shares) || 0, // ✅ ?? not || (0 valid hai)
      item.is_option_pool ? 1 : 0,
      item.shareClassType || item.share_class_type || null,
      item.instrumentType || item.instrument_type || null,
      item.roundName || item.round_name || "Round 0",
      parseInt(item.round_id || item.roundId) || null,
    ];

    connection.query(
      `INSERT INTO round_cap_table_items 
      (round_id, company_id, cap_table_type, item_type, name, shares, new_shares,
       total_shares, percentage_numeric, percentage_formatted, value, 
       founder_code, email, phone, investor_details, investment_amount, 
       share_price, is_previous, is_new_investment, is_converted, 
       existing_shares, is_option_pool, share_class_type, instrument_type, 
       round_name, round_id_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values,
      (err, result) => {
        if (err) {
          console.error("❌ Error inserting item:", err);
          reject(err);
        } else resolve(result);
      },
    );
  });
}

// ==================== MAIN saveCapTableData — Direct values, NO recalculation ====================
async function saveCapTableData(
  checkround,
  roundId,
  companyId,
  preTable,
  postTable,
  preMoneyTotalShares,
  postMoneyTotalShares,
  preMoneyValuation,
  postMoneyValuation,
  convert = false,
) {
  return new Promise((resolve, reject) => {
    db.getConnection((err, connection) => {
      if (err) {
        console.error("Error getting connection:", err);
        return reject(err);
      }

      connection.beginTransaction(async (err) => {
        if (err) {
          connection.release();
          return reject(err);
        }

        try {
          // ==================== DELETE EXISTING DATA ====================
          const tables = [
            "round_founders",
            "round_investors",
            "round_option_pools",
            "round_conversions",
            "round_cap_table_items",
          ];
          for (const table of tables) {
            await new Promise((res, rej) => {
              connection.query(
                `DELETE FROM ${table} WHERE round_id = ?`,
                [roundId],
                (err) => {
                  if (err) rej(err);
                  else res();
                },
              );
            });
          }

          // ==================== SAVE PRE-MONEY DATA ====================
          if (preTable) {
            // 1. Founders — PRE only
            if (preTable.founders?.list) {
              for (const founder of preTable.founders.list) {
                await insertFounderDirect(
                  connection,
                  roundId,
                  companyId,
                  "pre",
                  founder,
                );
              }
            }

            // 2. Option Pool — PRE
            if (preTable.option_pool) {
              await insertOptionPoolDirect(
                connection,
                roundId,
                companyId,
                "pre",
                preTable.option_pool,
              );
            }

            // 3. Previous Investors — PRE
            if (preTable.previous_investors?.items) {
              for (const inv of preTable.previous_investors.items) {
                const percentage_numeric = parseFloat(inv.percentage) || 0;
                const percentage_formatted = inv.percentage || "0.00%";
                const value = parseFloat(inv.value) || 0;

                await new Promise((res, rej) => {
                  connection.query(
                    `INSERT INTO round_investors 
                    (round_id, company_id, cap_table_type, investor_type, first_name, last_name,
                     email, phone, shares, new_shares, total_shares, investment_amount, share_price,
                     percentage_numeric, percentage_formatted, value, is_previous, investor_details,
                     share_class_type, instrument_type, round_name, round_id_ref)
                    VALUES (?, ?, 'pre', 'previous', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, ?, ?, ?, ?, ?)`,
                    [
                      roundId,
                      companyId,
                      inv.investor_details?.firstName ||
                        inv.name?.split(" ")[0] ||
                        "",
                      inv.investor_details?.lastName ||
                        inv.name?.split(" ").slice(1).join(" ") ||
                        "",
                      inv.investor_details?.email || inv.email || "",
                      inv.investor_details?.phone || inv.phone || "",
                      parseInt(inv.shares) || 0,
                      0,
                      parseInt(inv.shares) || 0,
                      parseFloat(inv.investment) || 0,
                      parseFloat(inv.share_price) || 0,
                      percentage_numeric,
                      percentage_formatted,
                      value,
                      JSON.stringify(inv.investor_details || {}),
                      inv.share_class_type || inv.shareClassType || "",
                      inv.instrument_type || inv.instrumentType || "",
                      inv.round_name || inv.roundName || "",
                      inv.round_id || inv.roundId || null,
                    ],
                    (err) => {
                      if (err) rej(err);
                      else res();
                    },
                  );
                });
              }
            }

            // 4. Converted Investors — PRE
            if (convert === false) {
              if (preTable.converted) {
                await insertConvertedInvestorDirect(
                  connection,
                  roundId,
                  companyId,
                  "pre",
                  preTable.converted,
                );
              }
            }

            // 5. Pending instruments from preTable.items — PRE only
            if (preTable.items) {
              for (const item of preTable.items) {
                if (item.type === "pending" || item.is_pending) {
                  await new Promise((res, rej) => {
                    connection.query(
                      `INSERT INTO round_investors 
                      (round_id, company_id, cap_table_type, investor_type,
                       first_name, last_name, email, phone,
                       shares, new_shares, total_shares,
                       investment_amount, share_price,
                       percentage_numeric, percentage_formatted, value,
                       is_pending, potential_shares,
                       conversion_price, discount_rate, valuation_cap,
                       interest_rate, years, interest_accrued, total_conversion_amount, maturity_date,
                       investor_details, instrument_type, round_name, share_class_type)
                      VALUES (?, ?, 'pre', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                      [
                        roundId,
                        companyId,
                        item.investor_details?.firstName ||
                          item.name?.split(" ")[0] ||
                          "",
                        item.investor_details?.lastName ||
                          item.name?.split(" ").slice(1).join(" ") ||
                          "",
                        item.investor_details?.email || item.email || "",
                        item.investor_details?.phone || item.phone || "",
                        0,
                        0,
                        0,
                        parseFloat(item.investment || item.investment_amount) ||
                          0,
                        parseFloat(item.conversion_price) || 0,
                        0,
                        "0.00%",
                        0,
                        parseInt(item.potential_shares) || 0,
                        parseFloat(item.conversion_price) || 0,
                        parseFloat(item.discount_rate) || 0,
                        parseFloat(item.valuation_cap) || 0,
                        parseFloat(item.interest_rate) || 0,
                        parseFloat(item.years) || 0,
                        parseFloat(item.interest_accrued) || 0,
                        parseFloat(item.total_conversion_amount) || 0,
                        item.maturity_date || null,
                        JSON.stringify(item.investor_details || {}),
                        item.instrument_type || "Safe",
                        item.round_name || item.roundName || "",
                        item.shareClassType || "",
                      ],
                      (err) => {
                        if (err) rej(err);
                        else res();
                      },
                    );
                  });
                }
              }
            }

            // 6. ✅ SAVE WARRANTS FOR PRE-MONEY
            // Look for warrant items in preTable.items
            if (preTable.items) {
              for (const item of preTable.items) {
                if (item.is_warrant === true) {
                  const percentage_numeric = parseFloat(item.percentage) || 0;
                  const percentage_formatted = item.percentage || "0.00%";
                  const value = parseFloat(item.value) || 0;

                  await new Promise((res, rej) => {
                    connection.query(
                      `INSERT INTO round_investors 
                      (round_id, company_id, cap_table_type, investor_type, first_name, last_name,
                       email, phone, shares, new_shares, total_shares, investment_amount, share_price,
                       percentage_numeric, percentage_formatted, value, is_previous, 
                       is_new_investment, investor_details, share_class_type, instrument_type, 
                       round_name, round_id_ref, warrant_id)
                      VALUES (?, ?, 'pre', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0,  1, ?, ?, ?, ?, ?, ?)`,
                      [
                        roundId,
                        companyId,
                        item.investor_type || "warrant",
                        item.investor_details?.firstName ||
                          item.name?.split(" ")[0] ||
                          "",
                        item.investor_details?.lastName ||
                          item.name?.split(" ").slice(1).join(" ") ||
                          "",
                        item.investor_details?.email || item.email || "",
                        item.investor_details?.phone || item.phone || "",
                        parseInt(item.shares) || 0,
                        parseInt(item.new_shares) || 0,
                        parseInt(item.shares) || 0,
                        parseFloat(item.investment) || 0,
                        parseFloat(item.share_price) || 0,
                        percentage_numeric,
                        percentage_formatted,
                        value,
                        JSON.stringify(item.investor_details || {}),
                        item.share_class_type || item.shareClassType || "",
                        item.instrument_type || item.instrumentType || "",
                        item.round_name || item.roundName || "",
                        item.round_id || item.roundId || null,
                        item.warrant_id || null,
                      ],
                      (err) => {
                        if (err) rej(err);
                        else res();
                      },
                    );
                  });
                }
              }
            }
          }

          // ==================== SAVE POST-MONEY DATA ====================
          if (postTable) {
            // 1. Founders — POST only
            if (postTable.founders?.list) {
              for (const founder of postTable.founders.list) {
                await insertFounderDirect(
                  connection,
                  roundId,
                  companyId,
                  "post",
                  founder,
                );
              }
            }

            // 2. Option Pool — POST
            if (postTable.option_pool) {
              await insertOptionPoolDirect(
                connection,
                roundId,
                companyId,
                "post",
                postTable.option_pool,
              );
            }

            // 3. Previous Investors — POST
            if (postTable.previous_investors?.items) {
              for (const inv of postTable.previous_investors.items) {
                await insertPreviousInvestorDirect(
                  connection,
                  roundId,
                  companyId,
                  inv,
                );
              }
            }

            // 4. New Investors — POST
            if (postTable.investors?.items) {
              for (const inv of postTable.investors.items) {
                await insertNewInvestorDirect(
                  connection,
                  roundId,
                  companyId,
                  inv,
                );
              }
            }

            // 5. Converted Investors — POST
            if (convert === true) {
              if (postTable.converted_investors?.items) {
                for (const conv of postTable.converted_investors.items) {
                  await insertConversion(connection, roundId, companyId, conv);
                }
              }

              if (postTable.converted_investors) {
                for (const conv of postTable.converted_investors.items) {
                  await insertConvertedInvestorDirect(
                    connection,
                    roundId,
                    companyId,
                    "post",
                    conv,
                  );
                }
              }
            }

            // 6. Pending instruments from postTable.items — POST only
            if (convert === false) {
              if (postTable.items) {
                for (const item of postTable.items) {
                  if (item.type === "pending" || item.is_pending) {
                    await new Promise((res, rej) => {
                      connection.query(
                        `INSERT INTO round_investors 
                      (round_id, company_id, cap_table_type, investor_type,
                       first_name, last_name, email, phone,
                       shares, new_shares, total_shares,
                       investment_amount, share_price,
                       percentage_numeric, percentage_formatted, value,
                       is_pending, potential_shares,
                       conversion_price, discount_rate, valuation_cap,
                       interest_rate, years, interest_accrued, total_conversion_amount, maturity_date,
                       investor_details, instrument_type, round_name, share_class_type)
                      VALUES (?, ?, 'post', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                          roundId,
                          companyId,
                          item.investor_details?.firstName ||
                            item.name?.split(" ")[0] ||
                            "",
                          item.investor_details?.lastName ||
                            item.name?.split(" ").slice(1).join(" ") ||
                            "",
                          item.investor_details?.email || item.email || "",
                          item.investor_details?.phone || item.phone || "",
                          0,
                          0,
                          0,
                          parseFloat(
                            item.investment || item.investment_amount,
                          ) || 0,
                          parseFloat(item.conversion_price) || 0,
                          0,
                          "0.00%",
                          0,
                          parseInt(item.potential_shares) || 0,
                          parseFloat(item.conversion_price) || 0,
                          parseFloat(item.discount_rate) || 0,
                          parseFloat(item.valuation_cap) || 0,
                          parseFloat(item.interest_rate) || 0,
                          parseFloat(item.years) || 0,
                          parseFloat(item.interest_accrued) || 0,
                          parseFloat(item.total_conversion_amount) || 0,
                          item.maturity_date || null,
                          JSON.stringify(item.investor_details || {}),
                          item.instrument_type || "Safe",
                          item.round_name || item.roundName || "",
                          item.shareClassType || "",
                        ],
                        (err) => {
                          if (err) rej(err);
                          else res();
                        },
                      );
                    });
                  }
                }
              }
            }

            // 7. ✅ SAVE WARRANTS FOR POST-MONEY
            // Look for warrant items in postTable.items
            if (postTable.items) {
              for (const item of postTable.items) {
                if (item.is_warrant === true) {
                  const percentage_numeric = parseFloat(item.percentage) || 0;
                  const percentage_formatted = item.percentage || "0.00%";
                  const value = parseFloat(item.value) || 0;

                  await new Promise((res, rej) => {
                    connection.query(
                      `INSERT INTO round_investors 
                      (round_id, company_id, cap_table_type, investor_type, first_name, last_name,
                       email, phone, shares, new_shares, total_shares, investment_amount, share_price,
                       percentage_numeric, percentage_formatted, value, is_previous, 
                       is_new_investment, investor_details, share_class_type, instrument_type, 
                       round_name, round_id_ref, warrant_id)
                      VALUES (?, ?, 'post', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0,  1, ?, ?, ?, ?, ?, ?)`,
                      [
                        roundId,
                        companyId,
                        item.investor_type || "warrant",
                        item.investor_details?.firstName ||
                          item.name?.split(" ")[0] ||
                          "",
                        item.investor_details?.lastName ||
                          item.name?.split(" ").slice(1).join(" ") ||
                          "",
                        item.investor_details?.email || item.email || "",
                        item.investor_details?.phone || item.phone || "",
                        parseInt(item.shares) || 0,
                        parseInt(item.new_shares) || 0,
                        parseInt(item.shares) || 0,
                        parseFloat(item.investment) || 0,
                        parseFloat(item.share_price) || 0,
                        percentage_numeric,
                        percentage_formatted,
                        value,
                        JSON.stringify(item.investor_details || {}),
                        item.share_class_type || item.shareClassType || "",
                        item.instrument_type || item.instrumentType || "",
                        item.round_name || item.roundName || "",
                        item.round_id || item.roundId || null,
                        item.warrant_id || null,
                      ],
                      (err) => {
                        if (err) rej(err);
                        else res();
                      },
                    );
                  });
                }
              }
            }
          }

          // ==================== SAVE FLATTENED ITEMS ====================

          // Pre-money items
          if (preTable?.items) {
            for (const item of preTable.items) {
              await insertCapTableItemDirect(
                connection,
                roundId,
                companyId,
                "pre",
                item,
              );
            }
          }

          // Post-money items
          if (postTable?.items) {
            for (const item of postTable.items) {
              await insertCapTableItemDirect(
                connection,
                roundId,
                companyId,
                "post",
                item,
              );
            }
          }
          if (postTable.investors?.items && checkround === "price") {
            for (const inv of postTable.investors.items) {
              await insertWarrantExercised(connection, roundId, companyId, inv);
            }
          }
          // Commit
          connection.commit((err) => {
            if (err) {
              return connection.rollback(() => {
                connection.release();
                reject(err);
              });
            }
            connection.release();
            resolve({
              success: true,
              message: "Cap table data saved successfully",
            });
          });
        } catch (error) {
          connection.rollback(() => {
            connection.release();
            reject(error);
          });
        }
      });
    });
  });
}
async function updateRoundRecordDataCommonPreferred(roundId, updateData) {
  return new Promise((resolve, reject) => {
    const query = `
      UPDATE roundrecord 
      SET 
      total_option_pool=?,
        previous_investors_total=?,
        total_founder_shares=?,
        share_price = ?,
        issuedshares = ?,
        investorPostMoney = ?,
        pre_money = ?,
        post_money = ?,
        roundsize = ?,
        conversion_shares = ?,
        total_converted_shares = ?,
        option_pool_shares = ?,
        option_pool_percentage = ?,
        total_shares_before = ?,
        total_shares_after = ?,
        pre_money_cap_table = ?,
        post_money_cap_table = ?,
        founder_data = ?,
        updated_at = ?
      WHERE id = ?
    `;

    const values = [
      updateData.total_option_pool, // share_price
      updateData.previous_investors_total, // share_price
      updateData.total_founder_shares, // share_price
      updateData.share_price, // share_price
      updateData.issuedshares, // issuedshares
      updateData.investorPostMoney, // investorPostMoney
      updateData.pre_money, // pre_money
      updateData.post_money, // post_money
      updateData.roundsize, // roundsize
      updateData.conversion_shares, // conversion_shares
      updateData.total_converted_shares, // total_converted_shares
      updateData.option_pool_shares, // option_pool_shares
      updateData.option_pool_percentage, // option_pool_percentage
      updateData.total_shares_before, // total_shares_before
      updateData.total_shares_after, // total_shares_after
      updateData.pre_money_cap_table, // pre_money_cap_table
      updateData.post_money_cap_table, // post_money_cap_table
      updateData.founder_data, // founder_data
      updateData.updated_at, // updated_at
      roundId, // WHERE id = ?
    ];

    db.query(query, values, (err, result) => {
      if (err) {
        console.error("❌ Database Error:", err);
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}
async function handlePreferredEquityCalculation(params, updateFlag = false) {
  const {
    round_investments,
    id,
    company_id,
    preMoney,
    roundSize,
    optionPoolPercentValue,
    total_shares_before,
    round0_shares,
    isUpdate: isUpdateFromParams = false,
    optionPoolPercent_post,
    currentRound,
  } = params;
  const isUpdate = updateFlag || isUpdateFromParams;

  const preMoneyVal = parseFloat(preMoney) || 0;
  const roundSizeVal = parseFloat(roundSize) || 0;
  const preMoneyPoolPercent = parseFloat(optionPoolPercentValue) || 0;
  const postMoneyPoolTarget = parseFloat(optionPoolPercent_post) || 0;
  let round0Shares = parseInt(round0_shares) || 0;

  if (preMoneyVal <= 0 || roundSizeVal <= 0 || round0Shares <= 0) {
    return { success: false, error: "Invalid inputs for calculation" };
  }

  let founderList = [];
  let founderData = null;
  let totalFounderShares = 0;
  let round0 = null;
  let round0Name = "Round 0";
  let round0Shareclassstype = "";
  try {
    const round0Data = await getFounderDataFromRound0(company_id);
    if (round0Data && round0Data.founder_data) {
      founderData = round0Data.founder_data;
      totalFounderShares = round0Data.total_founder_shares || 0;
      round0Name = round0Data.round0Name;
      round0Shareclassstype = round0Data.shareClassType;
      round0 = round0Data;
      if (founderData.founders && Array.isArray(founderData.founders)) {
        founderList = founderData.founders.map((founder, index) => ({
          name:
            `${founder.firstName || ""} ${founder.lastName || ""}`.trim() ||
            `Founder ${index + 1}`,
          shares: parseFloat(founder.shares) || 0,
          email: founder.email || "",
          phone: founder.phone || "",
          voting: founder.voting || "voting",
          share_type: founder.shareType || "Preferred",
          founder_code: `F${index + 1}`,
          shareClassType:
            founder.shareClassType ||
            round0Data.shareClassType ||
            "Preferred Equity",
          instrumentType:
            founder.instrumentType ||
            round0Data.instrumentType ||
            "Preferred Equity",
          roundName: round0Data.nameOfRound || "Round 0",
          roundId: round0Data.id || null,
          round_id: round0Data.id || null,
          investment: founder.investment || 0,
          share_price: founder.share_price || 0,
          original_founder_data: founder,
        }));
      }
    }
  } catch (error) {
    console.error("❌ Error fetching founder data:", error);
  }

  // ========== CONDITION: Check if previousRounds is empty ==========
  const previousRounds = await getPreviousRoundsForCompany(company_id, id);
  const sortedPreviousRounds = [...previousRounds].sort((a, b) => b.id - a.id);
  const latestPreviousRound = sortedPreviousRounds[0];

  // ✅ CONDITION: If previousRounds is empty, set all related variables to empty/default
  const hasInvestmentRoundBefore =
    previousRounds.length > 0
      ? previousRounds.some(
          (round) =>
            round.instrumentType === "Preferred Equity" ||
            round.instrumentType === "Common Stock" ||
            round.instrumentType === "Safe" ||
            round.instrumentType === "Convertible Note",
        )
      : false;

  const isPreviousRoundRound0 =
    previousRounds.length > 0 && latestPreviousRound?.round_type === "Round 0";

  // If previousRounds is empty, override round0Name
  if (previousRounds.length === 0) {
    round0Name = "Round 0";
  } else {
    round0Name = latestPreviousRound?.nameOfRound || round0Name;
  }

  let existingOptionPoolShares = 0;
  let totalPreMoneyShares = round0Shares;
  let previousInvestorsList = [];
  let previousInvestorsTotalShares = 0;
  let previousWarrantsList = [];
  let previousWarrantsTotalShares = 0;
  let currentRoundWarrantsList = [];
  let currentRoundWarrantsTotalShares = 0;
  // ✅ CONDITION: Only fetch previous investors if there are previous rounds
  if (previousRounds.length > 0 && latestPreviousRound) {
    const round = latestPreviousRound;
    existingOptionPoolShares =
      parseInt(round.total_option_pool) ||
      parseInt(round.option_pool_shares) ||
      0;
    totalPreMoneyShares = parseInt(round.total_shares_after) || round0Shares;

    const roundInvestors = await new Promise((resolve, reject) => {
      db.query(
        `SELECT * FROM round_investors 
       WHERE round_id = ? AND company_id = ? AND cap_table_type = 'post' 
       AND (investor_type = 'current' OR investor_type = 'converted' or investor_type = 'previous'  or investor_type = 'warrant' or investor_type = 'warrant not exercised')
       ORDER BY id ASC`,
        [round.id, company_id],
        (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        },
      );
    });

    roundInvestors.forEach((inv) => {
      if (
        inv.investor_type === "warrant" ||
        inv.investor_type === "warrant not exercised"
      ) {
        previousWarrantsList.push({
          type: "warrant",
          name: `${inv.first_name || ""} ${inv.last_name || ""}`.trim(),
          investor_details: {
            firstName: inv.first_name || "",
            lastName: inv.last_name || "",
            email: inv.email || "",
            phone: inv.phone || "",
          },
          shares: inv.shares,
          investor_type: inv.investor_type,
          investment: parseFloat(inv.investment_amount || 0),
          share_price: parseFloat(inv.share_price || 0),
          share_class_type: inv.share_class_type,
          instrument_type: inv.instrument_type,
          round_name: inv.round_name,
          round_id: round.id,
          warrant_id: inv.warrant_id,
          is_previous: true,
        });
      } else {
        previousInvestorsList.push({
          type: "investor",
          name: `${inv.first_name || ""} ${inv.last_name || ""}`.trim(),
          investor_details: {
            firstName: inv.first_name || "",
            lastName: inv.last_name || "",
            email: inv.email || "",
            phone: inv.phone || "",
          },
          shares: inv.shares,
          investment: parseFloat(inv.investment_amount || 0),
          share_price: parseFloat(inv.share_price || 0),
          share_class_type: inv.share_class_type,
          instrument_type: inv.instrument_type,
          round_name: inv.round_name,
          round_id: round.id,
          is_previous: true,
        });
      }
    });

    previousInvestorsTotalShares = previousInvestorsList.reduce(
      (sum, inv) => sum + (inv.shares || 0),
      0,
    );
    previousWarrantsTotalShares = previousWarrantsList.reduce(
      (sum, warrant) => sum + (warrant.shares || 0),
      0,
    );
  }
  // ========== GET CURRENT ROUND WARRANTS ==========
  try {
    const currentRoundWarrants = await new Promise((resolve, reject) => {
      db.query(
        `SELECT w.* 
         FROM warrants w
         WHERE w.roundrecord_id = ? AND w.company_id = ?`,
        [id, company_id],
        (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        },
      );
    });

    // Parse investors list for names
    let roundInvestorsList = [];
    try {
      if (round_investments) {
        roundInvestorsList =
          typeof round_investments === "string"
            ? JSON.parse(round_investments)
            : round_investments;
      }
    } catch (e) {
      console.error("Error parsing round_investments:", e);
    }

    currentRoundWarrants.forEach((warrant, index) => {
      let investorName = "Warrant Holder";
      let investorEmail = "";
      let investorPhone = "";
      let investorFirstName = "";
      let investorLastName = "";

      if (roundInvestorsList && roundInvestorsList.length > 0) {
        const investor = roundInvestorsList[0];
        investorFirstName = "";
        investorLastName = "";
        investorName = "Warrant Holder";
        investorEmail = "";
        investorPhone = "";
      }

      currentRoundWarrantsList.push({
        type: "warrant",
        name: investorName,
        investor_details: {
          firstName: investorFirstName,
          lastName: investorLastName,
          email: investorEmail,
          phone: investorPhone,
        },
        shares: warrant.shares || 0,
        investor_type: "warrant not exercised",
        investment: 0,
        share_price: 0,
        share_class_type: null,
        instrument_type: null,
        round_name: currentRound?.nameOfRound || "",
        round_id: id,
        warrant_id: warrant.id,
        is_previous: false,
      });
    });

    currentRoundWarrantsTotalShares = currentRoundWarrantsList.reduce(
      (sum, warrant) => sum + (warrant.shares || 0),
      0,
    );
  } catch (error) {
    console.error("❌ Error fetching current round warrants:", error);
  }
  const alreadyConvertedRounds = await getAlreadyConvertedRounds(
    company_id,
    id,
  );
  const alreadyConvertedIds = alreadyConvertedRounds.map((r) =>
    parseInt(r.original_round_id),
  );

  const sharePrice = preMoneyVal / totalPreMoneyShares;

  let totalConvertedShares = 0;
  let totalConvertedInvestment = 0;
  let conversionDetails = [];

  const sortedRounds = [...previousRounds].sort((a, b) => b.id - a.id);
  const latestRound = sortedRounds[0];

  // ✅ CONDITION: Only fetch preconversion if there are previous rounds
  let preconversion = [];
  if (previousRounds.length > 0 && latestRound) {
    preconversion = await getPreviousRoundsForCompanyForConversion(
      company_id,
      latestRound?.id,
    );
  }
  for (const investor of preconversion) {
    if (alreadyConvertedIds.includes(parseInt(investor.round_id))) continue;

    const instrumentData = parseInstrumentData(investor.instrument_type_data);
    const isSafe = investor.instrument_type === "Safe";
    const isNote = investor.instrument_type === "Convertible Note";

    const discountRate =
      parseFloat(
        isNote
          ? investor.discount_rate || 0
          : investor.discount_rate || investor.discountRate || 0,
      ) || 0;

    const valuationCap =
      parseFloat(
        isNote
          ? investor.valuation_cap || 0
          : investor.valuation_cap || investor.valuation_cap || 0,
      ) || 0;

    const interestRate = isNote ? parseFloat(investor.interest_rate) || 0 : 0;

    const discountedPrice = sharePrice * (1 - discountRate / 100);
    const capPrice =
      valuationCap > 0 ? valuationCap / totalPreMoneyShares : Infinity;
    const conversionPrice = Math.min(discountedPrice, capPrice);

    if (conversionPrice <= 0) continue;

    const principal = parseFloat(investor.investment_amount) || 0;
    if (principal <= 0) continue;

    const years = isNote
      ? parseInt(investor.years) ||
        parseFloat(investor.total_conversion_amount || investor.years) ||
        2
      : 0;

    const interestAccrued = isNote
      ? principal * (Math.pow(1 + interestRate / 100, years) - 1)
      : 0;
    const principalPlusInterest = principal + interestAccrued;
    const convertedShares = Math.round(principalPlusInterest / conversionPrice);

    if (convertedShares <= 0) continue;

    totalConvertedShares += convertedShares;
    totalConvertedInvestment += principal;

    const inv =
      typeof investor.investor_details === "string"
        ? JSON.parse(investor.investor_details || "{}")
        : investor.investor_details || {};

    conversionDetails.push({
      pending_instrument_id: investor.id,
      original_round_id: investor.round_id,
      round_name: investor.nameOfRound || "",
      instrument_type: investor.instrument_type,
      investment: principal,
      conversion_price: conversionPrice,
      convertedShares,
      investor_name:
        `${investor.first_name || ""} ${investor.last_name || ""}`.trim() ||
        inv.firstName ||
        `${investor.instrument_type} Investor`,
      investor_email: investor.email || inv.email || "",
      investor_phone: investor.phone || inv.phone || "",
      investor_details: {
        firstName: investor.first_name || inv.firstName || "",
        lastName: investor.last_name || inv.lastName || "",
        email: investor.email || inv.email || "",
        phone: investor.phone || inv.phone || "",
      },
      principal_plus_interest: principalPlusInterest,
      interest_accrued: interestAccrued,
      interest_rate: interestRate,
      shareClassType: investor.share_class_type,
      years,
      maturity_date: investor.maturity_date,
      discount_rate: discountRate,
      valuation_cap: valuationCap,
      moic: "0X",
    });
  }
  // ========== FETCH PREVIOUS PENDING SAFEs / NOTES ==========
  let previousPendingSafes = [];

  // ✅ CONDITION: Only fetch pending safes if there are previous rounds and latestRound exists
  if (
    previousRounds.length > 0 &&
    latestRound &&
    (latestRound.instrumentType === "Safe" ||
      latestRound.instrumentType === "Convertible Note")
  ) {
    try {
      let postCapTable = latestRound.post_money_cap_table;
      if (typeof postCapTable === "string") {
        postCapTable = JSON.parse(postCapTable);
      }

      const capTableItems = postCapTable?.items || [];

      const pendingItems = capTableItems.filter(
        (item) => item.type === "pending" && item.is_pending === true,
      );

      pendingItems.forEach((item) => {
        previousPendingSafes.push({
          type: "pending",
          id: item.id || item.pending_instrument_id || null,
          pending_instrument_id: item.pending_instrument_id || item.id || null,
          name: item.name || "",
          first_name: item.first_name || item.investor_details?.firstName || "",
          last_name: item.last_name || item.investor_details?.lastName || "",
          email: item.email || item.investor_details?.email || "",
          phone: item.phone || item.investor_details?.phone || "",
          investor_details: item.investor_details || {
            firstName: item.first_name || "",
            lastName: item.last_name || "",
            email: item.email || "",
            phone: item.phone || "",
          },
          shares: 0,
          new_shares: 0,
          existing_shares: 0,
          total: 0,
          investment:
            parseFloat(item.investment || item.investment_amount) || 0,
          investment_amount:
            parseFloat(item.investment || item.investment_amount) || 0,
          principal: parseFloat(item.investment || item.investment_amount) || 0,
          potential_shares: parseInt(item.potential_shares) || 0,
          conversion_price: parseFloat(item.conversion_price) || 0,
          discount_rate: parseFloat(item.discount_rate) || 0,
          valuation_cap: parseFloat(item.valuation_cap) || 0,
          interest_rate: parseFloat(item.interest_rate) || 0,
          years: parseInt(item.years) || 0,
          interest_accrued: parseFloat(item.interest_accrued) || 0,
          total_conversion_amount:
            parseFloat(item.total_conversion_amount) ||
            parseFloat(item.investment || item.investment_amount) ||
            0,
          maturity_date: item.maturity_date || null,
          instrument_type: item.instrument_type || item.instrumentType || "",
          instrumentType: item.instrumentType || item.instrument_type || "",
          share_class_type: item.share_class_type || item.shareClassType || "",
          shareClassType: item.shareClassType || item.share_class_type || "",
          round_id: item.round_id || item.roundId || null,
          round_name: item.round_name || item.roundName || "",
          roundId: item.roundId || item.round_id || null,
          percentage: 0,
          percentage_numeric: 0,
          percentage_raw: 0,
          percentage_formatted: "0.00%",
          value: 0,
          value_formatted: "0.00",
          is_pending: true,
          is_converted: false,
          is_previous: false,
          is_new_investment: false,
        });
      });
    } catch (error) {
      console.error(
        "❌ Error parsing post_money_cap_table pending items:",
        error,
      );
      previousPendingSafes = [];
    }
  }

  let investorsList = [];
  try {
    if (round_investments) {
      investorsList =
        typeof round_investments === "string"
          ? JSON.parse(round_investments)
          : round_investments;
    }
  } catch (e) {
    console.error("Error parsing round_investments:", e);
  }

  let total_option_pool = 0;
  let previous_investors_total = 0;
  let optionPoolShares = 0;
  let preMoneyTotalSharesCalc = 0;
  let totalPostShares = 0;
  let newInvestorShares = 0;
  let updatedSharePrice = 0;
  let newOptionShares = 0;
  let seriesAInvestorShares = 0;
  let total_shares_befores = 0;
  let postMoneyValuation = preMoneyVal + roundSizeVal;

  // ==================== SERIES A CALCULATION WITH CONDITION ====================
  // ✅ CONDITION: Check if there are previous rounds
  if (hasInvestmentRoundBefore && previousRounds.length > 0) {
    // Step 1: Pre-money total shares (founders + previous investors + existing option)
    preMoneyTotalSharesCalc = totalPreMoneyShares;

    // Step 2: Series A share price
    const seriesASharePrice = preMoneyVal / preMoneyTotalSharesCalc;

    // Step 3: Calculate conversion for SAFE/Notes
    let convertedSharesTotal = 0;
    let convertedInvestmentTotal = 0;
    const convertedInvestors = [];

    for (const conv of conversionDetails) {
      const discountedPrice =
        seriesASharePrice * (1 - conv.discount_rate / 100);
      const capPrice =
        conv.valuation_cap > 0
          ? conv.valuation_cap / preMoneyTotalSharesCalc
          : Infinity;
      const conversionPrice = Math.min(discountedPrice, capPrice);

      const principalPlusInterest =
        conv.principal_plus_interest || conv.investment;
      const convertedShares = Math.round(
        principalPlusInterest / conversionPrice,
      );

      const valueAtSeriesA = convertedShares * seriesASharePrice;
      const moic = (valueAtSeriesA / conv.investment).toFixed(2) + "X";

      convertedSharesTotal += convertedShares;
      convertedInvestmentTotal += conv.investment;

      convertedInvestors.push({
        ...conv,
        convertedShares,
        conversion_price: conversionPrice,
        value_at_series_a: valueAtSeriesA,
        moic,
      });
    }

    const newInvestorSharesBeforeOption = Math.round(
      roundSizeVal / seriesASharePrice,
    );

    const totalSharesBeforeOption =
      round0Shares +
      previousInvestorsTotalShares +
      convertedSharesTotal +
      newInvestorSharesBeforeOption;

    const targetOptionPercent = postMoneyPoolTarget / 100;

    const totalSharesAfterOption = Math.round(
      totalSharesBeforeOption / (1 - targetOptionPercent),
    );

    const targetTotalOptionShares = Math.round(
      totalSharesAfterOption * targetOptionPercent,
    );
    newOptionShares = Math.max(
      0,
      targetTotalOptionShares - existingOptionPoolShares,
    );

    totalPostShares = totalSharesAfterOption;
    newInvestorShares = newInvestorSharesBeforeOption;
    updatedSharePrice = seriesASharePrice;

    previous_investors_total = previousInvestorsTotalShares;
    total_option_pool = existingOptionPoolShares + newOptionShares;
    total_shares_befores = preMoneyTotalSharesCalc;
    postMoneyValuation = totalPostShares * seriesASharePrice;
  } else if (isPreviousRoundRound0 && previousRounds.length > 0) {
    const totalSharesWithConverted = round0Shares + totalConvertedShares;

    optionPoolShares = Math.round(
      (totalSharesWithConverted / (1 - preMoneyPoolPercent / 100)) *
        (preMoneyPoolPercent / 100),
    );

    preMoneyTotalSharesCalc = totalSharesWithConverted + optionPoolShares;
    const investorPostMoneyOwnership =
      (roundSizeVal / postMoneyValuation) * 100;

    totalPostShares = Math.round(
      preMoneyTotalSharesCalc / (1 - investorPostMoneyOwnership / 100),
    );
    newInvestorShares = totalPostShares - preMoneyTotalSharesCalc;
    updatedSharePrice = roundSizeVal / newInvestorShares;

    previous_investors_total = newInvestorShares;
    total_option_pool = optionPoolShares;
    total_shares_befores = preMoneyTotalSharesCalc;
  } else if (previousRounds.length > 0) {
    // ✅ CONDITION: Previous rounds exist but not the above conditions
    optionPoolShares = Math.round(
      (round0Shares / (1 - preMoneyPoolPercent / 100)) *
        (preMoneyPoolPercent / 100),
    );

    preMoneyTotalSharesCalc =
      round0Shares + optionPoolShares + totalConvertedShares;
    const investorPostMoneyOwnership =
      (roundSizeVal / postMoneyValuation) * 100;

    totalPostShares = Math.round(
      preMoneyTotalSharesCalc / (1 - investorPostMoneyOwnership / 100),
    );
    newInvestorShares = totalPostShares - preMoneyTotalSharesCalc;
    updatedSharePrice = roundSizeVal / newInvestorShares;

    previous_investors_total = newInvestorShares;
    total_option_pool = optionPoolShares;
    total_shares_befores = total_shares_before;
  } else {
    // ✅ CONDITION: NO PREVIOUS ROUNDS - First round calculation
    optionPoolShares = Math.round(
      (round0Shares / (1 - preMoneyPoolPercent / 100)) *
        (preMoneyPoolPercent / 100),
    );

    preMoneyTotalSharesCalc =
      round0Shares + optionPoolShares + totalConvertedShares;
    const investorPostMoneyOwnership =
      (roundSizeVal / postMoneyValuation) * 100;

    totalPostShares = Math.round(
      preMoneyTotalSharesCalc / (1 - investorPostMoneyOwnership / 100),
    );
    newInvestorShares = totalPostShares - preMoneyTotalSharesCalc;
    updatedSharePrice = roundSizeVal / newInvestorShares;

    previous_investors_total = 0; // No previous investors
    total_option_pool = optionPoolShares;
    total_shares_befores = round0Shares;
  }
  const buildWarrantItem = (warrant, totalShares, valuation, cur) => {
    const ownership = warrant.shares / totalShares;
    const rawPercentage = ownership * 100;
    let investorType = "warrant";
    if (warrant.investor_type === "warrant not exercised") {
      investorType = "warrant not exercised";
    }
    return {
      type: "investor",
      name: warrant.name,
      investor_details: warrant.investor_details,
      shares: warrant.shares,
      new_shares: warrant.shares,
      existing_shares: 0,
      total: warrant.shares,
      email: warrant.investor_details?.email || "",
      phone: warrant.investor_details?.phone || "",
      percentage_raw: rawPercentage,
      percentage: rawPercentage.toFixed(2) + "%",
      percentage_formatted: rawPercentage.toFixed(2) + "%",
      value: ((rawPercentage * valuation) / 100).toFixed(2),
      investment: warrant.investment,
      investment_amount: warrant.investment,
      share_price: warrant.share_price,
      is_previous: false,
      is_warrant: true,
      is_new_investment: true,
      is_converted: false,
      investor_type: investorType,
      share_class_type: warrant.share_class_type,
      instrument_type: warrant.instrument_type,
      round_name: warrant.round_name,
      round_id: warrant.round_id,
      warrant_id: warrant.warrant_id,
    };
  };
  // Rest of the code remains exactly the same...
  const investorsWithShares = investorsList.map((inv) => {
    const amount = parseFloat(inv.amount) || 0;
    const shares = Math.round(amount / updatedSharePrice);
    const exactPercentage = (shares / totalPostShares) * 100;
    const exactValue = (exactPercentage * postMoneyValuation) / 100;

    return {
      ...inv,
      shares,
      share_price: updatedSharePrice,
      type: "investor",
      is_new_investment: true,
      percentage: exactPercentage.toFixed(2) + "%",
      value: exactValue.toFixed(2),
      shareClassType: currentRound.shareClassType || "",
      instrumentType: currentRound.instrumentType || "",
      roundName: currentRound.nameOfRound || "",
      round_id: currentRound.id,
      investor_details: {
        firstName: inv.firstName || "",
        lastName: inv.lastName || "",
        email: inv.email || "",
        phone: inv.phone || "",
      },
    };
  });

  conversionDetails.forEach((conv) => {
    const ownership = conv.convertedShares / totalPostShares;
    const rawPct = ownership * 100;
    conv.percentage_raw = rawPct;
    conv.percentage = rawPct.toFixed(2) + "%";
    conv.percentage_formatted = rawPct.toFixed(2) + "%";
    conv.value = ((rawPct * postMoneyValuation) / 100).toFixed(2);
    conv.moic =
      conv.investment > 0
        ? (
            (updatedSharePrice * conv.convertedShares) /
            conv.investment
          ).toFixed(2) + "X"
        : "0X";
  });

  const preMoneyCapTable = {
    total_shares: preMoneyTotalSharesCalc,
    pending_instruments: previousPendingSafes,
    founders: {
      list: founderList.map((f) => {
        const ownership = f.shares / preMoneyTotalSharesCalc;
        const rawPercentage = ownership * 100;
        return {
          ...f,
          roundName: round0Name,
          share_class_type: round0Shareclassstype,
          percentage_raw: rawPercentage,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
        };
      }),
      roundName: round0Name,
      share_class_type: round0Shareclassstype,
      total_shares: round0Shares,
      total_percentage_raw: (round0Shares / preMoneyTotalSharesCalc) * 100,
      total_percentage:
        ((round0Shares / preMoneyTotalSharesCalc) * 100).toFixed(2) + "%",
      total_value: (
        ((round0Shares / preMoneyTotalSharesCalc) * 100 * preMoneyVal) /
        100
      ).toFixed(2),
    },
    option_pool: (() => {
      const opShares = existingOptionPoolShares + (optionPoolShares || 0);
      const ownership = opShares / preMoneyTotalSharesCalc;
      const rawPercentage = ownership * 100;
      return {
        shares: opShares,
        existing_shares: existingOptionPoolShares,
        new_shares: optionPoolShares || 0,
        percentage_raw: rawPercentage,
        percentage: rawPercentage.toFixed(2) + "%",
        value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
        shareClassType: "Option Pool",
        instrumentType: "Options",
        roundName: "Option Pool",
        is_option_pool: true,
      };
    })(),
    previous_investors:
      previousInvestorsList.length > 0
        ? (() => {
            const groupOwnership =
              previousInvestorsTotalShares / preMoneyTotalSharesCalc;
            const groupRawPercentage = groupOwnership * 100;
            return {
              name: "Previous Investors",
              total_shares: previousInvestorsTotalShares,
              percentage_raw: groupRawPercentage,
              percentage: groupRawPercentage.toFixed(2) + "%",
              total_value: ((groupRawPercentage * preMoneyVal) / 100).toFixed(
                2,
              ),
              items: previousInvestorsList.map((inv) => {
                const ownership = inv.shares / preMoneyTotalSharesCalc;
                const rawPercentage = ownership * 100;
                return {
                  ...inv,
                  percentage_raw: rawPercentage,
                  percentage: rawPercentage.toFixed(2) + "%",
                  value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
                };
              }),
              is_grouped: false,
            };
          })()
        : null,
    converted:
      totalConvertedShares > 0
        ? (() => {
            const ownership = totalConvertedShares / preMoneyTotalSharesCalc;
            const rawPercentage = ownership * 100;
            return {
              name: "Converted Investors",
              shares: totalConvertedShares,
              percentage_raw: rawPercentage,
              percentage: rawPercentage.toFixed(2) + "%",
              value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
              items: conversionDetails.map((conv) => ({
                name: conv.investor_name,
                instrument_type: conv.instrument_type,
                shares: conv.convertedShares,
                investment: conv.investment,
                conversion_price: conv.conversion_price,
                principal_plus_interest: conv.principal_plus_interest,
                interest_accrued: conv.interest_accrued,
                moic: conv.moic,
                original_round_id: conv.original_round_id,
              })),
            };
          })()
        : null,
    warrants:
      previousWarrantsList.length > 0
        ? {
            name: "Warrants",
            total_shares: previousWarrantsTotalShares,
            percentage_raw:
              (previousWarrantsTotalShares / preMoneyTotalSharesCalc) * 100,
            percentage:
              (
                (previousWarrantsTotalShares / preMoneyTotalSharesCalc) *
                100
              ).toFixed(2) + "%",
            total_value: (
              ((previousWarrantsTotalShares / preMoneyTotalSharesCalc) *
                100 *
                preMoneyVal) /
              100
            ).toFixed(2),
            items: previousWarrantsList.map((w) =>
              buildWarrantItem(
                w,
                preMoneyTotalSharesCalc,
                preMoneyVal,
                currentRound?.currency || "USD",
              ),
            ),
          }
        : null,
    pre_money_valuation: preMoneyVal,
    share_price: (preMoneyVal / preMoneyTotalSharesCalc).toFixed(4),
    items: [
      ...founderList.map((f) => {
        const ownership = f.shares / preMoneyTotalSharesCalc;
        const rawPercentage = ownership * 100;
        return {
          type: "founder",
          name: f.name,
          shares: f.shares,
          new_shares: 0,
          total: f.shares,
          existing_shares: f.shares,
          email: f.email,
          phone: f.phone,
          founder_code: f.founder_code,
          percentage_raw: rawPercentage,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
          shareClassType: f.shareClassType || "Common Shares",
          instrumentType: f.instrumentType || "Common Stock",
          roundName: round0Name,
          round_id: f.round_id || null,
          is_option_pool: false,
          is_previous: false,
          is_converted: false,
        };
      }),
      (() => {
        const opShares = existingOptionPoolShares + (optionPoolShares || 0);
        const ownership = opShares / preMoneyTotalSharesCalc;
        const rawPercentage = ownership * 100;
        return {
          type: "option_pool",
          name: "Employee Option Pool",
          shares: opShares,
          new_shares: optionPoolShares || 0,
          existing_shares: existingOptionPoolShares,
          total: opShares,
          is_option_pool: true,
          percentage_raw: rawPercentage,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
          shareClassType: "Option Pool",
          instrumentType: "Options",
          roundName: "Option Pool",
        };
      })(),
      ...previousInvestorsList.map((inv) => {
        const ownership = inv.shares / preMoneyTotalSharesCalc;
        const rawPercentage = ownership * 100;
        return {
          type: "investor",
          name: inv.name,
          investor_details: inv.investor_details,
          shares: inv.shares,
          new_shares: 0,
          existing_shares: inv.shares,
          total: inv.shares,
          percentage_raw: rawPercentage,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
          investment: inv.investment,
          share_price: inv.share_price,
          is_previous: true,
          is_new_investment: false,
          is_converted: false,
          share_class_type: inv.share_class_type,
          instrument_type: inv.instrument_type,
          round_name: inv.round_name,
          round_id: inv.round_id,
        };
      }),
      ...previousWarrantsList.map((w) =>
        buildWarrantItem(
          w,
          preMoneyTotalSharesCalc,
          preMoneyVal,
          currentRound?.currency || "USD",
        ),
      ),
      ...(totalConvertedShares > 0
        ? (() => {
            const ownership = totalConvertedShares / preMoneyTotalSharesCalc;
            const rawPercentage = ownership * 100;
            return [
              {
                type: "investor",
                name: "Converted Investors",
                shares: totalConvertedShares,
                new_shares: 0,
                existing_shares: totalConvertedShares,
                total: totalConvertedShares,
                is_converted: true,
                is_previous: false,
                percentage_raw: rawPercentage,
                percentage: rawPercentage.toFixed(2) + "%",
                value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
                shareClassType: "Convertible",
                instrumentType: "Safe / Convertible Note",
                roundName: "Conversion Round",
                items: conversionDetails.map((conv) => ({
                  type: "investor",
                  shareClassType: conv.shareClassType,
                  name: conv.investor_name,
                  maturity_date: conv.maturity_date,
                  instrument_type: conv.instrument_type,
                  shares: conv.convertedShares,
                  investment: conv.investment,
                  conversion_price: conv.conversion_price,
                  is_converted: true,
                })),
              },
            ];
          })()
        : []),
      ...previousPendingSafes,
    ],
  };

  const postMoneyCapTable = {
    total_shares: totalPostShares,
    pending_instruments: previousPendingSafes,
    founders: {
      list: founderList.map((f) => {
        const ownership = f.shares / totalPostShares;
        const rawPercentage = ownership * 100;

        return {
          ...f,
          roundName: currentRound.nameOfRound,
          share_class_type: round0Shareclassstype,
          shares: f.shares,
          new_shares: 0,
          total: f.shares,
          percentage_raw: rawPercentage,
          percentage: rawPercentage.toFixed(2) + "%",
          percentage_formatted: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
          shareClassType: f.shareClassType || "Common Shares",
          instrumentType: f.instrumentType || "Common Stock",
          round_id: round0?.id || null,
        };
      }),
      total_shares: round0Shares,
      total_percentage_raw: (round0Shares / totalPostShares) * 100,
      total_percentage:
        ((round0Shares / totalPostShares) * 100).toFixed(2) + "%",
      total_value: (
        ((round0Shares / totalPostShares) * 100 * postMoneyValuation) /
        100
      ).toFixed(2),
      roundName: round0Name,
      share_class_type: round0Shareclassstype,
      round_id: round0?.id || null,
      shareClassType: "Common Shares",
      instrumentType: "Common Stock",
    },
    previous_investors:
      previousInvestorsList.length > 0
        ? (() => {
            const groupOwnership =
              previousInvestorsTotalShares / totalPostShares;
            const groupRawPercentage = groupOwnership * 100;
            return {
              name: "Previous Investors",
              total_shares: previousInvestorsTotalShares,
              new_shares: 0,
              total: previousInvestorsTotalShares,
              percentage_raw: groupRawPercentage,
              percentage: groupRawPercentage.toFixed(2) + "%",
              percentage_formatted: groupRawPercentage.toFixed(2) + "%",
              total_value: (
                (groupRawPercentage * postMoneyValuation) /
                100
              ).toFixed(2),
              items: previousInvestorsList.map((inv) => {
                const ownership = inv.shares / totalPostShares;
                const rawPercentage = ownership * 100;
                return {
                  ...inv,
                  existing_shares: inv.shares,
                  new_shares: 0,
                  total: inv.shares,
                  percentage_raw: rawPercentage,
                  percentage: rawPercentage.toFixed(2) + "%",
                  percentage_formatted: rawPercentage.toFixed(2) + "%",
                  value: ((rawPercentage * postMoneyValuation) / 100).toFixed(
                    2,
                  ),
                };
              }),
              is_grouped: false,
            };
          })()
        : null,
    converted_investors:
      totalConvertedShares > 0
        ? (() => {
            const ownership = totalConvertedShares / totalPostShares;
            const rawPercentage = ownership * 100;
            return {
              name: "Converted Investors",
              shares: totalConvertedShares,
              new_shares: totalConvertedShares,
              total: totalConvertedShares,
              percentage_raw: rawPercentage,
              percentage: rawPercentage.toFixed(2) + "%",
              percentage_formatted: rawPercentage.toFixed(2) + "%",
              value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
              investment: totalConvertedInvestment,
              shareClassType: "Convertible",
              instrumentType: "Safe / Convertible Note",
              roundName: "Conversion Round",
              items: conversionDetails.map((conv) => ({
                type: "investor",
                name: conv.investor_name,
                instrument_type: conv.instrument_type,
                shares: conv.convertedShares,
                new_shares: conv.convertedShares,
                total: conv.convertedShares,
                investment: conv.investment,
                conversion_price: conv.conversion_price,
                principal_plus_interest: conv.principal_plus_interest,
                interest_accrued: conv.interest_accrued,
                interest_rate: conv.interest_rate,
                discount_rate: conv.discount_rate,
                valuation_cap: conv.valuation_cap,
                moic: conv.moic,
                original_round_id: conv.original_round_id,
                pending_instrument_id: conv.pending_instrument_id,
                is_converted: true,
                investor_details: conv.investor_details,
                email: conv.investor_email,
                phone: conv.investor_phone,
                shareClassType: conv.shareClassType,
                instrumentType: conv.instrument_type,
                roundId: conv.original_round_id,
                round_id: conv.original_round_id,
                round_name: conv.round_name || "Conversion Round",
                percentage_raw: conv.percentage_raw,
                maturity_date: conv.maturity_date,
                percentage: conv.percentage,
                percentage_formatted: conv.percentage_formatted,
                value: conv.value,
              })),
            };
          })()
        : null,
    investors: (() => {
      const ownership = newInvestorShares / totalPostShares;
      const rawPercentage = ownership * 100;
      return {
        name:
          hasInvestmentRoundBefore && previousRounds.length > 0
            ? currentRound.nameOfRound || "Series A Investors"
            : "Preferred Equity Investors",
        shares: newInvestorShares,
        new_shares: newInvestorShares,
        total: newInvestorShares,
        percentage_raw: rawPercentage,
        percentage: rawPercentage.toFixed(2) + "%",
        percentage_formatted: rawPercentage.toFixed(2) + "%",
        value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
        investment: roundSizeVal,
        shareClassType: currentRound.shareClassType || "Preferred",
        instrumentType: currentRound.instrumentType || "Preferred Equity",
        roundName: currentRound.nameOfRound || "Current Round",
        roundId: currentRound.id,
        round_id: currentRound.id,
        items: investorsWithShares,
      };
    })(),
    option_pool: (() => {
      const opShares =
        existingOptionPoolShares +
        (optionPoolShares || 0) +
        (newOptionShares || 0);
      const ownership = opShares / totalPostShares;
      const rawPercentage = ownership * 100;
      return {
        shares: opShares,
        existing_shares: existingOptionPoolShares + (optionPoolShares || 0),
        new_shares: newOptionShares || 0,
        total: opShares,
        percentage_raw: rawPercentage,
        percentage: rawPercentage.toFixed(2) + "%",
        percentage_formatted: rawPercentage.toFixed(2) + "%",
        value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
        shareClassType: "Option Pool",
        instrumentType: "Options",
        roundName: "Option Pool",
        is_option_pool: true,
      };
    })(),
    warrants:
      currentRoundWarrantsList.length > 0
        ? {
            name: "Warrants",
            total_shares: currentRoundWarrantsTotalShares,
            new_shares: currentRoundWarrantsTotalShares,
            total: currentRoundWarrantsTotalShares,
            percentage_raw:
              (currentRoundWarrantsTotalShares / totalPostShares) * 100,
            percentage:
              (
                (currentRoundWarrantsTotalShares / totalPostShares) *
                100
              ).toFixed(2) + "%",
            percentage_formatted:
              (
                (currentRoundWarrantsTotalShares / totalPostShares) *
                100
              ).toFixed(2) + "%",
            total_value: (
              ((currentRoundWarrantsTotalShares / totalPostShares) *
                100 *
                postMoneyValuation) /
              100
            ).toFixed(2),
            items: currentRoundWarrantsList.map((w) =>
              buildWarrantItem(
                w,
                totalPostShares,
                postMoneyValuation,
                currentRound?.currency || "USD",
              ),
            ),
          }
        : null,
    items: [
      ...founderList.map((f) => {
        const ownership = f.shares / totalPostShares;
        const rawPercentage = ownership * 100;
        return {
          type: "founder",
          name: f.name,
          shares: f.shares,
          new_shares: 0,
          total: f.shares,
          email: f.email,
          phone: f.phone,
          founder_code: f.founder_code,
          percentage_raw: rawPercentage,
          percentage: rawPercentage.toFixed(2) + "%",
          percentage_formatted: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
          shareClassType: f.shareClassType || "Common Shares",
          instrumentType: f.instrumentType || "Common Stock",
          roundName: "Round 0",
          roundId: round0?.id || null,
          round_id: round0?.id || null,
        };
      }),
      ...previousInvestorsList.map((inv) => {
        const ownership = inv.shares / totalPostShares;
        const rawPercentage = ownership * 100;
        return {
          type: "investor",
          name: inv.name,
          investor_details: inv.investor_details,
          shares: inv.shares,
          new_shares: 0,
          total: inv.shares,
          percentage_raw: rawPercentage,
          percentage: rawPercentage.toFixed(2) + "%",
          percentage_formatted: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
          investment: inv.investment,
          share_price: inv.share_price,
          is_previous: true,
          share_class_type: inv.share_class_type,
          instrument_type: inv.instrument_type,
          round_name: inv.round_name,
          round_id: inv.round_id,
        };
      }),
      ...previousWarrantsList.map((w) =>
        buildWarrantItem(
          w,
          totalPostShares,
          postMoneyValuation,
          currentRound?.currency || "USD",
        ),
      ),
      ...currentRoundWarrantsList.map((w) =>
        buildWarrantItem(
          w,
          totalPostShares,
          postMoneyValuation,
          currentRound?.currency || "USD",
        ),
      ),
      ...(totalConvertedShares > 0
        ? conversionDetails.map((conv) => ({
            type: "investor",
            name: conv.investor_name,
            shares: conv.convertedShares,
            new_shares: conv.convertedShares,
            total: conv.convertedShares,
            is_converted: true,
            percentage_raw: conv.percentage_raw,
            percentage: conv.percentage,
            percentage_formatted: conv.percentage_formatted,
            value: conv.value,
            investment: conv.investment,
            conversion_price: conv.conversion_price,
            principal_plus_interest: conv.principal_plus_interest,
            interest_accrued: conv.interest_accrued,
            interest_rate: conv.interest_rate,
            discount_rate: conv.discount_rate,
            valuation_cap: conv.valuation_cap,
            maturity_date: conv.maturity_date,
            moic: conv.moic,
            shareClassType: conv.shareClassType,
            instrumentType: conv.instrument_type,
            roundName: conv.round_name || "Conversion Round",
            roundId: conv.original_round_id,
            round_id: conv.original_round_id,
            pending_instrument_id: conv.pending_instrument_id,
            investor_details: conv.investor_details,
            email: conv.investor_email,
            phone: conv.investor_phone,
          }))
        : []),
      ...investorsWithShares.map((inv) => {
        const ownership = inv.shares / totalPostShares;
        const rawPercentage = ownership * 100;
        return {
          type: "investor",
          name:
            inv.name || [inv.firstName, inv.lastName].filter(Boolean).join(" "),
          investor_details: {
            firstName: inv.firstName || "",
            lastName: inv.lastName || "",
            email: inv.email || "",
            phone: inv.phone || "",
          },
          shares: inv.shares,
          new_shares: inv.shares,
          total: inv.shares,
          percentage_raw: rawPercentage,
          percentage: rawPercentage.toFixed(2) + "%",
          percentage_formatted: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
          investment: parseFloat(inv.amount) || 0,
          share_price: updatedSharePrice,
          is_new_investment: true,
          shareClassType: inv.shareClassType,
          instrumentType: inv.instrumentType,
          roundName: inv.roundName,
          roundId: inv.roundId,
          round_id: inv.roundId,
        };
      }),
      (() => {
        const opShares =
          existingOptionPoolShares +
          (optionPoolShares || 0) +
          (newOptionShares || 0);
        const ownership = opShares / totalPostShares;
        const rawPercentage = ownership * 100;
        return {
          type: "option_pool",
          name: "Employee Option Pool",
          shares: opShares,
          existing_shares: existingOptionPoolShares + (optionPoolShares || 0),
          new_shares: newOptionShares || 0,
          total: opShares,
          is_option_pool: true,
          percentage_raw: rawPercentage,
          percentage: rawPercentage.toFixed(2) + "%",
          percentage_formatted: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
          shareClassType: "Option Pool",
          instrumentType: "Options",
          roundName: "Option Pool",
        };
      })(),
      ...previousPendingSafes,
    ],
    post_money_valuation: postMoneyValuation,
    share_price: (postMoneyValuation / totalPostShares).toFixed(4),
    roundName: currentRound.nameOfRound,
    roundId: currentRound.id,
    round_id: currentRound.id,
    shareClassType: currentRound.shareClassType,
    instrumentType: currentRound.instrumentType,
    currency: currentRound.currency,
  };

  const roundInvestmentsString =
    typeof round_investments === "string"
      ? round_investments
      : JSON.stringify(round_investments || []);

  const dbUpdateData = {
    total_option_pool: total_option_pool.toString(),
    total_founder_shares: totalFounderShares.toString(),
    previous_investors_total: previous_investors_total.toString(),
    share_price: updatedSharePrice.toFixed(4),
    issuedshares: (newInvestorShares + (newOptionShares || 0)).toString(),
    investorPostMoney: ((newInvestorShares / totalPostShares) * 100).toFixed(2),
    pre_money: preMoneyVal.toString(),
    post_money: postMoneyValuation.toString(),
    roundsize: roundSizeVal.toString(),
    conversion_shares: totalConvertedShares.toString(),
    total_converted_shares: totalConvertedShares.toString(),
    option_pool_shares: (optionPoolShares || newOptionShares || 0).toString(),
    option_pool_percentage: (
      postMoneyPoolTarget || preMoneyPoolPercent
    ).toFixed(2),
    total_shares_before: total_shares_befores.toString(),
    total_shares_after: totalPostShares.toString(),
    founder_data: founderData ? JSON.stringify(founderData) : null,
    round_investments: roundInvestmentsString,
    pre_money_cap_table: JSON.stringify(preMoneyCapTable),
    post_money_cap_table: JSON.stringify(postMoneyCapTable),
    updated_at: new Date(),
  };

  try {
    if (conversionDetails.length > 0) {
      await saveCapTableData(
        "price",
        id,
        company_id,
        preMoneyCapTable,
        postMoneyCapTable,
        preMoneyTotalSharesCalc,
        totalPostShares,
        preMoneyVal,
        postMoneyValuation,
        true,
      );
    } else {
      await saveCapTableData(
        "price",
        id,
        company_id,
        preMoneyCapTable,
        postMoneyCapTable,
        preMoneyTotalSharesCalc,
        totalPostShares,
        preMoneyVal,
        postMoneyValuation,
      );
    }

    await updateRoundRecordDataCommonPreferred(id, dbUpdateData);

    return {
      success: true,
      data: dbUpdateData,
      roundId: id,
      pre_money_cap_table: preMoneyCapTable,
      post_money_cap_table: postMoneyCapTable,
      conversions: conversionDetails,
    };
  } catch (error) {
    console.error("❌ DATABASE ERROR:", error);
    return { success: false, error: error.message };
  }
}

// ==================== NEW HELPER FUNCTION ====================

async function getAlreadyConvertedRounds(companyId, currentRoundId) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT DISTINCT original_round_id 
      FROM round_conversions 
      WHERE company_id = ?  AND round_id < ?
      AND round_id IS NOT NULL
      AND original_round_id IS NOT NULL
    `;
    db.query(query, [companyId, currentRoundId], (err, results) => {
      if (err) {
        console.error("Error fetching already converted rounds:", err);
        reject(err);
      } else {
        resolve(results || []);
      }
    });
  });
}

// ==================== EXISTING HELPER FUNCTIONS (keep these as they are) ====================

// Get existing round data

// Save conversions to tracking table
async function saveConversionsToTracking(
  conversions,
  conversionRoundId,
  companyId,
) {
  if (!conversions || conversions.length === 0) return [];
  const results = [];

  // ==================== DELETE EXISTING CONVERSION RECORDS ====================
  // Pehle current round ke saare conversion records delete karo

  for (const conv of conversions) {
    try {
      const firstName =
        conv.investor_details?.firstName ||
        conv.investor_name?.split(" ")[0] ||
        "";
      const lastName =
        conv.investor_details?.lastName ||
        conv.investor_name?.split(" ").slice(1).join(" ") ||
        "";
      const email = conv.investor_email || conv.investor_details?.email || "";
      const phone = conv.investor_phone || conv.investor_details?.phone || "";

      // ================================================================
      // STEP 1: INSERT — PRE-MONEY converted record
      // cap_table_type = 'pre'
      // new_shares = 0 (pre-money mein new shares nahi hote)
      // ================================================================
      // const insertPreResult = await new Promise((resolve, reject) => {
      //   db.query(
      //     `INSERT INTO round_investors
      //       (round_id, company_id, cap_table_type, investor_type,
      //        first_name, last_name, email, phone,
      //        shares, new_shares, total_shares,
      //        investment_amount, share_price,
      //        percentage_numeric, percentage_formatted, value,
      //        is_converted, is_previous, is_new_investment, is_pending,
      //        potential_shares, conversion_price, discount_rate, valuation_cap,
      //        interest_rate, years, interest_accrued, total_conversion_amount, maturity_date,
      //        investor_details, instrument_type, round_name, round_id_ref)
      //      VALUES (?, ?, 'pre', 'converted',
      //              ?, ?, ?, ?,
      //              ?, 0, ?,
      //              ?, ?,
      //              0, '0.00%', 0,
      //              1, 0, 0, 0,
      //              ?, ?, ?, ?,
      //              ?, ?, ?, ?, ?,
      //              ?, ?, ?, ?)`,
      //     [
      //       conversionRoundId, // round_id
      //       companyId, // company_id
      //       firstName, // first_name
      //       lastName, // last_name
      //       email, // email
      //       phone, // phone
      //       parseInt(conv.convertedShares) || 0, // shares
      //       parseInt(conv.convertedShares) || 0, // total_shares
      //       parseFloat(conv.investment) || 0, // investment_amount
      //       parseFloat(conv.conversion_price) || 0, // share_price
      //       parseInt(conv.convertedShares) || 0, // potential_shares
      //       parseFloat(conv.conversion_price) || 0, // conversion_price
      //       parseFloat(conv.discount_rate) || 0, // discount_rate
      //       parseFloat(conv.valuation_cap) || 0, // valuation_cap
      //       conv.interest_rate || 0, // interest_rate
      //       conv.years || 0, // years
      //       conv.interest_accrued || 0, // interest_accrued
      //       conv.principal_plus_interest || conv.investment || 0, // total_conversion_amount
      //       conv.maturity_date || null, // maturity_date
      //       JSON.stringify(conv.investor_details || {}), // investor_details
      //       conv.instrument_type || "Safe", // instrument_type
      //       conv.investor_name || "", // round_name
      //       conv.original_round_id, // round_id_ref
      //     ],
      //     (err, result) => {
      //       if (err) {
      //         console.error(`❌ INSERT pre round_investors failed:`, err);
      //         reject(err);
      //       } else {
      //         console.log(
      //           `✅ PRE converted inserted — round: ${conversionRoundId}, id: ${result.insertId}`,
      //         );
      //         resolve(result);
      //       }
      //     },
      //   );
      // });

      // ================================================================
      // STEP 2: INSERT — POST-MONEY converted record
      // cap_table_type = 'post'
      // new_shares = convertedShares
      // ================================================================
      const insertPostResult = await new Promise((resolve, reject) => {
        db.query(
          `INSERT INTO round_investors
            (round_id, company_id, cap_table_type, investor_type,
             first_name, last_name, email, phone,
             shares, new_shares, total_shares,
             investment_amount, share_price,
             percentage_numeric, percentage_formatted, value,
             is_converted, is_previous, is_new_investment, is_pending,
             potential_shares, conversion_price, discount_rate, valuation_cap,
             interest_rate, years, interest_accrued, total_conversion_amount, maturity_date,
             investor_details, instrument_type, round_name, round_id_ref)
           VALUES (?, ?, 'post', 'converted',
                   ?, ?, ?, ?,
                   ?, ?, ?,
                   ?, ?,
                   0, '0.00%', 0,
                   1, 0, 0, 0,
                   ?, ?, ?, ?,
                   ?, ?, ?, ?, ?,
                   ?, ?, ?, ?)`,
          [
            conversionRoundId, // round_id
            companyId, // company_id
            firstName, // first_name
            lastName, // last_name
            email, // email
            phone, // phone
            parseInt(conv.convertedShares) || 0, // shares
            parseInt(conv.convertedShares) || 0, // new_shares ✅
            parseInt(conv.convertedShares) || 0, // total_shares
            parseFloat(conv.investment) || 0, // investment_amount
            parseFloat(conv.conversion_price) || 0, // share_price
            parseInt(conv.convertedShares) || 0, // potential_shares
            parseFloat(conv.conversion_price) || 0, // conversion_price
            parseFloat(conv.discount_rate) || 0, // discount_rate
            parseFloat(conv.valuation_cap) || 0, // valuation_cap
            conv.interest_rate || 0, // interest_rate
            conv.years || 0, // years
            conv.interest_accrued || 0, // interest_accrued
            conv.principal_plus_interest || conv.investment || 0, // total_conversion_amount
            conv.maturity_date || null, // maturity_date
            JSON.stringify(conv.investor_details || {}), // investor_details
            conv.instrument_type || "Safe", // instrument_type
            conv.investor_name || "", // round_name
            conv.original_round_id, // round_id_ref
          ],
          (err, result) => {
            if (err) {
              console.error(`❌ INSERT post round_investors failed:`, err);
              reject(err);
            } else {
              resolve(result);
            }
          },
        );
      });

      results.push({
        original_round_id: conv.original_round_id,
        instrument_type: conv.instrument_type,
        converted_shares: conv.convertedShares,
        conversion_price: conv.conversion_price,
        pending_instrument_id: conv.pending_instrument_id,
        pre_insert_id: insertPreResult.insertId,
        post_insert_id: insertPostResult.insertId,
        success: true,
      });
    } catch (error) {
      console.error(`❌ Error for round ${conv.original_round_id}:`, error);
      results.push({
        original_round_id: conv.original_round_id,
        success: false,
        error: error.message,
      });
    }
  }

  return results;
}
// ==================== HELPER FUNCTIONS ====================

async function getPreviousRoundsForCompany(companyId, currentRoundId) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT * FROM roundrecord 
      WHERE company_id = ? 
      AND id != ?
      AND round_type = 'Investment'
      ORDER BY created_at ASC
    `;
    db.query(query, [companyId, currentRoundId], (err, results) => {
      if (err) reject(err);
      else resolve(results || []);
    });
  });
}

async function getPreviousRoundsForCompanyForConversion(
  companyId,
  currentRoundId,
) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        ri.*,
        ri.instrument_type as instrumentType,
        ri.round_name as nameOfRound,
        ri.share_class_type as shareClassType,
        rr.instrument_type_data
      FROM round_investors ri
      JOIN roundrecord rr ON rr.id = ri.round_id
      WHERE ri.company_id   = ?
        AND ri.round_id     = ?
        AND ri.investor_type = 'pending'
        AND ri.is_pending    = 1
        AND ri.cap_table_type = 'post'
        AND rr.instrumentType IN ('Safe', 'Convertible Note')
      ORDER BY ri.round_id ASC, ri.id ASC
    `;
    db.query(query, [companyId, currentRoundId], (err, results) => {
      if (err) reject(err);
      else resolve(results || []);
    });
  });
}

function parseInstrumentData(instrumentDataStr) {
  if (!instrumentDataStr) return {};
  try {
    if (typeof instrumentDataStr === "object") return instrumentDataStr;
    return JSON.parse(instrumentDataStr);
  } catch (e) {
    console.error("Error parsing instrument data:", e);
    return {};
  }
}

// 3. SAFE HANDLER
async function handleSafeCalculation(params) {
  const {
    id,
    company_id,
    preMoney,
    roundSize,
    optionPoolPercentValue,
    total_shares_before,
    instrumentData,
    isUpdate,
    currentRound,
    round_investments,
  } = params;

  // ==================== PARSE INSTRUMENT DATA ====================
  let parsedInstrumentData = {};
  if (instrumentData) {
    if (typeof instrumentData === "string") {
      try {
        parsedInstrumentData = JSON.parse(instrumentData);
      } catch (e) {
        console.error("Error parsing instrumentData:", e);
      }
    } else if (typeof instrumentData === "object") {
      parsedInstrumentData = instrumentData;
    }
  }

  // ==================== EXTRACT SAFE TERMS ====================
  const discountRate = parseFloat(parsedInstrumentData.discountRate) || 0;
  const valuationCap = parseFloat(parsedInstrumentData.valuationCap) || 0;

  // ==================== VALIDATE INPUTS ====================
  const preMoneyVal = parseFloat(preMoney) || 0;
  const roundSizeVal = parseFloat(roundSize) || 0;
  const optionPoolPercent = parseFloat(optionPoolPercentValue) || 0;
  const round0Shares = parseInt(total_shares_before) || 0;

  // ==================== PARSE INVESTORS LIST ====================
  let investorsList = [];
  try {
    if (round_investments) {
      investorsList =
        typeof round_investments === "string"
          ? JSON.parse(round_investments)
          : round_investments;
    }
  } catch (e) {
    console.error("Error parsing round_investments:", e);
  }

  // ==================== GET FOUNDER DATA ====================
  let founderList = [];
  let round0Name = "Round 0";
  let round0Shareclassstype = "";
  let round0 = null;
  let founderData = null;
  let totalFounderShares = 0;

  try {
    const round0Data = await getFounderDataFromRound0(company_id);
    if (round0Data && round0Data.founder_data) {
      founderData = round0Data.founder_data;
      totalFounderShares = round0Data.total_founder_shares || 0;
      round0Name = round0Data.round0Name || "Round 0";
      round0Shareclassstype = round0Data.shareClassType || "";
      round0 = round0Data;

      if (founderData.founders && Array.isArray(founderData.founders)) {
        founderList = founderData.founders.map((founder, index) => ({
          name:
            `${founder.firstName || ""} ${founder.lastName || ""}`.trim() ||
            `Founder ${index + 1}`,
          shares: parseFloat(founder.shares) || 0,
          email: founder.email || "",
          phone: founder.phone || "",
          voting: founder.voting || "voting",
          share_type: founder.shareType || "common",
          founder_code: `F${index + 1}`,
          shareClassType:
            founder.shareClassType ||
            round0Data.shareClassType ||
            "Common Shares",
          instrumentType:
            founder.instrumentType ||
            round0Data.instrumentType ||
            "Common Stock",
          roundName: round0Data.nameOfRound || "Round 0",
          roundId: round0Data.id || null,
          round_id: round0Data.id || null,
          investment: founder.investment || 0,
          share_price: founder.share_price || 0,
          original_founder_data: founder,
        }));
      }
    }
  } catch (error) {
    console.error("❌ Error fetching founder data:", error);
  }

  // ==================== GET PREVIOUS ROUNDS ====================
  const previousRounds = await getPreviousRoundsForCompany(company_id, id);
  const sortedPreviousRounds = [...previousRounds].sort((a, b) => b.id - a.id);
  const latestPreviousRound = sortedPreviousRounds[0];

  // ==================== GET PREVIOUS INVESTORS ====================
  let existingOptionPoolShares = 0;
  let totalPreMoneyShares = round0Shares;
  let previousInvestorsList = [];
  let previousInvestorsTotalShares = 0;
  let previousWarrantsList = [];
  let previousWarrantsTotalShares = 0;

  // ==================== GET CURRENT ROUND WARRANTS ====================
  let currentRoundWarrantsList = [];
  let currentRoundWarrantsTotalShares = 0;

  try {
    const currentRoundWarrants = await new Promise((resolve, reject) => {
      db.query(
        `SELECT w.* 
       FROM warrants w
       WHERE w.roundrecord_id = ? AND w.company_id = ?`,
        [id, company_id],
        (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        },
      );
    });

    // Parse investors list for names
    let roundInvestorsList = [];
    try {
      if (round_investments) {
        roundInvestorsList =
          typeof round_investments === "string"
            ? JSON.parse(round_investments)
            : round_investments;
      }
    } catch (e) {
      console.error("Error parsing round_investments:", e);
    }

    currentRoundWarrants.forEach((warrant, index) => {
      let investorName = "Warrant Holder";
      let investorEmail = "";
      let investorPhone = "";
      let investorFirstName = "";
      let investorLastName = "";

      // Try to get from round_investments first
      if (roundInvestorsList && roundInvestorsList.length > 0) {
        const investor = roundInvestorsList[0];
        investorFirstName = "Warrant Holder";
        investorLastName = "";
        investorName = "Warrant Holder";
        investorEmail = "";
        investorPhone = "";
      }

      // If still empty, use warrant table data (if stored)
      if (!investorName || investorName === "Warrant Holder") {
        // Check if warrant table has investor details stored
        investorFirstName = "";
        investorLastName = "";
        investorName = "Warrant Holder";
        investorEmail = "";
        investorPhone = "";
      }

      currentRoundWarrantsList.push({
        type: "warrant",
        name: investorName,
        investor_details: {
          firstName: investorFirstName,
          lastName: investorLastName,
          email: investorEmail,
          phone: investorPhone,
        },
        shares: warrant.shares || 0,
        investor_type: "warrant not exercised",
        investment: 0,
        share_price: 0,
        share_class_type: null,
        instrument_type: null,
        round_name: currentRound?.nameOfRound || "",
        round_id: id,
        warrant_id: warrant.id,
        is_previous: false,
      });
    });

    currentRoundWarrantsTotalShares = currentRoundWarrantsList.reduce(
      (sum, warrant) => sum + (warrant.shares || 0),
      0,
    );
  } catch (error) {
    console.error("❌ Error fetching current round warrants:", error);
  }

  if (latestPreviousRound) {
    const round = latestPreviousRound;
    existingOptionPoolShares =
      parseInt(round.total_option_pool) ||
      parseInt(round.option_pool_shares) ||
      0;
    totalPreMoneyShares = parseInt(round.total_shares_after) || round0Shares;

    const allPreviousInvestorRounds = previousRounds.filter(
      (r) =>
        r.instrumentType === "Preferred Equity" ||
        r.instrumentType === "Common Stock" ||
        r.instrumentType === "Safe" ||
        r.instrumentType === "Convertible Note",
    );

    for (const prevRound of allPreviousInvestorRounds) {
      const roundInvestors = await new Promise((resolve, reject) => {
        db.query(
          `SELECT ri.*, w.id as warrant_id 
           FROM round_investors ri
           LEFT JOIN warrants w ON w.id = ri.warrant_id
           WHERE ri.round_id = ? AND ri.company_id = ? AND ri.cap_table_type = 'post' 
           AND (ri.investor_type = 'current' OR ri.investor_type = 'converted' or ri.investor_type = 'previous' or ri.investor_type = 'warrant' or ri.investor_type = 'warrant not exercised')
           ORDER BY ri.id ASC`,
          [prevRound.id, company_id],
          (err, results) => {
            if (err) reject(err);
            else resolve(results || []);
          },
        );
      });

      roundInvestors.forEach((inv) => {
        if (
          inv.investor_type === "warrant" ||
          inv.investor_type === "warrant not exercised"
        ) {
          previousWarrantsList.push({
            type: "warrant",
            name: `${inv.first_name || ""} ${inv.last_name || ""}`.trim(),
            investor_details: {
              firstName: inv.first_name || "",
              lastName: inv.last_name || "",
              email: inv.email || "",
              phone: inv.phone || "",
            },
            shares: inv.shares,
            investor_type: inv.investor_type,
            investment: parseFloat(inv.investment_amount || 0),
            share_price: parseFloat(inv.share_price || 0),
            share_class_type: inv.share_class_type,
            instrument_type: inv.instrument_type,
            round_name: inv.round_name,
            round_id: prevRound.id,
            warrant_id: inv.warrant_id,
            is_previous: true,
          });
        } else {
          previousInvestorsList.push({
            type: "investor",
            name: `${inv.first_name || ""} ${inv.last_name || ""}`.trim(),
            investor_details: {
              firstName: inv.first_name || "",
              lastName: inv.last_name || "",
              email: inv.email || "",
              phone: inv.phone || "",
            },
            shares: inv.shares,
            investor_type: inv.investor_type,
            investment: parseFloat(inv.investment_amount || 0),
            share_price: parseFloat(inv.share_price || 0),
            share_class_type: inv.share_class_type,
            instrument_type: inv.instrument_type,
            round_name: inv.round_name,
            round_id: prevRound.id,
            is_previous: true,
          });
        }
      });
    }

    previousInvestorsTotalShares = previousInvestorsList.reduce(
      (sum, inv) => sum + (inv.shares || 0),
      0,
    );
    previousWarrantsTotalShares = previousWarrantsList.reduce(
      (sum, warrant) => sum + (warrant.shares || 0),
      0,
    );
  }

  // ==================== CHECK IF FIRST INVESTMENT ROUND ====================
  const isFirstInvestmentRound =
    !latestPreviousRound || latestPreviousRound?.round_type === "Round 0";

  // ==================== STEP 1: PRE-MONEY TOTAL SHARES ====================
  let preMoneyTotalShares;
  let optionPoolShares;

  if (isFirstInvestmentRound) {
    optionPoolShares = Math.round(
      (round0Shares / (1 - optionPoolPercent / 100)) *
        (optionPoolPercent / 100),
    );
    preMoneyTotalShares =
      round0Shares + optionPoolShares + previousWarrantsTotalShares;
  } else {
    optionPoolShares = 0;
    preMoneyTotalShares = totalPreMoneyShares + previousWarrantsTotalShares;
  }

  // ==================== STEP 2: SHARE PRICE ====================
  const sharePrice = preMoneyVal / preMoneyTotalShares;

  // ==================== STEP 3: CONVERSION PRICE ====================
  const discountedPrice = sharePrice * (1 - discountRate / 100);
  const capPrice = valuationCap > 0 ? valuationCap / preMoneyTotalShares : "";
  const conversionPrice = Math.min(discountedPrice, capPrice);

  // ==================== STEP 4: POST-MONEY ====================
  const postMoneyValuation = preMoneyVal + roundSizeVal;
  const postMoneyTotalShares =
    preMoneyTotalShares + currentRoundWarrantsTotalShares; // ✅ Add current round warrants

  const totalOptionPoolShares =
    existingOptionPoolShares + (isFirstInvestmentRound ? optionPoolShares : 0);
  const newOptionPoolShares = isFirstInvestmentRound ? optionPoolShares : 0;

  const investorPostMoneyOwnership = (roundSizeVal / postMoneyValuation) * 100;

  // ==================== STEP 5: PER INVESTOR PENDING INSTRUMENTS ====================
  const pendingInstruments = investorsList.map((inv, index) => {
    const principal = parseFloat(inv.amount) || roundSizeVal;
    const potentialShares =
      conversionPrice > 0 ? Math.round(principal / conversionPrice) : 0;

    return {
      type: "pending",
      name:
        `${inv.firstName || ""} ${inv.lastName || ""}`.trim() ||
        inv.name ||
        `SAFE Investor ${index + 1}`,
      instrument_type: "Safe",
      shares: 0,
      new_shares: 0,
      existing_shares: 0,
      total: 0,
      principal,
      potential_shares: potentialShares,
      conversion_price: conversionPrice,
      discount_rate: discountRate,
      valuation_cap: valuationCap,
      investment: principal,
      investment_amount: principal,
      percentage: 0,
      percentage_formatted: "0.00%",
      value: 0,
      value_formatted: "0.00",
      is_pending: true,
      round_id: id,
      round_name: currentRound?.nameOfRound || "",
      shareClassType: currentRound?.shareClassType || "Safe",
      roundId: currentRound?.id,
      instrument_type: "Safe",
      investor_details: {
        firstName: inv.firstName || "",
        lastName: inv.lastName || "",
        email: inv.email || "",
        phone: inv.phone || "",
      },
      email: inv.email || "",
      phone: inv.phone || "",
    };
  });

  if (pendingInstruments.length === 0) {
    const potentialShares =
      conversionPrice > 0 ? Math.round(roundSizeVal / conversionPrice) : 0;
    pendingInstruments.push({
      type: "pending",
      name: currentRound?.nameOfRound || "SAFE Investor",
      instrument_type: "Safe",
      shares: 0,
      new_shares: 0,
      existing_shares: 0,
      total: 0,
      principal: roundSizeVal,
      potential_shares: potentialShares,
      conversion_price: conversionPrice,
      discount_rate: discountRate,
      valuation_cap: valuationCap,
      investment: roundSizeVal,
      investment_amount: roundSizeVal,
      percentage: 0,
      percentage_formatted: "0.00%",
      value: 0,
      value_formatted: "0.00",
      is_pending: true,
      round_id: latestPreviousRound?.id,
      shareClassType: currentRound?.shareClassType || "Safe",
      round_name: currentRound?.nameOfRound || "",
      roundId: currentRound?.id,
      investor_details: {
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
      },
    });
  }

  const conversionShares = pendingInstruments.reduce(
    (sum, inv) => sum + (inv.potential_shares || 0),
    0,
  );

  // ==================== GET ALL PREVIOUS PENDING SAFEs / NOTES ====================
  let previousPendingSafes = [];

  const allPreviousPendingRounds = [...previousRounds]
    .filter(
      (r) =>
        r.instrumentType === "Safe" || r.instrumentType === "Convertible Note",
    )
    .sort((a, b) => a.id - b.id);

  if (
    latestPreviousRound &&
    (latestPreviousRound.instrumentType === "Safe" ||
      latestPreviousRound.instrumentType === "Convertible Note")
  ) {
    try {
      const pendingRows = await new Promise((resolve, reject) => {
        db.query(
          `SELECT ri.*,
                r.nameOfRound    AS round_name_ref,
                r.instrumentType AS round_instrument_type,
                r.shareClassType AS round_share_class_type
         FROM round_investors ri
         LEFT JOIN roundrecord r ON r.id = ri.round_id
         WHERE ri.company_id     = ?
           AND ri.round_id       = ?
           AND ri.investor_type  = 'pending'
           AND ri.is_pending     = 1
           AND ri.cap_table_type = 'post'
         ORDER BY ri.id ASC`,
          [company_id, latestPreviousRound.id],
          (err, results) => {
            if (err) reject(err);
            else resolve(results || []);
          },
        );
      });

      pendingRows.forEach((row) => {
        const inv =
          typeof row.investor_details === "string"
            ? JSON.parse(row.investor_details || "{}")
            : row.investor_details || {};

        previousPendingSafes.push({
          type: "pending",
          name:
            `${row.first_name || ""} ${row.last_name || ""}`.trim() ||
            inv.firstName ||
            "Pending Investor",
          instrument_type:
            row.instrument_type || latestPreviousRound.instrumentType,
          shares: 0,
          new_shares: 0,
          existing_shares: 0,
          total: 0,
          potential_shares: parseInt(row.potential_shares) || 0,
          investment: parseFloat(row.investment_amount) || 0,
          investment_amount: parseFloat(row.investment_amount) || 0,
          principal: parseFloat(row.investment_amount) || 0,
          interest_accrued: parseFloat(row.interest_accrued) || 0,
          total_conversion_amount:
            parseFloat(row.total_conversion_amount) ||
            parseFloat(row.investment_amount) ||
            0,
          conversion_price: parseFloat(row.conversion_price) || 0,
          discount_rate: parseFloat(row.discount_rate) || 0,
          valuation_cap: parseFloat(row.valuation_cap) || 0,
          interest_rate: parseFloat(row.interest_rate) || 0,
          years: parseFloat(row.years) || 0,
          maturity_date: row.maturity_date || "",
          percentage: 0,
          percentage_formatted: "0.00%",
          value: 0,
          value_formatted: "0.00",
          is_pending: true,
          is_converted: false,
          round_id: row.round_id,
          shareClassType:
            row.round_share_class_type ||
            row.share_class_type ||
            row.instrument_type ||
            latestPreviousRound.instrumentType ||
            "",
          instrument_type:
            row.instrument_type || latestPreviousRound.instrumentType || "",
          round_name:
            row.round_name_ref || latestPreviousRound.nameOfRound || "",
          pending_instrument_id: row.id,
          investor_details: {
            firstName: row.first_name || inv.firstName || "",
            lastName: row.last_name || inv.lastName || "",
            email: row.email || inv.email || "",
            phone: row.phone || inv.phone || "",
          },
          email: row.email || inv.email || "",
          phone: row.phone || inv.phone || "",
        });
      });
    } catch (error) {
      console.error("❌ Error fetching pending instruments:", error);
      previousPendingSafes = [];
    }
  }

  const allPendingInstruments = [
    ...previousPendingSafes,
    ...pendingInstruments,
  ];

  const currency = currentRound?.currency || "";

  // ==================== HELPER FUNCTIONS ====================
  const buildFounderItem = (f, totalShares, valuation, cur) => {
    const ownership = f.shares / totalShares;
    const rawPercentage = ownership * 100;
    return {
      type: "founder",
      name: f.name,
      shares: f.shares,
      new_shares: 0,
      existing_shares: f.shares,
      total: f.shares,
      email: f.email,
      phone: f.phone,
      founder_code: f.founder_code,
      percentage: rawPercentage.toFixed(2) + "%",
      percentage_formatted: rawPercentage.toFixed(2) + "%",
      value: parseFloat(((rawPercentage * valuation) / 100).toFixed(2)),
      value_formatted: `${cur} ${((rawPercentage * valuation) / 100).toFixed(2)}`,
      shareClassType: f.shareClassType || "",
      instrumentType: f.instrumentType || "",
      roundName: round0Name,
      round_id: f.round_id || null,
      is_option_pool: false,
      is_previous: false,
      is_converted: false,
    };
  };

  const buildOptionPoolItem = (
    optShares,
    totalShares,
    valuation,
    cur,
    newShares,
    existingShares,
  ) => {
    const pct = (optShares / totalShares) * 100;
    return {
      type: "option_pool",
      founder_code: "O",
      name: "Employee Option Pool",
      label: "Options Pool",
      shares: optShares,
      new_shares: newShares,
      existing_shares: existingShares,
      total: optShares,
      is_option_pool: true,
      percentage: pct.toFixed(2) + "%",
      percentage_formatted: pct.toFixed(2) + "%",
      value: parseFloat(((pct * valuation) / 100).toFixed(2)),
      value_formatted: `${cur} ${((pct * valuation) / 100).toFixed(2)}`,
      shareClassType: "Option Pool",
      instrumentType: "Options",
      roundName: "Option Pool",
    };
  };

  const buildPrevInvestorItem = (inv, totalShares, valuation, cur) => {
    const ownership = inv.shares / totalShares;
    const rawPercentage = ownership * 100;
    let investorType = "previous";
    if (inv.investor_type === "warrant") {
      investorType = "warrant";
    } else if (inv.investor_type === "warrant not exercised") {
      investorType = "warrant not exercised";
    }
    return {
      type: "investor",
      name: inv.name,
      investor_details: inv.investor_details,
      shares: inv.shares,
      new_shares: 0,
      existing_shares: inv.shares,
      total: inv.shares,
      email: inv.investor_details?.email || inv.email || "",
      phone: inv.investor_details?.phone || inv.phone || "",
      percentage: rawPercentage.toFixed(2) + "%",
      percentage_formatted: rawPercentage.toFixed(2) + "%",
      value: parseFloat(((rawPercentage * valuation) / 100).toFixed(2)),
      value_formatted: `${cur} ${((rawPercentage * valuation) / 100).toFixed(2)}`,
      investment: inv.investment,
      investment_amount: inv.investment,
      share_price: inv.share_price,
      is_previous: true,
      is_new_investment: false,
      is_converted: false,
      investor_type: investorType,
      share_class_type: inv.share_class_type,
      instrument_type: inv.instrument_type,
      round_name: inv.round_name,
      round_id: inv.round_id,
    };
  };

  const buildWarrantItem = (warrant, totalShares, valuation, cur) => {
    const ownership = warrant.shares / totalShares;
    const rawPercentage = ownership * 100;
    let investorType = "warrant";
    if (warrant.investor_type === "warrant not exercised") {
      investorType = "warrant not exercised";
    }
    return {
      type: "investor",
      name: warrant.name,
      investor_details: warrant.investor_details,
      shares: warrant.shares,
      new_shares: warrant.shares,
      existing_shares: 0,
      total: warrant.shares,
      email: warrant.investor_details?.email || "",
      phone: warrant.investor_details?.phone || "",
      percentage: rawPercentage.toFixed(2) + "%",
      percentage_formatted: rawPercentage.toFixed(2) + "%",
      value: parseFloat(((rawPercentage * valuation) / 100).toFixed(2)),
      value_formatted: `${cur} ${((rawPercentage * valuation) / 100).toFixed(2)}`,
      investment: warrant.investment,
      investment_amount: warrant.investment,
      share_price: warrant.share_price,
      is_previous: false,
      is_warrant: true,
      is_new_investment: true,
      is_converted: false,
      investor_type: investorType,
      share_class_type: warrant.share_class_type,
      instrument_type: warrant.instrument_type,
      round_name: warrant.round_name,
      round_id: warrant.round_id,
      warrant_id: warrant.warrant_id,
    };
  };

  // ==================== PRE-MONEY CAP TABLE ====================
  let previousRoundPostCapTable = null;
  if (latestPreviousRound) {
    try {
      const prevRoundData = await new Promise((resolve, reject) => {
        db.query(
          `SELECT post_money_cap_table FROM roundrecord WHERE id = ? AND company_id = ?`,
          [latestPreviousRound.id, company_id],
          (err, results) => {
            if (err) reject(err);
            else resolve(results?.[0] || null);
          },
        );
      });

      if (prevRoundData?.post_money_cap_table) {
        previousRoundPostCapTable =
          typeof prevRoundData.post_money_cap_table === "string"
            ? JSON.parse(prevRoundData.post_money_cap_table)
            : prevRoundData.post_money_cap_table;
      }
    } catch (error) {
      console.error("❌ Error fetching previous round post cap table:", error);
    }
  }

  const preMoneyCapTable = previousRoundPostCapTable
    ? {
        ...previousRoundPostCapTable,
        pending_instruments: previousPendingSafes,
        items: [
          ...(previousRoundPostCapTable.items || []).filter(
            (item) => !item.is_pending,
          ),

          ...previousPendingSafes,
        ],
      }
    : {
        total_shares: preMoneyTotalShares,
        pre_money_valuation: preMoneyVal,
        currency,
        share_price: sharePrice.toFixed(4),
        pending_instruments: previousPendingSafes,

        founders: {
          list: founderList.map((f) => {
            const ownership = f.shares / preMoneyTotalShares;
            const rawPercentage = ownership * 100;
            return {
              ...f,
              roundName: round0Name,
              share_class_type: round0Shareclassstype,
              percentage: rawPercentage.toFixed(2) + "%",
              value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
            };
          }),
          total_shares: round0Shares,
          total_percentage:
            ((round0Shares / preMoneyTotalShares) * 100).toFixed(2) + "%",
          total_value: (
            ((round0Shares / preMoneyTotalShares) * 100 * preMoneyVal) /
            100
          ).toFixed(2),
          roundName: round0Name,
          share_class_type: round0Shareclassstype,
        },

        option_pool: {
          shares: totalOptionPoolShares,
          existing_shares: existingOptionPoolShares,
          new_shares: newOptionPoolShares,
          total: totalOptionPoolShares,
          percentage:
            ((totalOptionPoolShares / preMoneyTotalShares) * 100).toFixed(2) +
            "%",
          value: (
            ((totalOptionPoolShares / preMoneyTotalShares) *
              100 *
              preMoneyVal) /
            100
          ).toFixed(2),
          shareClassType: "Option Pool",
          instrumentType: "Options",
          roundName: "Option Pool",
          is_option_pool: true,
        },

        previous_investors:
          previousInvestorsList.length > 0
            ? {
                name: "Previous Investors",
                total_shares: previousInvestorsTotalShares,
                percentage:
                  (
                    (previousInvestorsTotalShares / preMoneyTotalShares) *
                    100
                  ).toFixed(2) + "%",
                total_value: (
                  ((previousInvestorsTotalShares / preMoneyTotalShares) *
                    100 *
                    preMoneyVal) /
                  100
                ).toFixed(2),
                items: previousInvestorsList.map((inv) => {
                  const ownership = inv.shares / preMoneyTotalShares;
                  const rawPercentage = ownership * 100;
                  return {
                    ...inv,
                    percentage: rawPercentage.toFixed(2) + "%",
                    value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
                  };
                }),
                is_grouped: false,
              }
            : null,

        converted: null,

        items: [
          ...founderList.map((f) =>
            buildFounderItem(f, preMoneyTotalShares, preMoneyVal, currency),
          ),
          buildOptionPoolItem(
            totalOptionPoolShares,
            preMoneyTotalShares,
            preMoneyVal,
            currency,
            newOptionPoolShares,
            existingOptionPoolShares,
          ),
          ...previousInvestorsList.map((inv) =>
            buildPrevInvestorItem(
              inv,
              preMoneyTotalShares,
              preMoneyVal,
              currency,
            ),
          ),
          ...previousWarrantsList.map((w) =>
            buildWarrantItem(w, preMoneyTotalShares, preMoneyVal, currency),
          ),
          ...previousPendingSafes,
        ],
      };

  // ==================== POST-MONEY CAP TABLE ====================
  const postMoneyCapTable = {
    total_shares: postMoneyTotalShares,
    post_money_valuation: preMoneyVal,
    currency,
    share_price: sharePrice.toFixed(4),
    pending_instruments: allPendingInstruments,

    founders: {
      list: founderList.map((f) => {
        const ownership = f.shares / postMoneyTotalShares;
        const rawPercentage = ownership * 100;
        return {
          ...f,
          roundName: currentRound?.nameOfRound,
          share_class_type: round0Shareclassstype,
          shares: f.shares,
          new_shares: 0,
          total: f.shares,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
          shareClassType: f.shareClassType || "",
          instrumentType: f.instrumentType || "",
          round_id: round0?.id || null,
        };
      }),
      total_shares: round0Shares,
      total_percentage:
        ((round0Shares / postMoneyTotalShares) * 100).toFixed(2) + "%",
      total_value: (
        ((round0Shares / postMoneyTotalShares) * 100 * preMoneyVal) /
        100
      ).toFixed(2),
    },

    option_pool: {
      shares: totalOptionPoolShares,
      existing_shares: totalOptionPoolShares,
      new_shares: 0,
      total: totalOptionPoolShares,
      percentage:
        ((totalOptionPoolShares / postMoneyTotalShares) * 100).toFixed(2) + "%",
      value: (
        ((totalOptionPoolShares / postMoneyTotalShares) * 100 * preMoneyVal) /
        100
      ).toFixed(2),
      shareClassType: "Option Pool",
      instrumentType: "Options",
      roundName: "Option Pool",
      is_option_pool: true,
    },

    previous_investors:
      previousInvestorsList.length > 0
        ? {
            name: "Previous Investors",
            total_shares: previousInvestorsTotalShares,
            new_shares: 0,
            total: previousInvestorsTotalShares,
            percentage:
              (
                (previousInvestorsTotalShares / postMoneyTotalShares) *
                100
              ).toFixed(2) + "%",
            total_value: (
              ((previousInvestorsTotalShares / postMoneyTotalShares) *
                100 *
                preMoneyVal) /
              100
            ).toFixed(2),
            items: previousInvestorsList.map((inv) => {
              const ownership = inv.shares / postMoneyTotalShares;
              const rawPercentage = ownership * 100;
              return {
                ...inv,
                existing_shares: inv.shares,
                new_shares: 0,
                total: inv.shares,
                percentage: rawPercentage.toFixed(2) + "%",
                value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
              };
            }),
            is_grouped: false,
          }
        : null,

    investors: {
      name: "SAFE Investors",
      shares: 0,
      new_shares: 0,
      total: 0,
      percentage: "0.00%",
      value: "0.00",
      investment: roundSizeVal,
      shareClassType: currentRound?.shareClassType || "Safe",
      instrumentType: "Safe",
      roundName: currentRound?.nameOfRound || "SAFE Round",
      roundId: currentRound?.id,
      items: [],
    },

    converted_investors: null,

    // ✅ Add current round warrants to items
    warrants:
      currentRoundWarrantsList.length > 0
        ? {
            name: "Warrants",
            total_shares: currentRoundWarrantsTotalShares,
            new_shares: currentRoundWarrantsTotalShares,
            total: currentRoundWarrantsTotalShares,
            percentage:
              (
                (currentRoundWarrantsTotalShares / postMoneyTotalShares) *
                100
              ).toFixed(2) + "%",
            total_value: (
              ((currentRoundWarrantsTotalShares / postMoneyTotalShares) *
                100 *
                preMoneyVal) /
              100
            ).toFixed(2),
            items: currentRoundWarrantsList.map((w) =>
              buildWarrantItem(w, postMoneyTotalShares, preMoneyVal, currency),
            ),
            is_grouped: true,
          }
        : null,

    items: [
      ...founderList.map((f) => ({
        ...buildFounderItem(f, postMoneyTotalShares, preMoneyVal, currency),
        roundName: "Round 0",
        roundId: round0?.id || null,
        round_id: round0?.id || null,
      })),
      buildOptionPoolItem(
        totalOptionPoolShares,
        postMoneyTotalShares,
        preMoneyVal,
        currency,
        0,
        totalOptionPoolShares,
      ),
      ...previousInvestorsList.map((inv) =>
        buildPrevInvestorItem(inv, postMoneyTotalShares, preMoneyVal, currency),
      ),
      ...previousWarrantsList.map((w) =>
        buildWarrantItem(w, postMoneyTotalShares, preMoneyVal, currency),
      ),
      // ✅ Add current round warrants
      ...currentRoundWarrantsList.map((w) =>
        buildWarrantItem(w, postMoneyTotalShares, preMoneyVal, currency),
      ),
      ...allPendingInstruments,
    ],
  };

  // ==================== DATABASE UPDATE ====================
  const dbUpdateData = {
    share_price: sharePrice.toFixed(4),
    issuedshares: "0",
    investorPostMoney: investorPostMoneyOwnership.toFixed(2),
    pre_money: preMoneyVal.toString(),
    post_money: postMoneyValuation.toString(),
    roundsize: roundSizeVal.toString(),
    conversion_shares: conversionShares.toString(),
    total_converted_shares: "0",
    option_pool_shares: totalOptionPoolShares.toString(),
    option_pool_percentage: optionPoolPercent.toFixed(2),
    total_shares_before: preMoneyTotalShares.toString(),
    total_shares_after: postMoneyTotalShares.toString(),
    total_option_pool: totalOptionPoolShares.toString(),
    pre_money_cap_table: JSON.stringify(preMoneyCapTable),
    post_money_cap_table: JSON.stringify(postMoneyCapTable),
    updated_at: new Date(),
  };

  try {
    await updateRoundCalculationsSafeConvertibleNote({
      id,
      new_investor_shares: 0,
      conversion_price: conversionPrice || 0,
      conversion_shares: conversionShares || 0,
      option_pool_shares: totalOptionPoolShares,
      share_price: sharePrice,
      total_shares_before: preMoneyTotalShares,
      total_shares_after: postMoneyTotalShares,
      total_converted_shares: 0,
      instrumentType: "Safe",
      roundSize: roundSizeVal,
      preMoney: preMoneyVal,
      pre_money_cap_table: JSON.stringify(preMoneyCapTable),
      post_money_cap_table: JSON.stringify(postMoneyCapTable),
    });

    await saveCapTableData(
      "unprice",
      id,
      company_id,
      preMoneyCapTable,
      postMoneyCapTable,
      preMoneyTotalShares,
      postMoneyTotalShares,
      preMoneyVal,
      postMoneyValuation,
    );

    return {
      success: true,
      data: dbUpdateData,
      roundId: id,
      pre_money_cap_table: preMoneyCapTable,
      post_money_cap_table: postMoneyCapTable,
    };
  } catch (error) {
    console.error("❌ DATABASE ERROR:", error);
    return { success: false, error: error.message };
  }
}

function updateRoundCalculationsSafeConvertibleNote(params) {
  const {
    id,
    new_investor_shares,
    conversion_price,
    conversion_shares,
    option_pool_shares,
    share_price,
    total_shares_before,
    total_shares_after,
    total_converted_shares,
    instrumentType,
    roundSize,
    preMoney,
    pre_money_cap_table,
    post_money_cap_table,
  } = params;

  // ==================== VALIDATE INPUTS ====================
  if (!id) {
    console.error("❌ Round ID is required");
    return;
  }

  // ==================== SIMPLE UPDATE QUERY ====================
  const updateQuery = `
    UPDATE roundrecord 
    SET 
      share_price = ?,
      issuedshares = ?,
      conversion_price = ?,
      conversion_shares = ?,
      option_pool_shares = ?,
      total_shares_before = ?,
      total_shares_after = ?,
      total_converted_shares = ?,
      roundsize = ?,
      pre_money = ?,
      post_money = ?,
      pre_money_cap_table = ?,
      post_money_cap_table = ?,
      updated_at = ?
    WHERE id = ?
  `;

  const updateValues = [
    parseFloat(share_price).toFixed(4), // share_price
    (parseInt(new_investor_shares) || 0).toString(), // issuedshares
    parseFloat(conversion_price || 0).toFixed(4), // conversion_price
    (parseInt(conversion_shares) || 0).toString(), // conversion_shares
    (parseInt(option_pool_shares) || 0).toString(), // option_pool_shares
    (parseInt(total_shares_before) || 0).toString(), // total_shares_before
    (parseInt(total_shares_after) || 0).toString(), // total_shares_after
    (parseInt(total_converted_shares) || 0).toString(), // total_converted_shares
    roundSize ? parseFloat(roundSize).toString() : "0", // roundsize
    preMoney ? parseFloat(preMoney).toString() : "0", // pre_money
    preMoney && roundSize // post_money
      ? (parseFloat(preMoney) + parseFloat(roundSize)).toString()
      : "0",
    pre_money_cap_table,
    post_money_cap_table,
    new Date(), // updated_at
    id, // WHERE id = ?
  ];

  db.query(updateQuery, updateValues, (updateErr, result) => {
    if (updateErr) {
      console.error(`❌ Error updating round ${id}:`, updateErr);
    } else {
    }
  });
}
// 4. CONVERTIBLE NOTE HANDLER
async function handleConvertibleNoteCalculation(params) {
  const {
    id,
    company_id,
    preMoney,
    roundSize,
    optionPoolPercentValue,
    total_shares_before,
    instrumentData,
    isUpdate,
    currentRound,
    round_investments,
  } = params;

  // ==================== PARSE INSTRUMENT DATA ====================
  let parsedInstrumentData = {};
  if (instrumentData) {
    if (typeof instrumentData === "string") {
      try {
        parsedInstrumentData = JSON.parse(instrumentData);
      } catch (e) {
        console.error("Error parsing instrumentData:", e);
      }
    } else if (typeof instrumentData === "object") {
      parsedInstrumentData = instrumentData;
    }
  }

  // ==================== EXTRACT CONVERTIBLE NOTE TERMS ====================
  const discountRate = parseFloat(parsedInstrumentData.discountRate_note) || 0;
  const valuationCap = parseFloat(parsedInstrumentData.valuationCap_note) || 0;
  const interestRate = parseFloat(parsedInstrumentData.interestRate_note) || 0;
  const maturityDate =
    parsedInstrumentData.maturityDate_note ||
    parsedInstrumentData.maturityDate ||
    "";

  // ==================== CALCULATE YEARS ====================
  let years = 0;
  if (maturityDate) {
    const issueDate = new Date();
    const maturity = new Date(maturityDate);
    const msPerYear = 1000 * 60 * 60 * 24 * 365.25;
    years = Math.max(0, (maturity - issueDate) / msPerYear);
  } else {
    years =
      parseFloat(
        parsedInstrumentData.years_to_conversion ||
          parsedInstrumentData.yearsToConversion ||
          parsedInstrumentData.years,
      ) || 1;
  }

  // ==================== VALIDATE INPUTS ====================
  const preMoneyVal = parseFloat(preMoney) || 0;
  const roundSizeVal = parseFloat(roundSize) || 0;
  const optionPoolPercent = parseFloat(optionPoolPercentValue) || 0;
  const round0Shares = parseInt(total_shares_before) || 0;

  // ==================== PARSE INVESTORS LIST ====================
  let investorsList = [];
  try {
    if (round_investments) {
      investorsList =
        typeof round_investments === "string"
          ? JSON.parse(round_investments)
          : round_investments;
    }
  } catch (e) {
    console.error("Error parsing round_investments:", e);
  }

  // ==================== GET FOUNDER DATA ====================
  let founderList = [];
  let round0Name = "Round 0";
  let round0Shareclassstype = "";
  let round0 = null;
  let founderData = null;
  let totalFounderShares = 0;

  try {
    const round0Data = await getFounderDataFromRound0(company_id);
    if (round0Data && round0Data.founder_data) {
      founderData = round0Data.founder_data;
      totalFounderShares = round0Data.total_founder_shares || 0;
      round0Name = round0Data.round0Name || "Round 0";
      round0Shareclassstype = round0Data.shareClassType || "";
      round0 = round0Data;

      if (founderData.founders && Array.isArray(founderData.founders)) {
        founderList = founderData.founders.map((founder, index) => ({
          name:
            `${founder.firstName || ""} ${founder.lastName || ""}`.trim() ||
            `Founder ${index + 1}`,
          shares: parseFloat(founder.shares) || 0,
          email: founder.email || "",
          phone: founder.phone || "",
          voting: founder.voting || "voting",
          share_type: founder.shareType || "common",
          founder_code: `F${index + 1}`,
          shareClassType:
            founder.shareClassType || round0Data.shareClassType || "",
          instrumentType:
            founder.instrumentType || round0Data.instrumentType || "",
          roundName: round0Data.nameOfRound || "Round 0",
          roundId: round0Data.id || null,
          round_id: round0Data.id || null,
          investment: founder.investment || 0,
          share_price: founder.share_price || 0,
          original_founder_data: founder,
        }));
      }
    }
  } catch (error) {
    console.error("❌ Error fetching founder data:", error);
  }

  // ==================== GET PREVIOUS ROUNDS ====================
  const previousRounds = await getPreviousRoundsForCompany(company_id, id);
  const sortedPreviousRounds = [...previousRounds].sort((a, b) => b.id - a.id);
  const latestPreviousRound = sortedPreviousRounds[0];

  // ==================== GET PREVIOUS INVESTORS ====================
  let existingOptionPoolShares = 0;
  let totalPreMoneyShares = round0Shares;
  let previousInvestorsList = [];
  let previousInvestorsTotalShares = 0;
  let previousWarrantsList = [];
  let previousWarrantsTotalShares = 0;

  // ==================== GET CURRENT ROUND WARRANTS ====================
  let currentRoundWarrantsList = [];
  let currentRoundWarrantsTotalShares = 0;

  try {
    const currentRoundWarrants = await new Promise((resolve, reject) => {
      db.query(
        `SELECT w.* 
       FROM warrants w
       WHERE w.roundrecord_id = ? AND w.company_id = ?`,
        [id, company_id],
        (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        },
      );
    });

    // Parse investors list for names
    let roundInvestorsList = [];
    try {
      if (round_investments) {
        roundInvestorsList =
          typeof round_investments === "string"
            ? JSON.parse(round_investments)
            : round_investments;
      }
    } catch (e) {
      console.error("Error parsing round_investments:", e);
    }

    currentRoundWarrants.forEach((warrant, index) => {
      let investorName = "Warrant Holder";
      let investorEmail = "";
      let investorPhone = "";
      let investorFirstName = "";
      let investorLastName = "";

      // Try to get from round_investments first
      if (roundInvestorsList && roundInvestorsList.length > 0) {
        const investor = roundInvestorsList[0];
        investorFirstName = "Warrant Holder";
        investorLastName = "";
        investorName = "Warrant Holder";
        investorEmail = "";
        investorPhone = "";
      }

      // If still empty, use warrant table data (if stored)
      if (!investorName || investorName === "Warrant Holder") {
        // Check if warrant table has investor details stored
        investorFirstName = "";
        investorLastName = "";
        investorName = "Warrant Holder";
        investorEmail = "";
        investorPhone = "";
      }

      currentRoundWarrantsList.push({
        type: "warrant",
        name: investorName,
        investor_details: {
          firstName: investorFirstName,
          lastName: investorLastName,
          email: investorEmail,
          phone: investorPhone,
        },
        shares: warrant.shares || 0,
        investor_type: "warrant not exercised",
        investment: 0,
        share_price: 0,
        share_class_type: null,
        instrument_type: null,
        round_name: currentRound?.nameOfRound || "",
        round_id: id,
        warrant_id: warrant.id,
        is_previous: false,
      });
    });

    currentRoundWarrantsTotalShares = currentRoundWarrantsList.reduce(
      (sum, warrant) => sum + (warrant.shares || 0),
      0,
    );
  } catch (error) {
    console.error("❌ Error fetching current round warrants:", error);
  }

  if (latestPreviousRound) {
    const round = latestPreviousRound;
    existingOptionPoolShares =
      parseInt(round.total_option_pool) ||
      parseInt(round.option_pool_shares) ||
      0;
    totalPreMoneyShares = parseInt(round.total_shares_after) || round0Shares;

    const allPreviousInvestorRounds = previousRounds.filter(
      (r) =>
        r.instrumentType === "Preferred Equity" ||
        r.instrumentType === "Common Stock" ||
        r.instrumentType === "Safe" ||
        r.instrumentType === "Convertible Note",
    );

    for (const prevRound of allPreviousInvestorRounds) {
      const roundInvestors = await new Promise((resolve, reject) => {
        db.query(
          `SELECT * FROM round_investors 
           WHERE round_id = ? AND company_id = ? AND cap_table_type = 'post' 
           AND (investor_type = 'current' OR investor_type = 'converted' or investor_type = 'previous' or investor_type = 'warrant' or investor_type = 'warrant not exercised')
           ORDER BY id ASC`,
          [prevRound.id, company_id],
          (err, results) => {
            if (err) reject(err);
            else resolve(results || []);
          },
        );
      });

      roundInvestors.forEach((inv) => {
        if (
          inv.investor_type === "warrant" ||
          inv.investor_type === "warrant not exercised"
        ) {
          previousWarrantsList.push({
            type: "warrant",
            name: `${inv.first_name || ""} ${inv.last_name || ""}`.trim(),
            investor_details: {
              firstName: inv.first_name || "",
              lastName: inv.last_name || "",
              email: inv.email || "",
              phone: inv.phone || "",
            },
            shares: inv.shares,
            investor_type: inv.investor_type,
            investment: parseFloat(inv.investment_amount || 0),
            share_price: parseFloat(inv.share_price || 0),
            share_class_type: inv.share_class_type,
            instrument_type: inv.instrument_type,
            round_name: inv.round_name,
            round_id: prevRound.id,
            warrant_id: inv.warrant_id,
            is_previous: true,
          });
        } else {
          previousInvestorsList.push({
            type: "investor",
            name: `${inv.first_name || ""} ${inv.last_name || ""}`.trim(),
            investor_details: {
              firstName: inv.first_name || "",
              lastName: inv.last_name || "",
              email: inv.email || "",
              phone: inv.phone || "",
            },
            shares: inv.shares,
            investor_type: inv.investor_type,
            investment: parseFloat(inv.investment_amount || 0),
            share_price: parseFloat(inv.share_price || 0),
            share_class_type: inv.share_class_type,
            instrument_type: inv.instrument_type,
            round_name: inv.round_name,
            round_id: prevRound.id,
            is_previous: true,
            warrant_id: inv.warrant_id,
          });
        }
      });
    }

    previousInvestorsTotalShares = previousInvestorsList.reduce(
      (sum, inv) => sum + (inv.shares || 0),
      0,
    );
    previousWarrantsTotalShares = previousWarrantsList.reduce(
      (sum, warrant) => sum + (warrant.shares || 0),
      0,
    );
  }

  // ==================== CHECK IF FIRST INVESTMENT ROUND ====================
  const isFirstInvestmentRound =
    !latestPreviousRound || latestPreviousRound?.round_type === "Round 0";

  // ==================== STEP 1: PRE-MONEY TOTAL SHARES ====================
  let preMoneyTotalShares;
  let optionPoolShares;

  if (isFirstInvestmentRound) {
    optionPoolShares = Math.round(
      (round0Shares / (1 - optionPoolPercent / 100)) *
        (optionPoolPercent / 100),
    );
    preMoneyTotalShares =
      round0Shares + optionPoolShares + previousWarrantsTotalShares;
  } else {
    optionPoolShares = 0;
    preMoneyTotalShares = totalPreMoneyShares + previousWarrantsTotalShares;
  }

  // ==================== STEP 2: SHARE PRICE ====================
  const sharePrice = preMoneyVal / preMoneyTotalShares;

  // ==================== STEP 3: CONVERSION PRICE ====================
  const discountedPrice = sharePrice * (1 - discountRate / 100);
  const capPrice = valuationCap > 0 ? valuationCap / preMoneyTotalShares : "";
  const conversionPrice = Math.min(discountedPrice, capPrice);

  // ==================== STEP 4: POST-MONEY ====================
  const postMoneyValuation = preMoneyVal;
  const postMoneyTotalShares =
    preMoneyTotalShares + currentRoundWarrantsTotalShares;

  const totalOptionPoolShares =
    existingOptionPoolShares + (isFirstInvestmentRound ? optionPoolShares : 0);
  const newOptionPoolShares = isFirstInvestmentRound ? optionPoolShares : 0;

  const investorPostMoneyOwnership = (roundSizeVal / postMoneyValuation) * 100;

  // ==================== STEP 5: PER INVESTOR PENDING INSTRUMENTS ====================
  const pendingInstruments = investorsList.map((inv, index) => {
    const principal = parseFloat(inv.amount) || roundSizeVal;

    const totalConversionAmount =
      principal * Math.pow(1 + interestRate / 100, years);
    const interestAccrued = totalConversionAmount - principal;

    const potentialShares =
      conversionPrice > 0
        ? Math.round(totalConversionAmount / conversionPrice)
        : 0;

    return {
      type: "pending",
      name:
        `${inv.firstName || ""} ${inv.lastName || ""}`.trim() ||
        inv.name ||
        `Convertible Note Investor ${index + 1}`,
      instrument_type: "Convertible Note",
      shares: 0,
      new_shares: 0,
      existing_shares: 0,
      total: 0,
      principal,
      shareClassType: currentRound?.shareClassType || "Convertible Note",
      round_name: currentRound?.nameOfRound || "",
      roundId: currentRound?.id,
      interest_rate: interestRate,
      years: parseFloat(years.toFixed(2)),
      interest_accrued: parseFloat(interestAccrued.toFixed(2)),
      total_conversion_amount: parseFloat(totalConversionAmount.toFixed(2)),
      potential_shares: potentialShares,
      conversion_price: conversionPrice,
      discount_rate: discountRate,
      valuation_cap: valuationCap,
      maturity_date: maturityDate,
      investment: principal,
      investment_amount: principal,
      percentage: 0,
      percentage_formatted: "0.00%",
      value: 0,
      value_formatted: "0.00",
      is_pending: true,
      round_id: id,
      investor_details: {
        firstName: inv.firstName || "",
        lastName: inv.lastName || "",
        email: inv.email || "",
        phone: inv.phone || "",
      },
      email: inv.email || "",
      phone: inv.phone || "",
    };
  });

  if (pendingInstruments.length === 0) {
    const principal = roundSizeVal;
    const interestAccrued = principal * (interestRate / 100) * years;
    const totalConversionAmount = principal + interestAccrued;
    const potentialShares =
      conversionPrice > 0
        ? Math.round(totalConversionAmount / conversionPrice)
        : 0;

    pendingInstruments.push({
      type: "pending",
      name: currentRound?.nameOfRound || "Convertible Note Investor",
      instrument_type: "Convertible Note",
      shares: 0,
      new_shares: 0,
      existing_shares: 0,
      total: 0,
      principal,
      interest_rate: interestRate,
      years: parseFloat(years.toFixed(2)),
      interest_accrued: parseFloat(interestAccrued.toFixed(2)),
      total_conversion_amount: parseFloat(totalConversionAmount.toFixed(2)),
      potential_shares: potentialShares,
      conversion_price: conversionPrice,
      discount_rate: discountRate,
      valuation_cap: valuationCap,
      maturity_date: maturityDate,
      investment: principal,
      investment_amount: principal,
      percentage: 0,
      percentage_formatted: "0.00%",
      value: 0,
      value_formatted: "0.00",
      is_pending: true,
      round_id: id,
      shareClassType: "",
      round_name: currentRound?.nameOfRound || "",
      roundId: currentRound?.id,
      investor_details: {
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
      },
    });
  }

  const conversionShares = pendingInstruments.reduce(
    (sum, inv) => sum + (inv.potential_shares || 0),
    0,
  );

  // ==================== GET ALL PREVIOUS PENDING SAFEs / NOTES ====================
  let previousPendingSafes = [];

  const allPreviousPendingRounds = [...previousRounds]
    .filter(
      (r) =>
        r.instrumentType === "Safe" || r.instrumentType === "Convertible Note",
    )
    .sort((a, b) => a.id - b.id);

  if (
    latestPreviousRound &&
    (latestPreviousRound.instrumentType === "Convertible Note" ||
      latestPreviousRound.instrumentType === "Safe")
  ) {
    try {
      const pendingRows = await new Promise((resolve, reject) => {
        db.query(
          `SELECT ri.*,
                r.nameOfRound    AS round_name_ref,
                r.instrumentType AS round_instrument_type,
                r.shareClassType AS round_share_class_type
         FROM round_investors ri
         LEFT JOIN roundrecord r ON r.id = ri.round_id
         WHERE ri.company_id     = ?
           AND ri.round_id       = ?
           AND ri.investor_type  = 'pending'
           AND ri.is_pending     = 1
           AND ri.cap_table_type = 'post'
         ORDER BY ri.id ASC`,
          [company_id, latestPreviousRound.id],
          (err, results) => {
            if (err) reject(err);
            else resolve(results || []);
          },
        );
      });

      pendingRows.forEach((row) => {
        const inv =
          typeof row.investor_details === "string"
            ? JSON.parse(row.investor_details || "{}")
            : row.investor_details || {};

        previousPendingSafes.push({
          type: "pending",
          name:
            `${row.first_name || ""} ${row.last_name || ""}`.trim() ||
            inv.firstName ||
            "Pending Investor",
          instrument_type:
            row.instrument_type || latestPreviousRound.instrumentType,
          shares: 0,
          new_shares: 0,
          existing_shares: 0,
          total: 0,
          potential_shares: parseInt(row.potential_shares) || 0,
          investment: parseFloat(row.investment_amount) || 0,
          investment_amount: parseFloat(row.investment_amount) || 0,
          principal: parseFloat(row.investment_amount) || 0,
          interest_accrued: parseFloat(row.interest_accrued) || 0,
          total_conversion_amount:
            parseFloat(row.total_conversion_amount) ||
            parseFloat(row.investment_amount) ||
            0,
          conversion_price: parseFloat(row.conversion_price) || 0,
          discount_rate: parseFloat(row.discount_rate) || 0,
          valuation_cap: parseFloat(row.valuation_cap) || 0,
          interest_rate: parseFloat(row.interest_rate) || 0,
          years: parseFloat(row.years) || 0,
          maturity_date: row.maturity_date || "",
          percentage: 0,
          percentage_formatted: "0.00%",
          value: 0,
          value_formatted: "0.00",
          is_pending: true,
          is_converted: false,
          shareClassType:
            row.round_share_class_type ||
            row.share_class_type ||
            row.instrument_type ||
            latestPreviousRound.instrumentType ||
            "",
          instrument_type:
            row.instrument_type || latestPreviousRound.instrumentType || "",
          round_id: row.round_id,
          round_name:
            row.round_name_ref || latestPreviousRound.nameOfRound || "",
          pending_instrument_id: row.id,
          investor_details: {
            firstName: row.first_name || inv.firstName || "",
            lastName: row.last_name || inv.lastName || "",
            email: row.email || inv.email || "",
            phone: row.phone || inv.phone || "",
          },
          email: row.email || inv.email || "",
          phone: row.phone || inv.phone || "",
        });
      });
    } catch (error) {
      console.error("❌ Error fetching pending instruments:", error);
      previousPendingSafes = [];
    }
  }

  const allPendingInstruments = [
    ...previousPendingSafes,
    ...pendingInstruments,
  ];

  const currency = currentRound?.currency || "";

  // ==================== HELPER FUNCTIONS ====================
  const buildFounderItem = (f, totalShares, valuation, cur) => {
    const ownership = f.shares / totalShares;
    const rawPercentage = ownership * 100;
    return {
      type: "founder",
      name: f.name,
      shares: f.shares,
      new_shares: 0,
      existing_shares: f.shares,
      total: f.shares,
      email: f.email,
      phone: f.phone,
      founder_code: f.founder_code,
      percentage: rawPercentage.toFixed(2) + "%",
      percentage_formatted: rawPercentage.toFixed(2) + "%",
      value: parseFloat(((rawPercentage * valuation) / 100).toFixed(2)),
      value_formatted: `${cur} ${((rawPercentage * valuation) / 100).toFixed(2)}`,
      shareClassType: f.shareClassType || "",
      instrumentType: f.instrumentType || "",
      roundName: round0Name,
      round_id: f.round_id || null,
      is_option_pool: false,
      is_previous: false,
      is_converted: false,
    };
  };

  const buildOptionPoolItem = (
    optShares,
    totalShares,
    valuation,
    cur,
    newShares,
    existingShares,
  ) => {
    const pct = (optShares / totalShares) * 100;
    return {
      type: "option_pool",
      founder_code: "O",
      name: "Employee Option Pool",
      label: "Options Pool",
      shares: optShares,
      new_shares: newShares,
      existing_shares: existingShares,
      total: optShares,
      is_option_pool: true,
      percentage: pct.toFixed(2) + "%",
      percentage_formatted: pct.toFixed(2) + "%",
      value: parseFloat(((pct * valuation) / 100).toFixed(2)),
      value_formatted: `${cur} ${((pct * valuation) / 100).toFixed(2)}`,
      shareClassType: "Option Pool",
      instrumentType: "Options",
      roundName: "Option Pool",
    };
  };

  const buildPrevInvestorItem = (inv, totalShares, valuation, cur) => {
    const ownership = inv.shares / totalShares;
    const rawPercentage = ownership * 100;
    let investorType = "previous";
    if (inv.investor_type === "warrant") {
      investorType = "warrant";
    } else if (inv.investor_type === "warrant not exercised") {
      investorType = "warrant not exercised";
    }
    return {
      type: "investor",
      name: inv.name,
      investor_details: inv.investor_details,
      shares: inv.shares,
      new_shares: 0,
      existing_shares: inv.shares,
      total: inv.shares,
      email: inv.investor_details?.email || inv.email || "",
      phone: inv.investor_details?.phone || inv.phone || "",
      percentage: rawPercentage.toFixed(2) + "%",
      percentage_formatted: rawPercentage.toFixed(2) + "%",
      value: parseFloat(((rawPercentage * valuation) / 100).toFixed(2)),
      value_formatted: `${cur} ${((rawPercentage * valuation) / 100).toFixed(2)}`,
      investment: inv.investment,
      investment_amount: inv.investment,
      share_price: inv.share_price,
      is_previous: true,
      is_new_investment: false,
      is_converted: false,
      investor_type: investorType,
      share_class_type: inv.share_class_type,
      instrument_type: inv.instrument_type,
      round_name: inv.round_name,
      round_id: inv.round_id,
    };
  };

  const buildWarrantItem = (warrant, totalShares, valuation, cur) => {
    const ownership = warrant.shares / totalShares;
    const rawPercentage = ownership * 100;
    let investorType = "warrant";
    if (warrant.investor_type === "warrant not exercised") {
      investorType = "warrant not exercised";
    }
    return {
      type: "investor",
      name: warrant.name,
      investor_details: warrant.investor_details,
      shares: warrant.shares,
      new_shares: warrant.shares,
      existing_shares: 0,
      total: warrant.shares,
      email: warrant.investor_details?.email || "",
      phone: warrant.investor_details?.phone || "",
      percentage: rawPercentage.toFixed(2) + "%",
      percentage_formatted: rawPercentage.toFixed(2) + "%",
      value: parseFloat(((rawPercentage * valuation) / 100).toFixed(2)),
      value_formatted: `${cur} ${((rawPercentage * valuation) / 100).toFixed(2)}`,
      investment: warrant.investment,
      investment_amount: warrant.investment,
      share_price: warrant.share_price,
      is_previous: false,
      is_warrant: true,
      is_new_investment: true,
      is_converted: false,
      investor_type: investorType,
      share_class_type: warrant.share_class_type,
      instrument_type: warrant.instrument_type,
      round_name: warrant.round_name,
      round_id: warrant.round_id,
      warrant_id: warrant.warrant_id,
    };
  };

  // ==================== PRE-MONEY CAP TABLE ====================
  let previousRoundPostCapTable = null;
  if (latestPreviousRound) {
    try {
      const prevRoundData = await new Promise((resolve, reject) => {
        db.query(
          `SELECT post_money_cap_table FROM roundrecord WHERE id = ? AND company_id = ?`,
          [latestPreviousRound.id, company_id],
          (err, results) => {
            if (err) reject(err);
            else resolve(results?.[0] || null);
          },
        );
      });

      if (prevRoundData?.post_money_cap_table) {
        previousRoundPostCapTable =
          typeof prevRoundData.post_money_cap_table === "string"
            ? JSON.parse(prevRoundData.post_money_cap_table)
            : prevRoundData.post_money_cap_table;
      }
    } catch (error) {
      console.error("❌ Error fetching previous round post cap table:", error);
    }
  }

  const preMoneyCapTable = previousRoundPostCapTable
    ? {
        ...previousRoundPostCapTable,
        pending_instruments: previousPendingSafes,
        items: [
          ...(previousRoundPostCapTable.items || []).filter(
            (item) => !item.is_pending,
          ),

          ...previousPendingSafes,
        ],
      }
    : {
        total_shares: preMoneyTotalShares,
        pre_money_valuation: preMoneyVal,
        currency,
        share_price: sharePrice.toFixed(4),
        pending_instruments: previousPendingSafes,

        founders: {
          list: founderList.map((f) => {
            const ownership = f.shares / preMoneyTotalShares;
            const rawPercentage = ownership * 100;
            return {
              ...f,
              roundName: round0Name,
              share_class_type: round0Shareclassstype,
              percentage: rawPercentage.toFixed(2) + "%",
              value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
            };
          }),
          total_shares: round0Shares,
          total_percentage:
            ((round0Shares / preMoneyTotalShares) * 100).toFixed(2) + "%",
          total_value: (
            ((round0Shares / preMoneyTotalShares) * 100 * preMoneyVal) /
            100
          ).toFixed(2),
          roundName: round0Name,
          share_class_type: round0Shareclassstype,
        },

        option_pool: {
          shares: totalOptionPoolShares,
          existing_shares: existingOptionPoolShares,
          new_shares: newOptionPoolShares,
          total: totalOptionPoolShares,
          percentage:
            ((totalOptionPoolShares / preMoneyTotalShares) * 100).toFixed(2) +
            "%",
          value: (
            ((totalOptionPoolShares / preMoneyTotalShares) *
              100 *
              preMoneyVal) /
            100
          ).toFixed(2),
          shareClassType: "Option Pool",
          instrumentType: "Options",
          roundName: "Option Pool",
          is_option_pool: true,
        },

        previous_investors:
          previousInvestorsList.length > 0
            ? {
                name: "Previous Investors",
                total_shares: previousInvestorsTotalShares,
                percentage:
                  (
                    (previousInvestorsTotalShares / preMoneyTotalShares) *
                    100
                  ).toFixed(2) + "%",
                total_value: (
                  ((previousInvestorsTotalShares / preMoneyTotalShares) *
                    100 *
                    preMoneyVal) /
                  100
                ).toFixed(2),
                items: previousInvestorsList.map((inv) => {
                  const ownership = inv.shares / preMoneyTotalShares;
                  const rawPercentage = ownership * 100;
                  return {
                    ...inv,
                    percentage: rawPercentage.toFixed(2) + "%",
                    value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
                  };
                }),
                is_grouped: false,
              }
            : null,

        converted: null,

        items: [
          ...founderList.map((f) =>
            buildFounderItem(f, preMoneyTotalShares, preMoneyVal, currency),
          ),
          buildOptionPoolItem(
            totalOptionPoolShares,
            preMoneyTotalShares,
            preMoneyVal,
            currency,
            newOptionPoolShares,
            existingOptionPoolShares,
          ),
          ...previousInvestorsList.map((inv) =>
            buildPrevInvestorItem(
              inv,
              preMoneyTotalShares,
              preMoneyVal,
              currency,
            ),
          ),
          ...previousWarrantsList.map((w) =>
            buildWarrantItem(w, preMoneyTotalShares, preMoneyVal, currency),
          ),
          ...previousPendingSafes,
        ],
      };

  // ==================== POST-MONEY CAP TABLE ====================
  const postMoneyCapTable = {
    total_shares: postMoneyTotalShares,
    post_money_valuation: postMoneyValuation,
    currency,
    share_price: sharePrice.toFixed(4),
    pending_instruments: allPendingInstruments,

    founders: {
      list: founderList.map((f) => {
        const ownership = f.shares / postMoneyTotalShares;
        const rawPercentage = ownership * 100;
        return {
          ...f,
          roundName: currentRound?.nameOfRound,
          share_class_type: round0Shareclassstype,
          shares: f.shares,
          new_shares: 0,
          total: f.shares,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
          shareClassType: f.shareClassType || "",
          instrumentType: f.instrumentType || "",
          round_id: round0?.id || null,
        };
      }),
      total_shares: round0Shares,
      total_percentage:
        ((round0Shares / postMoneyTotalShares) * 100).toFixed(2) + "%",
      total_value: (
        ((round0Shares / postMoneyTotalShares) * 100 * postMoneyValuation) /
        100
      ).toFixed(2),
    },

    option_pool: {
      shares: totalOptionPoolShares,
      existing_shares: totalOptionPoolShares,
      new_shares: 0,
      total: totalOptionPoolShares,
      percentage:
        ((totalOptionPoolShares / postMoneyTotalShares) * 100).toFixed(2) + "%",
      value: (
        ((totalOptionPoolShares / postMoneyTotalShares) *
          100 *
          postMoneyValuation) /
        100
      ).toFixed(2),
      shareClassType: "Option Pool",
      instrumentType: "Options",
      roundName: "Option Pool",
      is_option_pool: true,
    },

    previous_investors:
      previousInvestorsList.length > 0
        ? {
            name: "Previous Investors",
            total_shares: previousInvestorsTotalShares,
            new_shares: 0,
            total: previousInvestorsTotalShares,
            percentage:
              (
                (previousInvestorsTotalShares / postMoneyTotalShares) *
                100
              ).toFixed(2) + "%",
            total_value: (
              ((previousInvestorsTotalShares / postMoneyTotalShares) *
                100 *
                postMoneyValuation) /
              100
            ).toFixed(2),
            items: previousInvestorsList.map((inv) => {
              const ownership = inv.shares / postMoneyTotalShares;
              const rawPercentage = ownership * 100;
              return {
                ...inv,
                existing_shares: inv.shares,
                new_shares: 0,
                total: inv.shares,
                percentage: rawPercentage.toFixed(2) + "%",
                value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
              };
            }),
            is_grouped: false,
          }
        : null,

    investors: {
      name: "Convertible Note Investors",
      shares: 0,
      new_shares: 0,
      total: 0,
      percentage: "0.00%",
      value: "0.00",
      investment: roundSizeVal,
      shareClassType: currentRound?.shareClassType || "Convertible Note",
      instrumentType: "Convertible Note",
      roundName: currentRound?.nameOfRound || "Convertible Note Round",
      roundId: currentRound?.id,
      items: [],
    },

    converted_investors: null,

    items: [
      ...founderList.map((f) => {
        const ownership = f.shares / postMoneyTotalShares;
        const rawPercentage = ownership * 100;
        return {
          type: "founder",
          name: f.name,
          shares: f.shares,
          new_shares: 0,
          total: f.shares,
          email: f.email,
          phone: f.phone,
          founder_code: f.founder_code,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
          shareClassType: f.shareClassType || "Common Shares",
          instrumentType: f.instrumentType || "Common Stock",
          roundName: "Round 0",
          roundId: round0?.id || null,
          round_id: round0?.id || null,
        };
      }),
      {
        type: "option_pool",
        name: "Employee Option Pool",
        shares: totalOptionPoolShares,
        existing_shares: totalOptionPoolShares,
        new_shares: 0,
        total: totalOptionPoolShares,
        is_option_pool: true,
        percentage:
          ((totalOptionPoolShares / postMoneyTotalShares) * 100).toFixed(2) +
          "%",
        value: (
          ((totalOptionPoolShares / postMoneyTotalShares) *
            100 *
            postMoneyValuation) /
          100
        ).toFixed(2),
        shareClassType: "Option Pool",
        instrumentType: "Options",
        roundName: "Option Pool",
      },
      ...previousInvestorsList.map((inv) => {
        const ownership = inv.shares / postMoneyTotalShares;
        const rawPercentage = ownership * 100;
        return {
          type: "investor",
          name: inv.name,
          investor_details: inv.investor_details,
          shares: inv.shares,
          new_shares: 0,
          total: inv.shares,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
          investment: inv.investment,
          share_price: inv.share_price,
          is_previous: true,
          share_class_type: inv.share_class_type,
          instrument_type: inv.instrument_type,
          round_name: inv.round_name,
          round_id: inv.round_id,
        };
      }),
      ...previousWarrantsList.map((w) =>
        buildWarrantItem(w, postMoneyTotalShares, postMoneyValuation, currency),
      ),
      ...currentRoundWarrantsList.map((w) =>
        buildWarrantItem(w, postMoneyTotalShares, postMoneyValuation, currency),
      ),
      ...allPendingInstruments,
    ],
  };

  // ==================== DATABASE UPDATE ====================
  const dbUpdateData = {
    share_price: sharePrice.toFixed(4),
    issuedshares: "0",
    investorPostMoney: investorPostMoneyOwnership.toFixed(2),
    pre_money: preMoneyVal.toString(),
    post_money: postMoneyValuation.toString(),
    roundsize: roundSizeVal.toString(),
    conversion_shares: conversionShares.toString(),
    total_converted_shares: "0",
    option_pool_shares: totalOptionPoolShares.toString(),
    option_pool_percentage: optionPoolPercent.toFixed(2),
    total_shares_before: preMoneyTotalShares.toString(),
    total_shares_after: postMoneyTotalShares.toString(),
    total_option_pool: totalOptionPoolShares.toString(),
    pre_money_cap_table: JSON.stringify(preMoneyCapTable),
    post_money_cap_table: JSON.stringify(postMoneyCapTable),
    updated_at: new Date(),
  };

  try {
    await updateRoundCalculationsSafeConvertibleNote({
      id,
      new_investor_shares: 0,
      conversion_price: conversionPrice || 0,
      conversion_shares: conversionShares || 0,
      option_pool_shares: totalOptionPoolShares,
      share_price: sharePrice,
      total_shares_before: preMoneyTotalShares,
      total_shares_after: postMoneyTotalShares,
      total_converted_shares: 0,
      instrumentType: "Convertible Note",
      roundSize: roundSizeVal,
      preMoney: preMoneyVal,
      pre_money_cap_table: JSON.stringify(preMoneyCapTable),
      post_money_cap_table: JSON.stringify(postMoneyCapTable),
    });

    await saveCapTableData(
      "unprice",
      id,
      company_id,
      preMoneyCapTable,
      postMoneyCapTable,
      preMoneyTotalShares,
      postMoneyTotalShares,
      preMoneyVal,
      postMoneyValuation,
    );

    return {
      success: true,
      data: dbUpdateData,
      roundId: id,
      pre_money_cap_table: preMoneyCapTable,
      post_money_cap_table: postMoneyCapTable,
    };
  } catch (error) {
    console.error("❌ DATABASE ERROR:", error);
    return { success: false, error: error.message };
  }
}

// 5. ROUND 0 HANDLER
function handleRound0Calculation(params) {
  const { id, issuedshares, instrumentData } = params;

  const new_investor_shares = parseInt(issuedshares) || 0;
  const share_price = parseFloat(instrumentData.price_per_share) || 0.01;
  const total_shares_after = new_investor_shares;
  const total_shares_before = 0;

  updateRoundCalculations({
    id,
    new_investor_shares,
    conversion_price: 0,
    conversion_shares: 0,
    option_pool_shares: 0,
    share_price,
    total_shares_before,
    total_shares_after,
    total_converted_shares: 0,
    instrumentType: "Round 0",
    roundSize: 0,
  });
}

// ============================================
// UPDATE DATABASE FUNCTION
// ============================================
function updateRoundCalculations(params) {
  const {
    id,
    new_investor_shares,
    conversion_price,
    conversion_shares,
    option_pool_shares,
    share_price,
    total_shares_before,
    total_shares_after,
    total_converted_shares,
    instrumentType,
    roundSize,
    preMoney,
  } = params;

  const updateQuery = `
    UPDATE roundrecord 
    SET 
      issuedshares = ?,
      conversion_price = ?,
      conversion_shares = ?,
      option_pool_shares = ?,
      share_price = ?,
      total_shares_before = ?,
      total_shares_after = ?,
      total_converted_shares = ?
    WHERE id = ?
  `;

  const updateValues = [
    new_investor_shares,
    conversion_price.toFixed(4),
    conversion_shares,
    option_pool_shares,
    share_price.toFixed(4),
    total_shares_before,
    total_shares_after,
    total_converted_shares,
    id,
  ];

  db.query(updateQuery, updateValues, (updateErr) => {
    if (updateErr) {
      console.error(`❌ Error updating round ${id}:`, updateErr);
    } else {
    }
  });
}
function insertAuditLog({
  userId,
  companyId,
  module,
  action,
  entityId,
  entityType,
  details,
  ip,
  country_name,
}) {
  const sql = `
    INSERT INTO audit_logs 
    (country_name,user_id, company_id, module, action, entity_id, entity_type, details, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;

  const values = [
    country_name,
    userId,
    companyId,
    module,
    action,
    entityId,
    entityType,
    JSON.stringify(details || {}),
    ip,
  ];

  db.query(sql, values, (err) => {
    if (err) {
      console.error("Audit log insert failed:", err.message);
    }
  });
}
function insertAccessLog({
  userId,
  userRole,
  companyId,
  action,
  targetTable,
  targetId,
  description,
  ip,
  country_name,
}) {
  const sql = `
    INSERT INTO access_logs_company_round 
    (country_name,user_id, user_role, company_id, action, target_table, target_id, description, ip_address) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [
      country_name,
      userId,
      userRole,
      companyId,
      action,
      targetTable,
      targetId,
      description,
      ip,
    ],
    (err) => {
      if (err) {
        console.error("Access Log Insert Failed:", err);
      } else {
      }
    },
  );
}

exports.getCapitalRecordRound = (req, res) => {
  const { company_id } = req.body;

  const query = `SELECT * from roundrecord where company_id = ? And is_locked = ? And round_type =? order by id desc`;

  db.query(query, [company_id, "Yes", "Investment"], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "",
      results: results,
    });
  });
};
// Separate function for sending email
const sendRecordRoundEmail = async (
  investorInfo,
  record,
  companyInfo,
  datecreated,
) => {
  const { email, first_name, last_name } = investorInfo;
  const { displayName } = companyInfo;

  const url =
    "https://capavate.com/investor/company/capital-round-list/" +
    companyInfo.company_id;

  const mailOptions = {
    from: '"Capavate" <scale@blueprintcatalyst.com>',
    to: email,
    subject: `New Record Round Shared`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>New Record Round</title>
        </head>
        <body>
          <!-- Investor Section -->
          <div style="width:600px;margin:20px auto 0 auto;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
            <table style="width:600px;margin:0 auto;border-collapse:collapse;font-family:Verdana,Geneva,sans-serif;">
              <tr>
                <td style="background:#efefef;padding:10px 0;text-align:center;">
                  <img src="https://capavate.com/api/upload/images/logo.png" alt="logo" style="width:130px;" />
                </td>
              </tr>
              <tr>
                <td>
                  <table>
                    <tr>
                      <td style="padding:20px;">
                        <h2 style="margin:0 0 15px 0;font-size:16px;color:#111;">Dear ${first_name} ${last_name},</h2>
                        <h3 style="margin:0 0 15px 0;font-size:16px;color:#111;">
                          ${displayName} has shared a new record round with you:
                        </h3>
                        <p style="margin:0 0 15px 0;font-size:14px;color:#111;">
                          <b>Report Name:</b> ${record.name}
                        </p>
                        <p style="margin:0 0 15px 0;font-size:14px;color:#111;">
                          <b>Amount Invested in this Round:</b> ${
                            record.currency
                              ? `${record.currency} ${Number(
                                  record.roundsize,
                                ).toLocaleString("en-US")}`
                              : Number(record.roundsize).toLocaleString(
                                  "en-US",
                                ) || "N/A"
                          }
                        </p>
                        <p style="margin:0 0 15px 0;font-size:14px;color:#111;">
                          <b>Date Invested:</b> ${
                            formatCurrentDate(datecreated) || "N/A"
                          }
                        </p>
                        <p style="margin:0 0 15px 0;font-size:14px;color:#111;">
                          <b>Fully Diluted Shares at the time of Investment:</b> ${
                            Number(record.issuedshares).toLocaleString(
                              "en-US",
                            ) || "N/A"
                          }
                        </p>
                        <p style="margin:0 0 15px 0;font-size:14px;color:#111;">
                          You can view the full record details by clicking the button below:
                        </p>
                        <div style="padding:0 20px 20px 20px;">
                          <a href="${url}" style="
                            background:#CC0000;
                            color:#fff;
                            text-decoration:none;
                            font-size:14px;
                            padding:10px 30px;
                            border-radius:10px;
                          ">View Record Round</a>
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <p style="font-size:0.9em;color:#666;text-align:center;padding:10px 0;">
              Capavate. Powered by BluePrint Catalyst Limited
            </p>
          </div>
        </body>
      </html>
    `,
  };

  return transporter.sendMail(mailOptions);
};

// Main function
exports.SendRecordRoundToinvestor = async (req, res) => {
  try {
    const {
      crm_invite_acknowledged,
      country_name,
      ip_address,
      created_by_role,
      created_by_id,
      company_id,
      selectedRecords,
      records,
    } = req.body;
    if (
      !company_id ||
      !Array.isArray(selectedRecords) ||
      !Array.isArray(records)
    ) {
      return res.status(400).json({ message: "Invalid data" });
    }

    const duplicateRecords = [];
    const emailPromises = [];

    // Fetch entrepreneur/company name
    const [userRows] = await db
      .promise()
      .query("SELECT * FROM company WHERE id = ? LIMIT 1", [company_id]);

    const displayName = userRows.length
      ? `${userRows[0].company_name || ""}`.trim()
      : "Entrepreneur";

    const companyInfo = {
      company_id,
      displayName,
    };

    const currentDate = new Date();
    const expiredAt = new Date();
    expiredAt.setDate(currentDate.getDate() + 30);

    for (const investor_id of selectedRecords) {
      // Fetch investor info including email, registration status, and unique_code
      const [investorRows] = await db
        .promise()
        .query(
          "SELECT first_name, last_name, email, is_register, unique_code FROM investor_information WHERE id = ?",
          [investor_id],
        );

      if (!investorRows.length) continue;

      const investorInfo = investorRows[0];
      const { email, first_name, last_name, is_register, unique_code } =
        investorInfo;

      for (const record of records) {
        const roundrecord_id = record.id;

        // Check if record already exists
        const [existing] = await db
          .promise()
          .query(
            "SELECT id FROM sharerecordround WHERE company_id = ? AND investor_id = ? AND roundrecord_id = ?",
            [company_id, investor_id, roundrecord_id],
          );

        if (existing.length > 0) {
          duplicateRecords.push({
            investor_id,
            investor_email: email,
            first_name: first_name,
            last_name: last_name,
            record_id: roundrecord_id,
            record_name: record.name,
          });
          continue;
        }

        // Insert new record
        await db
          .promise()
          .query(
            "INSERT INTO sharerecordround (crm_invite_acknowledged,created_by_role, created_by_id, company_id, investor_id, roundrecord_id, sent_date, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())",
            [
              "Yes",
              created_by_role,
              created_by_id,
              company_id,
              investor_id,
              roundrecord_id,
            ],
          );

        await db
          .promise()
          .query("UPDATE roundrecord SET is_shared = 'Yes' WHERE id = ?", [
            roundrecord_id,
          ]);

        var datecreated = new Date();
        insertAuditLog({
          userId: created_by_id,
          companyId: company_id,
          module: "share_with_investorreport",
          action: "SHARED",
          entityId: roundrecord_id,
          entityType: "share_with_investorreport",
          details: "",
          ip: req.body.ip_address,
          country_name: req.body.country_name,
        });
        // Send email using the separate function
        emailPromises.push(
          sendRecordRoundEmail(investorInfo, record, companyInfo, datecreated),
        );
      }
    }

    // Send all emails
    await Promise.all(emailPromises);

    if (duplicateRecords.length > 0) {
      return res.status(200).json({
        message: "Some records already exist for the selected investors",
        duplicates: duplicateRecords,
        status: "2",
      });
    }

    return res.json({
      message: "Records shared successfully and emails sent",
      status: "1",
    });
  } catch (error) {
    console.error("Error sending record rounds:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};
function formatCurrentDate(input) {
  const date = new Date(input);

  if (isNaN(date)) return "";
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

exports.getInvestorCapitalMotionlist = (req, res) => {
  const { investor_id, company_id } = req.body; // make sure request body has correct keys

  const query = `
  SELECT 
    roundrecord.*, 
    sharerecordround.sent_date,
    sharerecordround.investor_id,
    company.company_name
  FROM sharerecordround
  JOIN roundrecord ON roundrecord.id = sharerecordround.roundrecord_id
  LEFT JOIN company ON company.id = roundrecord.company_id
  WHERE sharerecordround.company_id = ? 
  AND sharerecordround.investor_id = ?
  ORDER BY sharerecordround.id DESC
`;

  // Assuming company_id = user, company_id = investor_id (check DB schema!)
  db.query(query, [company_id, investor_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Success",
      results: results,
    });
  });
};
exports.getcheckCapitalMotionlist = (req, res) => {
  const { capital_round_id, investor_id } = req.body;

  if (!capital_round_id || !investor_id) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  // 1️⃣ First query: Get data for this specific investor_id
  const queryMain = `
    SELECT 
  roundrecord.*,
  company.company_name,
  GROUP_CONCAT(DISTINCT sharerecordround.signature_status) AS signature_status,
  GROUP_CONCAT(DISTINCT sharerecordround.termsChecked) AS termsChecked,
  GROUP_CONCAT(DISTINCT sharerecordround.signature) AS signature,
  GROUP_CONCAT(DISTINCT sharerecordround.id) AS sharerecordround_id,
  SUM(irc.shares) AS requested_shares,
  SUM(irc.investment_amount) AS total_investment_amount,
  COUNT(DISTINCT irc.id) AS investment_count
FROM roundrecord
JOIN company ON company.id = roundrecord.company_id
JOIN sharerecordround ON sharerecordround.roundrecord_id = roundrecord.id
LEFT JOIN investorrequest_company irc
  ON irc.roundrecord_id = roundrecord.id
  AND irc.request_confirm = 'Yes'
  AND irc.investor_id = ?
WHERE roundrecord.id = ?
  AND sharerecordround.investor_id = ?
GROUP BY roundrecord.id, company.id;
  `;

  db.query(
    queryMain,
    [investor_id, capital_round_id, investor_id],
    (err, results) => {
      if (err) {
        console.error("DB Query Error:", err);
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      if (!results || results.length === 0) {
        return res.status(200).json({ message: "No data found", results: [] });
      }

      // Prepare base data for this investor
      const roundData = { ...results[0], investment_requests: [] };

      results.forEach((row) => {
        if (row.request_id) {
          roundData.investment_requests.push({
            request_id: row.request_id,
            investor_id: row.request_investor_id,
            shares: row.requested_shares,
            investment_amount: row.investment_amount,
          });
        }
      });

      // 2️⃣ Second query: fetch ALL investor requests for this capital_round_id
      const queryAll = `
      SELECT 
        id AS request_id,
        investor_id,
        shares,
        investment_amount,
        request_confirm,
        created_at
      FROM investorrequest_company
      WHERE roundrecord_id = ?
        AND request_confirm = 'Yes';
    `;

      db.query(queryAll, [capital_round_id], (err2, allRequests) => {
        if (err2) {
          console.error("DB Query Error (allRequests):", err2);
          return res
            .status(500)
            .json({ message: "Database query error", error: err2 });
        }

        // Attach all investors requests array
        roundData.all_investment_requests = allRequests || [];

        res.status(200).json({
          message: "Capital round details fetched successfully",
          results: [roundData],
        });
      });
    },
  );
};

exports.tersheetdownloadInvestor = (req, res) => {
  const { id } = req.body; // Only the record id is needed for the update

  if (!id) {
    return res.status(400).json({ message: "Record ID is required" });
  }

  const query = `
    UPDATE sharerecordround
    SET termsheet_status = 'Download', access_status ='Download',activity_date=NOW()
    WHERE id = ?
  `;

  db.query(query, [id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Termsheet status updated successfully",
      results: results,
    });
  });
};

exports.Capitalmotionviewed = (req, res) => {
  const { id } = req.body; // Only the record id is needed for the update

  if (!id) {
    return res.status(400).json({ message: "Record ID is required" });
  }

  const query = `
    UPDATE sharerecordround
    SET access_status = 'Only View',activity_date=NOW(),
        date_view = NOW()
    WHERE id = ? AND access_status = 'Not View'
  `;

  db.query(query, [id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    if (results.affectedRows === 0) {
      return res.status(200).json({
        message: "Access status was already updated or not eligible",
        updated: false,
      });
    }

    res.status(200).json({
      message: "Access status updated successfully",
      updated: true,
      results: results,
    });
  });
};

exports.subscriptiondownloadInvestor = (req, res) => {
  const { id } = req.body; // Only the record id is needed for the update

  if (!id) {
    return res.status(400).json({ message: "Record ID is required" });
  }
  var date = new Date();
  const query = `
    UPDATE sharerecordround
    SET subscription_status = 'Download', access_status ='Download',activity_date=NOW()
    WHERE id = ?
  `;

  db.query(query, [id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    if (results.affectedRows === 0) {
      return res.status(200).json({
        message: "Access status was already updated or not eligible",
        updated: false,
      });
    }

    res.status(200).json({
      message: "Access status updated successfully",
      updated: true,
      results: results,
    });
  });
};
exports.investorrecordAuthorize = (req, res) => {
  const {
    id,
    signature_authorize,
    reports,
    company_id,
    user_id,
    termsChecked,
  } = req.body;
  if (!id || !signature_authorize) {
    return res
      .status(400)
      .json({ message: "Record ID and signature are required" });
  }

  var date = new Date();
  const query = `
    UPDATE sharerecordround
    SET signature_status = 'Yes', signature = ?,termsChecked =?, activity_date=NOW()
    WHERE id = ? AND signature_status != 'Yes'
  `;

  db.query(
    query,
    [signature_authorize, termsChecked, id],
    async (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      if (results.affectedRows === 0) {
        return res.status(200).json({
          message: "Signature was already authorized or not eligible",
          updated: false,
        });
      }

      try {
        // Fetch company email
        const [companyRows] = await db
          .promise()
          .query("SELECT * FROM company WHERE id = ?", [company_id]);

        if (companyRows.length === 0) throw new Error("Company not found");

        const companyName = companyRows[0].company_name;
        const companyEmail = companyRows[0].company_email;

        // Fetch investor name
        const [investorRows] = await db
          .promise()
          .query("SELECT * FROM investor_information WHERE id = ?", [user_id]);

        if (investorRows.length === 0) throw new Error("Investor not found");

        const investorName = `${investorRows[0].first_name} ${investorRows[0].last_name}`;
        const investorEmail = `${investorRows[0].email}`;

        // Compose message
        const reportUrl = "https://capavate.com/crm/investorreport";

        const message = `
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="UTF-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <title>Investor Signature Notification</title>
            </head>
            <body>
              <div style="width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
                <table style="width:600px;margin:0 auto;border-collapse:collapse;font-family:Verdana,Geneva,sans-serif;">
                  <tr>
                    <td style="background:#efefef;padding:10px 0;text-align:center;">
                      <div style="width:130px;margin:0 auto;">
                        <img src="logo.png" alt="logo" style="width:100%;" />
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <table>
                        <tr>
                          <td style="padding:20px;">
                            <h2 style="margin:0 0 15px 0;font-size:16px;color:#111;">Dear Media</h2>
                            <h3 style="margin:0 0 15px 0;font-size:16px;color:#111;">
                              Investor <strong>${investorName}</strong> has authorized the signature for the following report:
                            </h3>
                            <p style="margin:0 0 15px 0;font-size:14px;color:#111;"><b>Report Name:</b> ${reports.nameOfRound}</p>
                            <p style="margin:0 0 15px 0;font-size:14px;color:#111;"><b>Share Class Type:</b> ${reports.shareClassType}</p>
                            <p style="margin:0 0 15px 0;font-size:14px;color:#111;">You can view the report by clicking the button below:</p>
                          </td>
                        </tr>
                        <tr>
                          <td>
                            <div style="padding:0 20px 20px 20px;">
                              <a href="${reportUrl}" style="background:#CC0000;color:#fff;text-decoration:none;font-size:14px;padding:10px 30px;border-radius:10px;display:inline-block;">View Report</a>
                            </div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </div>

              <div style="width:600px;margin:20px auto 0 auto;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
                <table style="width:600px;margin:0 auto;border-collapse:collapse;font-family:Verdana,Geneva,sans-serif;">
                  <tr>
                    <td style="padding:20px;text-align:center;font-size:0.9em;color:#666;">
                      Capavate. Powered by BluePrint Catalyst Limited
                    </td>
                  </tr>
                </table>
              </div>
            </body>
          </html>
          `;

        const subject = `Signature Authorized by Investor - ${reports.nameOfRound}`;

        // Send email

        sendEmailToCorpSignature(companyEmail, companyName, message, subject);
        sendEmailToInvestor(investorEmail, investorName, companyName, reports);
      } catch (emailErr) {
        console.error("Error sending email:", emailErr);
      }

      res.status(200).json({
        message: "Signature authorized successfully and email sent",
        updated: true,
        results: results,
      });
    },
  );
};

// 📧 TO INVESTOR: Signature confirmation with wiring instructions
function sendEmailToInvestor(
  to,
  investorName,
  companyName,
  reports,
  wiringInstructions = null,
) {
  const subject = `Signature Confirmed - Next Steps for ${reports.nameOfRound}`;

  const message = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Signature Confirmation & Next Steps</title>
      </head>
      <body>
        <div style="width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
          <table style="width:600px;margin:0 auto;border-collapse:collapse;font-family:Verdana,Geneva,sans-serif;">
            <tr>
              <td style="background:#efefef;padding:10px 0;text-align:center;">
                <div style="width:130px;margin:0 auto;">
                  <img src="${
                    process.env.APP_URL
                  }/logo.png" alt="logo" style="width:100%;" />
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:30px;">
                <h2 style="margin:0 0 20px 0;font-size:20px;color:#111;">Dear ${investorName},</h2>
                
                <!-- Confirmation Section -->
                <div style="background:#f0f9ff;padding:20px;border-radius:8px;margin-bottom:20px;">
                  <h3 style="margin:0 0 15px 0;font-size:18px;color:#111;">
                    ✅ Your Digital Signature Has Been Confirmed
                  </h3>
                  <p style="margin:0 0 10px 0;font-size:14px;color:#111;">
                    Thank you for authorizing your investment in <strong>${companyName}</strong>.
                  </p>
                  <p style="margin:0 0 10px 0;font-size:14px;color:#111;">
                    <b>Investment Round:</b> ${reports.nameOfRound}
                  </p>
                  <p style="margin:0 0 10px 0;font-size:14px;color:#111;">
                    <b>Signature Date:</b> ${new Date().toLocaleDateString()}
                  </p>
                  <p style="margin:0 0 10px 0;font-size:14px;color:#111;">
                    <b>Reference ID:</b> INV-${Date.now()}
                  </p>
                </div>

                <!-- Next Steps -->
                <div style="margin-bottom:25px;">
                  <h4 style="margin:0 0 15px 0;font-size:16px;color:#111;">📋 Next Steps:</h4>
                  <ol style="margin:0;padding-left:20px;font-size:14px;color:#111;">
                    <li style="margin-bottom:10px;">Complete the fund transfer using the wiring instructions below</li>
                    <li style="margin-bottom:10px;">The company will confirm receipt of funds</li>
                    <li>Shares will be formally allocated to you</li>
                  </ol>
                </div>

                <!-- Documents -->
                <div style="margin-bottom:25px;">
                  <h4 style="margin:0 0 15px 0;font-size:16px;color:#111;">📄 Important Documents:</h4>
                  <p style="margin:0 0 10px 0;font-size:14px;color:#111;">
                    Please keep copies of these documents for your records:
                  </p>
                  <ul style="margin:0;padding-left:20px;font-size:14px;color:#111;">
                    <li style="margin-bottom:5px;">Term Sheet</li>
                    <li style="margin-bottom:5px;">Subscription Agreement</li>
                    <li>This confirmation email</li>
                  </ul>
                </div>

                <!-- Wiring Instructions (if provided) -->
                ${
                  wiringInstructions
                    ? `
                <div style="background:#fff8e1;padding:20px;border-radius:8px;margin-bottom:20px;border-left:4px solid #f59e0b;">
                  <h4 style="margin:0 0 15px 0;font-size:16px;color:#111;">🏦 Wiring Instructions:</h4>
                  <div style="font-size:14px;color:#111;line-height:1.6;">
                    ${wiringInstructions}
                  </div>
                  <p style="margin:15px 0 0 0;font-size:13px;color:#6b7280;">
                    <i>Note: Funds will be converted based on the exchange rate of the day the investment is completed, according to the Bank of Canada.</i>
                  </p>
                </div>
                `
                    : ""
                }

                <!-- Contact Information -->
                <div style="background:#f9fafb;padding:20px;border-radius:8px;margin-bottom:20px;">
                  <h4 style="margin:0 0 15px 0;font-size:16px;color:#111;">📞 Need Help?</h4>
                  <p style="margin:0 0 10px 0;font-size:14px;color:#111;">
                    If you have any questions, please contact:
                  </p>
                  <p style="margin:0;font-size:14px;color:#111;">
                    <b>${companyName}</b><br/>
                    Email: <a href="mailto:scale@blueprintcatalyst.com" style="color:#3b82f6;">${
                      reports.company_email
                    }</a>
                  </p>
                </div>

                <!-- Action Button -->
                <div style="text-align:center;margin:30px 0;">
                  <a href="https://capavate.com/investor/dashboard" style="background:#10b981;color:#fff;text-decoration:none;font-size:16px;font-weight:500;padding:12px 40px;border-radius:8px;display:inline-block;">
                    Go to Your Dashboard
                  </a>
                </div>
              </td>
            </tr>
          </table>
        </div>

        <div style="width:600px;margin:20px auto 0 auto;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
          <table style="width:600px;margin:0 auto;border-collapse:collapse;font-family:Verdana,Geneva,sans-serif;">
            <tr>
              <td style="padding:20px;text-align:center;font-size:0.9em;color:#666;">
                Capavate. Powered by BluePrint Catalyst Limited<br/>
                <small style="font-size:0.8em;">This is an automated message. Please do not reply to this email.</small>
              </td>
            </tr>
          </table>
        </div>
      </body>
    </html>
  `;

  const mailOptions = {
    from: '"Capavate" <scale@blueprintcatalyst.com>',
    to,
    subject,
    html: message,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending email:", error);
    else console.log(`✅ Email sent to ${to}`);
  });
}

// Email function
function sendEmailToCorpSignature(to, companyName, message, subject) {
  const mailOptions = {
    from: '"Capavate" <scale@blueprintcatalyst.com>',
    to,
    subject,
    html: message,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending email:", error);
    else console.log(`✅ Email sent to ${to}`);
  });
}

exports.getinvestorprofile = (req, res) => {
  const { investor_id } = req.body; // make sure request body has correct keys

  const query = `SELECT * from 	investor_information where id = ?`;

  // Assuming user_id = user, company_id = investor_id (check DB schema!)
  db.query(query, [investor_id], (err, row) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "",
      results: row,
    });
  });
};
// configure upload for KYC/AML document

const storagekyc = multer.diskStorage({
  destination: function (req, file, cb) {
    const userId = req.body.user_id; // get user ID from request body

    const userFolder = path.join(
      __dirname,
      "..",
      "..",
      "upload",
      "investor",
      `inv_${userId}`,
    );

    // Create folder if it doesn't exist
    if (!fs.existsSync(userFolder)) {
      fs.mkdirSync(userFolder, { recursive: true });
    }

    cb(null, userFolder);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const uploadKyc = multer({ storage: storagekyc });

exports.updateInvestorProfile = (req, res) => {
  uploadKyc.array("kyc_document", 10)(req, res, (err) => {
    if (err) {
      return res.status(500).json({ message: "File upload error", error: err });
    }

    const data = req.body;

    // Get newly uploaded files
    let newKycFiles = req.files ? req.files.map((f) => f.filename) : [];

    const getOldFileQuery = `SELECT kyc_document FROM investor_information WHERE id = ?`;

    db.query(getOldFileQuery, [data.user_id], (err, result) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database fetch error", error: err });
      }

      let oldFiles = [];
      if (result.length > 0 && result[0].kyc_document) {
        try {
          oldFiles = JSON.parse(result[0].kyc_document); // parse JSON from DB
        } catch (e) {
          oldFiles = [];
        }
      }

      // Merge old + new files
      let finalKycFiles = [];
      if (req.files.length > 0) {
        finalKycFiles = [...newKycFiles];
      } else {
        finalKycFiles = [...oldFiles];
      }

      const query = `
        UPDATE investor_information
        SET first_name = ?, 
            last_name = ?, 
            country = ?, 
            city = ?, 
            phone = ?, 
            full_address = ?, 
            country_tax = ?, 
            tax_id = ?, 
            accredited_status = ?, 
            industry_expertise = ?, 
            linkedIn_profile = ?, 
            kyc_document = ?,
            type_of_investor =?
        WHERE id = ?
      `;

      db.query(
        query,
        [
          data.first_name,
          data.last_name,
          data.country,
          data.city,
          data.phone,
          data.full_address,
          data.country_tax,
          data.tax_id,
          data.accredited_status,
          data.industry_expertise,
          data.linkedIn_profile,
          JSON.stringify(finalKycFiles), // store as JSON string
          data.type_of_investor,
          data.user_id,
        ],
        (err, row) => {
          if (err) {
            return res.status(500).json({
              message: "Database update error",
              error: err,
            });
          }

          res.status(200).json({
            message: "Investor profile updated successfully",
            results: row,
          });
        },
      );
    });
  });
};

exports.getTotalcompany = (req, res) => {
  const { investor_id } = req.body; // make sure request body has correct keys

  const query = `SELECT company_investor.* from company_investor join company on company.id = company_investor.company_id where company_investor.investor_id = ?`;

  // Assuming investor_id = user, company_id = investor_id (check DB schema!)
  db.query(query, [investor_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "",
      results: results,
    });
  });
};
exports.getTotalCompanyIssuedShares = (req, res) => {
  const { investor_id } = req.body;

  if (!investor_id) {
    return res.status(400).json({ message: "Investor ID is required" });
  }

  const query = `
    SELECT 
      COUNT(DISTINCT sharerecordround.roundrecord_id) AS totalRounds,
      SUM(roundrecord.issuedshares) AS totalIssuedShares,
      SUM(roundrecord.roundsize) AS totalRoundSize
    FROM sharerecordround
    JOIN roundrecord ON roundrecord.id = sharerecordround.roundrecord_id
    WHERE sharerecordround.investor_id = ?
  `;

  db.query(query, [investor_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    // results[0] will contain totalIssuedShares and totalRoundSize
    res.status(200).json({
      message: "Investor total shares and round size calculated",
      results: results[0],
    });
  });
};
exports.getlatestinvestorreport = async (req, res) => {
  var type = req.body.type;
  var investor_id = req.body.investor_id;
  try {
    // Check if user already exists
    db.query(
      `SELECT sharereport.*,investor_updates.version,investor_updates.document_name,investor_updates.type,investor_updates.created_at as shared_date from sharereport join investor_updates on investor_updates.id = sharereport.investor_updates_id where sharereport.investor_id = ? And investor_updates.type =? order by sharereport.id Desc LIMIT 10`,
      [investor_id, type],
      async (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        res.status(200).json({
          message: "",
          results: results,
        });
      },
    );
  } catch (err) {
    res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};
exports.getlatestinvestorDataroom = async (req, res) => {
  var type = req.body.type;
  var investor_id = req.body.investor_id;
  try {
    // Check if user already exists
    db.query(
      `SELECT sharereport.*,investor_updates.version,investor_updates.document_name,investor_updates.type,investor_updates.created_at as shared_date from sharereport join investor_updates on investor_updates.id = sharereport.investor_updates_id where sharereport.investor_id = ? And investor_updates.type =? order by sharereport.id Desc LIMIT 10`,
      [investor_id, type],
      async (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        res.status(200).json({
          message: "",
          results: results,
        });
      },
    );
  } catch (err) {
    res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};
exports.getInvestorCapitalMotionlistLatest = async (req, res) => {
  var investor_id = req.body.investor_id;
  const query = `
    SELECT roundrecord.*, sharerecordround.sent_date,sharerecordround.investor_id
    FROM sharerecordround
    JOIN roundrecord ON roundrecord.id = sharerecordround.roundrecord_id
    WHERE  sharerecordround.investor_id = ?
    ORDER BY sharerecordround.id DESC
  `;

  // Assuming user_id = user, company_id = investor_id (check DB schema!)
  db.query(query, [investor_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Success",
      results: results,
    });
  });
};
exports.getEditrecordlist = async (req, res) => {
  var company_id = req.body.company_id;
  var id = req.body.id;
  const query = `
  SELECT 
    roundrecord.*, 
    company.year_registration,
    warrants.*
  FROM roundrecord 
  JOIN company ON roundrecord.company_id = company.id 
  LEFT JOIN warrants ON warrants.roundrecord_id = roundrecord.id
  WHERE roundrecord.company_id = ? AND roundrecord.id = ?;
`;

  db.query(query, [company_id, id], (err, row) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    if (row.length > 0) {
      // Parse JSON fields properly
      const processedRow = row.map((record) => {
        const processedRecord = { ...record };

        // Parse instrument_type_data
        if (record.instrument_type_data) {
          try {
            let rawData = record.instrument_type_data;
            // Remove extra escaping if present
            if (
              typeof rawData === "string" &&
              rawData.startsWith('"') &&
              rawData.endsWith('"')
            ) {
              rawData = rawData.slice(1, -1).replace(/\\"/g, '"');
            }
            processedRecord.instrument_type_data = JSON.parse(rawData);
          } catch (err) {
            console.error("Error parsing instrument_type_data:", err);
            processedRecord.instrument_type_data = {};
          }
        } else {
          processedRecord.instrument_type_data = {};
        }

        // Parse founder_data for Round 0
        if (record.founder_data) {
          try {
            let rawData = record.founder_data;

            // Keep parsing until we reach an actual object
            while (typeof rawData === "string") {
              // Remove outer quotes if present
              if (rawData.startsWith('"') && rawData.endsWith('"')) {
                rawData = rawData.slice(1, -1).replace(/\\"/g, '"');
              }

              // Try to parse JSON
              try {
                rawData = JSON.parse(rawData);
              } catch (e) {
                break;
              }
            }

            processedRecord.founder_data = rawData;
          } catch (err) {
            console.error("Error parsing founder_data:", err);
            processedRecord.founder_data = {};
          }
        } else {
          processedRecord.founder_data = {};
        }

        // Parse file arrays
        if (record.termsheetFile) {
          try {
            let rawData = record.termsheetFile;
            if (
              typeof rawData === "string" &&
              rawData.startsWith('"') &&
              rawData.endsWith('"')
            ) {
              rawData = rawData.slice(1, -1).replace(/\\"/g, '"');
            }
            processedRecord.termsheetFile = JSON.parse(rawData);
          } catch (err) {
            console.error("Error parsing termsheetFile:", err);
            processedRecord.termsheetFile = [];
          }
        } else {
          processedRecord.termsheetFile = [];
        }

        if (record.subscriptiondocument) {
          try {
            let rawData = record.subscriptiondocument;
            if (
              typeof rawData === "string" &&
              rawData.startsWith('"') &&
              rawData.endsWith('"')
            ) {
              rawData = rawData.slice(1, -1).replace(/\\"/g, '"');
            }
            processedRecord.subscriptiondocument = JSON.parse(rawData);
          } catch (err) {
            console.error("Error parsing subscriptiondocument:", err);
            processedRecord.subscriptiondocument = [];
          }
        } else {
          processedRecord.subscriptiondocument = [];
        }

        // Parse liquidation array
        if (record.liquidation) {
          try {
            processedRecord.liquidation = record.liquidation
              .split(",")
              .map((v) => v.trim());
          } catch (err) {
            console.error("Error parsing liquidation:", err);
            processedRecord.liquidation = [];
          }
        } else {
          processedRecord.liquidation = [];
        }

        return processedRecord;
      });

      res.status(200).json({
        message: "",
        results: processedRow,
      });
    } else {
      res.status(404).json({
        message: "Record not found",
        results: [],
      });
    }
  });
};

exports.EditcapitalRound = (req, res) => {
  const uploadFields = upload.fields([
    { name: "termsheetFile", maxCount: 10 },
    { name: "subscriptiondocument", maxCount: 10 },
  ]);

  uploadFields(req, res, (err) => {
    if (err) {
      return res.status(500).json({ message: "File upload error", error: err });
    }

    const {
      id,
      user_id,
      shareClassType,
      description,
      liquidationOther,
      liquidationpreferences,
      nameOfRound,
      shareclassother,
      instrumentType,
      customInstrument,
      roundsize,
      currency,
      issuedshares,
      rights,
      liquidation,
      convertible,
      convertibleType,
      voting,
      generalnotes,
      dateroundclosed,
      existingTermsheetFiles,
      existingSubscriptionDocs,
    } = req.body;

    // Only add newly uploaded files if they exist
    const newTermsheetFiles = req.files["termsheetFile"]
      ? req.files["termsheetFile"].map((f) => f.filename)
      : null; // null means no new file
    const newSubscriptionDocs = req.files["subscriptiondocument"]
      ? req.files["subscriptiondocument"].map((f) => f.filename)
      : null;

    // Prepare the update query dynamically
    let sql = `UPDATE roundrecord SET 
      user_id = ?, 
      dateroundclosed = ?, 
      nameOfRound = ?, 
      shareClassType = ?, 
      shareclassother = ?, 
      description = ?, 
      instrumentType = ?, 
      customInstrument = ?, 
      roundsize = ?, 
      currency = ?, 
      issuedshares = ?, 
      rights = ?, 
      liquidationpreferences = ?, 
      liquidation = ?, 
      liquidationOther = ?, 
      convertible = ?, 
      convertibleType = ?, 
      voting = ?`;

    const values = [
      user_id,
      dateroundclosed,
      nameOfRound,
      shareClassType || "",
      shareclassother || "",
      description || "",
      instrumentType || "",
      customInstrument || "",
      roundsize || "",
      currency || "",
      issuedshares || "",
      rights || "",
      liquidationpreferences || "",
      liquidation || "",
      liquidationOther || "",
      convertible || "",
      convertibleType || "",
      voting || "",
    ];

    // Append file fields **only if new files are uploaded**
    if (newTermsheetFiles !== null) {
      sql += `, termsheetFile = ?`;
      const allTermsheetFiles = [
        ...(existingTermsheetFiles ? JSON.parse(existingTermsheetFiles) : []),
        ...newTermsheetFiles,
      ];
      values.push(JSON.stringify(allTermsheetFiles));
    }

    if (newSubscriptionDocs !== null) {
      sql += `, subscriptiondocument = ?`;
      const allSubscriptionDocs = [
        ...(existingSubscriptionDocs
          ? JSON.parse(existingSubscriptionDocs)
          : []),
        ...newSubscriptionDocs,
      ];
      values.push(JSON.stringify(allSubscriptionDocs));
    }

    sql += `, generalnotes = ? WHERE id = ?`;
    values.push(generalnotes || "", id);

    db.query(sql, values, (err, result) => {
      if (err) {
        return res.status(500).json({ message: "DB update error", err });
      }
      insertAuditLog({
        userId: created_by_id,
        companyId: company_id,
        module: "capital_round",
        action: "UPDATE",
        entityId: id,
        entityType: "roundrecord",
        details: { nameOfRound, roundsize, currency },
        ip: req.body.ClientIP,
        country_name: req.body.country_name,
      });
      res.status(200).json({ message: "Record updated successfully", id });
    });
  });
};

exports.getTotalInvestorReport = async (req, res) => {
  var type = req.body.type;
  var investor_id = req.body.investor_id;

  try {
    // Query 1: Get data from sharereport table
    const shareReportQuery = `
      SELECT 
        sharereport.*,
        investor_updates.version,
        investor_updates.document_name,
        investor_updates.type,
        investor_updates.created_at as shared_date 
      FROM sharereport 
      JOIN investor_updates ON investor_updates.id = sharereport.investor_updates_id 
      WHERE sharereport.investor_id = ? 
        AND investor_updates.type = ?
        AND sharereport.access_status != 'Not View'
      ORDER BY sharereport.id DESC
    `;

    // Query 2: Get data from sharerecordround table
    const shareRecordRoundQuery = `
      SELECT 
        sharerecordround.*
      FROM sharerecordround 
      WHERE sharerecordround.investor_id = ?
        AND sharerecordround.access_status != 'Not View'
      ORDER BY sharerecordround.id DESC
    `;

    // Execute both queries
    db.query(
      shareReportQuery,
      [investor_id, type],
      async (err, shareReportResults) => {
        if (err) {
          return res.status(500).json({
            message: "Database query error in sharereport",
            error: err,
          });
        }

        // Execute second query
        db.query(
          shareRecordRoundQuery,
          [investor_id],
          async (err2, shareRecordRoundResults) => {
            if (err2) {
              return res.status(500).json({
                message: "Database query error in sharerecordround",
                error: err2,
              });
            }

            // Combine results from both tables
            const combinedResults = {
              shareReports: shareReportResults,
              shareRecordRounds: shareRecordRoundResults,
              totalCount:
                shareReportResults.length + shareRecordRoundResults.length,
            };

            res.status(200).json({
              message: "Success",
              results: combinedResults,
            });
          },
        );
      },
    );
  } catch (err) {
    res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};

exports.getcheckNextRoundForInvestor = (req, res) => {
  const { company_id, capital_round_id, investor_id } = req.body;

  if (!company_id || !capital_round_id || !investor_id) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  // 1️⃣ Get next round for the same company
  const queryNextRound = `
    SELECT *
    FROM roundrecord
    WHERE company_id = ?
      AND id > ?
    ORDER BY id ASC
    LIMIT 1;
  `;

  db.query(queryNextRound, [company_id, capital_round_id], (err, nextRound) => {
    if (err) {
      console.error("DB Query Error (nextRound):", err);
      return res
        .status(500)
        .json({ message: "Database query error", error: err });
    }

    if (nextRound.length === 0) {
      return res
        .status(200)
        .json({ nextRoundExists: false, message: "No next round" });
    }

    const nextRoundId = nextRound[0].id;

    // 2️⃣ Check if investor has shares in next round
    const queryInvestorNextRound = `
      SELECT *
      FROM sharerecordround
      WHERE investor_id = ?
        AND roundrecord_id = ?;
    `;

    db.query(
      queryInvestorNextRound,
      [investor_id, nextRoundId],
      (err2, investorShares) => {
        if (err2) {
          console.error("DB Query Error (investorShares):", err2);
          return res
            .status(500)
            .json({ message: "Database query error", error: err2 });
        }

        res.status(200).json({
          nextRoundExists: true,
          investorHasShares: investorShares.length > 0,
          nextRoundData: nextRound[0],
        });
      },
    );
  });
};

function safeJSONParse(data) {
  if (!data) return {};

  // If already an object, return as is
  if (typeof data === "object") return data;

  // If string, try to parse with cleaning
  if (typeof data === "string") {
    try {
      let cleanedData = data;

      // Remove extra escaping that happens in MySQL on live server
      if (cleanedData.startsWith('"') && cleanedData.endsWith('"')) {
        cleanedData = cleanedData.slice(1, -1);
      }

      // Replace escaped quotes and slashes
      cleanedData = cleanedData.replace(/\\"/g, '"');
      cleanedData = cleanedData.replace(/\\\\/g, "\\");

      return JSON.parse(cleanedData);
    } catch (parseError) {
      console.error("First parse attempt failed:", parseError);

      // Try alternative cleaning for live server format
      try {
        // For live server double-escaped JSON
        const reCleaned = data
          .replace(/^"|"$/g, "") // Remove surrounding quotes
          .replace(/\\"/g, '"') // Replace escaped quotes
          .replace(/\\n/g, "") // Remove newlines
          .trim();

        return JSON.parse(reCleaned);
      } catch (finalError) {
        console.error("Final parse attempt failed:", finalError);
        console.error("Original data:", data);
        return {};
      }
    }
  }

  return {};
}

exports.getRoundCapTableSingleRecord = (req, res) => {
  const { company_id, round_id } = req.body;

  if (!company_id || !round_id) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
  }

  // STEP 1: Round record fetch karo
  db.query(
    `SELECT r.*, c.year_registration
     FROM roundrecord r
     LEFT JOIN company c ON r.company_id = c.id
     WHERE r.id = ? AND r.company_id = ?`,
    [round_id, company_id],
    (err, roundResults) => {
      if (err || !roundResults || roundResults.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Round not found" });
      }

      const currentRound = roundResults[0];
      const currency = currentRound.currency || "USD";
      const preMoneyVal = parseFloat(currentRound.pre_money) || 0;
      const postMoneyVal = parseFloat(currentRound.post_money) || 0;

      // Round 0 handling
      if (currentRound.round_type === "Round 0") {
        try {
          if (
            currentRound.founder_data &&
            typeof currentRound.founder_data === "string"
          ) {
            currentRound.founder_data = JSON.parse(currentRound.founder_data);
          }
        } catch (parseErr) {
          console.error("Error parsing Round 0 founder_data:", parseErr);
        }

        const round0CapTable = calculateRound0CapTable(currentRound);

        const response = {
          success: true,
          round: {
            id: currentRound.id,
            name: currentRound.nameOfRound || "Round 0",
            type: currentRound.round_type,
            instrument: "Common Stock",
            status: currentRound.roundStatus || "COMPLETED",
            date: currentRound.created_at,
            incorporation_date: currentRound.year_registration,
            pre_money: "0",
            round_target_money: currentRound.round_target_money,
            post_money: "0",
            investment: "0",
            currency: currentRound.currency || "USD",
            share_price: currentRound.share_price || "0.00",
            share_class_type: currentRound.shareClassType,
            instrument_type_data: currentRound.instrument_type_data,
            issued_shares:
              currentRound.issuedshares || currentRound.total_founder_shares,
            total_shares_after:
              currentRound.total_shares_after ||
              currentRound.total_founder_shares,
            option_pool_percent: "0",
            investor_post_money: "0",
          },
          cap_table: {
            pre_money: round0CapTable,
            post_money: round0CapTable,
          },
          pending_conversions: [],
          calculations: {
            pre_money_valuation: 0,
            post_money_valuation: 0,
            total_shares_outstanding: round0CapTable?.totals?.total_shares || 0,
            fully_diluted_shares: round0CapTable?.totals?.total_shares,
            share_price: parseFloat(currentRound.share_price) || 0,
          },
        };

        return res.status(200).json(response);
      }

      // HELPERS
      const fmt = (n) => Math.round(n || 0).toLocaleString();
      const money = (n) => `${currency} ${parseFloat(n || 0).toFixed(2)}`;
      const parseDetails = (d) => {
        try {
          return d ? (typeof d === "string" ? JSON.parse(d) : d) : null;
        } catch {
          return null;
        }
      };

      // ✅ Helper to calculate ownership percentage
      const calculatePercentage = (shares, totalShares) => {
        if (!totalShares || totalShares === 0) return 0;
        return (shares / totalShares) * 100;
      };

      const buildPendingItem = (p) => ({
        type: "pending",
        name:
          `${p.first_name || ""} ${p.last_name || ""}`.trim() ||
          p.round_name ||
          "Pending Investor",
        instrument_type: p.instrument_type,
        investment: parseFloat(p.investment_amount) || 0,
        potential_shares: parseInt(p.potential_shares) || 0,
        conversion_price: parseFloat(p.conversion_price) || 0,
        discount_rate: parseFloat(p.discount_rate) || 0,
        valuation_cap: parseFloat(p.valuation_cap) || 0,
        interest_rate: parseFloat(p.interest_rate) || 0,
        years: parseFloat(p.years) || 0,
        interest_accrued: parseFloat(p.interest_accrued) || 0,
        total_conversion_amount:
          parseFloat(p.total_conversion_amount) ||
          parseFloat(p.investment_amount) ||
          0,
        maturity_date: p.maturity_date || null,
        investor_details: parseDetails(p.investor_details),
        is_pending: true,
        shares: 0,
        new_shares: 0,
        total: 0,
        percentage: 0,
        percentage_formatted: "0.00%",
        value: 0,
        value_formatted: money(0),
        email: p.email || "",
        phone: p.phone || "",
        round_id: p.round_id,
        round_name:
          p.name_of_round ||
          p.round_name ||
          (p.instrument_type === "Convertible Note"
            ? "Convertible Note Round"
            : "SAFE Round"),
        pending_instrument_id: p.id,
        shareClassType: p.round_share_class_type || p.instrument_type,
      });

      const groupPendingByRound = (pendingItems) => {
        const groups = {};
        pendingItems.forEach((item) => {
          const key = `${item.round_id}_${item.instrument_type}`;
          if (!groups[key]) {
            groups[key] = {
              type: "pending_group",
              round_id: item.round_id,
              round_name: item.round_name,
              instrument_type: item.instrument_type,
              shareClassType: item.shareClassType,
              is_pending: true,
              total_investment: 0,
              total_potential_shares: 0,
              items: [],
            };
          }
          groups[key].items.push(item);
          groups[key].total_investment += item.investment;
          groups[key].total_potential_shares += item.potential_shares;
        });

        return Object.values(groups).map((group) => ({
          ...group,
          label: `${group.items.length} investor${group.items.length > 1 ? "s" : ""}`,
          shares: 0,
          new_shares: 0,
          percentage: 0,
          percentage_formatted: "0.00%",
          value: 0,
          value_formatted: money(0),
        }));
      };

      // STEP 2: PRE Founders
      db.query(
        `SELECT * FROM round_founders WHERE round_id=? AND company_id=? AND cap_table_type='pre' ORDER BY id ASC`,
        [round_id, company_id],
        (err, preFounders) => {
          if (err)
            return res
              .status(500)
              .json({ success: false, message: err.message });

          // STEP 3: PRE Investors
          db.query(
            `SELECT * FROM round_investors WHERE round_id=? AND company_id=? AND cap_table_type='pre' ORDER BY id ASC`,
            [round_id, company_id],
            (err, preInvestors) => {
              if (err)
                return res
                  .status(500)
                  .json({ success: false, message: err.message });

              // STEP 4: PRE Option Pool
              db.query(
                `SELECT * FROM round_option_pools WHERE round_id=? AND company_id=? AND cap_table_type='pre'`,
                [round_id, company_id],
                (err, preOptionPools) => {
                  if (err)
                    return res
                      .status(500)
                      .json({ success: false, message: err.message });

                  // STEP 5: POST Founders
                  db.query(
                    `SELECT * FROM round_founders WHERE round_id=? AND company_id=? AND cap_table_type='post' ORDER BY id ASC`,
                    [round_id, company_id],
                    (err, postFounders) => {
                      if (err)
                        return res
                          .status(500)
                          .json({ success: false, message: err.message });

                      // STEP 6: POST Investors
                      db.query(
                        `SELECT * FROM round_investors WHERE round_id=? AND company_id=? AND cap_table_type='post' ORDER BY id ASC`,
                        [round_id, company_id],
                        (err, postInvestors) => {
                          if (err)
                            return res
                              .status(500)
                              .json({ success: false, message: err.message });

                          // STEP 7: POST Option Pool
                          db.query(
                            `SELECT * FROM round_option_pools WHERE round_id=? AND company_id=? AND cap_table_type='post'`,
                            [round_id, company_id],
                            (err, postOptionPools) => {
                              if (err)
                                return res.status(500).json({
                                  success: false,
                                  message: err.message,
                                });

                              // STEP 8: Pending Instruments (SAFE + Convertible Note)
                              db.query(
                                `SELECT ri.*, 
                                  ri.round_name as name_of_round, 
                                  ri.instrument_type as round_instrument_type,
                                  ri.share_class_type as round_share_class_type
                                FROM round_investors ri
                                LEFT JOIN roundrecord r ON r.id = ri.round_id
                                WHERE ri.company_id = ? 
                                  AND ri.round_id = ?
                                  AND ri.investor_type = 'pending'
                                  AND ri.is_pending = 1
                                ORDER BY ri.round_id ASC, ri.id ASC`,
                                [company_id, round_id],
                                (err, pendingInstruments) => {
                                  if (err)
                                    return res.status(500).json({
                                      success: false,
                                      message: err.message,
                                    });

                                  // ========== PRE-MONEY BUILD ==========

                                  // ✅ GET PRE-MONEY WARRANTS
                                  const getPreWarrantsQuery = `
                                    SELECT ri.*, w.expiration_date, w.id as warrant_id
                                    FROM round_investors ri
                                    LEFT JOIN warrants w ON w.id = ri.warrant_id
                                    WHERE ri.round_id = ? 
                                      AND ri.company_id = ? 
                                      AND ri.cap_table_type = 'pre'
                                      AND ri.investor_type IN ('warrant', 'warrant not exercised')
                                      AND (w.expiration_date IS NULL OR w.expiration_date >= CURDATE())
                                  `;

                                  db.query(
                                    getPreWarrantsQuery,
                                    [round_id, company_id],
                                    (preWarrantErr, preWarrantResults) => {
                                      if (preWarrantErr) {
                                        console.error(
                                          "Error fetching pre-money warrants:",
                                          preWarrantErr,
                                        );
                                      }

                                      const preValidWarrants =
                                        preWarrantResults || [];

                                      const preFounderItems = (
                                        preFounders || []
                                      ).map((f) => ({
                                        type: "founder",
                                        founder_code: f.founder_code,
                                        name: `${f.first_name || ""} ${f.last_name || ""}`.trim(),
                                        email: f.email,
                                        phone: f.phone,
                                        shares: f.shares,
                                        shares_formatted: fmt(f.shares),
                                        value: parseFloat(f.value || 0),
                                        value_formatted: money(f.value),
                                        share_class_type: f.share_class_type,
                                        instrument_type: f.instrument_type,
                                        round_name: f.round_name,
                                      }));

                                      const prePool =
                                        (preOptionPools || [])[0] || null;
                                      const prePoolShares = prePool
                                        ? prePool.shares
                                        : 0;
                                      const prePoolValue = prePool
                                        ? parseFloat(prePool.value || 0)
                                        : 0;

                                      const prePrevInv = (
                                        preInvestors || []
                                      ).filter(
                                        (i) => i.investor_type === "previous",
                                      );
                                      const preConvInv = (
                                        preInvestors || []
                                      ).filter(
                                        (i) => i.investor_type === "converted",
                                      );

                                      // ✅ Calculate pre-warrant totals
                                      const preWarrantShares =
                                        preValidWarrants.reduce(
                                          (s, i) => s + i.shares,
                                          0,
                                        );
                                      const preWarrantValue =
                                        preValidWarrants.reduce(
                                          (s, i) =>
                                            s + parseFloat(i.value || 0),
                                          0,
                                        );

                                      const prePrevShares = prePrevInv.reduce(
                                        (s, i) => s + i.shares,
                                        0,
                                      );
                                      const prePrevValue = prePrevInv.reduce(
                                        (s, i) => s + parseFloat(i.value || 0),
                                        0,
                                      );
                                      const preConvShares = preConvInv.reduce(
                                        (s, i) => s + i.shares,
                                        0,
                                      );
                                      const preConvValue = preConvInv.reduce(
                                        (s, i) => s + parseFloat(i.value || 0),
                                        0,
                                      );

                                      const preTotalFounderShares =
                                        preFounderItems.reduce(
                                          (s, f) => s + f.shares,
                                          0,
                                        );
                                      const preTotalFounderValue =
                                        preFounderItems.reduce(
                                          (s, f) => s + f.value,
                                          0,
                                        );
                                      const preTotalShares =
                                        preTotalFounderShares +
                                        prePoolShares +
                                        prePrevShares +
                                        preConvShares +
                                        preWarrantShares; // ✅ Add pre-warrant shares
                                      const preTotalValue =
                                        preTotalFounderValue +
                                        prePoolValue +
                                        prePrevValue +
                                        preConvValue +
                                        preWarrantValue; // ✅ Add pre-warrant value

                                      // Group previous investors by round_name
                                      const prePrevGroups = {};
                                      prePrevInv.forEach((i) => {
                                        const key =
                                          i.round_name || "Previous Investors";
                                        if (!prePrevGroups[key]) {
                                          prePrevGroups[key] = {
                                            round_name: key,
                                            round_id_ref: i.round_id_ref,
                                            shareClassType:
                                              i.share_class_type ||
                                              i.instrument_type ||
                                              "",
                                            instrument_type:
                                              i.instrument_type || "",
                                            items: [],
                                            total_shares: 0,
                                            total_value: 0,
                                          };
                                        }
                                        prePrevGroups[key].items.push(i);
                                        prePrevGroups[key].total_shares +=
                                          i.shares;
                                        prePrevGroups[key].total_value +=
                                          parseFloat(i.value || 0);
                                      });

                                      // ✅ Group pre-warrants by round_name
                                      const preWarrantGroups = {};
                                      preValidWarrants.forEach((i) => {
                                        // Use warrant_id as the unique grouping key
                                        const key = i.warrant_id
                                          ? i.warrant_id.toString()
                                          : `${i.round_name}_${i.investor_type}_${Math.random()}`;

                                        if (!preWarrantGroups[key]) {
                                          preWarrantGroups[key] = {
                                            warrant_id: i.warrant_id,
                                            round_name:
                                              i.round_name || "Warrant",
                                            round_id_ref: i.round_id_ref,
                                            items: [],
                                            total_shares: 0,
                                            total_value: 0,
                                            investor_type: i.investor_type,
                                          };
                                        }
                                        preWarrantGroups[key].items.push(i);
                                        preWarrantGroups[key].total_shares +=
                                          i.shares;
                                        preWarrantGroups[key].total_value +=
                                          parseFloat(i.value || 0);
                                      });

                                      const prePendingItems =
                                        groupPendingByRound(
                                          (pendingInstruments || [])
                                            .filter(
                                              (p) => p.cap_table_type === "pre",
                                            )
                                            .map(buildPendingItem),
                                        );

                                      // Helper function for pre-money warrants
                                      const buildPreWarrantItem = (
                                        warrant,
                                        totalShares,
                                        valuation,
                                      ) => ({
                                        type: "investor",
                                        name:
                                          `${warrant.first_name || ""} ${warrant.last_name || ""}`.trim() ||
                                          "Warrant Holder",
                                        investor_details: {
                                          firstName: warrant.first_name || "",
                                          lastName: warrant.last_name || "",
                                          email: warrant.email || "",
                                          phone: warrant.phone || "",
                                        },
                                        shares: warrant.shares,
                                        new_shares: warrant.shares,
                                        existing_shares: 0,
                                        total: warrant.shares,
                                        shares_formatted: fmt(warrant.shares),
                                        percentage: calculatePercentage(
                                          warrant.shares,
                                          totalShares,
                                        ),
                                        percentage_formatted:
                                          calculatePercentage(
                                            warrant.shares,
                                            totalShares,
                                          ).toFixed(2) + "%",
                                        value: parseFloat(warrant.value || 0),
                                        value_formatted: money(warrant.value),
                                        investment: parseFloat(
                                          warrant.investment_amount || 0,
                                        ),
                                        share_price: parseFloat(
                                          warrant.share_price || 0,
                                        ),
                                        is_previous: false,
                                        is_warrant: true,
                                        is_new_investment: true,
                                        is_converted: false,
                                        investor_type: warrant.investor_type,
                                        share_class_type:
                                          warrant.share_class_type,
                                        instrument_type:
                                          warrant.instrument_type,
                                        round_name: warrant.round_name,
                                        round_id: warrant.round_id,
                                        warrant_id: warrant.warrant_id,
                                      });

                                      // ✅ Calculate pre-money percentages
                                      const preMoneyCapTable = {
                                        total_shares: preTotalShares,
                                        pre_money_valuation: preMoneyVal,
                                        currency,
                                        items: [
                                          ...preFounderItems.map((item) => ({
                                            ...item,
                                            percentage: calculatePercentage(
                                              item.shares,
                                              preTotalShares,
                                            ),
                                            percentage_formatted:
                                              calculatePercentage(
                                                item.shares,
                                                preTotalShares,
                                              ).toFixed(2) + "%",
                                          })),
                                          ...(prePool
                                            ? [
                                                {
                                                  type: "option_pool",
                                                  founder_code: "O",
                                                  name: "Employee Option Pool",
                                                  shares: prePoolShares,
                                                  shares_formatted:
                                                    fmt(prePoolShares),
                                                  percentage:
                                                    calculatePercentage(
                                                      prePoolShares,
                                                      preTotalShares,
                                                    ),
                                                  percentage_formatted:
                                                    calculatePercentage(
                                                      prePoolShares,
                                                      preTotalShares,
                                                    ).toFixed(2) + "%",
                                                  value: prePoolValue,
                                                  value_formatted:
                                                    money(prePoolValue),
                                                  is_option_pool: true,
                                                  existing_shares:
                                                    prePool.existing_shares ||
                                                    prePoolShares,
                                                  new_shares:
                                                    prePool.new_shares || 0,
                                                },
                                              ]
                                            : []),
                                          ...Object.values(prePrevGroups).map(
                                            (group) => ({
                                              type: "investor",
                                              name: group.round_name,
                                              label: `${group.items.length} investor${group.items.length > 1 ? "s" : ""}`,
                                              round_id_ref: group.round_id_ref,
                                              share_class_type: "",
                                              shares: group.total_shares,
                                              shares_formatted: fmt(
                                                group.total_shares,
                                              ),
                                              percentage: calculatePercentage(
                                                group.total_shares,
                                                preTotalShares,
                                              ),
                                              percentage_formatted:
                                                calculatePercentage(
                                                  group.total_shares,
                                                  preTotalShares,
                                                ).toFixed(2) + "%",
                                              value: group.total_value,
                                              value_formatted: money(
                                                group.total_value,
                                              ),
                                              investor_details: group.items.map(
                                                (i) => ({
                                                  type: "investor",
                                                  name: `${i.first_name || ""} ${i.last_name || ""}`.trim(),
                                                  email: i.email,
                                                  phone: i.phone,
                                                  shares: i.shares,
                                                  shares_formatted: fmt(
                                                    i.shares,
                                                  ),
                                                  percentage:
                                                    calculatePercentage(
                                                      i.shares,
                                                      preTotalShares,
                                                    ),
                                                  percentage_formatted:
                                                    calculatePercentage(
                                                      i.shares,
                                                      preTotalShares,
                                                    ).toFixed(2) + "%",
                                                  value: parseFloat(
                                                    i.value || 0,
                                                  ),
                                                  value_formatted: money(
                                                    i.value,
                                                  ),
                                                  share_class_type:
                                                    i.share_class_type,
                                                  instrument_type:
                                                    i.instrument_type,
                                                  round_name: i.round_name,
                                                  round_id_ref: i.round_id_ref,
                                                  share_class_type: "in",
                                                  investor_details:
                                                    parseDetails(
                                                      i.investor_details,
                                                    ),
                                                  is_previous: true,
                                                }),
                                              ),
                                            }),
                                          ),
                                          ...(preConvInv.length > 0
                                            ? [
                                                {
                                                  type: "investor",
                                                  name: "Converted Notes",
                                                  label: `${preConvInv.length} investor${preConvInv.length > 1 ? "s" : ""}`,
                                                  shares: preConvShares,
                                                  shares_formatted:
                                                    fmt(preConvShares),
                                                  percentage:
                                                    calculatePercentage(
                                                      preConvShares,
                                                      preTotalShares,
                                                    ),
                                                  percentage_formatted:
                                                    calculatePercentage(
                                                      preConvShares,
                                                      preTotalShares,
                                                    ).toFixed(2) + "%",
                                                  value: preConvValue,
                                                  value_formatted:
                                                    money(preConvValue),
                                                  items: preConvInv.map(
                                                    (i) => ({
                                                      type: "investor",
                                                      name: `${i.first_name || ""} ${i.last_name || ""}`.trim(),
                                                      shares: i.shares,
                                                      shares_formatted: fmt(
                                                        i.shares,
                                                      ),
                                                      percentage:
                                                        calculatePercentage(
                                                          i.shares,
                                                          preTotalShares,
                                                        ),
                                                      percentage_formatted:
                                                        calculatePercentage(
                                                          i.shares,
                                                          preTotalShares,
                                                        ).toFixed(2) + "%",
                                                      value: parseFloat(
                                                        i.value || 0,
                                                      ),
                                                      value_formatted: money(
                                                        i.value,
                                                      ),
                                                      is_converted: true,
                                                      investor_details:
                                                        parseDetails(
                                                          i.investor_details,
                                                        ),
                                                    }),
                                                  ),
                                                },
                                              ]
                                            : []),
                                          // ✅ Add pre-money warrants
                                          ...Object.values(
                                            preWarrantGroups,
                                          ).map((group) => {
                                            const warrant = group.items[0];
                                            let displayName = group.round_name;
                                            if (
                                              warrant.first_name ||
                                              warrant.last_name
                                            ) {
                                              displayName =
                                                `${warrant.first_name || ""} ${warrant.last_name || ""}`.trim();
                                            }
                                            return {
                                              type: "investor",
                                              name: displayName,
                                              label: "1 warrant",
                                              shares: group.total_shares,
                                              new_shares: group.total_shares,
                                              existing_shares: 0,
                                              total: group.total_shares,
                                              shares_formatted: fmt(
                                                group.total_shares,
                                              ),
                                              percentage: calculatePercentage(
                                                group.total_shares,
                                                preTotalShares,
                                              ),
                                              percentage_formatted:
                                                calculatePercentage(
                                                  group.total_shares,
                                                  preTotalShares,
                                                ).toFixed(2) + "%",
                                              value: group.total_value,
                                              value_formatted: money(
                                                group.total_value,
                                              ),
                                              investor_type:
                                                group.investor_type,
                                              is_warrant: true,
                                              is_new_investment: true,
                                              warrant_id: group.warrant_id,
                                              investor_details: group.items.map(
                                                (i) => ({
                                                  type: "investor",
                                                  investor_type:
                                                    i.investor_type,
                                                  name:
                                                    `${i.first_name || ""} ${i.last_name || ""}`.trim() ||
                                                    "Warrant Holder",
                                                  email: i.email || "",
                                                  phone: i.phone || "",
                                                  shares: i.shares,
                                                  shares_formatted: fmt(
                                                    i.shares,
                                                  ),
                                                  percentage:
                                                    calculatePercentage(
                                                      i.shares,
                                                      preTotalShares,
                                                    ),
                                                  percentage_formatted:
                                                    calculatePercentage(
                                                      i.shares,
                                                      preTotalShares,
                                                    ).toFixed(2) + "%",
                                                  value: parseFloat(
                                                    i.value || 0,
                                                  ),
                                                  value_formatted: money(
                                                    i.value,
                                                  ),
                                                  is_warrant: true,
                                                  warrant_id: i.warrant_id,
                                                  investment_amount: parseFloat(
                                                    i.investment_amount || 0,
                                                  ),
                                                  share_price: parseFloat(
                                                    i.share_price || 0,
                                                  ),
                                                }),
                                              ),
                                            };
                                          }),
                                          ...prePendingItems,
                                        ],
                                        totals: {
                                          total_shares: preTotalShares,
                                          total_shares_formatted:
                                            fmt(preTotalShares),
                                          total_founders: preTotalFounderShares,
                                          total_option_pool: prePoolShares,
                                          total_investors:
                                            prePrevShares +
                                            preConvShares +
                                            preWarrantShares,
                                          total_value: preTotalValue,
                                          total_value_formatted:
                                            money(preTotalValue),
                                          total_percentage: "100.00%",
                                        },
                                      };

                                      // ========== POST-MONEY BUILD WITH WARRANT EXPIRY CHECK ==========

                                      // Get all investors first
                                      const postPrevInv = (
                                        postInvestors || []
                                      ).filter(
                                        (i) => i.investor_type === "previous",
                                      );
                                      const postConvInv = (
                                        postInvestors || []
                                      ).filter(
                                        (i) => i.investor_type === "converted",
                                      );
                                      const postCurrInv = (
                                        postInvestors || []
                                      ).filter(
                                        (i) => i.investor_type === "current",
                                      );

                                      // ✅ Get warrants and check expiry by joining with warrants table
                                      const postWarrantInv = [];

                                      // We'll use a separate query to get warrants with expiry check
                                      const getWarrantsWithExpiryQuery = `
                                        SELECT ri.*, w.expiration_date 
                                        FROM round_investors ri
                                        LEFT JOIN warrants w ON w.id = ri.warrant_id
                                        WHERE ri.round_id = ? 
                                          AND ri.company_id = ? 
                                          AND ri.cap_table_type = 'post'
                                          AND ri.investor_type IN ('warrant', 'warrant not exercised')
                                          AND (w.expiration_date IS NULL OR w.expiration_date >= CURDATE())
                                      `;

                                      // Execute the query synchronously within the callback
                                      db.query(
                                        getWarrantsWithExpiryQuery,
                                        [round_id, company_id],
                                        (warrantErr, warrantResults) => {
                                          if (warrantErr) {
                                            console.error(
                                              "Error fetching warrants with expiry:",
                                              warrantErr,
                                            );
                                          }

                                          const validWarrants =
                                            warrantResults || [];

                                          // Now continue with the rest of the post-money build
                                          const postFounderItems = (
                                            postFounders || []
                                          ).map((f) => ({
                                            type: "founder",
                                            founder_code: f.founder_code,
                                            name: `${f.first_name || ""} ${f.last_name || ""}`.trim(),
                                            email: f.email,
                                            phone: f.phone,
                                            existing_shares: f.shares,
                                            new_shares: 0,
                                            shares: f.shares,
                                            total_shares: f.shares,
                                            shares_formatted: fmt(f.shares),
                                            value: parseFloat(f.value || 0),
                                            value_formatted: money(f.value),
                                            share_class_type:
                                              f.share_class_type,
                                            instrument_type: f.instrument_type,
                                            round_name: f.round_name,
                                          }));

                                          const postPool =
                                            (postOptionPools || [])[0] || null;
                                          const postPoolExisting = postPool
                                            ? postPool.existing_shares || 0
                                            : 0;
                                          const postPoolNew = postPool
                                            ? postPool.new_shares || 0
                                            : 0;
                                          const postPoolTotal = postPool
                                            ? postPool.shares
                                            : 0;
                                          const postPoolValue = postPool
                                            ? parseFloat(postPool.value || 0)
                                            : 0;

                                          const postPrevShares =
                                            postPrevInv.reduce(
                                              (s, i) => s + i.shares,
                                              0,
                                            );
                                          const postPrevValue =
                                            postPrevInv.reduce(
                                              (s, i) =>
                                                s + parseFloat(i.value || 0),
                                              0,
                                            );
                                          const postConvShares =
                                            postConvInv.reduce(
                                              (s, i) => s + i.shares,
                                              0,
                                            );
                                          const postConvValue =
                                            postConvInv.reduce(
                                              (s, i) =>
                                                s + parseFloat(i.value || 0),
                                              0,
                                            );
                                          const postCurrShares =
                                            postCurrInv.reduce(
                                              (s, i) => s + i.shares,
                                              0,
                                            );
                                          const postCurrValue =
                                            postCurrInv.reduce(
                                              (s, i) =>
                                                s + parseFloat(i.value || 0),
                                              0,
                                            );

                                          // ✅ Calculate warrant totals from valid warrants only
                                          const postWarrantShares =
                                            validWarrants.reduce(
                                              (s, i) => s + i.shares,
                                              0,
                                            );
                                          const postWarrantValue =
                                            validWarrants.reduce(
                                              (s, i) =>
                                                s + parseFloat(i.value || 0),
                                              0,
                                            );

                                          const postTotalFounderShares =
                                            postFounderItems.reduce(
                                              (s, f) => s + f.shares,
                                              0,
                                            );
                                          const postTotalFounderValue =
                                            postFounderItems.reduce(
                                              (s, f) => s + f.value,
                                              0,
                                            );

                                          const postTotalShares =
                                            postTotalFounderShares +
                                            postPoolTotal +
                                            postPrevShares +
                                            postConvShares +
                                            postCurrShares +
                                            postWarrantShares; // ✅ Add warrant shares

                                          const postTotalNewShares =
                                            postPoolNew +
                                            postConvShares +
                                            postCurrShares +
                                            postWarrantShares; // ✅ Add warrant shares to new shares

                                          const postTotalValue =
                                            postTotalFounderValue +
                                            postPoolValue +
                                            postPrevValue +
                                            postConvValue +
                                            postCurrValue +
                                            postWarrantValue; // ✅ Add warrant value

                                          const postPendingItems =
                                            groupPendingByRound(
                                              (pendingInstruments || [])
                                                .filter(
                                                  (p) =>
                                                    p.cap_table_type === "post",
                                                )
                                                .map(buildPendingItem),
                                            );

                                          // Previous investors group by round_name
                                          const postPrevGroups = {};
                                          postPrevInv.forEach((i) => {
                                            const key =
                                              i.round_name ||
                                              "Previous Investors";
                                            if (!postPrevGroups[key]) {
                                              postPrevGroups[key] = {
                                                round_name: key,
                                                round_id_ref: i.round_id_ref,
                                                items: [],
                                                total_shares: 0,
                                                total_value: 0,
                                              };
                                            }
                                            postPrevGroups[key].items.push(i);
                                            postPrevGroups[key].total_shares +=
                                              i.shares;
                                            postPrevGroups[key].total_value +=
                                              parseFloat(i.value || 0);
                                          });

                                          // Converted investors group by round_name
                                          const postConvGroups = {};
                                          postConvInv.forEach((i) => {
                                            const key =
                                              i.round_name || "Converted Notes";
                                            if (!postConvGroups[key]) {
                                              postConvGroups[key] = {
                                                round_name: key,
                                                round_id_ref: i.round_id_ref,
                                                items: [],
                                                total_shares: 0,
                                                total_value: 0,
                                              };
                                            }
                                            postConvGroups[key].items.push(i);
                                            postConvGroups[key].total_shares +=
                                              i.shares;
                                            postConvGroups[key].total_value +=
                                              parseFloat(i.value || 0);
                                          });

                                          // Current (new) investors group by round_name
                                          const postCurrGroups = {};
                                          postCurrInv.forEach((i) => {
                                            const key =
                                              i.round_name || "New Investors";
                                            if (!postCurrGroups[key]) {
                                              postCurrGroups[key] = {
                                                round_name: key,
                                                round_id_ref: i.round_id_ref,
                                                items: [],
                                                total_shares: 0,
                                                total_new_shares: 0,
                                                total_value: 0,
                                              };
                                            }
                                            postCurrGroups[key].items.push(i);
                                            postCurrGroups[key].total_shares +=
                                              i.shares;
                                            postCurrGroups[
                                              key
                                            ].total_new_shares +=
                                              i.new_shares || i.shares;
                                            postCurrGroups[key].total_value +=
                                              parseFloat(i.value || 0);
                                          });

                                          // ✅ Warrants group by round_name (from valid warrants only)
                                          const postWarrantGroups = {};
                                          validWarrants.forEach((i) => {
                                            // Use warrant_id as the unique grouping key
                                            const key = i.warrant_id
                                              ? i.warrant_id.toString()
                                              : `${i.round_name}_${i.investor_type}_${Math.random()}`;

                                            if (!postWarrantGroups[key]) {
                                              postWarrantGroups[key] = {
                                                warrant_id: i.warrant_id,
                                                round_name:
                                                  i.round_name || "Warrant",
                                                round_id_ref: i.round_id_ref,
                                                items: [],
                                                total_shares: 0,
                                                total_value: 0,
                                                investor_type: i.investor_type,
                                              };
                                            }
                                            postWarrantGroups[key].items.push(
                                              i,
                                            );
                                            postWarrantGroups[
                                              key
                                            ].total_shares += i.shares;
                                            postWarrantGroups[
                                              key
                                            ].total_value += parseFloat(
                                              i.value || 0,
                                            );
                                          });

                                          // Helper: group → item

                                          const buildGroupItem = (
                                            group,
                                            investorType,
                                            totalShares,
                                          ) => ({
                                            type: "investor",
                                            investor_type: investorType, // ✅ This will be 'warrant' or 'warrant not exercised'
                                            name: group.round_name,
                                            label: `${group.items.length} investor${group.items.length > 1 ? "s" : ""}`,
                                            round_id_ref: group.round_id_ref,
                                            share_class_type:
                                              group.share_class_type,
                                            shares: group.total_shares,
                                            existing_shares:
                                              investorType === "current" ||
                                              investorType === "converted" ||
                                              investorType === "warrant" ||
                                              investorType ===
                                                "warrant not exercised" // ✅ Add this
                                                ? 0
                                                : group.total_shares,
                                            new_shares:
                                              investorType === "current" ||
                                              investorType === "converted" ||
                                              investorType === "warrant" ||
                                              investorType ===
                                                "warrant not exercised" // ✅ Add this
                                                ? group.total_shares
                                                : 0,
                                            total_shares: group.total_shares,
                                            shares_formatted: fmt(
                                              group.total_shares,
                                            ),
                                            percentage: calculatePercentage(
                                              group.total_shares,
                                              totalShares,
                                            ),
                                            percentage_formatted:
                                              calculatePercentage(
                                                group.total_shares,
                                                totalShares,
                                              ).toFixed(2) + "%",
                                            value: group.total_value,
                                            value_formatted: money(
                                              group.total_value,
                                            ),
                                            is_previous:
                                              investorType === "previous",
                                            is_new_investment:
                                              investorType === "current",
                                            is_converted:
                                              investorType === "converted",
                                            is_warrant:
                                              investorType === "warrant" ||
                                              investorType ===
                                                "warrant not exercised", // ✅ Update this line
                                            investor_details: group.items.map(
                                              (i) => ({
                                                type: "investor",
                                                investor_type: investorType, // ✅ This will be 'warrant' or 'warrant not exercised'
                                                name: `${i.first_name || ""} ${i.last_name || ""}`.trim(),
                                                email: i.email,
                                                phone: i.phone,
                                                shares: i.shares,
                                                existing_shares:
                                                  investorType === "current" ||
                                                  investorType ===
                                                    "converted" ||
                                                  investorType === "warrant" ||
                                                  investorType ===
                                                    "warrant not exercised" // ✅ Add this
                                                    ? 0
                                                    : i.shares,
                                                new_shares:
                                                  investorType === "current" ||
                                                  investorType ===
                                                    "converted" ||
                                                  investorType === "warrant" ||
                                                  investorType ===
                                                    "warrant not exercised" // ✅ Add this
                                                    ? i.new_shares || i.shares
                                                    : 0,
                                                shares_formatted: fmt(i.shares),
                                                percentage: calculatePercentage(
                                                  i.shares,
                                                  totalShares,
                                                ),
                                                percentage_formatted:
                                                  calculatePercentage(
                                                    i.shares,
                                                    totalShares,
                                                  ).toFixed(2) + "%",
                                                value: parseFloat(i.value || 0),
                                                value_formatted: money(i.value),
                                                investment_amount: parseFloat(
                                                  i.investment_amount || 0,
                                                ),
                                                share_price: parseFloat(
                                                  i.share_price || 0,
                                                ),
                                                share_class_type:
                                                  i.share_class_type,
                                                instrument_type:
                                                  i.instrument_type,
                                                round_name: i.round_name,
                                                round_id_ref: i.round_id_ref,
                                                share_class_type:
                                                  i.share_class_type,
                                                is_previous:
                                                  investorType === "previous",
                                                is_new_investment:
                                                  investorType === "current",
                                                is_converted:
                                                  investorType === "converted",
                                                is_warrant:
                                                  investorType === "warrant" ||
                                                  investorType ===
                                                    "warrant not exercised", // ✅ Update this line
                                                investor_details: parseDetails(
                                                  i.investor_details,
                                                ),
                                                potential_shares:
                                                  parseInt(
                                                    i.potential_shares,
                                                  ) || 0,
                                                conversion_price:
                                                  parseFloat(
                                                    i.conversion_price,
                                                  ) || 0,
                                                discount_rate:
                                                  parseFloat(i.discount_rate) ||
                                                  0,
                                                valuation_cap:
                                                  parseFloat(i.valuation_cap) ||
                                                  0,
                                                interest_rate:
                                                  parseFloat(i.interest_rate) ||
                                                  0,
                                                years: parseFloat(i.years) || 0,
                                                interest_accrued:
                                                  parseFloat(
                                                    i.interest_accrued,
                                                  ) || 0,
                                                total_conversion_amount:
                                                  parseFloat(
                                                    i.total_conversion_amount,
                                                  ) ||
                                                  parseFloat(
                                                    i.investment_amount,
                                                  ) ||
                                                  0,
                                                maturity_date:
                                                  i.maturity_date || null,
                                                warrant_id: i.warrant_id,
                                              }),
                                            ),
                                          });

                                          // ========== POST-MONEY CAP TABLE WITH WARRANTS ==========
                                          const postMoneyCapTable = {
                                            total_shares: postTotalShares,
                                            post_money_valuation: postMoneyVal,
                                            currency,
                                            items: [
                                              ...postFounderItems.map(
                                                (item) => ({
                                                  ...item,
                                                  percentage:
                                                    calculatePercentage(
                                                      item.shares,
                                                      postTotalShares,
                                                    ),
                                                  percentage_formatted:
                                                    calculatePercentage(
                                                      item.shares,
                                                      postTotalShares,
                                                    ).toFixed(2) + "%",
                                                }),
                                              ),
                                              ...(postPool
                                                ? [
                                                    {
                                                      type: "option_pool",
                                                      name: "Employee Option Pool",
                                                      label: "Options Pool",
                                                      existing_shares:
                                                        postPoolExisting,
                                                      new_shares: postPoolNew,
                                                      shares: postPoolTotal,
                                                      total_shares:
                                                        postPoolTotal,
                                                      shares_formatted:
                                                        fmt(postPoolTotal),
                                                      percentage:
                                                        calculatePercentage(
                                                          postPoolTotal,
                                                          postTotalShares,
                                                        ),
                                                      percentage_formatted:
                                                        calculatePercentage(
                                                          postPoolTotal,
                                                          postTotalShares,
                                                        ).toFixed(2) + "%",
                                                      value: postPoolValue,
                                                      value_formatted:
                                                        money(postPoolValue),
                                                      is_option_pool: true,
                                                      instrument_type:
                                                        postPool.instrument_type ||
                                                        "Options",
                                                    },
                                                  ]
                                                : []),
                                              ...Object.values(
                                                postPrevGroups,
                                              ).map((g) =>
                                                buildGroupItem(
                                                  g,
                                                  "previous",
                                                  postTotalShares,
                                                ),
                                              ),
                                              ...Object.values(
                                                postConvGroups,
                                              ).map((g) =>
                                                buildGroupItem(
                                                  g,
                                                  "converted",
                                                  postTotalShares,
                                                ),
                                              ),
                                              ...Object.values(
                                                postCurrGroups,
                                              ).map((g) =>
                                                buildGroupItem(
                                                  g,
                                                  "current",
                                                  postTotalShares,
                                                ),
                                              ),
                                              // ✅ Add warrant groups
                                              ...Object.values(
                                                postWarrantGroups,
                                              ).map((g) =>
                                                buildGroupItem(
                                                  g,
                                                  g.investor_type,
                                                  postTotalShares,
                                                ),
                                              ),
                                              ...postPendingItems.map(
                                                (item) => ({
                                                  ...item,
                                                  percentage:
                                                    calculatePercentage(
                                                      item.total_potential_shares ||
                                                        0,
                                                      postTotalShares,
                                                    ),
                                                  percentage_formatted:
                                                    calculatePercentage(
                                                      item.total_potential_shares ||
                                                        0,
                                                      postTotalShares,
                                                    ).toFixed(2) + "%",
                                                }),
                                              ),
                                            ],
                                            totals: {
                                              total_shares: postTotalShares,
                                              total_shares_formatted:
                                                fmt(postTotalShares),
                                              total_new_shares:
                                                postTotalNewShares,
                                              total_new_shares_formatted:
                                                fmt(postTotalNewShares),
                                              total_founders:
                                                postTotalFounderShares,
                                              total_option_pool: postPoolTotal,
                                              total_investors:
                                                postPrevShares +
                                                postConvShares +
                                                postCurrShares +
                                                postWarrantShares,
                                              total_value: postTotalValue,
                                              total_value_formatted:
                                                money(postTotalValue),
                                              total_percentage: "100.00%",
                                            },
                                          };

                                          // ========== FINAL RESPONSE ==========
                                          return res.status(200).json({
                                            success: true,
                                            round: {
                                              id: currentRound.id,
                                              name: currentRound.nameOfRound,
                                              shareClassType:
                                                currentRound.shareClassType,
                                              incorporation_date:
                                                currentRound.year_registration,
                                              type: currentRound.round_type,
                                              instrument:
                                                currentRound.instrumentType,
                                              status: currentRound.roundStatus,
                                              date: currentRound.created_at,
                                              pre_money: currentRound.pre_money,
                                              post_money:
                                                currentRound.post_money,
                                              investment:
                                                currentRound.roundsize,
                                              currency: currentRound.currency,
                                              share_price:
                                                currentRound.share_price,
                                              round_target_money:
                                                currentRound.round_target_money,
                                              issued_shares:
                                                currentRound.issuedshares,
                                              option_pool_percent:
                                                currentRound.optionPoolPercent,
                                              option_pool_percent_post:
                                                currentRound.optionPoolPercent_post,
                                              instrument_type_data:
                                                currentRound.instrument_type_data,
                                              investor_post_money:
                                                currentRound.investorPostMoney,
                                            },
                                            cap_table: {
                                              pre_money: preMoneyCapTable,
                                              post_money: postMoneyCapTable,
                                            },
                                            calculations: {
                                              pre_money_valuation: preMoneyVal,
                                              post_money_valuation:
                                                postMoneyVal,
                                              total_shares_outstanding:
                                                postTotalShares,
                                              fully_diluted_shares:
                                                postTotalShares,
                                              share_price:
                                                parseFloat(
                                                  currentRound.share_price,
                                                ) || 0,
                                              total_new_shares:
                                                postTotalNewShares,
                                              total_investors:
                                                postPrevShares +
                                                postConvShares +
                                                postCurrShares +
                                                postWarrantShares,
                                            },
                                          });
                                        },
                                      );
                                    },
                                  );
                                },
                              );
                            },
                          );
                        },
                      );
                    },
                  );
                },
              );
            },
          );
        },
      );
    },
  );
};
exports.getRoundCapTableSingleRecordsss = (req, res) => {
  const { company_id, round_id } = req.body;

  if (!company_id || !round_id) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields",
    });
  }

  db.query(
    "SELECT r.*,c.year_registration FROM roundrecord as r LEFT JOIN company c ON r.company_id = c.id WHERE r.id = ? And r.company_id = ?",
    [round_id, company_id],
    (err, roundResults) => {
      if (err || roundResults.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Round not found",
        });
      }

      const currentRound = roundResults[0];

      // SPECIAL CASE: ROUND 0
      if (currentRound.round_type === "Round 0") {
        // Parse founder_data for Round 0
        try {
          if (
            currentRound.founder_data &&
            typeof currentRound.founder_data === "string"
          ) {
            currentRound.founder_data = JSON.parse(currentRound.founder_data);
          }
        } catch (parseErr) {
          console.error("Error parsing Round 0 founder_data:", parseErr);
        }

        const round0CapTable = calculateRound0CapTable(currentRound);

        const response = {
          success: true,
          round: {
            id: currentRound.id,
            name: currentRound.nameOfRound || "Round 0",
            type: currentRound.round_type,
            instrument: "Common Stock",
            status: currentRound.roundStatus || "COMPLETED",
            date: currentRound.created_at,
            incorporation_date: currentRound.year_registration,
            pre_money: "0",
            round_target_money: currentRound.round_target_money,
            post_money: "0",
            investment: "0",
            currency: currentRound.currency || "USD",
            share_price: currentRound.share_price || "0.00",
            share_class_type: currentRound.shareClassType,
            issued_shares:
              currentRound.issuedshares || currentRound.total_founder_shares,
            total_shares_after:
              currentRound.total_shares_after ||
              currentRound.total_founder_shares,
            option_pool_percent: "0",
            investor_post_money: "0",
          },
          cap_table: {
            pre_money: round0CapTable,
            post_money: round0CapTable,
          },

          pending_conversions: [],
          calculations: {
            pre_money_valuation: 0,
            post_money_valuation: 0,
            total_shares_outstanding: round0CapTable?.totals?.total_shares || 0,
            fully_diluted_shares: round0CapTable?.totals?.total_shares,
            share_price: parseFloat(currentRound.share_price) || 0,
          },
        };

        return res.status(200).json(response);
      }

      // Parse JSON fields
      try {
        if (currentRound.founder_data) {
          currentRound.founder_data =
            typeof currentRound.founder_data === "string"
              ? JSON.parse(currentRound.founder_data)
              : currentRound.founder_data;
        }
        if (currentRound.instrument_type_data) {
          currentRound.instrument_type_data =
            typeof currentRound.instrument_type_data === "string"
              ? JSON.parse(currentRound.instrument_type_data)
              : currentRound.instrument_type_data;
        }
      } catch (parseErr) {
        console.error("Error parsing JSON data:", parseErr);
      }

      // Get all previous rounds
      db.query(
        `SELECT r.*,c.year_registration FROM roundrecord as r LEFT JOIN company c ON r.company_id = c.id WHERE r.company_id = ? AND r.id <= ? ORDER BY id ASC`,
        [company_id, round_id],
        async (err, allRounds) => {
          if (err) {
            return res.status(500).json({
              success: false,
              message: "Database error",
            });
          }

          // Parse JSON for all rounds
          allRounds.forEach((round) => {
            try {
              if (round.founder_data) {
                round.founder_data =
                  typeof round.founder_data === "string"
                    ? JSON.parse(round.founder_data)
                    : round.founder_data;
              }
              if (round.instrument_type_data) {
                round.instrument_type_data =
                  typeof round.instrument_type_data === "string"
                    ? JSON.parse(round.instrument_type_data)
                    : round.instrument_type_data;
              }
            } catch (e) {
              console.warn(`Could not parse data for round ${round.id}`);
            }
          });
          const conversionData = await getConversionTrackingData(company_id);
          const pendingConversions = await getPendingConversions(
            company_id,
            round_id,
          );

          // ✅ FIX 1: Check if current round is SAFE/CONVERTIBLE and its conversion status
          const isUnpricedRound =
            currentRound.instrumentType === "Safe" ||
            currentRound.instrumentType === "Convertible Note";

          const conversionRecord = conversionData.find(
            (c) => parseInt(c.original_round_id) === parseInt(currentRound.id),
          );

          const isConverted = !!conversionRecord;

          // ✅ COUNT INVESTMENT ROUNDS IN ALLROUNDS
          const investmentRoundsCount = allRounds.filter(
            (round) =>
              round.instrumentType === "Common Stock" ||
              round.instrumentType === "Preferred Equity",
          ).length;

          // ✅ CONDITIONAL FUNCTION CALLS
          if (investmentRoundsCount >= 2) {
            // Agar investment rounds hain to Investment version call karo

            preMoneyCapTable =
              calculateCPAVATEPreMoneyCapTableInvestment(currentRound);

            postMoneyCapTable =
              calculateCPAVATEPostMoneyCapTableInvestment(currentRound);
          } else {
            // Agar koi investment round nahi hai to standard version call karo

            preMoneyCapTable = calculateCPAVATEPreMoneyCapTable(
              allRounds,
              currentRound,
              conversionData,
            );

            postMoneyCapTable = calculateCPAVATEPostMoneyCapTable(
              allRounds,
              currentRound,
              conversionData,
            );
          }

          const calculations = calculateCPAVATERoundMetrics(
            currentRound,
            allRounds,
            preMoneyCapTable,
            postMoneyCapTable,
          );

          const instrumentDetails = extractInstrumentDetails(currentRound);

          // ✅ FIX 2: Round response with N/A for unconverted SAFE/Note
          const roundResponse = {
            id: currentRound.id,
            name: currentRound.nameOfRound,
            shareClassType: currentRound.shareClassType,
            type: currentRound.round_type,
            instrument: currentRound.instrumentType,
            round_target_money: currentRound.round_target_money,
            status: currentRound.roundStatus,
            date: currentRound.created_at,
            pre_money: currentRound.pre_money,
            post_money: currentRound.post_money,
            investment: currentRound.roundsize,
            currency: currentRound.currency,
            incorporation_date: allRounds[0].year_registration,
            // ✅ SAFE/CONVERTIBLE HANDLING - N/A if not converted
            share_price: isUnpricedRound
              ? isConverted
                ? currentRound.share_price
                : "N/A"
              : currentRound.share_price,
            issued_shares: isUnpricedRound
              ? isConverted
                ? currentRound.issuedshares
                : "N/A"
              : currentRound.issuedshares,
            option_pool_percent: currentRound.optionPoolPercent,
            option_pool_percent_post: currentRound.optionPoolPercent_post,
            investor_post_money: currentRound.investorPostMoney,
            instrument_details: instrumentDetails,
          };

          // ✅ FIX 3: Add conversion status to response
          const conversionStatus = {
            is_unpriced_round: isUnpricedRound,
            is_converted: isConverted,
            converted_in_round: conversionRecord?.conversion_round_id || null,
            converted_round_name:
              conversionRecord?.conversion_round_name || null,
            converted_shares: conversionRecord?.converted_shares || 0,
            conversion_price: conversionRecord?.conversion_price || 0,
            message: isUnpricedRound
              ? isConverted
                ? `✅ This ${currentRound.instrumentType} converted in Round ${conversionRecord.conversion_round_id}`
                : `⏳ This ${currentRound.instrumentType} has NOT been converted yet`
              : null,
          };

          const response = {
            success: true,
            round: roundResponse,
            conversion_status: conversionStatus, // ✅ ADDED
            cap_table: {
              pre_money: preMoneyCapTable,
              post_money: postMoneyCapTable,
            },
            pending_conversions: pendingConversions,
            conversions: conversionData,
            calculations: calculations,
          };

          return res.status(200).json(response);
        },
      );
    },
  );
};

// ============================================
function calculateCPAVATEPreMoneyCapTableInvestment(currentRound) {
  const capTable = [];
  let totalShares = 0;
  const preMoneyValuation = parseFloat(currentRound.pre_money) || 0;
  const isCurrentRoundRound0 = currentRound.round_type === "Round 0";

  // ========== GET FOUNDER SHARES ==========
  let founderList = [];
  if (currentRound.founder_data) {
    try {
      const founderData =
        typeof currentRound.founder_data === "string"
          ? JSON.parse(currentRound.founder_data)
          : currentRound.founder_data;

      if (founderData.founders && Array.isArray(founderData.founders)) {
        founderData.founders.forEach((founder, idx) => {
          const shares = parseFloat(founder.shares) || 0;
          founderList.push({
            name:
              `${founder.firstName || ""} ${founder.lastName || ""}`.trim() ||
              `Founder ${idx + 1}`,
            shares: shares,
            email: founder.email || "",
            phone: founder.phone || "",
            founder_code: `F${idx + 1}`,
            share_type: founder.shareType || "common",
            voting: founder.voting || "voting",
          });
        });
      }
    } catch (e) {
      console.error("Error parsing founder data:", e);
    }
  }

  // ========== ADD FOUNDERS ==========
  founderList.forEach((founder) => {
    capTable.push({
      type: "founder",
      name: founder.name,
      shares: founder.shares,
      percentage: "0.00",
      founder_code: founder.founder_code,
      email: founder.email,
      phone: founder.phone,
      share_type: founder.share_type,
      voting: founder.voting,
      pre_money_display_value: 0,
      investor_details: {
        firstName: founder.name?.split(" ")[0] || "",
        lastName: founder.name?.split(" ").slice(1).join(" ") || "",
        email: founder.email,
        phone: founder.phone,
      },
    });
    totalShares += founder.shares;
  });

  // ========== PROCESS pre_money_cap_table ==========
  if (currentRound.pre_money_cap_table) {
    try {
      const preTable =
        typeof currentRound.pre_money_cap_table === "string"
          ? JSON.parse(currentRound.pre_money_cap_table)
          : currentRound.pre_money_cap_table;

      // ========== OPTION POOL ==========
      if (preTable.option_pool) {
        const optionShares = preTable.option_pool.shares || 0;
        if (optionShares > 0) {
          capTable.push({
            type: "option_pool",
            name: "Employee Option Pool",
            shares: optionShares,
            existing_shares: preTable.option_pool.existing_shares || 0,
            new_shares: preTable.option_pool.new_shares || 0,
            percentage:
              preTable.option_pool.percentage?.replace("%", "") || "0.00",
            is_option_pool: true,
            pre_money_display_value: 0,
          });
          totalShares += optionShares;
        }
      }

      // ========== PREVIOUS INVESTORS - GROUP WITH ITEMS ==========
      if (preTable.previous_investors) {
        if (
          preTable.previous_investors.items &&
          Array.isArray(preTable.previous_investors.items)
        ) {
          // Calculate group total ONCE
          const groupTotalShares = preTable.previous_investors.items.reduce(
            (sum, inv) => sum + (inv.shares || 0),
            0,
          );

          // Add to totalShares ONCE
          totalShares += groupTotalShares;

          // Push ONE group item
          capTable.push({
            type: "investor_group",
            group_type: "previous_investors",
            name: preTable.previous_investors.name || "Previous Investors",
            total_shares: groupTotalShares,
            percentage:
              preTable.previous_investors.percentage?.replace("%", "") ||
              "0.00",
            share_class_type:
              preTable.previous_investors.shareClassType || "Previous Investor",
            is_previous: true,
            pre_money_display_value: 0,

            // Store individuals here for frontend expansion
            items: preTable.previous_investors.items.map((inv) => ({
              type: "investor",
              name:
                inv.name ||
                `${inv.firstName || ""} ${inv.lastName || ""}`.trim(),
              investor_details: inv.investor_details || {
                firstName: inv.firstName || "",
                lastName: inv.lastName || "",
                email: inv.email || "",
                phone: inv.phone || "",
              },
              shares: inv.shares,
              percentage: inv.percentage?.replace("%", "") || "0.00",
              is_previous: true,
              share_class_type: inv.share_class_type || inv.shareClassType,
              email: inv.email || inv.investor_details?.email || "",
              phone: inv.phone || inv.investor_details?.phone || "",
              round_id: inv.round_id,
              round_name: inv.round_name,
              investment: inv.investment,
              share_price: inv.share_price,
            })),
          });
        } else if (preTable.previous_investors.shares) {
          totalShares += preTable.previous_investors.shares;
          capTable.push({
            type: "investor_group",
            group_type: "previous_investors",
            name: preTable.previous_investors.name || "Previous Investors",
            total_shares: preTable.previous_investors.shares,
            percentage:
              preTable.previous_investors.percentage?.replace("%", "") ||
              "0.00",
            share_class_type: preTable.previous_investors.shareClassType,
            is_previous: true,
            is_grouped: true,
            pre_money_display_value: 0,
            items: preTable.previous_investors.items || [],
          });
        }
      }

      // ========== INVESTORS SECTION ==========
      if (preTable.investors) {
        if (
          preTable.investors.items &&
          Array.isArray(preTable.investors.items)
        ) {
          const isNewInvestment = preTable.investors.items.some(
            (inv) => inv.is_new_investment,
          );

          if (isNewInvestment) {
            // Add as individual investors
            preTable.investors.items.forEach((inv) => {
              const investorName =
                inv.name ||
                `${inv.firstName || ""} ${inv.lastName || ""}`.trim();
              capTable.push({
                type: "investor",
                name: investorName,
                investor_details: inv.investor_details || {
                  firstName: inv.firstName || "",
                  lastName: inv.lastName || "",
                  email: inv.email || "",
                  phone: inv.phone || "",
                },
                shares: inv.shares,
                percentage: inv.percentage?.replace("%", "") || "0.00",
                is_new_investment: true,
                pre_money_display_value: 0,
                email: inv.email || inv.investor_details?.email || "",
                phone: inv.phone || inv.investor_details?.phone || "",
                share_class_type:
                  inv.share_class_type || preTable.share_class_type,
                investment: inv.investment || 0,
                share_price: inv.share_price || 0,
                round_id: inv.round_id,
                round_name: inv.round_name,
              });
              totalShares += inv.shares;
            });
          } else {
            // Add as group
            const groupTotalShares = preTable.investors.items.reduce(
              (sum, inv) => sum + (inv.shares || 0),
              0,
            );
            totalShares += groupTotalShares;
            capTable.push({
              type: "investor_group",
              group_type: "investors",
              name: preTable.investors.name || "Series Investors",
              total_shares: groupTotalShares,
              percentage:
                preTable.investors.percentage?.replace("%", "") || "0.00",
              share_class_type: preTable.investors.shareClassType,
              pre_money_display_value: 0,
              items: preTable.investors.items.map((inv) => ({
                type: "investor",
                name:
                  inv.name ||
                  `${inv.firstName || ""} ${inv.lastName || ""}`.trim(),
                investor_details: inv.investor_details || {},
                shares: inv.shares,
                percentage: inv.percentage?.replace("%", "") || "0.00",
                email: inv.email || inv.investor_details?.email || "",
                phone: inv.phone || inv.investor_details?.phone || "",
                round_id: inv.round_id,
                investment: inv.investment,
              })),
            });
          }
        } else if (preTable.investors.shares) {
          totalShares += preTable.investors.shares;
          capTable.push({
            type: "investor_group",
            group_type: "investors",
            name: preTable.investors.name || "Series Investors",
            total_shares: preTable.investors.shares,
            percentage:
              preTable.investors.percentage?.replace("%", "") || "0.00",
            share_class_type: preTable.investors.shareClassType,
            pre_money_display_value: 0,
            items: preTable.investors.items || [],
          });
        }
      }

      // ========== CONVERTED INVESTORS ==========
      if (preTable.converted_investors) {
        if (
          preTable.converted_investors.items &&
          Array.isArray(preTable.converted_investors.items)
        ) {
          const groupTotalShares = preTable.converted_investors.items.reduce(
            (sum, inv) => sum + (inv.shares || 0),
            0,
          );
          totalShares += groupTotalShares;
          capTable.push({
            type: "investor_group",
            group_type: "converted_investors",
            name: preTable.converted_investors.name || "Converted Investors",
            total_shares: groupTotalShares,
            percentage:
              preTable.converted_investors.percentage?.replace("%", "") ||
              "0.00",
            is_converted: true,
            pre_money_display_value: 0,
            items: preTable.converted_investors.items.map((inv) => ({
              type: "investor",
              name:
                inv.name ||
                `${inv.firstName || ""} ${inv.lastName || ""}`.trim(),
              investor_details: inv.investor_details || {},
              shares: inv.shares,
              percentage: inv.percentage?.replace("%", "") || "0.00",
              round_id: inv.round_id,
            })),
          });
        }
      }
    } catch (e) {
      console.error("Error parsing pre_money_cap_table:", e);
    }
  }

  // ========== CALCULATE PERCENTAGES ==========
  if (totalShares > 0) {
    capTable.forEach((item) => {
      if (item.type === "investor_group") {
        const itemper = (item.total_shares / totalShares) * 100;
        item.percentage = itemper.toFixed(2);
        if (item.items && item.items.length > 0) {
          item.items.forEach((subItem) => {
            const subItemPer = (subItem.shares / totalShares) * 100;
            subItem.percentage = subItemPer.toFixed(2);
          });
        }
      } else if (item.type !== "pending") {
        const itemper = (item.shares / totalShares) * 100;
        item.percentage = itemper.toFixed(2);
      }
    });
  }

  // ========== CALCULATE PRE-MONEY VALUES ==========
  if (!isCurrentRoundRound0 && preMoneyValuation > 0 && totalShares > 0) {
    capTable.forEach((item) => {
      if (item.type === "investor_group") {
        const itemper = (item.total_shares / totalShares) * 100;
        const prevalue = (itemper * preMoneyValuation) / 100;
        item.pre_money_display_value = prevalue;
        item.display_value = prevalue;
        item.value = prevalue;

        if (item.items && item.items.length > 0) {
          item.items.forEach((subItem) => {
            const subItemPer = (subItem.shares / totalShares) * 100;
            const subPrevalue = (subItemPer * preMoneyValuation) / 100;
            subItem.pre_money_display_value = subPrevalue;
            subItem.display_value = subPrevalue;
            subItem.value = subPrevalue;
          });
        }
      } else if (item.type !== "pending") {
        const itemper = (item.shares / totalShares) * 100;
        const prevalue = (itemper * preMoneyValuation) / 100;
        item.pre_money_display_value = prevalue;
        item.display_value = prevalue;
        item.value = prevalue;
        item.pre_money_display_share_price = preMoneyValuation / totalShares;
      }
    });
  }

  // ========== SEPARATE ITEMS ==========
  const founders = capTable.filter((item) => item.type === "founder");
  const optionPools = capTable.filter((item) => item.type === "option_pool");
  const investorGroups = capTable.filter(
    (item) => item.type === "investor_group",
  );
  const individualInvestors = capTable.filter(
    (item) =>
      item.type === "investor" && !item.is_previous && !item.is_new_investment,
  );

  // ========== CALCULATE TOTALS ==========
  const totalFounders = founders.reduce(
    (sum, item) => sum + (item.shares || 0),
    0,
  );

  // ✅ CORRECT: Count groups once, not their items
  const totalInvestorsFromGroups = investorGroups.reduce(
    (sum, group) => sum + (group.total_shares || 0),
    0,
  );
  const totalIndividualInvestors = individualInvestors.reduce(
    (sum, item) => sum + (item.shares || 0),
    0,
  );
  const totalInvestors = totalInvestorsFromGroups + totalIndividualInvestors;

  const totalOptionPool = optionPools.reduce(
    (sum, item) => sum + (item.shares || 0),
    0,
  );

  const totals = {
    total_shares: totalShares,
    total_founders: totalFounders,
    total_investors: totalInvestors,
    total_option_pool: totalOptionPool,
    total_value: preMoneyValuation,
    pre_money_valuation: preMoneyValuation,
    display_share_price: totalShares > 0 ? preMoneyValuation / totalShares : 0,
    is_round_0: isCurrentRoundRound0,
    pre_money_share_price:
      totalShares > 0 ? preMoneyValuation / totalShares : 0,
  };

  return {
    items: capTable,
    founders,
    optionPools,
    investorGroups,
    individualInvestors,
    totals,
    pre_money_valuation: preMoneyValuation,
    total_shares: totalShares,
  };
}
function calculateCPAVATEPreMoneyCapTable(
  allRounds,
  currentRound,
  conversionData = [],
) {
  const capTable = [];
  let totalShares = 0;
  const preMoneyValuation = parseFloat(currentRound.pre_money) || 0;

  // ✅ Check if current round is Round 0
  const isCurrentRoundRound0 = currentRound.round_type === "Round 0";

  // Get all rounds BEFORE current round
  const previousRounds = allRounds.filter(
    (round) => parseInt(round.id) < parseInt(currentRound.id),
  );

  // ========== GET FOUNDER SHARES FROM ROUND 0 ==========
  // IMPORTANT: Find Round 0 from allRounds (not just previousRounds)
  const round0 = allRounds.find((r) => r.round_type === "Round 0");

  let founderShares = 0;

  // ========== ADD FOUNDERS FROM ROUND 0 ==========
  if (round0 && round0.founder_data) {
    try {
      const founderData =
        typeof round0.founder_data === "string"
          ? JSON.parse(round0.founder_data)
          : round0.founder_data;

      if (founderData.founders && Array.isArray(founderData.founders)) {
        // Sirf positive shares wale founders ko include karo
        const activeFounders = founderData.founders.filter(
          (founder) => parseFloat(founder.shares) > 0,
        );

        activeFounders.forEach((founder, idx) => {
          const shares = parseFloat(founder.shares) || 0;
          const firstName = founder.firstName || "";
          const lastName = founder.lastName || "";

          // ✅ NAME BANANE KA SAHI TARIKA
          let founderName = "";
          if (firstName && lastName) {
            founderName = `${firstName} ${lastName}`.trim();
          } else if (firstName) {
            founderName = firstName;
          } else if (lastName) {
            founderName = lastName;
          } else {
            founderName = `Founder ${idx + 1}`;
          }

          const originalSharePrice = parseFloat(round0.share_price) || 0.01;
          const originalValue = shares * originalSharePrice;

          founderShares += shares;

          capTable.push({
            type: "founder",
            name: founderName,
            shares: shares,
            percentage: "0.00",
            round_id: round0.id,
            round_name: "Round 0",
            investment: 0,
            share_price: originalSharePrice,
            value: originalValue,
            founder_id: idx + 1,
            founder_code: `F${idx + 1}`,
            email: founder.email || "",
            phone: founder.phone || "",
            share_type: founder.shareType || "common",
            voting: founder.voting || "voting",
            original_share_price: originalSharePrice,
            original_value: originalValue,
            pre_money_display_value: 0,
            pre_money_display_share_price: 0,
          });

          totalShares += shares;
        });
      }
    } catch (e) {
      console.error("Error parsing founder data:", e);
    }
  }

  // ========== PROCESS PREVIOUS ROUNDS ==========
  for (const round of previousRounds) {
    // Skip Round 0 as we already processed it
    if (round.round_type === "Round 0") continue;

    // ========== SAFE/CONVERTIBLE NOTE ROUNDS (CONVERTED) ==========
    if (
      round.instrumentType === "Safe" ||
      round.instrumentType === "Convertible Note"
    ) {
      // Check if this instrument was converted in a previous round
      const previousConversions = conversionData.filter(
        (conv) =>
          parseInt(conv.original_round_id) === parseInt(round.id) &&
          parseInt(conv.conversion_round_id) < parseInt(currentRound.id),
      );

      if (previousConversions.length > 0) {
        previousConversions.forEach((conversion) => {
          const shares = parseFloat(conversion.converted_shares) || 0;
          const sharePrice = parseFloat(conversion.conversion_price) || 0;
          const value = shares * sharePrice;

          if (shares > 0) {
            capTable.push({
              type: "investor",
              name:
                conversion.investor_name || `${round.instrumentType} Investor`,
              shares: shares,
              percentage: "0.00",
              round_id: conversion.conversion_round_id,
              round_name: `Converted from ${round.nameOfRound}`,
              investment:
                parseFloat(conversion.original_investment_amount) || 0,
              share_price: sharePrice,
              value: value,
              is_converted: true,
              original_round_id: round.id,
              original_share_price: sharePrice,
              original_value: value,
              pre_money_display_value: 0,
              pre_money_display_share_price: 0,
              instrument_type: round.instrumentType,
            });
            totalShares += shares;
          }
        });
      } else {
        // PENDING instruments (not converted yet)
        const investment = parseFloat(round.roundsize) || 0;

        if (investment > 0) {
          let instrumentData = {};
          try {
            instrumentData = round.instrument_type_data
              ? typeof round.instrument_type_data === "string"
                ? JSON.parse(round.instrument_type_data)
                : round.instrument_type_data
              : {};
          } catch (e) {
            console.error("Error parsing instrument data:", e);
          }

          capTable.push({
            type: "pending",
            name: `${round.instrumentType} - ${round.nameOfRound}`,
            shares: 0,
            percentage: "0.00",
            round_id: round.id,
            round_name: round.nameOfRound,
            investment: investment,
            share_price: null,
            value: 0,
            discount_rate:
              round.instrumentType === "Safe"
                ? instrumentData.discountRate ||
                  instrumentData.discount_rate ||
                  20
                : instrumentData.discountRate_note ||
                  instrumentData.discount_rate_note ||
                  20,
            valuation_cap:
              round.instrumentType === "Safe"
                ? instrumentData.valuationCap ||
                  instrumentData.valuation_cap ||
                  0
                : instrumentData.valuationCap_note ||
                  instrumentData.valuation_cap_note ||
                  0,
            interest_rate:
              round.instrumentType === "Convertible Note"
                ? instrumentData.interestRate_note ||
                  instrumentData.interest_rate_note ||
                  8
                : 0,
            is_pending: true,
            instrument_type: round.instrumentType,
            display_share_price: "N/A",
            display_shares: "N/A",
            pre_money_display_value: 0,
            pre_money_display_share_price: 0,
          });
        }
      }

      // ✅ OPTION POOL FROM PREVIOUS ROUND - ALWAYS ADD (even if 0)
      const optionPoolShares = parseFloat(round.option_pool_shares) || 0;

      capTable.push({
        type: "option_pool",
        name: `${round.nameOfRound || `Round ${round.id}`} Option Pool`,
        shares: optionPoolShares,
        percentage: "0.00",
        round_id: round.id,
        round_name: round.nameOfRound || `Round ${round.id}`,
        investment: 0,
        share_price: 0,
        value: 0,
        is_option_pool: true,
        original_share_price: 0,
        original_value: 0,
        pre_money_display_value: 0,
        pre_money_display_share_price: 0,
      });

      totalShares += optionPoolShares;
    }

    // ========== PREFERRED EQUITY / COMMON STOCK ROUNDS ==========
    else if (
      round.instrumentType === "Preferred Equity" ||
      round.instrumentType === "Common Stock"
    ) {
      const sharePrice = parseFloat(round.share_price) || 0;
      const totalSharesAfter = parseFloat(round.total_shares_after) || 0;
      const optionPoolShares = parseFloat(round.option_pool_shares) || 0;

      // Investors = Total After - Founders - Option Pool
      const investorShares =
        totalSharesAfter - founderShares - optionPoolShares;

      // INVESTOR SHARES
      if (investorShares > 0) {
        const value = investorShares * sharePrice;

        capTable.push({
          type: "investor",
          name: `${round.instrumentType} - ${round.nameOfRound}`,
          shares: investorShares,
          percentage: "0.00",
          round_id: round.id,
          round_name: round.nameOfRound,
          investment: parseFloat(round.roundsize) || 0,
          share_price: sharePrice,
          value: value,
          is_investor: true,
          original_share_price: sharePrice,
          original_value: value,
          pre_money_display_value: 0,
          pre_money_display_share_price: 0,
          instrument_type: round.instrumentType,
        });
        totalShares += investorShares;
      }

      // ✅ OPTION POOL SHARES - ALWAYS ADD (even if 0)
      const value = optionPoolShares * sharePrice;

      capTable.push({
        type: "option_pool",
        name: `${round.nameOfRound} Option Pool`,
        shares: optionPoolShares,
        percentage: "0.00",
        round_id: round.id,
        round_name: round.nameOfRound,
        investment: 0,
        share_price: sharePrice,
        value: value,
        is_option_pool: true,
        original_share_price: sharePrice,
        original_value: value,
        pre_money_display_value: 0,
        pre_money_display_share_price: 0,
      });

      totalShares += optionPoolShares;
    }
  }

  // ========== ADD CURRENT ROUND'S OPTION POOL ==========
  const currentRoundOptionPool =
    parseFloat(currentRound.option_pool_shares) || 0;

  // ✅ ALWAYS ADD CURRENT ROUND OPTION POOL (even if 0)
  capTable.push({
    type: "option_pool",
    name: `${currentRound.nameOfRound || `Round ${currentRound.id}`} Option Pool`,
    shares: currentRoundOptionPool,
    percentage: "0.00",
    round_id: currentRound.id,
    round_name: currentRound.nameOfRound || `Round ${currentRound.id}`,
    investment: 0,
    share_price: 0,
    value: 0,
    is_option_pool: true,
    is_new_pool: true,
    original_share_price: 0,
    original_value: 0,
    pre_money_display_value: 0,
    pre_money_display_share_price: 0,
  });

  totalShares += currentRoundOptionPool;

  // ========== CALCULATE PERCENTAGES ==========
  if (totalShares > 0) {
    capTable.forEach((item) => {
      if (item.type !== "pending") {
        item.percentage = ((item.shares / totalShares) * 100).toFixed(2);
      }
    });
  }

  // ========== CALCULATE PRE-MONEY DISPLAY VALUES ==========
  if (!isCurrentRoundRound0 && preMoneyValuation > 0 && totalShares > 0) {
    capTable.forEach((item) => {
      if (item.type !== "pending") {
        item.pre_money_display_value =
          (parseFloat(item.percentage) / 100) * preMoneyValuation;
        item.pre_money_display_share_price = preMoneyValuation / totalShares;
        item.display_value = item.pre_money_display_value;
      }
    });
  }

  // ========== CALCULATE TOTALS ==========
  const totalFounders = capTable
    .filter((item) => item.type === "founder")
    .reduce((sum, item) => sum + item.shares, 0);

  const totalInvestors = capTable
    .filter((item) => item.type === "investor")
    .reduce((sum, item) => sum + item.shares, 0);

  const totalOptionPool = capTable
    .filter((item) => item.type === "option_pool")
    .reduce((sum, item) => sum + item.shares, 0);

  const totalPending = capTable
    .filter((item) => item.type === "pending")
    .reduce((sum, item) => sum + (item.investment || 0), 0);

  const totals = {
    total_shares: totalShares,
    total_founders: totalFounders,
    total_investors: totalInvestors,
    total_option_pool: totalOptionPool,
    total_pending: totalPending,
    original_round_0_value: capTable
      .filter((item) => item.type === "founder")
      .reduce((sum, item) => sum + (item.original_value || 0), 0),
  };

  if (isCurrentRoundRound0) {
    totals.total_value = capTable
      .filter((item) => item.type === "founder")
      .reduce((sum, item) => sum + (item.value || 0), 0);
    totals.pre_money_valuation = totals.total_value;
    totals.display_share_price =
      totals.total_shares > 0 ? totals.total_value / totals.total_shares : 0;
    totals.is_round_0 = true;
  } else {
    totals.total_value = preMoneyValuation;
    totals.pre_money_valuation = preMoneyValuation;
    totals.display_share_price =
      totalShares > 0 ? preMoneyValuation / totalShares : 0;
    totals.is_round_0 = false;
  }

  totals.pre_money_share_price = totals.display_share_price;

  // ========== SORT ITEMS ==========
  const sortedItems = [
    ...capTable
      .filter((item) => item.type === "founder")
      .sort((a, b) => {
        const aNum = parseInt(a.founder_code?.replace(/\D/g, "") || 0);
        const bNum = parseInt(b.founder_code?.replace(/\D/g, "") || 0);
        return aNum - bNum;
      }),
    ...capTable.filter((item) => item.type === "option_pool"),
    ...capTable.filter((item) => item.type === "investor"),
    ...capTable.filter((item) => item.type === "pending"),
  ];

  return {
    items: sortedItems,
    totals,
  };
}
function calculateCPAVATEPostMoneyCapTable(
  allRounds,
  currentRound,
  conversionData = [],
) {
  const postCapTable = [];
  let totalShares = 0;
  let totalNewShares = 0;

  const preMoneyValuation = parseFloat(currentRound.pre_money) || 0;
  const investment = parseFloat(currentRound.roundsize) || 0;
  const postMoneyValuation = preMoneyValuation + investment;

  // ✅ DETECT ROUND TYPE
  const isRound0 = currentRound.round_type === "Round 0";
  const isSeedRound =
    !isRound0 &&
    currentRound.instrumentType === "Safe" &&
    parseFloat(currentRound.issuedshares || 0) === 0;
  const isConvertibleNoteRound =
    !isRound0 &&
    currentRound.instrumentType === "Convertible Note" &&
    parseFloat(currentRound.issuedshares || 0) === 0;
  const isCommonStockRound =
    !isRound0 &&
    !isSeedRound &&
    !isConvertibleNoteRound &&
    currentRound.instrumentType === "Common Stock";
  const isPreferredEquityRound =
    !isRound0 && currentRound.instrumentType === "Preferred Equity";

  // ✅ Get pre-money cap table
  const preMoneyTable = calculateCPAVATEPreMoneyCapTable(
    allRounds,
    currentRound,
    conversionData,
  );

  // ✅ Get pre-money total shares
  const preMoneyTotalShares = preMoneyTable.totals.total_shares || 0;

  // ✅ Calculate share price
  const sharePrice =
    preMoneyValuation > 0 && preMoneyTotalShares > 0
      ? preMoneyValuation / preMoneyTotalShares
      : 0;

  // ✅ STEP 1: Add all pre-money items
  preMoneyTable.items.forEach((item) => {
    if (item.type !== "pending") {
      postCapTable.push({
        ...item,
        new_shares: 0,
        share_price: sharePrice,
        value: 0, // Will calculate later
        percentage: "0.00",
        original_shares: item.shares,
      });
      totalShares += item.shares;
    }
  });

  // ========== HANDLE CURRENT ROUND ==========
  if (!isRound0 && currentRound.round_type === "Investment") {
    const currentRoundId = parseInt(currentRound.id);
    const conversionsInThisRound = conversionData.filter(
      (conv) => parseInt(conv.conversion_round_id) === currentRoundId,
    );

    // ========== COMMON STOCK ROUND ==========
    // ========== COMMON STOCK ROUND ==========
    if (isCommonStockRound) {
      // Get investors from currentRound.investments
      let investors = [];

      // Parse investments from currentRound
      if (currentRound.round_investments) {
        try {
          investors =
            typeof currentRound.round_investments === "string"
              ? JSON.parse(currentRound.round_investments)
              : currentRound.round_investments;
        } catch (e) {
          console.error("Error parsing investments:", e);
        }
      }

      if (investors.length > 0) {
        let totalInvestorShares = 0;

        // Process each investor individually
        investors.forEach((investor, idx) => {
          // Calculate shares for this investor
          const investorAmount = parseFloat(investor.amount) || 0;
          let investorShares = 0;

          if (investorAmount > 0 && sharePrice > 0) {
            investorShares = Math.round(investorAmount / sharePrice);
          }

          if (investorShares > 0) {
            // Create investor name from firstName and lastName
            const investorName =
              [investor.firstName, investor.lastName]
                .filter(Boolean)
                .join(" ") || `Investor ${idx + 1}`;

            postCapTable.push({
              type: "investor",
              name: investorName,
              investor_details: {
                firstName: investor.firstName || "",
                lastName: investor.lastName || "",
                email: investor.email || "",
                phone: investor.phone || "",
              },
              share_class_type: currentRound.shareClassType,
              shares: investorShares,
              new_shares: investorShares,
              total: investorShares,
              percentage: "0.00",
              round_id: currentRoundId,
              round_name: currentRound.nameOfRound,
              investment: investorAmount,
              share_price: sharePrice,
              is_new_investment: true,
              instrument_type: "Common Stock",
              value: 0,
              investor_index: idx + 1,
            });

            totalInvestorShares += investorShares;
            totalNewShares += investorShares;
          }
        });

        totalShares += totalInvestorShares;
      }
    }

    // ========== PREFERRED EQUITY ROUND ==========
    // ========== PREFERRED EQUITY ROUND ==========
    if (isPreferredEquityRound) {
      // Get investors from currentRound.investments
      let investors = [];

      // Parse investments from currentRound
      if (currentRound.round_investments) {
        try {
          investors =
            typeof currentRound.round_investments === "string"
              ? JSON.parse(currentRound.round_investments)
              : currentRound.round_investments;
        } catch (e) {
          console.error("Error parsing investments:", e);
        }
      }

      let totalInvestorShares = 0;
      let totalInvestment = 0;

      // ========== PROCESS CONVERTED INVESTORS (SAFE) ==========
      const safeConversion = conversionsInThisRound.find(
        (c) => c.instrument_type === "Safe",
      );
      if (safeConversion) {
        const shares = parseFloat(safeConversion.converted_shares) || 0;
        if (shares > 0) {
          postCapTable.push({
            type: "investor",
            share_class_type: currentRound.shareClassType,
            name: safeConversion.investor_name || "SAFE Investor",
            investor_details: {
              firstName: safeConversion.firstName || "",
              lastName: safeConversion.lastName || "",
              email: safeConversion.email || "",
              phone: safeConversion.phone || "",
            },
            shares: shares,
            new_shares: shares,
            total: shares,
            percentage: "0.00",
            round_id: currentRoundId,
            round_name: currentRound.nameOfRound,
            investment:
              parseFloat(safeConversion.original_investment_amount) || 0,
            conversion_price:
              parseFloat(safeConversion.conversion_price) || sharePrice,
            share_price: sharePrice,
            is_converted: true,
            instrument_type: "Safe",
            value: 0,
            investor_index: "C1",
          });
          totalShares += shares;
          totalNewShares += shares;
        }
      }

      // ========== PROCESS CONVERTED INVESTORS (CONVERTIBLE NOTE) ==========
      const noteConversion = conversionsInThisRound.find(
        (c) => c.instrument_type === "Convertible Note",
      );
      if (noteConversion) {
        const shares = parseFloat(noteConversion.converted_shares) || 0;
        if (shares > 0) {
          postCapTable.push({
            type: "investor",
            share_class_type: currentRound.shareClassType,
            name: noteConversion.investor_name || "Convertible Note Investor",
            investor_details: {
              firstName: noteConversion.firstName || "",
              lastName: noteConversion.lastName || "",
              email: noteConversion.email || "",
              phone: noteConversion.phone || "",
            },
            shares: shares,
            new_shares: shares,
            total: shares,
            percentage: "0.00",
            round_id: currentRoundId,
            round_name: currentRound.nameOfRound,
            investment:
              parseFloat(noteConversion.original_investment_amount) || 0,
            conversion_price:
              parseFloat(noteConversion.conversion_price) || sharePrice,
            share_price: sharePrice,
            is_converted: true,
            instrument_type: "Convertible Note",
            value: 0,
            investor_index: "C2",
          });
          totalShares += shares;
          totalNewShares += shares;
        }
      }

      // ========== PROCESS NEW INVESTORS (SERIES A) ==========
      if (investors.length > 0) {
        // Calculate total investment from all investors
        totalInvestment = investors.reduce(
          (sum, inv) => sum + (parseFloat(inv.amount) || 0),
          0,
        );

        // Calculate share price (if not already calculated)
        const effectiveSharePrice =
          sharePrice > 0 ? sharePrice : totalInvestment / investorShares;

        // Process each investor individually
        investors.forEach((investor, idx) => {
          const investorAmount = parseFloat(investor.amount) || 0;
          let investorShares = 0;

          if (investorAmount > 0 && effectiveSharePrice > 0) {
            investorShares = Math.round(investorAmount / effectiveSharePrice);
          }

          if (investorShares > 0) {
            // Create investor name from firstName and lastName
            const investorName =
              [investor.firstName, investor.lastName]
                .filter(Boolean)
                .join(" ") ||
              `${currentRound.shareClassType} Investor ${idx + 1}`;

            postCapTable.push({
              type: "investor",
              share_class_type: currentRound.shareClassType,
              name: investorName,
              investor_details: {
                firstName: investor.firstName || "",
                lastName: investor.lastName || "",
                email: investor.email || "",
                phone: investor.phone || "",
              },
              shares: investorShares,
              new_shares: investorShares,
              total: investorShares,
              percentage: "0.00",
              round_id: currentRoundId,
              round_name: currentRound.nameOfRound,
              investment: investorAmount,
              share_price: effectiveSharePrice,
              is_new_investment: true,
              instrument_type: "Preferred Equity",
              value: 0,
              investor_index: idx + 1,
            });

            totalInvestorShares += investorShares;
            totalNewShares += investorShares;
          }
        });

        totalShares += totalInvestorShares;
      } else {
        // Fallback to single investor if no details provided
        let investorShares = 0;
        if (investment > 0 && sharePrice > 0) {
          investorShares = Math.round(investment / sharePrice);
        }

        if (investorShares > 0) {
          postCapTable.push({
            type: "investor",
            share_class_type: currentRound.shareClassType,
            name: currentRound.shareClassType + " Investors",
            shares: investorShares,
            new_shares: investorShares,
            total: investorShares,
            percentage: "0.00",
            round_id: currentRoundId,
            round_name: currentRound.nameOfRound,
            investment: investment,
            share_price: sharePrice,
            is_new_investment: true,
            instrument_type: "Preferred Equity",
            value: 0,
          });

          totalShares += investorShares;
          totalNewShares += investorShares;
        }
      }
    }

    // ========== SEED ROUND (SAFE) ==========
    if (isSeedRound) {
      const optionPoolShares = parseFloat(currentRound.option_pool_shares) || 0;
      const investmentAmount = parseFloat(currentRound.roundsize) || 0;

      if (optionPoolShares > 0) {
        // Option pool already in pre-money
      }

      if (investmentAmount > 0) {
        let instrumentData = {};
        try {
          instrumentData = currentRound.instrument_type_data
            ? typeof currentRound.instrument_type_data === "string"
              ? JSON.parse(currentRound.instrument_type_data)
              : currentRound.instrument_type_data
            : {};
        } catch (e) {}

        postCapTable.push({
          share_class_type: currentRound.shareClassType,
          type: "pending",
          name: `Safe - ${currentRound.nameOfRound}`,
          shares: 0,
          new_shares: 0,
          total: 0,
          percentage: "0.00",
          round_id: currentRoundId,
          round_name: currentRound.nameOfRound,
          investment: investmentAmount,
          share_price: null,
          value: 0,
          is_pending: true,
          instrument_type: "Safe",
          discount_rate: instrumentData.discountRate || 20,
          valuation_cap: instrumentData.valuationCap || 0,
        });
      }
    }

    // ========== CONVERTIBLE NOTE ROUND ==========
    if (isConvertibleNoteRound) {
      const optionPoolShares = parseFloat(currentRound.option_pool_shares) || 0;
      const investmentAmount = parseFloat(currentRound.roundsize) || 0;

      if (investmentAmount > 0) {
        let instrumentData = {};
        try {
          instrumentData = currentRound.instrument_type_data
            ? typeof currentRound.instrument_type_data === "string"
              ? JSON.parse(currentRound.instrument_type_data)
              : currentRound.instrument_type_data
            : {};
        } catch (e) {}

        postCapTable.push({
          share_class_type: currentRound.shareClassType,
          type: "pending",
          name: `Convertible Note - ${currentRound.nameOfRound}`,
          shares: 0,
          new_shares: 0,
          total: 0,
          percentage: "0.00",
          round_id: currentRoundId,
          round_name: currentRound.nameOfRound,
          investment: investmentAmount,
          share_price: null,
          value: 0,
          is_pending: true,
          instrument_type: "Convertible Note",
          discount_rate: instrumentData.discountRate_note || 20,
          valuation_cap: instrumentData.valuationCap_note || 0,
          interest_rate: instrumentData.interestRate_note || 8,
        });
      }
    }
  }

  const finalTotalShares = totalShares;

  postCapTable.forEach((item) => {
    if (finalTotalShares > 0 && item.type !== "pending") {
      // Calculate percentage
      percentageactual = (item.shares / finalTotalShares) * 100;

      item.percentage = ((item.shares / finalTotalShares) * 100).toFixed(2);

      // // Calculate value based on investor type
      // if (item.type === "investor" && item.is_new_investment) {
      //   // For new investors, use exact investment amount
      //   item.value = item.investment;
      // } else {
      //   // For others, calculate from post-money valuation
      //   item.value = Math.round((item.percentage / 100) * postMoneyValuation);
      // }
      // item.value = Math.round(
      //   (item.percentage / 100) * postMoneyValuation,
      // ).toFixed(2);
      item.value = (percentageactual * postMoneyValuation) / 100;
      // item.value = v_value;
    }
  });
  // ========== CALCULATE TOTALS ==========
  const totalFounders = postCapTable
    .filter((item) => item.type === "founder")
    .reduce((sum, item) => sum + item.shares, 0);
  const totalOptionPool = postCapTable
    .filter((item) => item.type === "option_pool")
    .reduce((sum, item) => sum + item.shares, 0);
  const totalInvestors = postCapTable
    .filter((item) => item.type === "investor")
    .reduce((sum, item) => sum + item.shares, 0);

  const totals = {
    total_shares: finalTotalShares,
    total_new_shares: totalNewShares,
    total_founders: totalFounders,
    total_option_pool: totalOptionPool,
    total_investors: totalInvestors,

    total_value: Math.round(postMoneyValuation),
    post_money_valuation: Math.round(postMoneyValuation),
    pre_money_valuation: preMoneyValuation,
    investment: investment,
    pre_money_share_price: sharePrice,
    post_money_share_price:
      finalTotalShares > 0 ? postMoneyValuation / finalTotalShares : 0,
  };

  // ========== SORT ITEMS FOR DISPLAY ==========
  // ========== SORT ITEMS FOR DISPLAY ==========
  const sortedItems = [
    // Founders first
    ...postCapTable
      .filter((item) => item.type === "founder")
      .sort((a, b) =>
        (a.founder_code || "").localeCompare(b.founder_code || ""),
      ),

    // ✅ Option Pool SECOND (before investors)
    ...postCapTable.filter((item) => item.type === "option_pool"),

    // Then converted investors
    ...postCapTable.filter(
      (item) => item.type === "investor" && item.is_converted,
    ),

    // Then new investors
    ...postCapTable.filter(
      (item) => item.type === "investor" && item.is_new_investment,
    ),

    // Then pending instruments
    ...postCapTable.filter((item) => item.type === "pending"),
  ];

  return {
    items: sortedItems,
    totals,
  };
}
function calculateCPAVATEPostMoneyCapTableInvestment(currentRound) {
  // ========== USE post_money_cap_table IF AVAILABLE ==========
  if (currentRound.post_money_cap_table) {
    try {
      const postTable =
        typeof currentRound.post_money_cap_table === "string"
          ? JSON.parse(currentRound.post_money_cap_table)
          : currentRound.post_money_cap_table;

      const postMoney =
        Number(String(currentRound.post_money).replace(/,/g, "")) || 0;
      const items = [];
      let totalShares = 0;
      let totalNewShares = 0; // ✅ Calculate this
      // 1. Add founders from postTable with details
      if (postTable.founders && postTable.founders.list) {
        postTable.founders.list.forEach((founder) => {
          const percentage =
            Number(String(founder.percentage).replace("%", "")) || 0;
          const founderValue = (postMoney * percentage) / 100;

          items.push({
            type: "founder",
            name: founder.name,
            shares: founder.shares,
            new_shares: 0,
            total: founder.shares,
            percentage: founder.percentage?.replace("%", "") || "0",
            value: founderValue,
            founder_code: founder.founder_code,
            email: founder.email,
            phone: founder.phone,
            investor_details: {
              firstName: founder.name?.split(" ")[0] || "",
              lastName: founder.name?.split(" ").slice(1).join(" ") || "",
              email: founder.email,
              phone: founder.phone,
            },
          });
          totalShares += founder.shares;
        });
      }

      // 2. Add option pool
      if (postTable.option_pool) {
        const optionShares =
          postTable.option_pool.shares || postTable.option_pool.total || 0;
        const percentage =
          postTable.option_pool.percentage?.replace("%", "") || "0";
        const optionValue = (postMoney * percentage) / 100;

        items.push({
          type: "option_pool",
          name: "Employee Option Pool",
          shares: optionShares,
          existing_shares: postTable.option_pool.existing_shares || 0,
          new_shares: postTable.option_pool.new_shares || 0,
          total: optionShares,
          percentage: postTable.option_pool.percentage?.replace("%", "") || "0",
          value: optionValue,
          is_option_pool: true,
        });
        totalShares += optionShares;

        // ✅ Add new option pool shares to totalNewShares
        if (postTable.option_pool.new_shares) {
          totalNewShares += postTable.option_pool.new_shares;
        }
      }

      // 3. Add previous investors (seed) with details
      if (postTable.previous_investors) {
        if (
          postTable.previous_investors.items &&
          Array.isArray(postTable.previous_investors.items)
        ) {
          postTable.previous_investors.items.forEach((inv) => {
            const percentage = inv.percentage?.replace("%", "") || "0";
            const invValue = (postMoney * percentage) / 100;

            items.push({
              type: "investor",
              name: inv.name,
              investor_details: inv.investor_details || {
                firstName: inv.firstName || "",
                lastName: inv.lastName || "",
                email: inv.email || "",
                phone: inv.phone || "",
              },
              shares: inv.shares,
              new_shares: 0, // Previous investors have no new shares
              share_class_type: inv.share_class_type || "",
              total: inv.shares,
              percentage: inv.percentage?.replace("%", "") || "0",
              value: invValue,
              is_previous: true,
              is_seed: true,
              email: inv.email || inv.investor_details?.email || "",
              phone: inv.phone || inv.investor_details?.phone || "",
              round_id: inv.id,
            });
            totalShares += inv.shares;
          });
        } else if (postTable.previous_investors.shares) {
          const percentage =
            postTable.previous_investors.percentage?.replace("%", "") || "0";
          const prevValue = (postMoney * percentage) / 100;

          items.push({
            type: "investor",
            name: postTable.previous_investors.name || "Previous Investors",
            shares: postTable.previous_investors.shares,
            share_class_type: postTable.previous_investors.shareClassType || "",
            new_shares: 0, // Previous investors have no new shares
            total: postTable.previous_investors.shares,
            round_id: postTable.previous_investors.id,
            percentage:
              postTable.previous_investors.percentage?.replace("%", "") || "0",
            value: prevValue,
            is_previous: true,
            is_grouped: true,
          });
          totalShares += postTable.previous_investors.shares;
        }
      }

      // 4. Add new investors (current round) with details
      if (postTable.investors) {
        if (
          postTable.investors.items &&
          Array.isArray(postTable.investors.items)
        ) {
          postTable.investors.items.forEach((inv) => {
            // Get investor name
            let investorName = inv.name;
            if (!investorName && inv.firstName) {
              investorName =
                `${inv.firstName || ""} ${inv.lastName || ""}`.trim();
            }

            // Calculate value for this investor
            const percentage = inv.percentage?.replace("%", "") || "0";
            const invValue = (postMoney * percentage) / 100;

            items.push({
              type: "investor",
              name: investorName || "Investor",
              investor_details: inv.investor_details || {
                firstName: inv.firstName || "",
                lastName: inv.lastName || "",
                email: inv.email || "",
                phone: inv.phone || "",
              },
              shares: inv.shares,
              share_class_type: inv.shareClassType || "",
              new_shares: inv.shares, // ✅ New investors have new shares
              total: inv.shares,
              percentage: inv.percentage?.replace("%", "") || "0",
              value: invValue,
              is_new_investment: true,
              round_id: inv.id,
              investment: inv.investment || 0,
              share_price: inv.share_price,
              email: inv.email || inv.investor_details?.email || "",
              phone: inv.phone || inv.investor_details?.phone || "",
              round_id: inv.id,
            });
            totalShares += inv.shares;
            totalNewShares += inv.shares; // ✅ Add to totalNewShares
          });
        } else if (postTable.investors.shares) {
          const percentage =
            postTable.investors.percentage?.replace("%", "") || "0";
          const investorsValue = (postMoney * percentage) / 100;

          items.push({
            type: "investor",
            name: postTable.investors.name || "Series Investors",
            shares: postTable.investors.shares,
            new_shares:
              postTable.investors.new_shares || postTable.investors.shares, // ✅ New shares
            total: postTable.investors.shares,
            percentage: postTable.investors.percentage?.replace("%", "") || "0",
            value: investorsValue,
            is_new_investment: true,
            round_id: postTable.investors.id,
            is_grouped: true,
            investment: postTable.investors.investment || 0,
            round_id: postTable.investors.id,
          });
          totalShares += postTable.investors.shares;
          totalNewShares +=
            postTable.investors.new_shares || postTable.investors.shares; // ✅ Add to totalNewShares
        }
      }

      // 5. Add converted investors with details
      if (postTable.converted_investors) {
        if (
          postTable.converted_investors.items &&
          Array.isArray(postTable.converted_investors.items)
        ) {
          postTable.converted_investors.items.forEach((inv) => {
            const percentage = inv.percentage?.replace("%", "") || "0";
            const invValue = (postMoney * percentage) / 100;

            items.push({
              type: "investor",
              name: inv.name,
              investor_details: inv.investor_details || {},
              shares: inv.shares,
              new_shares: inv.shares, // ✅ Converted investors have new shares
              total: inv.shares,
              percentage: inv.percentage?.replace("%", "") || "0",
              value: invValue,
              is_converted: true,
              investment: inv.investment || 0,
            });
            totalShares += inv.shares;
            totalNewShares += inv.shares; // ✅ Add to totalNewShares
          });
        } else if (postTable.converted_investors.shares) {
          const percentage =
            postTable.converted_investors.percentage?.replace("%", "") || "0";
          const convValue = (postMoney * percentage) / 100;

          items.push({
            type: "investor",
            name: "Converted Investors",
            shares: postTable.converted_investors.shares,
            new_shares: postTable.converted_investors.shares, // ✅ New shares
            total: postTable.converted_investors.shares,
            percentage:
              postTable.converted_investors.percentage?.replace("%", "") || "0",
            value: convValue,
            is_converted: true,
            is_grouped: true,
          });
          totalShares += postTable.converted_investors.shares;
          totalNewShares += postTable.converted_investors.shares; // ✅ Add to totalNewShares
        }
      }

      // 6. Add items array if it exists (with investor_details)
      if (postTable.items && Array.isArray(postTable.items)) {
        postTable.items.forEach((item) => {
          // Avoid duplicates
          const exists = items.some(
            (existing) =>
              existing.type === item.type &&
              existing.name === item.name &&
              existing.shares === item.shares,
          );

          if (!exists) {
            if (item.type === "investor") {
              const percentage = item.percentage?.replace("%", "") || "0";
              const itemValue = (postMoney * percentage) / 100;

              items.push({
                type: "investor",
                name: item.name,
                investor_details: item.investor_details || {},
                shares: item.shares,
                new_shares: item.new_shares || item.shares || 0,
                total: item.total || item.shares,
                percentage: item.percentage?.replace("%", "") || "0",
                value: itemValue,
                is_previous: item.is_previous || false,
                is_new_investment: item.is_new_investment || false,
                round_id: item.id,
                is_converted: item.is_converted || false,
                is_seed: item.is_seed || false,
                is_grouped: item.is_grouped || false,
                investment: item.investment || 0,
                share_price: item.share_price || 0,
                email: item.email || item.investor_details?.email || "",
                phone: item.phone || item.investor_details?.phone || "",
              });

              // ✅ Add to totalNewShares if it's a new investment or converted
              if (item.is_new_investment || item.is_converted) {
                totalNewShares += item.shares || 0;
              }
            } else {
              items.push(item);
            }
            totalShares += item.shares || 0;
          }
        });
      }

      // Calculate totals
      const finalTotalShares = postTable.total_shares || totalShares;

      const totalFounders = items
        .filter((item) => item.type === "founder")
        .reduce((sum, item) => sum + (item.shares || 0), 0);

      const totalInvestors = items
        .filter((item) => item.type === "investor")
        .reduce((sum, item) => sum + (item.shares || 0), 0);

      const totalOptionPool = items
        .filter((item) => item.type === "option_pool")
        .reduce((sum, item) => sum + (item.shares || 0), 0);

      const totals = {
        total_shares: finalTotalShares,
        total_new_shares: totalNewShares, // ✅ Now this will have correct value
        total_founders: totalFounders,
        total_investors: totalInvestors,
        total_option_pool: totalOptionPool,
        total_value: postTable.post_money_valuation || 0,
        post_money_valuation: postTable.post_money_valuation || 0,
        pre_money_valuation: postTable.pre_money_valuation || 0,
        investment: postTable.investment || 0,
        share_price: postTable.share_price || 0,
        round_type: postTable.round_type || currentRound.instrumentType,
      };

      return {
        items,
        totals,
      };
    } catch (e) {
      console.error("Error parsing post_money_cap_table:", e);
    }
  }

  return {
    items: [],
    totals: {
      total_shares: 0,
      total_new_shares: 0,
      total_founders: 0,
      total_investors: 0,
      total_option_pool: 0,
      total_value: 0,
      post_money_valuation: 0,
      pre_money_valuation: 0,
      investment: 0,
      share_price: 0,
    },
  };
}

// ============================================
function calculateCPAVATERoundMetrics(
  currentRound,
  allRounds,
  preMoneyCapTable,
  postMoneyCapTable,
) {
  const preMoneyVal = parseFloat(currentRound.pre_money) || 0;
  const investmentVal = parseFloat(currentRound.roundsize) || 0;
  const postMoneyVal = preMoneyVal + investmentVal;

  const totalSharesPre = preMoneyCapTable.totals.total_shares || 0;
  const totalSharesPost = postMoneyCapTable.totals.total_shares || 0;

  // ✅ Share price = Pre-money valuation / Pre-money shares
  const sharePrice = totalSharesPre > 0 ? preMoneyVal / totalSharesPre : 0;

  // ✅ Get option pool percentage
  let optionPoolPercent = 0;
  let postMoneyOptionPoolPercent = 0;

  if (
    currentRound.instrumentType === "Preferred Equity" ||
    currentRound.instrumentType === "Common Stock"
  ) {
    optionPoolPercent = parseFloat(currentRound.optionPoolPercent) || 0;
    postMoneyOptionPoolPercent =
      parseFloat(currentRound.optionPoolPercent_post) || 0;
  } else {
    optionPoolPercent = parseFloat(currentRound.optionPoolPercent) || 0;
    postMoneyOptionPoolPercent =
      parseFloat(currentRound.optionPoolPercent_post) || 0;
  }

  // ✅ Calculate dilution if applicable
  let dilutionPercentage = 0;
  if (totalSharesPre > 0 && totalSharesPost > 0) {
    dilutionPercentage =
      ((totalSharesPost - totalSharesPre) / totalSharesPost) * 100;
  }

  return {
    // Valuation
    pre_money_valuation: preMoneyVal,
    post_money_valuation: postMoneyVal,
    investment: investmentVal,

    // Shares
    total_shares_pre: totalSharesPre,
    total_shares_outstanding: totalSharesPost,
    fully_diluted_shares: totalSharesPost,
    total_new_shares: postMoneyCapTable.totals.total_new_shares || 0,

    // Price
    share_price: sharePrice,
    price_per_share_fully_diluted: sharePrice,

    // Option Pool
    option_pool_percent: optionPoolPercent,
    post_money_option_pool_percent: postMoneyOptionPoolPercent,
    option_pool_shares_pre: preMoneyCapTable.totals.total_option_pool || 0,
    option_pool_shares_post: postMoneyCapTable.totals.total_option_pool || 0,
    new_option_pool_shares:
      (postMoneyCapTable.totals.total_option_pool || 0) -
      (preMoneyCapTable.totals.total_option_pool || 0),

    // Dilution
    dilution_percentage: parseFloat(dilutionPercentage.toFixed(2)),

    // MOIC calculations (if conversion data available)
    seed_moic: null,
    series_a_moic: investmentVal > 0 ? 1.0 : null,
  };
}

// ============================================
// FIXED ROUND 0 CALCULATION
// ============================================
// ============================================
// FIXED ROUND 0 CALCULATION WITH CHART DATA
// ============================================
function calculateRound0CapTable(round) {
  if (round.round_type !== "Round 0") return null;

  const capTable = [];
  let totalShares = 0;
  let totalValue = 0;
  const sharePrice = parseFloat(round.share_price) || 0.0;
  const currency = round.currency || "USD";

  // Parse founder_data if it exists
  let founderData = null;

  if (round.founder_data) {
    try {
      if (typeof round.founder_data === "string") {
        founderData = JSON.parse(round.founder_data);
      } else if (typeof round.founder_data === "object") {
        founderData = round.founder_data;
      }
    } catch (error) {
      console.error("Error parsing founder_data in Round 0:", error);
      founderData = null;
    }
  }

  if (
    founderData &&
    founderData.founders &&
    Array.isArray(founderData.founders)
  ) {
    // Process founders from JSON data
    founderData.founders.forEach((founder, idx) => {
      const shares = parseFloat(founder.shares);
      const value = shares * sharePrice;

      // Get founder name
      let founderName = "";

      if (founder.firstName && founder.lastName) {
        founderName = `${founder.firstName} ${founder.lastName}`;
      } else if (founder.firstName) {
        founderName = founder.firstName;
      } else if (founder.lastName) {
        founderName = founder.lastName;
      } else {
        founderName = `F${idx + 1}`;
      }

      const founderCode = `F${idx + 1}`;

      capTable.push({
        type: "founder",
        name: founderName,
        shares: shares,
        percentage: 0,
        round_id: round.id,
        round_name: round.nameOfRound || "Round 0",
        investment: 0,
        share_price: sharePrice,
        value: value,
        founder_id: idx + 1,
        founder_code: founderCode,
        email: founder.email || "",
        phone: founder.phone || "",
        share_type: founder.shareType || "common",
        voting: founder.voting || "voting",
      });

      totalShares += shares;
      totalValue += value;
    });
  } else {
    // Fallback if no founder data found
    const totalFounderShares = parseFloat(round.total_founder_shares) || 100000;
    const defaultShares = Math.floor(totalFounderShares / 3);
    const remaining = totalFounderShares - defaultShares * 2;

    const founders = [
      { name: "F1", shares: defaultShares },
      { name: "F2", shares: defaultShares },
      { name: "F3", shares: remaining },
    ];

    founders.forEach((founder, idx) => {
      const shares = founder.shares;
      const value = shares * sharePrice;

      capTable.push({
        type: "founder",
        name: founder.name,
        shares: shares,
        percentage: 0,
        round_id: round.id,
        round_name: round.nameOfRound || "Round 0",
        investment: 0,
        share_price: sharePrice,
        value: value,
        founder_id: idx + 1,
        founder_code: founder.name,
      });

      totalShares += shares;
      totalValue += value;
    });
  }

  // Calculate percentages
  if (totalShares > 0) {
    capTable.forEach((item) => {
      item.percentage = ((item.shares / totalShares) * 100).toFixed(2);
    });
  }

  // Calculate chart data for Round 0
  const chartData = {
    labels: capTable.map((item) => item.founder_code || item.name),
    datasets: [
      {
        data: capTable.map((item) => item.shares),
        backgroundColor: [
          "#FF6384",
          "#36A2EB",
          "#FFCE56",
          "#4BC0C0",
          "#9966FF",
          "#FF9F40",
          "#8AC926",
          "#1982C4",
        ],
        borderWidth: 1,
      },
    ],
  };

  const totals = {
    total_shares: totalShares,
    total_founders: totalShares,
    total_investors: 0,
    total_option_pool: 0,
    total_value: totalValue,
  };

  return {
    items: capTable,
    totals: totals,
    chart_data: chartData, // Add chart data
  };
}

// ✅ NEW FUNCTION: Extract Instrument-Specific Details
function extractInstrumentDetails(round) {
  const details = {
    type: round.instrumentType,
    terms: {},
    warrants: null,
  };

  if (round.instrument_type_data) {
    details.terms = round.instrument_type_data;
  }

  // Extract warrant info if exists
  if (
    round.instrumentType === "Preferred Equity" &&
    round.hasWarrants_preferred
  ) {
    details.warrants = {
      coverage_percentage: round.warrant_coverage_percentage,
      exercise_type: round.warrant_exercise_type,
      adjustment_percent: round.warrant_adjustment_percent,
      adjustment_direction: round.warrant_adjustment_direction,
      expiration_date: round.expirationDate_preferred,
    };
  }

  return details;
}

async function getPendingConversions(company_id, current_round_id) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        rr.id,
        rr.nameOfRound,
        rr.instrumentType,
        rr.roundsize,
        rr.instrument_type_data,
        rr.created_at,
        rr.share_price,
        rr.currency,
        rr.option_pool_shares
      FROM roundrecord rr
      LEFT JOIN conversion_tracking ct 
        ON rr.id = ct.original_round_id 
      WHERE rr.company_id = ? 
        AND rr.round_type = 'Investment'
        AND rr.instrumentType IN ('Safe', 'Convertible Note')
        AND rr.id < ?
        AND ct.id IS NULL
      ORDER BY rr.id ASC
    `;

    db.query(query, [company_id, current_round_id], (err, results) => {
      if (err) {
        console.error("❌ Error fetching pending conversions:", err);
        resolve([]);
      } else {
        const pending = results.map((round) => {
          let instrumentData = {};
          try {
            instrumentData = round.instrument_type_data
              ? typeof round.instrument_type_data === "string"
                ? JSON.parse(round.instrument_type_data)
                : round.instrument_type_data
              : {};
          } catch (e) {}

          return {
            round_id: round.id,
            round_name: round.nameOfRound,
            instrument_type: round.instrumentType,
            investment_amount: parseFloat(round.roundsize) || 0,
            instrument_data: instrumentData,
            discount_rate:
              round.instrumentType === "Safe"
                ? instrumentData.discountRate ||
                  instrumentData.discount_rate ||
                  20
                : instrumentData.discountRate_note ||
                  instrumentData.discount_rate_note ||
                  20,
            valuation_cap:
              round.instrumentType === "Safe"
                ? instrumentData.valuationCap ||
                  instrumentData.valuation_cap ||
                  0
                : instrumentData.valuationCap_note ||
                  instrumentData.valuation_cap_note ||
                  0,
            is_pending: true,
            display_share_price: "N/A",
            display_shares: "N/A",
          };
        });
        resolve(pending);
      }
    });
  });
}
async function getConversionTrackingData(company_id) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        ct.*,
        rr.nameOfRound as original_round_name,
        rr2.nameOfRound as conversion_round_name
      FROM conversion_tracking ct
      LEFT JOIN roundrecord rr ON ct.original_round_id = rr.id
      LEFT JOIN roundrecord rr2 ON ct.conversion_round_id = rr2.id
      WHERE ct.company_id = ?
      ORDER BY ct.original_round_id ASC
    `;

    db.query(query, [company_id], (err, results) => {
      if (err) {
        console.error("❌ Error fetching conversion data:", err);
        resolve([]);
      } else {
        const conversions = results.map((conv) => ({
          ...conv,
          original_investment_amount:
            parseFloat(conv.original_investment_amount) || 0,
          conversion_price: parseFloat(conv.conversion_price) || 0,
          converted_shares: parseFloat(conv.converted_shares) || 0,
        }));
        resolve(conversions);
      }
    });
  });
}

// Helper function for currency formatting
// Helper function for currency formatting
function formatCurrency(amount, currency = "USD") {
  // ✅ Clean the currency code - remove spaces and special characters
  let cleanCurrency = "USD"; // default

  if (currency) {
    // Extract only alphabetic characters for currency code
    cleanCurrency = currency.replace(/[^A-Z]/g, "");

    // If no valid currency code found, use default
    if (!cleanCurrency || cleanCurrency.length !== 3) {
      cleanCurrency = "USD";
    }
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: cleanCurrency,
    }).format(amount);
  } catch (error) {
    // Fallback if currency code is still invalid
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  }
}

function safeJSONParseRepeated(raw, maxDepth = 3) {
  let cur = raw;
  for (let i = 0; i < maxDepth; i++) {
    if (cur === null || cur === undefined) return null;
    if (typeof cur === "object") return cur;
    if (typeof cur !== "string") return null;
    cur = cur.trim();
    if (cur === "") return null;
    try {
      const parsed = JSON.parse(cur);
      // If parsed is a string again (double-encoded), loop and parse again
      cur = parsed;
      if (typeof cur === "object") return cur;
    } catch (e) {
      // Not JSON parsable as string -> stop
      return null;
    }
  }
  return null;
}

function normalizeFounders(founderObj) {
  // founderObj may be an array or an object containing arrays
  if (!founderObj) return [];
  if (Array.isArray(founderObj)) return founderObj;
  if (typeof founderObj === "object") {
    if (Array.isArray(founderObj.founders)) return founderObj.founders;
    if (Array.isArray(founderObj.shareholders)) return founderObj.shareholders;
  }
  return [];
}

function toNumber(v, fallback = 0) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.\-]/g, "");
    const n = cleaned === "" ? NaN : Number(cleaned);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/**
 * Update roundrecord with calculation results
 * @param {number} roundId - Round ID to update
 * @param {object} calculationData - Calculation results
 * @param {function} callback - Callback function
 */
function updateRoundRecordWithCalculations(
  totalSharesBefore,
  totalSharesAfter,
  sharePrice,
  roundId,
) {
  // Validate inputs
  if (!roundId) {
    console.error("❌ Error: roundId is required");
    return;
  }

  // Prepare data for update
  const updateData = {
    total_shares_before: totalSharesBefore || null,
    total_shares_after: totalSharesAfter || null,
    share_price: sharePrice || null,
  };

  // Fix: Added SET keyword and removed comma before WHERE
  const sqlQuery = `
    UPDATE roundrecord 
    SET 
      total_shares_before = ?,
      total_shares_after = ?,
      share_price = ?
    WHERE id = ?
  `;

  // Execute the query
  db.query(
    sqlQuery,
    [
      updateData.total_shares_before,
      updateData.total_shares_after,
      updateData.share_price,
      roundId,
    ],
    (updateErr, updateResult) => {
      if (updateErr) {
        console.error("❌ Database update error:", updateErr);
        return;
      }

      if (updateResult.affectedRows === 0) {
        console.warn(`⚠️ No record found with id: ${roundId}`);
      } else {
      }
    },
  );
}
function updateIssuedShares(seriesAShares, roundId) {
  db.query(
    `UPDATE roundrecord SET issuedshares = ? WHERE id = ?`,
    [seriesAShares, roundId],
    (err, result) => {
      if (err) {
        console.error("❌ Error updating issued shares:", err);
      } else {
        // Optional: Verify the update
        if (result.affectedRows > 0) {
        }
      }
    },
  );
}
function parseLiquidationPreference(liquidationValue) {
  if (
    liquidationValue === null ||
    liquidationValue === undefined ||
    liquidationValue === "" ||
    liquidationValue === "null" ||
    liquidationValue === "undefined"
  ) {
    return 1; // Default to Non-participating
  }

  const parsed = parseInt(liquidationValue);
  if ([1, 2, 3].includes(parsed)) {
    return parsed;
  }

  return 1;
}

function calculateLiquidationDistributionWithCommonStock(
  exitValue,
  liquidationType,
  seriesAInvestment,
  seedInvestment,
  commonStockInvestment,
  totalPostShares,
  seriesAShares,
  seedConversionShares,
  founderShares,
  optionPoolShares,
  commonStockShares,
  commonStockInvestors,
) {
  // Initialize result object
  const result = {
    exitValue: exitValue,
    liquidationType: liquidationType,
    liquidationLabel: getLiquidationLabel(liquidationType),

    // Preferred Equity amounts
    seriesAPreferredAmount: 0,
    seriesAParticipationAmount: 0,

    // Converted Seed amounts
    seedPreferredAmount: 0,
    seedParticipationAmount: 0,

    // Common Stock amounts
    commonStockAmount: 0,

    // Founder amounts
    founderAmount: 0,

    // Option Pool amounts
    optionPoolAmount: 0,

    // Calculation intermediates
    remainingAfterPreferred: 0,
    totalDistributed: 0,

    // Ownership percentages for reference
    ownershipPercentages: {},

    // Breakdown
    breakdown: {},
  };

  // ============================================
  // ✅ STEP 1: CALCULATE OWNERSHIP PERCENTAGES
  // ============================================
  const seriesAOwnership =
    totalPostShares > 0 ? seriesAShares / totalPostShares : 0;
  const seedOwnership =
    totalPostShares > 0 ? seedConversionShares / totalPostShares : 0;
  const commonStockOwnership =
    totalPostShares > 0 ? commonStockShares / totalPostShares : 0;
  const founderOwnership =
    totalPostShares > 0 ? founderShares / totalPostShares : 0;
  const optionPoolOwnership =
    totalPostShares > 0 ? optionPoolShares / totalPostShares : 0;

  // Store ownership percentages
  result.ownershipPercentages = {
    seriesA: (seriesAOwnership * 100).toFixed(2) + "%",
    seed: (seedOwnership * 100).toFixed(2) + "%",
    commonStock: (commonStockOwnership * 100).toFixed(2) + "%",
    founders: (founderOwnership * 100).toFixed(2) + "%",
    optionPool: (optionPoolOwnership * 100).toFixed(2) + "%",
    total: "100%",
  };

  // ============================================
  // ✅ STEP 2: APPLY LIQUIDATION PREFERENCE
  // ============================================
  // IMPORTANT: Only Preferred Equity (Series A) gets liquidation preference
  // Converted Seed investors ALSO get liquidation preference (they converted to Preferred)
  // Common Stock investors DO NOT get liquidation preference

  // TYPE 1: Non-participating (1x preference)
  if (liquidationType === 1) {
    // ============================================
    // NON-PARTICIPATING WITH COMMON STOCK
    // ============================================

    // Step 1: Preferred Equity investors get EITHER:
    // - Their 1x investment back, OR
    // - Their pro-rata share of exit value (as Common Stock)
    // They choose whichever is HIGHER

    const seriesAConvertedValue = exitValue * seriesAOwnership;
    const seedConvertedValue = exitValue * seedOwnership;

    // Series A investors choose between 1x investment or converted value
    result.seriesAPreferredAmount = Math.max(
      seriesAInvestment * 1, // 1x multiple
      seriesAConvertedValue,
    );

    // Seed investors (converted to Preferred) also choose
    result.seedPreferredAmount = Math.max(
      seedInvestment * 1, // 1x multiple
      seedConvertedValue,
    );

    // Total amount to Preferred Equity investors
    const totalPreferredAmount =
      result.seriesAPreferredAmount + result.seedPreferredAmount;

    // Step 2: If exit value is less than total preferred amount,
    // Preferred investors get everything, others get nothing
    if (exitValue <= totalPreferredAmount) {
      // Distribute proportionally among Preferred investors based on their investment
      const seriesARatio =
        seriesAInvestment / (seriesAInvestment + seedInvestment);
      const seedRatio = seedInvestment / (seriesAInvestment + seedInvestment);

      result.seriesAPreferredAmount = Math.round(exitValue * seriesARatio);
      result.seedPreferredAmount = Math.round(exitValue * seedRatio);
      result.commonStockAmount = 0;
      result.founderAmount = 0;
      result.optionPoolAmount = 0;
    }
    // Step 3: If there's money left after Preferred investors are paid
    else {
      result.remainingAfterPreferred = exitValue - totalPreferredAmount;

      // Remaining goes to Common Stock, Founders, and Option Pool
      const remainingForCommon = result.remainingAfterPreferred;
      const totalCommonShares =
        commonStockShares + founderShares + optionPoolShares;

      if (totalCommonShares > 0) {
        // Common Stock investors
        result.commonStockAmount =
          remainingForCommon * (commonStockShares / totalCommonShares);

        // Founders
        result.founderAmount =
          remainingForCommon * (founderShares / totalCommonShares);

        // Option Pool
        result.optionPoolAmount =
          remainingForCommon * (optionPoolShares / totalCommonShares);
      }
    }
  }

  // TYPE 2: Participating (1x preference + participation)
  else if (liquidationType === 2) {
    // ============================================
    // PARTICIPATING WITH COMMON STOCK
    // ============================================

    // Step 1: Preferred Equity investors get 1x investment back FIRST
    const totalPreferredInvestment = seriesAInvestment * 1 + seedInvestment * 1;
    result.seriesAPreferredAmount = seriesAInvestment * 1; // 1x
    result.seedPreferredAmount = seedInvestment * 1; // 1x

    // If exit value is less than total 1x preference
    if (exitValue <= totalPreferredInvestment) {
      // Distribute proportionally among Preferred investors
      const seriesARatio =
        seriesAInvestment / (seriesAInvestment + seedInvestment);
      const seedRatio = seedInvestment / (seriesAInvestment + seedInvestment);

      result.seriesAPreferredAmount = Math.round(exitValue * seriesARatio);
      result.seedPreferredAmount = Math.round(exitValue * seedRatio);
      result.commonStockAmount = 0;
      result.founderAmount = 0;
      result.optionPoolAmount = 0;
    }
    // If there's money left after 1x preference
    else {
      result.remainingAfterPreferred = exitValue - totalPreferredInvestment;

      // Step 2: Remaining proceeds distributed among ALL shareholders
      // INCLUDING Preferred Equity investors (they "participate")
      // But Common Stock investors still get their share

      // Calculate participation amounts for Preferred investors
      result.seriesAParticipationAmount =
        result.remainingAfterPreferred * seriesAOwnership;
      result.seedParticipationAmount =
        result.remainingAfterPreferred * seedOwnership;

      // Calculate amounts for Common Stock, Founders, and Option Pool
      result.commonStockAmount =
        result.remainingAfterPreferred * commonStockOwnership;
      result.founderAmount = result.remainingAfterPreferred * founderOwnership;
      result.optionPoolAmount =
        result.remainingAfterPreferred * optionPoolOwnership;
    }
  }

  // TYPE 3: Capped Participating (1x preference + participation up to 2x cap)
  else if (liquidationType === 3) {
    // ============================================
    // CAPPED PARTICIPATING WITH COMMON STOCK
    // ============================================
    const participationCap = 2; // 2x cap as per document
    const seriesACap = seriesAInvestment * participationCap;
    const seedCap = seedInvestment * participationCap;

    // Step 1: Preferred Equity investors get 1x investment back
    result.seriesAPreferredAmount = seriesAInvestment * 1;
    result.seedPreferredAmount = seedInvestment * 1;

    const totalPreferredAmount =
      result.seriesAPreferredAmount + result.seedPreferredAmount;

    // If exit value is less than 1x preference
    if (exitValue <= totalPreferredAmount) {
      // Distribute proportionally among Preferred investors
      const seriesARatio =
        seriesAInvestment / (seriesAInvestment + seedInvestment);
      const seedRatio = seedInvestment / (seriesAInvestment + seedInvestment);

      result.seriesAPreferredAmount = Math.round(exitValue * seriesARatio);
      result.seedPreferredAmount = Math.round(exitValue * seedRatio);
      result.commonStockAmount = 0;
      result.founderAmount = 0;
      result.optionPoolAmount = 0;
    }
    // If there's money left after 1x preference
    else {
      result.remainingAfterPreferred = exitValue - totalPreferredAmount;

      // Step 2: Calculate how much Preferred investors can participate
      // until they reach their 2x cap

      // First, calculate what they would get if they participated fully
      const potentialSeriesAParticipation =
        result.remainingAfterPreferred * seriesAOwnership;
      const potentialSeedParticipation =
        result.remainingAfterPreferred * seedOwnership;

      // Apply 2x caps
      result.seriesAParticipationAmount = Math.min(
        potentialSeriesAParticipation,
        seriesACap - result.seriesAPreferredAmount,
      );

      result.seedParticipationAmount = Math.min(
        potentialSeedParticipation,
        seedCap - result.seedPreferredAmount,
      );

      // Total amount taken by Preferred investors (1x + participation)
      const totalPreferredTaken =
        result.seriesAPreferredAmount +
        result.seedPreferredAmount +
        result.seriesAParticipationAmount +
        result.seedParticipationAmount;

      // Step 3: If Preferred investors haven't reached their caps,
      // they get their participation amount, and the rest goes to Common
      const remainingAfterPreferredParticipation =
        exitValue - totalPreferredTaken;

      if (remainingAfterPreferredParticipation > 0) {
        // Distribute remaining among Common Stock, Founders, and Option Pool
        const totalCommonShares =
          commonStockShares + founderShares + optionPoolShares;

        if (totalCommonShares > 0) {
          result.commonStockAmount =
            remainingAfterPreferredParticipation *
            (commonStockShares / totalCommonShares);
          result.founderAmount =
            remainingAfterPreferredParticipation *
            (founderShares / totalCommonShares);
          result.optionPoolAmount =
            remainingAfterPreferredParticipation *
            (optionPoolShares / totalCommonShares);
        }
      }
    }
  }

  // TYPE 4: Common Stock Only (No liquidation preference)
  else if (liquidationType === 4) {
    // ============================================
    // NO LIQUIDATION PREFERENCE (All treated as Common)
    // ============================================
    // All investors treated equally as Common Stock

    result.seriesAPreferredAmount = exitValue * seriesAOwnership;
    result.seedPreferredAmount = exitValue * seedOwnership;
    result.commonStockAmount = exitValue * commonStockOwnership;
    result.founderAmount = exitValue * founderOwnership;
    result.optionPoolAmount = exitValue * optionPoolOwnership;
  }

  // ============================================
  // ✅ STEP 3: CALCULATE TOTALS AND ROUND VALUES
  // ============================================

  // Calculate totals
  result.totalDistributed =
    result.seriesAPreferredAmount +
    result.seriesAParticipationAmount +
    result.seedPreferredAmount +
    result.seedParticipationAmount +
    result.commonStockAmount +
    result.founderAmount +
    result.optionPoolAmount;

  // Check for rounding errors
  const distributionError = Math.abs(exitValue - result.totalDistributed);
  if (distributionError > 1) {
    // Adjust the largest amount to fix rounding
    const amounts = [
      { key: "seriesAPreferredAmount", value: result.seriesAPreferredAmount },
      {
        key: "seriesAParticipationAmount",
        value: result.seriesAParticipationAmount,
      },
      { key: "seedPreferredAmount", value: result.seedPreferredAmount },
      { key: "seedParticipationAmount", value: result.seedParticipationAmount },
      { key: "commonStockAmount", value: result.commonStockAmount },
      { key: "founderAmount", value: result.founderAmount },
      { key: "optionPoolAmount", value: result.optionPoolAmount },
    ];

    // Find largest amount
    amounts.sort((a, b) => b.value - a.value);
    if (amounts.length > 0) {
      result[amounts[0].key] += exitValue - result.totalDistributed;
    }

    // Recalculate total
    result.totalDistributed =
      result.seriesAPreferredAmount +
      result.seriesAParticipationAmount +
      result.seedPreferredAmount +
      result.seedParticipationAmount +
      result.commonStockAmount +
      result.founderAmount +
      result.optionPoolAmount;
  }

  // Round all values
  Object.keys(result).forEach((key) => {
    if (typeof result[key] === "number") {
      result[key] = Math.round(result[key]);
    }
  });

  // Create breakdown for display
  result.breakdown = {
    // Preferred Equity Section
    preferredEquity: {
      seriesA: {
        preferred: result.seriesAPreferredAmount,
        participation: result.seriesAParticipationAmount,
        total:
          result.seriesAPreferredAmount + result.seriesAParticipationAmount,
        ownership: result.ownershipPercentages.seriesA,
        hasLiquidationPreference: true,
      },
      seed: {
        preferred: result.seedPreferredAmount,
        participation: result.seedParticipationAmount,
        total: result.seedPreferredAmount + result.seedParticipationAmount,
        ownership: result.ownershipPercentages.seed,
        hasLiquidationPreference: true,
      },
    },

    // Common Stock Section
    commonStock: {
      commonStockInvestors: {
        amount: result.commonStockAmount,
        ownership: result.ownershipPercentages.commonStock,
        hasLiquidationPreference: false,
      },
      founders: {
        amount: result.founderAmount,
        ownership: result.ownershipPercentages.founders,
        hasLiquidationPreference: false,
      },
      optionPool: {
        amount: result.optionPoolAmount,
        ownership: result.ownershipPercentages.optionPool,
        hasLiquidationPreference: false,
      },
    },

    // Totals
    totals: {
      preferredTotal:
        result.seriesAPreferredAmount +
        result.seriesAParticipationAmount +
        result.seedPreferredAmount +
        result.seedParticipationAmount,
      commonTotal:
        result.commonStockAmount +
        result.founderAmount +
        result.optionPoolAmount,
      grandTotal: result.totalDistributed,
    },
  };

  // Add a summary message
  result.summary = generateLiquidationSummary(result, liquidationType);

  return result;
}
function generateLiquidationSummary(result, liquidationType) {
  const messages = [];

  if (liquidationType === 1) {
    messages.push("Type 1: Non-participating (1x preference)");
    messages.push(
      "Preferred Equity investors get EITHER 1x investment OR pro-rata share",
    );
    messages.push(
      "Common Stock investors paid only after Preferred investors choose",
    );
  } else if (liquidationType === 2) {
    messages.push("Type 2: Participating (1x preference + participation)");
    messages.push("Preferred Equity investors get 1x investment back FIRST");
    messages.push("Then ALL shareholders participate in remaining proceeds");
  } else if (liquidationType === 3) {
    messages.push(
      "Type 3: Capped Participating (1x preference + participation up to 2x cap)",
    );
    messages.push("Preferred Equity investors get 1x investment back FIRST");
    messages.push(
      "Then participate in remaining until reaching 2x total return",
    );
    messages.push("Remaining after caps goes to Common Stock investors");
  }

  // Add distribution message
  const preferredTotal = result.breakdown.totals.preferredTotal;
  const commonTotal = result.breakdown.totals.commonTotal;

  messages.push(
    `Distribution: Preferred Equity: ${formatCurrency(preferredTotal)} | Common Stock: ${formatCurrency(commonTotal)}`,
  );

  return messages;
}
function getLiquidationLabel(liquidationType) {
  const labels = {
    1: "Non-participating (1x preference)",
    2: "Participating (1x preference + participation)",
    3: "Capped Participating (1x preference + participation up to 2x cap)",
    4: "Common Stock Only (No liquidation preference)",
  };
  return labels[liquidationType] || "Unknown";
}

function getLiquidationLabel(liquidationType) {
  switch (liquidationType) {
    case 1:
      return "Non-participating (1x)";
    case 2:
      return "Participating (1x)";
    case 3:
      return "Capped participating (2x cap)";
    default:
      return "Non-participating (1x)";
  }
}

// Add this to your capitalround API
// capitalRoundController.js
exports.checkExistingRounds = (req, res) => {
  const { company_id, id } = req.body;

  // Count all rounds including Round 0 to determine if company has any rounds
  const sql = "SELECT * FROM roundrecord WHERE company_id = ?";

  db.query(sql, [company_id], (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Database error", error: err });
    }
    var roundCounts = false;

    if (results.length > 0) {
      const roundCount = results[0].round_type;

      if (id) {
        if (roundCount === "Round 0") {
          var roundCounts = false;
        }
      } else {
        if (roundCount === "Round 0") {
          var roundCounts = true;
        }
      }
    }
    res.status(200).json({
      roundCount: roundCounts,
    });
  });
};

// Backend mein yeh API endpoint add karein
// API 1: getPreviousRoundOptionPool
// In your backend API controller
// exports.getPreviousRoundOptionPool = (req, res) => {
//   const { company_id } = req.body;

//   db.query(
//     `SELECT
//       rr.id,
//       rr.optionPoolPercent,
//       rr.optionPoolPercent_post,
//       rr.round_type,
//       rr.nameOfRound,
//       rr.issuedshares,
//       rr.created_at
//     FROM roundrecord rr
//     WHERE rr.company_id = ?
//     AND rr.round_type = 'Investment'

//     ORDER BY rr.created_at DESC
//     LIMIT 1`,
//     [company_id],
//     (err, results) => {
//       if (err) {
//         return res.status(500).json({
//           success: false,
//           message: "Database error",
//           error: err.message,
//         });
//       }

//       if (results.length > 0) {
//         const previousRound = results[0];
//         let existingOptionPoolPercent = 0;

//         // ✅ CRITICAL: For Seed round, the PRE-money pool becomes POST-money pool
//         // For Series rounds, use POST-money pool
//         if (
//           previousRound.optionPoolPercent_post &&
//           parseFloat(previousRound.optionPoolPercent_post) > 0
//         ) {
//           // Series round had POST-money pool
//           existingOptionPoolPercent = parseFloat(
//             previousRound.optionPoolPercent_post
//           );
//         } else if (
//           previousRound.optionPoolPercent &&
//           parseFloat(previousRound.optionPoolPercent) > 0
//         ) {
//           // Seed round had PRE-money pool, which becomes the POST-money pool
//           existingOptionPoolPercent = parseFloat(
//             previousRound.optionPoolPercent
//           );
//         }

//         res.status(200).json({
//           success: true,
//           existingOptionPoolPercent: existingOptionPoolPercent,
//           previousRoundType: previousRound.round_type,
//           previousRoundName: previousRound.nameOfRound,
//         });
//       } else {
//         res.status(200).json({
//           success: true,
//           existingOptionPoolPercent: 0,
//           previousRoundType: null,
//         });
//       }
//     }
//   );
// };
exports.getPreviousRoundOptionPool = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    return res.status(400).json({
      success: false,
      message: "Company ID is required",
    });
  }

  db.query(
    `SELECT 
      rr.id,
      rr.optionPoolPercent,
      rr.optionPoolPercent_post,
      rr.round_type,
      rr.nameOfRound,
      rr.shareClassType,
      rr.instrumentType,
      rr.issuedshares,
      rr.roundsize,
      rr.currency,
      rr.pre_money,
      rr.post_money,
      rr.instrument_type_data,
      rr.founder_data,
      rr.dateroundclosed,
      rr.created_at,
      ROW_NUMBER() OVER (ORDER BY 
        CASE 
          WHEN rr.round_type = 'Round 0' THEN 1
          WHEN rr.shareClassType LIKE '%Seed%' OR rr.nameOfRound LIKE '%Seed%' THEN 2
          WHEN rr.shareClassType LIKE '%Series%' OR rr.nameOfRound LIKE '%Series%' THEN 3
          ELSE 4
        END, 
        rr.created_at DESC
      ) as round_order
    FROM roundrecord rr
    WHERE rr.company_id = ?
      AND rr.round_type IN ('Round 0', 'Investment')
    ORDER BY 
      CASE 
        WHEN rr.round_type = 'Round 0' THEN 1
        WHEN rr.shareClassType LIKE '%Seed%' OR rr.nameOfRound LIKE '%Seed%' THEN 2
        WHEN rr.shareClassType LIKE '%Series%' OR rr.nameOfRound LIKE '%Series%' THEN 3
        ELSE 4
      END,
      rr.created_at DESC`,
    [company_id],
    (err, allResults) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Database error",
          error: err.message,
        });
      }

      let existingOptionPoolPercent = 0;
      let previousRoundData = {
        totalShares: 0,
        founderShares: 0,
        employeeShares: 0,
        seedInvestment: 0,
        valuationCap: 0,
        discountRate: 0,
        shareClassType: "",
        instrumentType: "",
        roundName: "",
        currency: "",
        preMoneyValuation: 0,
        postMoneyValuation: 0,
        roundZeroTotalShares: 0,
        employeeSharesSeedRound: 0,
        totalSharesPreSeed: 0,
      };

      // Separate rounds
      const round0 = allResults.find((r) => r.round_type === "Round 0");
      const seedRound = allResults.find(
        (r) =>
          (r.shareClassType?.includes("Seed") ||
            r.nameOfRound?.includes("Seed")) &&
          r.round_type === "Investment",
      );
      const latestSeriesRound = allResults.find(
        (r) =>
          (r.shareClassType?.includes("Series") ||
            r.nameOfRound?.includes("Series")) &&
          r.round_type === "Investment",
      );

      // 1. Get Round 0 (Founder) data
      let round0FounderShares = 0;
      let round0TotalShares = 0;

      if (round0) {
        round0TotalShares = parseInt(round0.issuedshares) || 0;
        previousRoundData.roundZeroTotalShares = round0TotalShares;

        // DEBUG: Log the founder_data structure

        if (round0.founder_data) {
          try {
            const founderData =
              typeof round0.founder_data === "string"
                ? JSON.parse(round0.founder_data)
                : round0.founder_data;

            // Try multiple possible structures
            if (founderData.founders && Array.isArray(founderData.founders)) {
              round0FounderShares = founderData.founders.reduce(
                (sum, founder) => {
                  // Try multiple field names for shares
                  const shares =
                    parseInt(founder.shares) ||
                    parseInt(founder.numOfShares) ||
                    parseInt(founder.issuedShares) ||
                    parseInt(founder.totalShares) ||
                    0;

                  return sum + shares;
                },
                0,
              );
            } else if (founderData.totalShares) {
              // Alternative: totalShares in root
              round0FounderShares = parseInt(founderData.totalShares) || 0;
            } else if (founderData.shares) {
              // Simple structure
              round0FounderShares = parseInt(founderData.shares) || 0;
            }
          } catch (e) {}
        }

        // FALLBACK: If no founder shares found, use all Round 0 shares as founder shares
        if (round0FounderShares === 0) {
          round0FounderShares = round0TotalShares;
        }
      }

      // 2. Get Seed round data (for Series A calculations)
      if (seedRound) {
        previousRoundData.seedInvestment = parseFloat(seedRound.roundsize) || 0;
        previousRoundData.shareClassType = seedRound.shareClassType || "";
        previousRoundData.instrumentType = seedRound.instrumentType || "";
        previousRoundData.roundName = seedRound.nameOfRound || "";
        previousRoundData.currency = seedRound.currency || "";
        previousRoundData.preMoneyValuation =
          parseFloat(seedRound.pre_money) || 0;
        previousRoundData.postMoneyValuation =
          parseFloat(seedRound.post_money) || 0;

        // Get Seed's PRE-MONEY option pool
        const seedPreMoneyPool = parseFloat(seedRound.optionPoolPercent || 0);
        existingOptionPoolPercent = seedPreMoneyPool;

        // 🔥 CRITICAL FIX: Calculate PROPER total shares including option pool
        if (seedPreMoneyPool > 0 && round0FounderShares > 0) {
          // Formula: Total Shares After Seed = Founder Shares / (1 - Pool%)
          // This calculates the total shares INCLUDING the option pool created at Seed
          const totalSharesAfterSeedPool = Math.round(
            round0FounderShares / (1 - seedPreMoneyPool / 100),
          );

          const employeeSharesCreatedInSeed =
            totalSharesAfterSeedPool - round0FounderShares;

          previousRoundData.totalShares = totalSharesAfterSeedPool; // Should be 111,111
          previousRoundData.founderShares = round0FounderShares; // 100,000
          previousRoundData.employeeShares = employeeSharesCreatedInSeed; // 11,111
          previousRoundData.employeeSharesSeedRound =
            employeeSharesCreatedInSeed;
          previousRoundData.totalSharesPreSeed = totalSharesAfterSeedPool;
        } else {
          // If no option pool at Seed, just use Round 0 numbers
          previousRoundData.totalShares = round0TotalShares;
          previousRoundData.founderShares = round0FounderShares;
          previousRoundData.employeeShares =
            round0TotalShares - round0FounderShares;
          previousRoundData.totalSharesPreSeed = round0TotalShares;
        }

        // Parse SAFE details if available
        if (seedRound.instrument_type_data) {
          try {
            const safeData =
              typeof seedRound.instrument_type_data === "string"
                ? JSON.parse(seedRound.instrument_type_data)
                : seedRound.instrument_type_data;

            previousRoundData.valuationCap =
              parseFloat(safeData.valuationCap) || 0;
            previousRoundData.discountRate =
              parseFloat(safeData.discountRate) || 0;
          } catch (e) {}
        }

        // If pre-money valuation seems wrong, calculate it properly
        // if (previousRoundData.preMoneyValuation < 100000) {
        //   // If less than 100k, it's probably wrong
        //   // Pre-money = (Founder Shares / Total Shares) * (Something sensible)
        //   // Or use a sensible default
        //   previousRoundData.preMoneyValuation = 1200000; // Default for calculation
        //
        // }
      } else if (round0) {
        // No Seed round exists, use Round 0 data
        previousRoundData.totalShares = round0TotalShares;
        previousRoundData.founderShares = round0FounderShares;
        previousRoundData.employeeShares =
          round0TotalShares - round0FounderShares;
        previousRoundData.totalSharesPreSeed = round0TotalShares;
      }

      // 3. Get latest Series round data (for next Series round)
      if (latestSeriesRound && !seedRound) {
        // If no Seed round, use latest Series round's Post-Money pool
        if (
          latestSeriesRound.optionPoolPercent_post &&
          parseFloat(latestSeriesRound.optionPoolPercent_post) > 0
        ) {
          existingOptionPoolPercent = parseFloat(
            latestSeriesRound.optionPoolPercent_post,
          );
        } else if (
          latestSeriesRound.optionPoolPercent &&
          parseFloat(latestSeriesRound.optionPoolPercent) > 0
        ) {
          existingOptionPoolPercent = parseFloat(
            latestSeriesRound.optionPoolPercent,
          );
        }
      }

      // If still no option pool found
      if (existingOptionPoolPercent === 0 && round0) {
        existingOptionPoolPercent = 10; // Default 10% for Seed round
      }

      // FINAL VALIDATION: If totalShares is still Round 0 value, recalculate
      if (previousRoundData.totalShares === round0TotalShares && seedRound) {
        if (
          existingOptionPoolPercent > 0 &&
          previousRoundData.founderShares > 0
        ) {
          const recalculatedTotal = Math.round(
            previousRoundData.founderShares /
              (1 - existingOptionPoolPercent / 100),
          );
          previousRoundData.totalShares = recalculatedTotal;
          previousRoundData.employeeShares =
            recalculatedTotal - previousRoundData.founderShares;
          previousRoundData.totalSharesPreSeed = recalculatedTotal;
        }
      }

      res.status(200).json({
        success: true,
        existingOptionPoolPercent: existingOptionPoolPercent,
        previousRoundData: previousRoundData,
        round0Exists: !!round0,
        seedRoundExists: !!seedRound,
        seriesRoundExists: !!latestSeriesRound,
        message: "Dynamic data fetched successfully",
      });
    },
  );
};
exports.getPreviousRoundForConvertible = (req, res) => {
  const { company_id, current_round_id } = req.body;

  if (!company_id) {
    return res.status(400).json({
      success: false,
      message: "Company ID is required",
    });
  }

  // 🔥 STATIC DEFAULT: 2 years between rounds
  const years = 2; // Static value as requested

  // Get ALL rounds to build the complete cap table
  db.query(
    `SELECT 
      rr.id,
      rr.optionPoolPercent,
      rr.optionPoolPercent_post,
      rr.round_type,
      rr.nameOfRound,
      rr.shareClassType,
      rr.instrumentType,
      rr.issuedshares,
      rr.roundsize,
      rr.currency,
      rr.pre_money,
      rr.post_money,
      rr.instrument_type_data,
      rr.founder_data,
      rr.dateroundclosed,
      rr.created_at,
      ROW_NUMBER() OVER (ORDER BY 
        CASE 
          WHEN rr.round_type = 'Round 0' THEN 1
          WHEN rr.shareClassType LIKE '%Seed%' OR rr.nameOfRound LIKE '%Seed%' THEN 2
          WHEN rr.shareClassType LIKE '%Series%' OR rr.nameOfRound LIKE '%Series%' THEN 3
          ELSE 4
        END, 
        rr.created_at DESC
      ) as round_order
    FROM roundrecord rr
    WHERE rr.company_id = ?
      AND rr.round_type IN ('Round 0', 'Investment')
    ORDER BY 
      CASE 
        WHEN rr.round_type = 'Round 0' THEN 1
        WHEN rr.shareClassType LIKE '%Seed%' OR rr.nameOfRound LIKE '%Seed%' THEN 2
        WHEN rr.shareClassType LIKE '%Series%' OR rr.nameOfRound LIKE '%Series%' THEN 3
        ELSE 4
      END,
      rr.created_at DESC`,
    [company_id],
    (err, allResults) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Database error",
          error: err.message,
        });
      }

      if (allResults.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No rounds found for this company",
        });
      }

      allResults.forEach((round, index) => {});

      // Find Round 0 for founder shares
      const round0 = allResults.find((r) => r.round_type === "Round 0");
      // Find Seed Convertible Note round (could be Seed or Pre-Seed)
      const seedConvertibleRound = allResults.find(
        (r) => r.instrumentType === "Convertible Note",
      );

      if (!round0) {
        return res.status(404).json({
          success: false,
          message: "Round 0 (Founder round) not found",
        });
      }

      // Initialize variables
      let totalShares = 0;
      let founderShares = 0;
      let employeeSharesFromSeed = 0;
      let seedInvestment = 0;
      let valuationCap = 0;
      let discountRate = 0;
      let interestRate = 0;
      let seedOptionPoolPercent = 0;

      // 1. Get founder shares from Round 0
      if (round0) {
        // Get total shares issued in Round 0
        const round0TotalShares = parseInt(round0.issuedshares) || 0;

        // Parse founder data
        if (round0.founder_data) {
          try {
            const founderData =
              typeof round0.founder_data === "string"
                ? JSON.parse(round0.founder_data)
                : round0.founder_data;

            if (founderData.founders && Array.isArray(founderData.founders)) {
              founderShares = founderData.founders.reduce((sum, founder) => {
                return sum + (parseInt(founder.shares) || 0);
              }, 0);
            } else if (founderData.totalShares) {
              founderShares = parseInt(founderData.totalShares) || 0;
            }
          } catch (e) {}
        }

        // Fallback: if no founder shares parsed, use round0 total shares
        if (founderShares === 0) {
          founderShares = round0TotalShares;
        }
      }

      // 2. Get Seed Convertible Note details
      if (seedConvertibleRound) {
        seedInvestment = parseFloat(seedConvertibleRound.roundsize) || 0;
        seedOptionPoolPercent =
          parseFloat(seedConvertibleRound.optionPoolPercent) || 0;

        // Parse Convertible Note details
        if (seedConvertibleRound.instrument_type_data) {
          try {
            const instrumentData =
              typeof seedConvertibleRound.instrument_type_data === "string"
                ? JSON.parse(seedConvertibleRound.instrument_type_data)
                : seedConvertibleRound.instrument_type_data;

            // Look for convertible note specific fields
            valuationCap =
              parseFloat(instrumentData.valuationCap) ||
              parseFloat(instrumentData.valuationCap_note) ||
              parseFloat(instrumentData.cap) ||
              0;

            discountRate =
              parseFloat(instrumentData.discountRate) ||
              parseFloat(instrumentData.discountRate_note) ||
              parseFloat(instrumentData.discount) ||
              0;

            interestRate =
              parseFloat(instrumentData.interestRate_note) ||
              parseFloat(instrumentData.interestRate) ||
              parseFloat(instrumentData.interest) ||
              0;
          } catch (e) {}
        }
      }

      // 3. CRITICAL: Calculate total shares including Seed option pool
      // This is the key difference from your example
      // Total Shares = Founder Shares ÷ (1 - Seed Option Pool %)
      if (seedOptionPoolPercent > 0 && founderShares > 0) {
        totalShares = Math.round(
          founderShares / (1 - seedOptionPoolPercent / 100),
        );
        employeeSharesFromSeed = totalShares - founderShares;
      } else {
        // If no seed option pool, total shares = founder shares
        totalShares = founderShares;
        employeeSharesFromSeed = 0;
      }

      // 4. Calculate Convertible Note conversion WITH STATIC 2 YEARS
      let principalPlusInterest = seedInvestment;
      if (interestRate > 0) {
        // 🔥 STATIC: Always use 2 years
        principalPlusInterest =
          seedInvestment * Math.pow(1 + interestRate / 100, years);
      }

      // Prepare response data
      const responseData = {
        // Core data from previous rounds
        totalShares: totalShares, // Should be 111,111
        founderShares: founderShares, // Should be 100,000
        employeeSharesFromSeed: employeeSharesFromSeed, // Should be 11,111
        seedInvestment: seedInvestment,
        principalPlusInterest: parseFloat(principalPlusInterest.toFixed(2)),
        valuationCap: valuationCap,
        discountRate: discountRate,
        interestRate: interestRate,
        seedOptionPoolPercent: seedOptionPoolPercent,
        yearsBetweenRounds: years, // 🔥 STATIC 2 years
        instrumentType: seedConvertibleRound?.instrumentType || "",
        roundName: seedConvertibleRound?.nameOfRound || "",

        // 🔥 Add this important note about static years
        note: "Using static 2 years between rounds for interest calculation",
      };

      res.status(200).json({
        success: true,
        previousRoundData: responseData,
        message:
          "Previous round data for Convertible Note conversion fetched successfully",
      });
    },
  );
};

// ============================================

// ============================================
// getPreviousRoundForAutoFill - FULLY CORRECTED
// DOC 5&6 KE ACCORDING - EXACT FORMULA
// ============================================
// ============================================
// getPreviousRoundForAutoFill - FINAL CORRECTED
// ============================================
// ============================================
// getPreviousRoundForAutoFill - AUTOFILL ALWAYS ON
// ============================================
exports.getPreviousRoundForAutoFill = (req, res) => {
  const { company_id, current_round_id } = req.body; // ✅ removed current_instrument_type

  // ============================================
  // STEP 1: GET PREVIOUS CLOSED ROUND
  // ============================================
  const getPreviousRoundQuery = `
    SELECT 
      id,
      nameOfRound,
      instrumentType,
      optionPoolPercent,
      optionPoolPercent_post,
      option_pool_shares,
      total_shares_after
    FROM roundrecord 
    WHERE company_id = ? 
      AND round_type = 'Investment'
      ${current_round_id ? "AND id < ?" : ""}
    ORDER BY id DESC 
    LIMIT 1
  `;

  const params = current_round_id
    ? [company_id, current_round_id]
    : [company_id];

  db.query(getPreviousRoundQuery, params, (err, results) => {
    if (err) {
      console.error("❌ Database error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }

    // ============================================
    // CASE 1: NO PREVIOUS ROUND
    // ============================================
    if (results.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          is_first_round: true,
          existingOptionPoolPercent: 0,
          existingOptionPoolPercentDiluted: 0,
          existingShares: 0,
          previousPostMoneyPool: 0,
          previousPreMoneyPool: 0,
          previousRoundName: null,
          previousRoundId: null,
          totalSharesAfterPrevious: 0,
          // ✅ AUTOFILL - first round mein 0% (koi previous pool nahi)
          can_autofill: true,
          note: "First investment round - no previous option pool",
        },
      });
    }

    // ============================================
    // CASE 2: PREVIOUS ROUND FOUND
    // ============================================
    const previousRound = results[0];
    const totalShares = parseFloat(previousRound.total_shares_after) || 0;
    const previousInstrumentType = previousRound.instrumentType;
    const previousOptionShares =
      parseFloat(previousRound.option_pool_shares) || 0;

    // ============================================
    // STEP 2: GET CUMULATIVE OPTION POOL
    // ============================================
    const getCumulativePoolQuery = `
      SELECT 
        SUM(option_pool_shares) as cumulative_pool,
        COUNT(*) as round_count
      FROM roundrecord 
      WHERE company_id = ? 
        ${current_round_id ? "AND id < ?" : ""}
    `;

    const poolParams = current_round_id
      ? [company_id, current_round_id]
      : [company_id];

    db.query(getCumulativePoolQuery, poolParams, (poolErr, poolResults) => {
      if (poolErr) {
        console.error("❌ Error fetching cumulative pool:", poolErr);
        return res.status(500).json({ success: false, error: poolErr.message });
      }

      // ✅ GET CUMULATIVE OPTION POOL SHARES
      const cumulativeOptionPoolShares =
        parseFloat(poolResults[0]?.cumulative_pool) || 0;

      // ✅ CALCULATE POST-MONEY POOL %
      const dbPreMoneyPool = parseFloat(previousRound.optionPoolPercent) || 0;
      const dbPostMoneyPool =
        parseFloat(previousRound.optionPoolPercent_post) || 0;

      let previousPostMoneyPool = dbPostMoneyPool;
      let calculationMethod = "Database";

      if (
        dbPostMoneyPool === 0 &&
        cumulativeOptionPoolShares > 0 &&
        totalShares > 0
      ) {
        previousPostMoneyPool =
          (cumulativeOptionPoolShares / totalShares) * 100;
        calculationMethod = "Calculated from cumulative shares";
      } else if (dbPostMoneyPool === 0 && dbPreMoneyPool > 0) {
        previousPostMoneyPool = dbPreMoneyPool;
        calculationMethod = "Using pre-money pool as fallback";
      }

      const previousPreMoneyPool = dbPreMoneyPool;

      // ✅ CALCULATE EMPLOYEE OWNERSHIP %
      let employeeOwnershipPercent = 0;
      if (totalShares > 0 && cumulativeOptionPoolShares > 0) {
        employeeOwnershipPercent =
          (cumulativeOptionPoolShares / totalShares) * 100;
      }

      // ============================================
      // ✅ AUTOFILL - ALWAYS TRUE
      // ============================================
      const canAutofill = true; // ✅ ALWAYS TRUE - CONDITION REMOVED

      // ✅ PRE-MONEY POOL = PREVIOUS ROUND POST-MONEY POOL
      const existingOptionPoolPercent =
        previousPostMoneyPool > 0
          ? parseFloat(previousPostMoneyPool.toFixed(2))
          : 0;

      // ============================================
      // PREPARE RESPONSE
      // ============================================
      const responseData = {
        // 🎯 PRE-MONEY POOL for AUTOFILL (ALWAYS)
        existingOptionPoolPercent: existingOptionPoolPercent,

        // 🎯 EMPLOYEE OWNERSHIP % for DISPLAY
        existingOptionPoolPercentDiluted: parseFloat(
          employeeOwnershipPercent.toFixed(2),
        ),

        // 🎯 CUMULATIVE OPTION POOL SHARES
        existingShares: Math.round(cumulativeOptionPoolShares),

        // 🎯 PREVIOUS ROUND DETAILS
        previousPostMoneyPool: parseFloat(previousPostMoneyPool.toFixed(2)),
        previousPreMoneyPool: parseFloat(previousPreMoneyPool.toFixed(2)),
        previousRoundName: previousRound.nameOfRound,
        previousRoundId: previousRound.id,
        previousInstrumentType: previousInstrumentType,
        totalSharesAfterPrevious: Math.round(totalShares),
        previousOptionPoolShares: previousOptionShares,

        // 🎯 AUTOFILL FLAG - ALWAYS TRUE
        can_autofill: true,

        // ✅ REMOVED - is_priced_round, is_unpriced_round
        // is_priced_round: false,
        // is_unpriced_round: false,

        employee_ownership_percent: parseFloat(
          employeeOwnershipPercent.toFixed(2),
        ),

        is_new_round: !current_round_id,
        is_edit_mode: !!current_round_id,

        // 🎯 METADATA
        calculation_method: calculationMethod,
        cumulative_rounds: poolResults[0]?.round_count || 0,
        cumulative_pool_shares: cumulativeOptionPoolShares,

        note:
          existingOptionPoolPercent > 0
            ? `Previous round (${previousRound.nameOfRound}) had ${previousPostMoneyPool.toFixed(2)}% post-money pool. AUTOFILLING ${existingOptionPoolPercent}% for pre-money pool.`
            : `Previous round had 0% post-money pool. AUTOFILLING 0% for pre-money pool.`,
      };

      return res.status(200).json({
        success: true,
        data: responseData,
      });
    });
  });
};

// Then in your getPreviousRoundForAutoFill:

exports.getIndustryExpertise = (req, res) => {
  db.query(
    `SELECT *
    FROM industry_expertise
    ORDER BY name ASC`,
    (err, results) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Database error",
          error: err.message,
        });
      }

      res.status(200).json({
        results: results,
      });
    },
  );
};
// Add this to your backend controller
exports.addIndustryExpertise = (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({
      success: false,
      message: "Industry name is required",
    });
  }

  // Generate value from name
  const value = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  db.query(
    `INSERT INTO industry_expertise (name, value) 
     VALUES (?, ?)`,
    [name, value],
    (err, results) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Database error",
          error: err.message,
        });
      }

      res.status(201).json({
        success: true,
        message: "Industry expertise added successfully",
        data: {
          id: results.insertId,
          name: name,
          value: value,
        },
      });
    },
  );
};

exports.createWarrant = (req, res) => {
  const {
    roundrecord_id,
    company_id,
    investor_id,
    warrant_coverage_percentage,
    warrant_status,
    issued_date,
    expiration_date,
    notes,
    warrantType,
    warrant_fixed_shares,
    share_class_type,
    instrument_type,
    round_name,
  } = req.body;
  const sql = `
    INSERT INTO warrants (
      warrantType,
      warrant_fixed_shares,
      roundrecord_id,
      company_id,
      investor_id,
      warrant_coverage_percentage,
      warrant_status,
      issued_date,
      expiration_date,
      notes,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?,  ?, ?, ?, ?, NOW(), NOW())
  `;

  const values = [
    warrantType,
    warrant_fixed_shares,
    roundrecord_id,
    company_id,
    investor_id || 0,
    warrant_coverage_percentage || 0,
    warrant_status || "pending",
    issued_date || new Date(),
    expiration_date || null,
    notes || null,
  ];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("Error creating warrant:", err);
      return res.status(500).json({
        success: false,
        message: "Error creating warrant",
        error: err,
      });
    }

    const warrantId = result.insertId;

    return res.status(200).json({
      success: true,
      message: "Warrant created successfully with round investor record",
      warrantId: "",
      roundInvestorId: "",
    });
  });
};
const createWarrantDataInternal = (warrantData) => {
  return new Promise((resolve, reject) => {
    const {
      roundrecord_id,
      company_id,
      investor_id,
      warrant_coverage_percentage,
      warrant_status,
      issued_date,
      expiration_date,
      notes,
      warrantType,
      warrant_fixed_shares,
      warrant_coverage_percentage_main,
    } = warrantData;

    // Function to format date to YYYY-MM-DD for MySQL
    const formatDateForMySQL = (dateStr) => {
      if (!dateStr) return null;

      // If already in YYYY-MM-DD format
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
      }

      // If in DD/Month/YYYY format (e.g., 03/April/2026)
      if (/^\d{2}\/[A-Za-z]+\/\d{4}$/.test(dateStr)) {
        const [day, monthName, year] = dateStr.split("/");
        const monthMap = {
          January: "01",
          February: "02",
          March: "03",
          April: "04",
          May: "05",
          June: "06",
          July: "07",
          August: "08",
          September: "09",
          October: "10",
          November: "11",
          December: "12",
        };
        const month = monthMap[monthName];
        if (month) {
          return `${year}-${month}-${day}`;
        }
      }

      // If in DD-Month-YYYY format (e.g., 03-April-2026)
      if (/^\d{2}-[A-Za-z]+-\d{4}$/.test(dateStr)) {
        const [day, monthName, year] = dateStr.split("-");
        const monthMap = {
          January: "01",
          February: "02",
          March: "03",
          April: "04",
          May: "05",
          June: "06",
          July: "07",
          August: "08",
          September: "09",
          October: "10",
          November: "11",
          December: "12",
        };
        const month = monthMap[monthName];
        if (month) {
          return `${year}-${month}-${day}`;
        }
      }

      // If in MM/DD/YYYY format
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
        const [month, day, year] = dateStr.split("/");
        return `${year}-${month}-${day}`;
      }

      return null;
    };

    // Format dates
    const formattedIssuedDate = formatDateForMySQL(issued_date);
    const formattedExpirationDate = formatDateForMySQL(expiration_date);

    const sql = `
      INSERT INTO warrants (
        warrant_coverage_percentage_main,
        warrantType,
        warrant_fixed_shares,
        roundrecord_id,
        company_id,
        investor_id,
        warrant_coverage_percentage,
        warrant_status,
        issued_date,
        expiration_date,
        notes,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;

    const values = [
      warrant_coverage_percentage_main || null,
      warrantType || null,
      warrant_fixed_shares || null,
      roundrecord_id,
      company_id,
      investor_id || 0,
      warrant_coverage_percentage || 0,
      warrant_status || "pending",
      formattedIssuedDate,
      formattedExpirationDate,
      notes || null,
    ];

    db.query(sql, values, (err, result) => {
      if (err) {
        console.error("Error creating warrant:", err);
        reject(err);
      } else {
        resolve({
          success: true,
          message: "Warrant created successfully",
          warrantId: result.insertId,
          affectedRows: result.affectedRows,
        });
      }
    });
  });
};

exports.getPreviousFundingRound = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    return res.status(400).json({
      success: false,
      message: "Company ID is required",
    });
  }

  db.query(
    `SELECT * 
     FROM roundrecord 
     WHERE company_id = ? AND round_type != 'Round 0'
     ORDER BY created_at ASC`,
    [company_id],
    (err, results) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Database error",
          error: err.message,
        });
      }

      // STEP 1: Check karo results empty hai ya nahi
      if (!results || results.length === 0) {
        const allRounds = [
          "Pre-Seed",
          "Seed",
          "Post-Seed",
          "Series A",

          "Series B",

          "Series C",

          "Series D",

          "Bridge Round",
          "Advisor Shares",
          "OTHER",
        ];

        return res.status(200).json({
          success: true,
          results: [],
          allowedRounds: allRounds,
          message: "First funding round - All options available",
          isFirstRound: true,
        });
      }

      // STEP 2: Agar results hai, tabhi condition check karo

      const allowedRounds = calculateNextAllowedRounds(results);

      res.status(200).json({
        success: true,
        results: results,
        allowedRounds: allowedRounds,
        message: `${results.length} previous rounds found`,
        isFirstRound: false,
      });
    },
  );
};

// Condition check sirf jab table empty nahi ho
function calculateNextAllowedRounds(previousRounds) {
  // All possible rounds in SEQUENTIAL ORDER
  const roundSequence = [
    "Pre-Seed",
    "Seed",
    "Post-Seed",
    "Series A",
    "Series A Extension",
    "Series B",
    "Series B Extension",
    "Series C",
    "Series C Extension",
    "Series D",
    "Series D Extension",
    "Bridge Round",
    "Advisor Shares",
    "OTHER",
  ];

  // Step 1: Find highest completed round (including extensions)
  let highestIndex = -1;
  previousRounds.forEach((round) => {
    const type = round.shareClassType;
    const index = roundSequence.indexOf(type);
    if (index > highestIndex) highestIndex = index;
  });

  // Step 2: Check what's the highest MAIN series round
  let highestSeriesIndex = -1;
  previousRounds.forEach((round) => {
    const type = round.shareClassType;
    if (type.includes("Series") && !type.includes("Extension")) {
      const index = roundSequence.indexOf(type);
      if (index > highestSeriesIndex) highestSeriesIndex = index;
    }
  });

  // Step 3: Check what company started with
  let startedWithPreSeed = false;
  let startedWithSeed = false;
  let startedWithPostSeed = false;
  let startedWithSeries = false;
  let startedWithExtension = false;

  if (previousRounds.length > 0) {
    // Find the FIRST Seed/Series round
    const firstRound = previousRounds[0];
    const firstType = firstRound.shareClassType;

    if (firstType === "Pre-Seed") startedWithPreSeed = true;
    else if (firstType === "Seed") startedWithSeed = true;
    else if (firstType === "Post-Seed") startedWithPostSeed = true;
    else if (firstType.includes("Extension")) startedWithExtension = true;
    else if (firstType.includes("Series")) startedWithSeries = true;
  }

  // Step 4: Determine allowed rounds
  const allowedRounds = [];

  // Check each round in sequence
  roundSequence.forEach((round, index) => {
    let shouldAllow = false;

    // CASE 1: Round is higher than highest completed
    if (index > highestIndex) {
      // For extensions, check if main round exists
      if (round.includes("Extension")) {
        const mainRound = round.replace(" Extension", "");
        const hasMainRound = previousRounds.some(
          (r) => r.shareClassType === mainRound,
        );
        const hasExtension = previousRounds.some(
          (r) => r.shareClassType === round,
        );

        // Extension allowed only if:
        // 1. Main round exists
        // 2. Extension not already done
        if (hasMainRound && !hasExtension) {
          shouldAllow = true;
        }
      } else {
        // For main rounds, always allow if higher
        shouldAllow = true;
      }
    }

    // CASE 2: Bridge, Advisor, OTHER (special cases)
    if (["Bridge Round", "Advisor Shares", "OTHER"].includes(round)) {
      // These are always allowed UNLESS company started with Series D Extension
      if (roundSequence[highestIndex] !== "Series D Extension") {
        shouldAllow = true;
      }
    }

    // Apply starting restrictions
    if (shouldAllow) {
      // If started with Series D Extension, block EVERYTHING except maybe Bridge/Advisor/OTHER
      if (
        startedWithExtension &&
        roundSequence[highestIndex] === "Series D Extension"
      ) {
        if (!["Bridge Round", "Advisor Shares", "OTHER"].includes(round)) {
          shouldAllow = false;
        }
      }
      // If started with Series, block all Seed rounds
      else if (
        startedWithSeries &&
        ["Pre-Seed", "Seed", "Post-Seed"].includes(round)
      ) {
        shouldAllow = false;
      }
      // If started with Post-Seed, block Pre-Seed and Seed
      else if (startedWithPostSeed && ["Pre-Seed", "Seed"].includes(round)) {
        shouldAllow = false;
      }
      // If started with Seed, block Pre-Seed
      else if (startedWithSeed && round === "Pre-Seed") {
        shouldAllow = false;
      }
    }

    if (shouldAllow) {
      allowedRounds.push(round);
    }
  });

  return allowedRounds;
}

exports.getCompanyWarrant = (req, res) => {
  const { company_id, round_id } = req.body;

  const query = `
    SELECT 
      w.*,
      CASE 
        WHEN iw.id IS NOT NULL THEN 'exercised'
        ELSE w.warrant_status
      END as actual_status,
      iw.id as investors_warrants_id,
      iw.shares as exercised_shares,
      iw.created_at as exercised_date,
      iw.exercised_in_round_id,
      iw.round_investor_id,
      iw.investor_id as exercising_investor_id,
      iw.created_at as exercise_created_at
    FROM warrants w
    LEFT JOIN investors_warrants iw 
      ON iw.warrant_id = w.id 
      AND iw.company_id = w.company_id
    WHERE w.roundrecord_id = ? 
      AND w.company_id = ?
    ORDER BY w.id DESC
  `;

  db.query(query, [round_id, company_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Database query error",
        error: err,
      });
    }

    // Process results to add helpful flags
    const processedResults = results.map((warrant) => ({
      ...warrant,
      is_exercised: warrant.actual_status === "exercised",
      exercise_round_id: warrant.exercised_in_round_id,
      // If exercised, show exercise details
      exercise_details: warrant.is_exercised
        ? {
            shares: warrant.exercised_shares,
            date: warrant.exercised_date,
            round_id: warrant.exercised_in_round_id,
            investor_id: warrant.exercising_investor_id,
          }
        : null,
    }));

    res.status(200).json({
      success: true,
      message: "Warrants fetched successfully",
      results: processedResults,
    });
  });
};
exports.roundManagementAcklnowlegment = (req, res) => {
  const { company_id } = req.body; // action_type: 'create', 'edit', 'close'

  let status_create = "Yes";
  let status_edit = "Yes";
  let status_closed = "Yes";

  // Insert into round_acknowlegment table
  const insertQuery = `
    INSERT INTO round_acknowlegment (company_id, status_create, status_edit, status_closed, created_at) 
    VALUES (?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
    status_create =  'Yes',
    status_edit = 'Yes',
    status_closed = 'Yes',
    created_at = NOW()
  `;

  db.query(
    insertQuery,
    [company_id, status_create, status_edit, status_closed],
    (err, result) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Database error",
          error: err,
        });
      }

      res.status(200).json({
        success: true,
        message: `Round acknowledgment saved successfully`,
        results: {
          affectedRows: result.affectedRows,
          insertId: result.insertId,
        },
      });
    },
  );
};
exports.getroundManagementAcklnowlegment = (req, res) => {
  const { company_id } = req.body;

  // First check if Round 0 exists
  const checkRoundZeroQuery = `SELECT id FROM roundrecord WHERE company_id = ? AND round_type = 'Round 0' LIMIT 1`;

  db.query(checkRoundZeroQuery, [company_id], (err, roundZeroResult) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Database query error",
        error: err,
      });
    }

    // If Round 0 exists
    if (roundZeroResult.length > 0) {
      // Get acknowledgement records
      const query = `SELECT * FROM round_acknowlegment WHERE company_id = ?`;

      db.query(query, [company_id], (err, results) => {
        if (err) {
          return res.status(500).json({
            success: false,
            message: "Database query error",
            error: err,
          });
        }

        res.status(200).json({
          success: true,
          message: "",
          results: results, // Return array (empty if no records)
        });
      });
    } else {
      // No Round 0 exists - return test data or empty array
      var ackResults = [{ email: "test@gmail.com" }];
      res.status(200).json({
        success: true,
        message: "",
        results: ackResults || [],
      });
    }
  });
};
