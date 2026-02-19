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
    } = req.body;

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
            total_founder_shares=?, founder_count=?`;

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
            founder_data || null,
            total_founder_shares || null,
            founder_count || null,
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

            // ⚠️ DECLARE CASCADE VARIABLES OUTSIDE TRY-CATCH
            let subsequentRounds = [];
            let cascadeSuccess = true;
            let cascadeError = null;

            // ⚠️ CRITICAL: CASCADE RECALCULATION

            try {
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
                },
                true,
              );

              // Step 2: Cascade recalculate all subsequent rounds
              const cascadeResult = await recalculateCascade(company_id, id);

              cascadeSuccess = cascadeResult.success;
              cascadeError =
                cascadeResult.errors.length > 0
                  ? cascadeResult.errors.map((e) => e.error).join(", ")
                  : null;
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
        "No", // 35
        new Date(), // 36
        JSON.stringify(founder_data) || null, // 37
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
            },
            false,
          ); // isUpdate = false for CREATE
        } catch (calcError) {
          console.error(`❌ Error calculating new round ${newId}:`, calcError);
        }

        // ✅ CRITICAL: Check if this is a Preferred Equity round
        // If yes, then exercise ALL pending warrants from previous rounds
        if (instrumentType === "Preferred Equity") {
          const pendingWarrantsQuery = `
            SELECT * FROM warrants 
            WHERE company_id = ? 
            AND warrant_status = 'pending'
            AND roundrecord_id < ?
            ORDER BY issued_date ASC
          `;

          db.query(
            pendingWarrantsQuery,
            [company_id, newId],
            async (err, pendingWarrants) => {
              if (err) {
                console.error("Error fetching pending warrants:", err);
              } else if (pendingWarrants.length > 0) {
                for (const warrant of pendingWarrants) {
                  try {
                    await db.promise().query(
                      `UPDATE warrants 
                      SET warrant_status = 'exercised', 
                          exercised_date = NOW(), 
                          exercised_in_round_id = ?, 
                          updated_at = NOW()
                      WHERE id = ?`,
                      [newId, warrant.id],
                    );

                    const originalRoundQuery = `SELECT instrument_type_data FROM roundrecord WHERE id = ?`;

                    db.query(
                      originalRoundQuery,
                      [warrant.roundrecord_id],
                      async (err, originalRoundResult) => {
                        if (!err && originalRoundResult.length > 0) {
                          try {
                            let originalInstrumentData = {};
                            if (originalRoundResult[0].instrument_type_data) {
                              originalInstrumentData =
                                typeof originalRoundResult[0]
                                  .instrument_type_data === "string"
                                  ? JSON.parse(
                                      originalRoundResult[0]
                                        .instrument_type_data,
                                    )
                                  : originalRoundResult[0].instrument_type_data;
                            }

                            if (
                              !originalInstrumentData.warrant_exercise_history
                            ) {
                              originalInstrumentData.warrant_exercise_history =
                                [];
                            }

                            originalInstrumentData.warrant_exercise_history.push(
                              {
                                exercised_in_round_id: newId,
                                exercised_date: new Date().toISOString(),
                                warrant_id: warrant.id,
                              },
                            );

                            await db
                              .promise()
                              .query(
                                `UPDATE roundrecord SET instrument_type_data = ? WHERE id = ?`,
                                [
                                  JSON.stringify(originalInstrumentData),
                                  warrant.roundrecord_id,
                                ],
                              );
                          } catch (parseErr) {
                            console.error(
                              `Error updating original round ${warrant.roundrecord_id}:`,
                              parseErr,
                            );
                          }
                        }
                      },
                    );
                  } catch (updateErr) {
                    console.error(
                      `Error exercising warrant ${warrant.id}:`,
                      updateErr,
                    );
                  }
                }

                try {
                  const currentRoundQuery = `SELECT instrument_type_data FROM roundrecord WHERE id = ?`;
                  db.query(
                    currentRoundQuery,
                    [newId],
                    async (err, currentRoundResult) => {
                      if (!err && currentRoundResult.length > 0) {
                        let currentInstrumentData = {};
                        if (currentRoundResult[0].instrument_type_data) {
                          currentInstrumentData =
                            typeof currentRoundResult[0]
                              .instrument_type_data === "string"
                              ? JSON.parse(
                                  currentRoundResult[0].instrument_type_data,
                                )
                              : currentRoundResult[0].instrument_type_data;
                        }

                        currentInstrumentData.exercised_warrants_in_this_round =
                          pendingWarrants.map((w) => ({
                            warrant_id: w.id,
                            original_round_id: w.roundrecord_id,
                            coverage_percentage: w.warrant_coverage_percentage,
                            exercise_type: w.warrant_exercise_type,
                          }));

                        await db
                          .promise()
                          .query(
                            `UPDATE roundrecord SET instrument_type_data = ? WHERE id = ?`,
                            [JSON.stringify(currentInstrumentData), newId],
                          );
                      }
                    },
                  );
                } catch (currentRoundErr) {
                  console.error(
                    "Error updating current round with exercised warrants:",
                    currentRoundErr,
                  );
                }
              }
            },
          );
        }

        // ✅ Create warrant record in warrants table if this round has warrants
        if (parsedInstrumentData.hasWarrants_preferred) {
          const warrantSql = `
            INSERT INTO warrants (
              roundrecord_id, company_id, investor_id, warrant_coverage_percentage,
              warrant_exercise_type, warrant_adjustment_percent, warrant_adjustment_direction,
              expiration_date, notes, warrant_status, issued_date, created_at, updated_at
            ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW(), NOW())
          `;

          const warrantValues = [
            newId,
            company_id,
            parsedInstrumentData.warrant_coverage_percentage || 0,
            parsedInstrumentData.warrant_exercise_type || "next_round_adjusted",
            parsedInstrumentData.warrant_adjustment_percent || 0,
            parsedInstrumentData.warrant_adjustment_direction || "decrease",
            parsedInstrumentData.expirationDate_preferred || null,
            parsedInstrumentData.warrant_notes || "",
          ];

          db.query(warrantSql, warrantValues, (warrantErr, warrantResult) => {
            if (warrantErr) {
              console.error("Warrant creation error:", warrantErr);
            } else {
            }
          });
        }

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
          });
        } else if (instrumentType === "Preferred Equity") {
          handlePreferredEquityCalculation({
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
          });
        } else if (instrumentType === "Safe") {
          handleSafeCalculation({
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
      SELECT founder_data, total_founder_shares, founder_count 
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
    round_investments, // ✅ IMPORTANT: Ye parameter add karo
    id,
    company_id,
    preMoney,
    roundSize,
    optionPoolPercentValue,
    total_shares_before,
    round0_shares,
    isUpdate: isUpdateFromParams = false,
    optionPoolPercent_post,
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

  try {
    const round0Data = await getFounderDataFromRound0(company_id);

    if (round0Data && round0Data.founder_data) {
      founderData = round0Data.founder_data;
      totalFounderShares = round0Data.total_founder_shares || 0;

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
        }));
      }
    }
  } catch (error) {
    console.error("❌ Error fetching founder data:", error);
  }

  // ==================== GET PREVIOUS ROUNDS ====================
  const previousRounds = await getPreviousRoundsForCompany(company_id, id);

  // ==================== DETECT PREVIOUS ROUND TYPE ====================
  const sortedPreviousRounds = [...previousRounds].sort((a, b) => b.id - a.id);
  const latestPreviousRound = sortedPreviousRounds[0];

  const hasInvestmentRoundBefore = previousRounds.some(
    (round) =>
      round.instrumentType === "Preferred Equity" ||
      round.instrumentType === "Common Stock",
  );
  const isPreviousRoundRound0 = latestPreviousRound?.round_type === "Round 0";

  // ==================== GET DATA FROM LATEST PREVIOUS ROUND ====================
  let existingOptionPoolShares = 0;
  let totalInvestorShares = 0;
  let totalPreMoneyShares = round0Shares;
  let previousInvestorsTotal = 0;

  if (latestPreviousRound) {
    const round = latestPreviousRound;

    // Get total option pool from previous round
    existingOptionPoolShares =
      parseInt(round.total_option_pool) ||
      parseInt(round.option_pool_shares) ||
      0;

    // Pre-money shares = latest round ka total_shares_after
    totalPreMoneyShares = parseInt(round.total_shares_after) || round0Shares;

    // Get investor total from post-money table
    if (round.post_money_cap_table) {
      try {
        const postTable =
          typeof round.post_money_cap_table === "string"
            ? JSON.parse(round.post_money_cap_table)
            : round.post_money_cap_table;

        // Get all investors
        if (postTable.previous_investors) {
          totalInvestorShares += postTable.previous_investors.shares || 0;
        }
        if (postTable.investors) {
          totalInvestorShares += postTable.investors.shares || 0;
        }
        if (postTable.converted_investors) {
          totalInvestorShares += postTable.converted_investors.shares || 0;
        }

        // Get previous investors total for database
        if (postTable.previous_investors_total) {
          previousInvestorsTotal =
            parseInt(postTable.previous_investors_total) || 0;
        }
      } catch (e) {
        console.error("Error parsing post_money_cap_table:", e);
      }
    }

    // Fallback calculation
    if (totalInvestorShares === 0) {
      const issuedShares = parseInt(round.issuedshares) || 0;
      const optionShares = parseInt(round.option_pool_shares) || 0;
      totalInvestorShares = issuedShares - optionShares;
    }
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

  // ==================== CONVERT ONLY CONVERTIBLE NOTES ====================
  let totalConvertedShares = 0;
  let totalConvertedInvestment = 0;
  let conversionDetails = [];
  let yearsBetween = 2;

  for (const round of previousRounds) {
    if (round.instrumentType !== "Convertible Note") continue;
    if (alreadyConvertedIds.includes(parseInt(round.id))) continue;

    const instrumentData = parseInstrumentData(round.instrument_type_data);
    const investment = parseFloat(round.roundsize) || 0;

    if (investment > 0) {
      const interestRate = parseFloat(instrumentData.interestRate_note) || 0;
      const discountRate = parseFloat(instrumentData.discountRate_note) || 0;
      const valuationCap = parseFloat(instrumentData.valuationCap_note) || 0;

      const principalPlusInterest =
        investment * Math.pow(1 + interestRate / 100, yearsBetween);
      const discountedPrice = sharePrice * (1 - discountRate / 100);
      const capPrice =
        valuationCap > 0 ? valuationCap / totalPreMoneyShares : Infinity;
      const conversionPrice = Math.min(discountedPrice, capPrice);
      const convertedShares = Math.round(
        principalPlusInterest / conversionPrice,
      );

      if (convertedShares > 0) {
        totalConvertedShares += convertedShares;
        totalConvertedInvestment += investment;

        conversionDetails.push({
          original_round_id: round.id,
          instrument_type: "Convertible Note",
          investment: investment,
          conversion_price: conversionPrice,
          convertedShares: convertedShares,
          investor_name: round.nameOfRound || "Convertible Note Investor",
          principal_plus_interest: principalPlusInterest,
          discount_rate: discountRate,
          valuation_cap: valuationCap,
          interest_rate: interestRate,
        });
      }
    }
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

  let optionPoolShares,
    preMoneyTotalSharesCalc,
    totalPostShares,
    newInvestorShares,
    updatedSharePrice;
  let newOptionShares = 0;
  let seriesAInvestorShares = 0;
  let total_shares_befores = 0;
  const postMoneyValuation = preMoneyVal + roundSizeVal;

  if (hasInvestmentRoundBefore) {
    console.log("kkk1 - Series A/B Round");

    preMoneyTotalSharesCalc = totalPreMoneyShares;

    // Total existing shares (founders + previous investors) - WITHOUT option pool
    const totalExistingShares = round0Shares + totalInvestorShares;

    // Investor ownership
    const investorOwnership = roundSizeVal / postMoneyValuation;

    // Target option pool percentage (post-money)
    const targetOptionPercent = postMoneyPoolTarget / 100;

    // Combined ownership of existing shareholders after this round
    const existingOwnershipAfter = 1 - investorOwnership - targetOptionPercent;

    // Total post-money shares
    totalPostShares = Math.round(totalExistingShares / existingOwnershipAfter);

    // Total new shares in this round
    const totalNewSharesThisRound = totalPostShares - preMoneyTotalSharesCalc;

    // New option pool shares
    const targetTotalOptionShares = Math.round(
      totalPostShares * targetOptionPercent,
    );
    newOptionShares = Math.max(
      0,
      targetTotalOptionShares - existingOptionPoolShares,
    );

    // New investor shares
    seriesAInvestorShares = totalNewSharesThisRound - newOptionShares;
    newInvestorShares = seriesAInvestorShares;

    // Share price (PRE-MONEY valuation basis)
    updatedSharePrice =
      preMoneyVal / (preMoneyTotalSharesCalc + newOptionShares);

    // Calculate totals
    previous_investors_total =
      (previousInvestorsTotal || totalInvestorShares) + newInvestorShares;
    total_option_pool = existingOptionPoolShares + newOptionShares;
    total_shares_befores = preMoneyTotalSharesCalc;
  } else if (isPreviousRoundRound0) {
    // ✅ CASE 2: Seed Round - First Investment
    console.log("kkk2 - Seed Round");
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

    // Seed round totals
    previous_investors_total = newInvestorShares;
    total_option_pool = optionPoolShares;
    total_shares_befores = preMoneyTotalSharesCalc;
  } else {
    // ✅ CASE 3: Default/Fallback
    console.log("k3 - Default");
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

  // ==================== PREPARE INVESTORS LIST WITH SHARES ====================
  const investorsWithShares = investorsList.map((inv, index) => {
    const amount = parseFloat(inv.amount) || 0;
    const shares = Math.round(amount / updatedSharePrice);
    return {
      ...inv,
      shares: shares,
      share_price: updatedSharePrice,
      type: "investor",
      is_new_investment: true,
    };
  });

  // ==================== PREPARE PRE-MONEY CAP TABLE ====================
  const preMoneyCapTable = {
    total_shares: preMoneyTotalSharesCalc,
    founders: {
      list: founderList.map((f) => ({
        ...f,
        shares: f.shares,
        percentage:
          ((f.shares / preMoneyTotalSharesCalc) * 100).toFixed(2) + "%",
        value: ((f.shares / preMoneyTotalSharesCalc) * preMoneyVal).toFixed(2),
      })),
      total_shares: round0Shares,
      total_percentage:
        ((round0Shares / preMoneyTotalSharesCalc) * 100).toFixed(2) + "%",
      total_value: (
        (round0Shares / preMoneyTotalSharesCalc) *
        preMoneyVal
      ).toFixed(2),
    },
    option_pool: {
      shares: existingOptionPoolShares + (optionPoolShares || 0),
      percentage:
        (
          ((existingOptionPoolShares + (optionPoolShares || 0)) /
            preMoneyTotalSharesCalc) *
          100
        ).toFixed(2) + "%",
      value: (
        ((existingOptionPoolShares + (optionPoolShares || 0)) /
          preMoneyTotalSharesCalc) *
        preMoneyVal
      ).toFixed(2),
    },
    previous_investors:
      totalInvestorShares > 0
        ? {
            shares: totalInvestorShares,
            percentage:
              ((totalInvestorShares / preMoneyTotalSharesCalc) * 100).toFixed(
                2,
              ) + "%",
            value: (
              (totalInvestorShares / preMoneyTotalSharesCalc) *
              preMoneyVal
            ).toFixed(2),
          }
        : null,
    converted:
      totalConvertedShares > 0
        ? {
            name: "Convertible Note Investors",
            shares: totalConvertedShares,
            percentage:
              ((totalConvertedShares / preMoneyTotalSharesCalc) * 100).toFixed(
                2,
              ) + "%",
            value: (
              (totalConvertedShares / preMoneyTotalSharesCalc) *
              preMoneyVal
            ).toFixed(2),
          }
        : null,
    pre_money_valuation: preMoneyVal,
    share_price: (preMoneyVal / preMoneyTotalSharesCalc).toFixed(4),
  };

  // ==================== PREPARE POST-MONEY CAP TABLE WITH ITEMS ====================
  const postMoneyCapTable = {
    total_shares: totalPostShares,
    founders: {
      list: founderList.map((f) => ({
        ...f,
        shares: f.shares,
        new_shares: 0,
        total: f.shares,
        percentage: ((f.shares / totalPostShares) * 100).toFixed(2) + "%",
        value: ((f.shares / totalPostShares) * postMoneyValuation).toFixed(2),
      })),
      total_shares: round0Shares,
      total_percentage:
        ((round0Shares / totalPostShares) * 100).toFixed(2) + "%",
      total_value: (
        (round0Shares / totalPostShares) *
        postMoneyValuation
      ).toFixed(2),
    },
    previous_investors:
      totalInvestorShares > 0
        ? {
            name: "Previous Investors",
            shares: totalInvestorShares,
            new_shares: 0,
            total: totalInvestorShares,
            percentage:
              ((totalInvestorShares / totalPostShares) * 100).toFixed(2) + "%",
            value: (
              (totalInvestorShares / totalPostShares) *
              postMoneyValuation
            ).toFixed(2),
          }
        : null,
    converted_investors:
      totalConvertedShares > 0
        ? {
            name: "Convertible Note Investors",
            shares: totalConvertedShares,
            new_shares: totalConvertedShares,
            total: totalConvertedShares,
            percentage:
              ((totalConvertedShares / totalPostShares) * 100).toFixed(2) + "%",
            value: (
              (totalConvertedShares / totalPostShares) *
              postMoneyValuation
            ).toFixed(2),
            investment: totalConvertedInvestment,
          }
        : null,
    investors: {
      name: hasInvestmentRoundBefore
        ? "Series A Investors"
        : "Common Stock Investors",
      shares: newInvestorShares,
      new_shares: newInvestorShares,
      total: newInvestorShares,
      percentage:
        ((newInvestorShares / totalPostShares) * 100).toFixed(2) + "%",
      value: (
        (newInvestorShares / totalPostShares) *
        postMoneyValuation
      ).toFixed(2),
      investment: roundSizeVal,
      items: investorsWithShares, // ✅ Individual investors with shares
    },
    option_pool: {
      shares:
        existingOptionPoolShares +
        (optionPoolShares || 0) +
        (newOptionShares || 0),
      existing_shares: existingOptionPoolShares + (optionPoolShares || 0),
      new_shares: newOptionShares || 0,
      total:
        existingOptionPoolShares +
        (optionPoolShares || 0) +
        (newOptionShares || 0),
      percentage:
        (
          ((existingOptionPoolShares +
            (optionPoolShares || 0) +
            (newOptionShares || 0)) /
            totalPostShares) *
          100
        ).toFixed(2) + "%",
      value: (
        ((existingOptionPoolShares +
          (optionPoolShares || 0) +
          (newOptionShares || 0)) /
          totalPostShares) *
        postMoneyValuation
      ).toFixed(2),
    },
    items: [
      // ✅ Complete items array for future use
      ...founderList.map((f) => ({
        type: "founder",
        name: f.name,
        shares: f.shares,
        new_shares: 0,
        total: f.shares,
        email: f.email,
        phone: f.phone,
        founder_code: f.founder_code,
      })),
      ...(totalInvestorShares > 0
        ? [
            {
              type: "investor",
              name: "Previous Investors",
              shares: totalInvestorShares,
              new_shares: 0,
              total: totalInvestorShares,
              is_previous: true,
              is_grouped: true,
            },
          ]
        : []),
      ...(totalConvertedShares > 0
        ? [
            {
              type: "investor",
              name: "Convertible Note Investors",
              shares: totalConvertedShares,
              new_shares: totalConvertedShares,
              total: totalConvertedShares,
              is_converted: true,
            },
          ]
        : []),
      ...investorsWithShares.map((inv) => ({
        type: "investor",
        name: [inv.firstName, inv.lastName].filter(Boolean).join(" "),
        investor_details: {
          firstName: inv.firstName || "",
          lastName: inv.lastName || "",
          email: inv.email || "",
          phone: inv.phone || "",
        },
        shares: inv.shares,
        new_shares: inv.shares,
        total: inv.shares,
        investment: parseFloat(inv.amount) || 0,
        share_price: updatedSharePrice,
        is_new_investment: true,
      })),
      {
        type: "option_pool",
        name: "Employee Option Pool",
        shares:
          existingOptionPoolShares +
          (optionPoolShares || 0) +
          (newOptionShares || 0),
        existing_shares: existingOptionPoolShares + (optionPoolShares || 0),
        new_shares: newOptionShares || 0,
        total:
          existingOptionPoolShares +
          (optionPoolShares || 0) +
          (newOptionShares || 0),
        is_option_pool: true,
      },
    ],
    post_money_valuation: postMoneyValuation,
    share_price: (postMoneyValuation / totalPostShares).toFixed(4),
  };

  // ==================== PREPARE ROUND INVESTMENTS FOR DATABASE ====================
  // Round investments already have investor details, just ensure it's a string
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
    round_investments: roundInvestmentsString, // ✅ Save round_investments
    pre_money_cap_table: JSON.stringify(preMoneyCapTable),
    post_money_cap_table: JSON.stringify(postMoneyCapTable),
    updated_at: new Date(),
  };

  try {
    await updateRoundRecordDataCommonPreferred(id, dbUpdateData);

    if (conversionDetails.length > 0) {
      await saveConversionsToTracking(conversionDetails, id, company_id);
    }

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
    id,
    company_id,
    preMoney,
    roundSize,
    optionPoolPercentValue,
    total_shares_before,
    round0_shares,
    investorPostMoney,
    instrumentData,
    isUpdate: isUpdateFromParams = false,
    optionPoolPercent_post,
  } = params;

  const isUpdate = updateFlag || isUpdateFromParams;

  // ==================== STEP 1: VALIDATE INPUTS ====================
  const preMoneyVal = parseFloat(preMoney) || 0;
  const roundSizeVal = parseFloat(roundSize) || 0;
  const optionPoolTarget = parseFloat(optionPoolPercent_post) || 0;
  let totalSharesBefore = parseInt(total_shares_before) || 0;

  if (preMoneyVal <= 0 || roundSizeVal <= 0 || totalSharesBefore <= 0) {
    console.error("❌ Invalid inputs for calculation");
    return { success: false, error: "Invalid inputs for calculation" };
  }

  // ==================== STEP 2: GET PREVIOUS ROUNDS ====================
  const previousRounds = await getPreviousRoundsForCompany(company_id, id);

  // ==================== STEP 3: GET FOUNDER DATA FROM ROUND 0 ====================
  let founderList = [];
  let founderData = null;
  let round0Shares = 0;

  try {
    const round0Data = await getFounderDataFromRound0(company_id);
    if (round0Data && round0Data.founder_data) {
      founderData = round0Data.founder_data;
      round0Shares = round0Data.total_founder_shares || 0;

      if (founderData.founders && Array.isArray(founderData.founders)) {
        founderList = founderData.founders.map((founder, index) => ({
          name:
            `${founder.firstName || ""} ${founder.lastName || ""}`.trim() ||
            `Founder ${index + 1}`,
          shares: parseFloat(founder.shares) || 0,
          email: founder.email || "",
          founder_code: `F${index + 1}`,
          share_type: founder.shareType || "common",
          voting: founder.voting || "voting",
        }));
      }
    }
  } catch (error) {
    console.error("❌ Error fetching founder data:", error);
  }

  // ==================== STEP 4: GET EXISTING OPTION POOL ====================
  let existingOptionPoolShares = 0;
  previousRounds.forEach((round) => {
    if (parseInt(round.id) < parseInt(id)) {
      existingOptionPoolShares += parseInt(round.option_pool_shares) || 0;
    }
  });

  // ==================== STEP 5: GET FOUNDER SHARES ====================
  const foundersShares = totalSharesBefore - existingOptionPoolShares;

  // ==================== STEP 6: GET ALREADY CONVERTED ROUNDS ====================
  const alreadyConvertedRounds = await getAlreadyConvertedRounds(
    company_id,
    id,
  );
  const alreadyConvertedIds = alreadyConvertedRounds.map((r) =>
    parseInt(r.original_round_id),
  );

  // ==================== STEP 7: CALCULATE SHARE PRICE ====================
  const sharePrice = preMoneyVal / totalSharesBefore;

  // ==================== STEP 8: CONVERT SAFE/CONVERTIBLE NOTES ====================
  let totalConvertedShares = 0;
  let totalConvertedInvestment = 0;
  let conversionDetails = [];
  let yearsBetween = 2;

  for (const round of previousRounds) {
    // Skip current round and future rounds
    if (parseInt(round.id) >= parseInt(id)) continue;

    // Skip if not a convertible instrument
    if (!["Safe", "Convertible Note"].includes(round.instrumentType)) continue;

    // Skip if already converted in another round
    if (alreadyConvertedIds.includes(parseInt(round.id))) {
      continue;
    }

    const instrumentData = parseInstrumentData(round.instrument_type_data);
    const investment = parseFloat(round.roundsize) || 0;

    if (investment > 0) {
      let conversionResult;

      if (round.instrumentType === "Convertible Note") {
        // ========== CONVERTIBLE NOTE CONVERSION ==========
        const interestRate = parseFloat(instrumentData.interestRate_note) || 0;
        const discountRate = parseFloat(instrumentData.discountRate_note) || 0;
        const valuationCap = parseFloat(instrumentData.valuationCap_note) || 0;

        // Calculate principal + interest
        const principalPlusInterest =
          investment * Math.pow(1 + interestRate / 100, yearsBetween);

        // Calculate discounted price
        const discountedPrice = sharePrice * (1 - discountRate / 100);

        // Calculate cap price
        const capPrice =
          valuationCap > 0 ? valuationCap / totalSharesBefore : Infinity;

        // Conversion price is the minimum
        const conversionPrice = Math.min(discountedPrice, capPrice);

        // Converted shares
        const convertedShares = Math.round(
          principalPlusInterest / conversionPrice,
        );

        conversionResult = {
          convertedShares,
          price: conversionPrice,
          totalAmount: principalPlusInterest,
          discountRate,
          valuationCap,
          interestRate,
        };
      } else if (round.instrumentType === "Safe") {
        // ========== SAFE CONVERSION ==========
        const discountRate = parseFloat(instrumentData.discountRate) || 0;
        const valuationCap = parseFloat(instrumentData.valuationCap) || 0;

        // Calculate discounted price
        const discountedPrice = sharePrice * (1 - discountRate / 100);

        // Calculate cap price
        const capPrice =
          valuationCap > 0 ? valuationCap / totalSharesBefore : Infinity;

        // Conversion price is the minimum of discounted price and cap price
        const conversionPrice = Math.min(discountedPrice, capPrice);

        // Converted shares = Investment / Conversion Price
        const convertedShares = Math.round(investment / conversionPrice);

        conversionResult = {
          convertedShares,
          price: conversionPrice,
          totalAmount: investment, // SAFE doesn't accrue interest
          discountRate,
          valuationCap,
          interestRate: 0,
        };
      }

      if (conversionResult && conversionResult.convertedShares > 0) {
        totalConvertedShares += conversionResult.convertedShares;
        totalConvertedInvestment += investment;

        // Push conversion details with ALL required fields
        conversionDetails.push({
          original_round_id: round.id,
          instrument_type: round.instrumentType,
          investment: investment,
          conversion_price: conversionResult.price,
          convertedShares: conversionResult.convertedShares,
          investor_name:
            round.nameOfRound || `${round.instrumentType} Investor`,
          principal_plus_interest: conversionResult.totalAmount || investment,
          discount_rate: conversionResult.discountRate || 0,
          valuation_cap: conversionResult.valuationCap || 0,
          interest_rate: conversionResult.interestRate || 0,
        });
      }
    }
  }

  // ==================== STEP 9: NEW INVESTOR SHARES (SERIES A) ====================
  const newInvestorShares = Math.round(roundSizeVal / sharePrice);

  // Calculate founders shares distribution
  const founderSharesDistribution = founderList.map((f) => ({
    name: f.name,
    shares: f.shares,
    email: f.email,
    founder_code: f.founder_code,
  }));

  const totalWithoutAnyOptions =
    foundersShares + totalConvertedShares + newInvestorShares;

  let newOptionShares = 0;
  let totalSharesAfterPool = totalWithoutAnyOptions;

  if (optionPoolTarget > 0) {
    totalSharesAfterPool =
      totalWithoutAnyOptions / (1 - optionPoolTarget / 100);
    const totalOptionSharesNeeded = Math.round(
      totalSharesAfterPool - totalWithoutAnyOptions,
    );
    newOptionShares = Math.max(
      0,
      totalOptionSharesNeeded - existingOptionPoolShares,
    );
  }

  // ==================== STEP 11: FINAL TOTALS ====================
  const finalTotalShares = Math.round(totalSharesAfterPool);
  const issuedSharesThisRound = newInvestorShares + newOptionShares;
  const postMoneyValuation = finalTotalShares * sharePrice;
  const investorOwnership = (newInvestorShares / finalTotalShares) * 100;

  // ==================== STEP 12: CREATE DYNAMIC CAP TABLES ====================

  // Pre-Money Cap Table - COMPLETELY DYNAMIC
  const preMoneyItems = [];

  // Add founders to pre-money
  founderList.forEach((founder, index) => {
    preMoneyItems.push({
      type: "founder",
      name: founder.name,
      shares: founder.shares,
      percentage: ((founder.shares / totalSharesBefore) * 100).toFixed(2),
      value: (founder.shares / totalSharesBefore) * preMoneyVal,
      founder_code: founder.founder_code,
      email: founder.email,
      share_type: founder.share_type,
      voting: founder.voting,
    });
  });

  // Add existing option pool to pre-money
  if (existingOptionPoolShares > 0) {
    preMoneyItems.push({
      type: "option_pool",
      name: "Employee Option Pool",
      shares: existingOptionPoolShares,
      percentage: (
        (existingOptionPoolShares / totalSharesBefore) *
        100
      ).toFixed(2),
      value: (existingOptionPoolShares / totalSharesBefore) * preMoneyVal,
      round_name: "From Previous Rounds",
    });
  }

  const preMoneyCapTable = {
    items: preMoneyItems,
    totals: {
      total_shares: totalSharesBefore,
      total_value: preMoneyVal,
      pre_money_valuation: preMoneyVal,
      share_price: sharePrice,
    },
  };

  // Post-Money Cap Table - COMPLETELY DYNAMIC
  const postMoneyItems = [];

  // Add founders to post-money
  founderList.forEach((founder) => {
    postMoneyItems.push({
      type: "founder",
      name: founder.name,
      shares: founder.shares,
      new_shares: 0,
      total: founder.shares,
      percentage: ((founder.shares / finalTotalShares) * 100).toFixed(2),
      value: (founder.shares / finalTotalShares) * postMoneyValuation,
      founder_code: founder.founder_code,
      email: founder.email,
    });
  });

  // Add converted investors (Seed)
  if (totalConvertedShares > 0) {
    postMoneyItems.push({
      type: "investor",
      name: "Seed Investors",
      instrument_type: "Convertible Note",
      is_converted: true,
      shares: totalConvertedShares,
      new_shares: totalConvertedShares,
      total: totalConvertedShares,
      percentage: ((totalConvertedShares / finalTotalShares) * 100).toFixed(2),
      value: (totalConvertedShares / finalTotalShares) * postMoneyValuation,
      investment: totalConvertedInvestment,
      conversion_price: conversionDetails[0]?.conversion_price || 0,
    });
  }

  // Add Series A investors
  if (newInvestorShares > 0) {
    postMoneyItems.push({
      type: "investor",
      name: "Series A Investors",
      instrument_type: "Preferred Equity",
      is_new_investment: true,
      shares: newInvestorShares,
      new_shares: newInvestorShares,
      total: newInvestorShares,
      percentage: ((newInvestorShares / finalTotalShares) * 100).toFixed(2),
      value: (newInvestorShares / finalTotalShares) * postMoneyValuation,
      investment: roundSizeVal,
      share_price: sharePrice,
    });
  }

  // Add option pool
  if (existingOptionPoolShares + newOptionShares > 0) {
    postMoneyItems.push({
      type: "option_pool",
      name: "Employee Option Pool",
      shares: existingOptionPoolShares + newOptionShares,
      existing_shares: existingOptionPoolShares,
      new_shares: newOptionShares,
      total: existingOptionPoolShares + newOptionShares,
      percentage: (
        ((existingOptionPoolShares + newOptionShares) / finalTotalShares) *
        100
      ).toFixed(2),
      value:
        ((existingOptionPoolShares + newOptionShares) / finalTotalShares) *
        postMoneyValuation,
      is_new_pool: newOptionShares > 0,
    });
  }

  const postMoneyCapTable = {
    items: postMoneyItems,
    totals: {
      total_shares: finalTotalShares,
      total_value: Math.round(postMoneyValuation),
      post_money_valuation: Math.round(postMoneyValuation),
      share_price: sharePrice,
    },
  };

  // ==================== STEP 13: PREPARE DATABASE DATA ====================
  const dbUpdateData = {
    share_price: sharePrice.toFixed(4),
    issuedshares: issuedSharesThisRound.toString(),
    investorPostMoney: investorOwnership.toFixed(2),
    pre_money: preMoneyVal.toString(),
    post_money: Math.round(postMoneyValuation).toString(),
    roundsize: roundSizeVal.toString(),
    conversion_shares: totalConvertedShares.toString(),
    total_converted_shares: totalConvertedShares.toString(),
    option_pool_shares: newOptionShares.toString(),
    option_pool_percentage: optionPoolTarget.toFixed(2),
    total_shares_before: totalSharesBefore.toString(),
    total_shares_after: finalTotalShares.toString(),
    total_option_pool: (existingOptionPoolShares + newOptionShares).toString(),
    pre_money_cap_table: JSON.stringify(preMoneyCapTable),
    post_money_cap_table: JSON.stringify(postMoneyCapTable),
    founder_data: founderData ? JSON.stringify(founderData) : null,
    updated_at: new Date(),
  };

  // ==================== STEP 14: DATABASE OPERATIONS ====================
  // ==================== STEP 14: DATABASE OPERATIONS ====================
  try {
    // Update round record
    await updateRoundRecordData(id, dbUpdateData);

    // Handle conversions - DELETE OLD IF UPDATE
    if (isUpdate) {
      await deleteConversionsForRound(id);
    }

    // ===== ONLY SAVE SEED INVESTORS CONVERSION (if any) =====
    if (conversionDetails.length > 0) {
      const seedConversionData = conversionDetails.map((conv) => ({
        original_round_id: conv.original_round_id,
        instrument_type: conv.instrument_type,
        investment: conv.investment,
        conversion_price: conv.conversion_price,
        convertedShares: conv.convertedShares,
        investor_name: conv.investor_name,
      }));

      seedConversionData.forEach((conv, idx) => {});

      await saveConversionsToTracking(seedConversionData, id, company_id);
    } else {
    }

    if (conversionDetails.length > 0) {
    } else {
    }

    return {
      success: true,
      message: `Series A round ${isUpdate ? "updated" : "created"} successfully`,
      data: dbUpdateData,
      calculations: {
        share_price: sharePrice,
        founders: founderList.map((f) => ({
          name: f.name,
          shares: f.shares,
          percentage: ((f.shares / finalTotalShares) * 100).toFixed(2),
        })),
        converted_shares: totalConvertedShares,
        converted_investment: totalConvertedInvestment,
        new_investor_shares: newInvestorShares,
        new_option_shares: newOptionShares,
        total_shares: finalTotalShares,
        post_money_valuation: Math.round(postMoneyValuation),
        investor_ownership: investorOwnership.toFixed(2),
      },
      conversion_details:
        conversionDetails.length > 0 ? conversionDetails : null,
      roundId: id,
    };
  } catch (dbError) {
    console.error("\n❌ DATABASE ERROR:", dbError);
    return {
      success: false,
      error: "Database update failed",
      details: dbError.message,
    };
  }
}

// Helper function for SAFE conversion
function calculateSafeConversion(
  investment,
  instrumentData,
  sharePrice,
  totalSharesBefore,
) {
  const discountRate = parseFloat(instrumentData.discountRate) || 0;
  const valuationCap = parseFloat(instrumentData.valuationCap) || 0;

  const discountedPrice = sharePrice * (1 - discountRate / 100);
  const capPrice =
    valuationCap > 0 ? valuationCap / totalSharesBefore : Infinity;
  const conversionPrice = Math.min(discountedPrice, capPrice);
  const convertedShares = Math.round(investment / conversionPrice);

  return {
    convertedShares,
    price: conversionPrice,
    totalAmount: investment,
    discountRate,
    valuationCap,
  };
}

// ==================== NEW HELPER FUNCTION ====================

async function getAlreadyConvertedRounds(companyId, currentRoundId) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT DISTINCT original_round_id 
      FROM conversion_tracking 
      WHERE company_id = ?  AND conversion_round_id < ?
      AND conversion_round_id IS NOT NULL
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
function calculateSafeOrNoteConversion(
  instrumentType,
  investment,
  instrumentData,
  sharePrice,
  totalSharesBefore,
  round0_shares,
) {
  let convertedShares = 0;
  let price = sharePrice;
  let totalAmount = investment;

  if (instrumentType === "Safe") {
    const discount = parseFloat(instrumentData.discountRate) || 0;
    const valuationCap = parseFloat(instrumentData.valuationCap) || 0;

    const discountedPrice = sharePrice * (1 - discount / 100);
    let capPrice = Infinity;
    if (valuationCap > 0) {
      capPrice = valuationCap / totalSharesBefore;
    }

    price = Math.min(discountedPrice, capPrice);
    convertedShares = price > 0 ? Math.round(investment / price) : 0;
  } else if (instrumentType === "Convertible Note") {
    const discount = parseFloat(instrumentData.discountRate_note) || 0;
    const interestRate = parseFloat(instrumentData.interestRate_note) || 0;
    const valuationCap = parseFloat(instrumentData.valuationCap_note) || 0;
    const years = 2; // Default from documentation

    // Calculate principal + interest
    if (interestRate > 0) {
      totalAmount = investment * Math.pow(1 + interestRate / 100, years);
    }

    const discountedPrice = sharePrice * (1 - discount / 100);
    let capPrice = Infinity;
    if (valuationCap > 0) {
      capPrice = valuationCap / totalSharesBefore;
    }

    price = Math.min(discountedPrice, capPrice);
    convertedShares = price > 0 ? Math.round(totalAmount / price) : 0;
  }

  return { convertedShares, price, totalAmount };
}
// ==================== EXISTING HELPER FUNCTIONS (keep these as they are) ====================

// Get existing round data
async function getExistingRoundData(roundId) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        *
      FROM roundrecord 
      WHERE id = ?
    `;
    db.query(query, [roundId], (err, results) => {
      if (err) reject(err);
      else resolve(results.length > 0 ? results[0] : null);
    });
  });
}

// Save conversions to tracking table
async function saveConversionsToTracking(
  conversions,
  conversionRoundId,
  companyId,
) {
  if (!conversions || conversions.length === 0) return [];

  const insertPromises = conversions.map((conv) => {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO conversion_tracking (
          company_id,
          original_round_id,
          conversion_round_id,
          instrument_type,
          original_investment_amount,
          conversion_price,
          converted_shares,
          conversion_date,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const values = [
        companyId,
        conv.original_round_id,
        conversionRoundId,
        conv.instrument_type,
        conv.investment,
        conv.conversion_price,
        conv.convertedShares,
        new Date(),
        new Date(),
      ];

      db.query(query, values, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  });

  return Promise.all(insertPromises);
}
// ==================== HELPER FUNCTIONS ====================

async function checkRoundExists(roundId) {
  return new Promise((resolve, reject) => {
    const query = "SELECT id FROM roundrecord WHERE id = ?";
    db.query(query, [roundId], (err, results) => {
      if (err) reject(err);
      else resolve(results.length > 0);
    });
  });
}

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

function calculateConversion(
  instrumentType,
  investment,
  instrumentData,
  sharePrice,
  totalSharesBefore,
) {
  let convertedShares = 0;
  let price = sharePrice;

  if (instrumentType === "Safe") {
    const discount = parseFloat(instrumentData.discountRate) || 0;
    const valuationCap = parseFloat(instrumentData.valuationCap) || 0;

    const discountedPrice = sharePrice * (1 - discount / 100);
    let capPrice = Infinity;
    if (valuationCap > 0) {
      capPrice = valuationCap / totalSharesBefore;
    }

    price = Math.min(discountedPrice, capPrice);
    convertedShares = price > 0 ? Math.round(investment / price) : 0;
  } else if (instrumentType === "Convertible Note") {
    const discount = parseFloat(instrumentData.discountRate_note) || 0;
    const interestRate = parseFloat(instrumentData.interestRate_note) || 0;
    const valuationCap = parseFloat(instrumentData.valuationCap_note) || 0;
    const years = 2;

    let totalWithInterest = investment;
    if (interestRate > 0) {
      totalWithInterest = investment * Math.pow(1 + interestRate / 100, years);
    }

    const discountedPrice = sharePrice * (1 - discount / 100);
    let capPrice = Infinity;
    if (valuationCap > 0) {
      capPrice = valuationCap / totalSharesBefore;
    }

    price = Math.min(discountedPrice, capPrice);
    convertedShares = price > 0 ? Math.round(totalWithInterest / price) : 0;
  }

  return { convertedShares, price };
}

async function updateRoundRecordData(roundId, updateData) {
  return new Promise((resolve, reject) => {
    const query = `
      UPDATE roundrecord 
      SET 
      pre_money_cap_table=?,
      post_money_cap_table=?,
        share_price = ?,
        issuedshares = ?,
        investorPostMoney = ?,
        post_money = ?,
        conversion_shares = ?,
        total_converted_shares = ?,
        option_pool_shares = ?,
        option_pool_percentage = ?,
        total_shares_before = ?,
        total_shares_after = ?,
        updated_at = ?
      WHERE id = ?
    `;

    const values = [
      updateData.pre_money_cap_table,
      updateData.post_money_cap_table,
      updateData.share_price,
      updateData.issuedshares,
      updateData.investorPostMoney,
      updateData.post_money,
      updateData.conversion_shares,
      updateData.total_converted_shares,
      updateData.option_pool_shares,
      updateData.option_pool_percentage,
      updateData.total_shares_before,
      updateData.total_shares_after,
      updateData.updated_at,
      roundId,
    ];

    db.query(query, values, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

async function deleteConversionsForRound(conversionRoundId) {
  return new Promise((resolve, reject) => {
    const query =
      "DELETE FROM conversion_tracking WHERE conversion_round_id = ?";
    db.query(query, [conversionRoundId], (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

// 3. SAFE HANDLER
function handleSafeCalculation(params) {
  const {
    id,
    company_id,
    preMoney,
    roundSize,
    optionPoolPercentValue, // Pre-seed option pool % (10%)
    total_shares_before, // Round 0 shares (1,000)
    instrumentData,
    isUpdate,
    optionPoolPercent_post,
  } = params;

  // ==================== VALIDATE INPUTS ====================
  const preMoneyVal = parseFloat(preMoney) || 0; // $8,000
  const roundSizeVal = parseFloat(roundSize) || 0; // $2,000
  const optionPoolPercent = parseFloat(optionPoolPercentValue) || 0; // 10%
  const round0Shares = parseInt(total_shares_before) || 0; // 1,000

  if (preMoneyVal <= 0 || roundSizeVal <= 0 || round0Shares <= 0) {
    return { success: false, error: "Invalid inputs for calculation" };
  }

  // ==================== STEP 1: CALCULATE OPTION POOL SHARES ====================
  // Formula: Employee shares = Round0 / (1 - optionPool%) × optionPool%
  // = 1,000 / (1 - 0.10) × 0.10 = 111
  const optionPoolShares = Math.round(
    (round0Shares / (1 - optionPoolPercent / 100)) * (optionPoolPercent / 100),
  );

  // ==================== STEP 2: PRE-MONEY TOTAL SHARES ====================
  const preMoneyTotalShares = round0Shares + optionPoolShares; // 1,000 + 111 = 1,111

  // ==================== STEP 3: SHARE PRICE ====================
  // Share Price = Pre-money Valuation / Pre-money Shares
  const sharePrice = preMoneyVal / preMoneyTotalShares; // $8,000 / 1,111 = $7.20

  // ==================== STEP 4: CONVERSION PRICE (for future) ====================
  let conversionPrice = 0;
  let conversionShares = 0;

  // Get SAFE terms from instrumentData
  const discountRate = parseFloat(instrumentData?.discountRate) || 0;
  const valuationCap = parseFloat(instrumentData?.valuationCap) || 0;

  // Calculate discounted price
  const discountedPrice = sharePrice * (1 - discountRate / 100);

  // Calculate cap price
  const capPrice =
    valuationCap > 0 ? valuationCap / preMoneyTotalShares : Infinity;

  // Conversion price is the minimum
  conversionPrice = Math.min(discountedPrice, capPrice);

  // Conversion shares (will be used in next round)
  conversionShares = Math.round(roundSizeVal / conversionPrice);

  // ==================== STEP 5: POST-MONEY VALUATION ====================
  const postMoneyValuation = preMoneyVal + roundSizeVal; // $8,000 + $2,000 = $10,000

  // ==================== STEP 6: INVESTOR POST-MONEY OWNERSHIP ====================
  const investorPostMoneyOwnership = (roundSizeVal / postMoneyValuation) * 100; // 20%

  // ==================== STEP 7: TOTAL POST-MONEY SHARES ====================
  const totalPostShares = Math.round(
    preMoneyTotalShares / (1 - investorPostMoneyOwnership / 100),
  ); // 1,111 / 0.8 = 1,389

  // ==================== STEP 8: NO IMMEDIATE SHARES FOR SAFE ====================
  const newInvestorShares = 0; // SAFE doesn't get shares now
  const totalSharesAfter = preMoneyTotalShares; // 1,111 (no new shares)

  // ==================== PREPARE DATABASE UPDATE ====================
  const dbUpdateData = {
    share_price: sharePrice.toFixed(4),
    issuedshares: "0", // No shares issued in SAFE round
    investorPostMoney: investorPostMoneyOwnership.toFixed(2),
    pre_money: preMoneyVal.toString(),
    post_money: postMoneyValuation.toString(),
    roundsize: roundSizeVal.toString(),
    conversion_shares: "0",
    total_converted_shares: "0",
    option_pool_shares: optionPoolShares.toString(),
    option_pool_percentage: optionPoolPercent.toFixed(2),
    total_shares_before: round0Shares.toString(),
    total_shares_after: totalSharesAfter.toString(),
    total_option_pool: optionPoolShares.toString(),
    updated_at: new Date(),
  };
  updateRoundCalculationsSafeConvertibleNote({
    id: id,
    new_investor_shares: 0,
    conversion_price: conversionPrice || 0,
    conversion_shares: conversionShares || 0,
    option_pool_shares: optionPoolShares,
    share_price: sharePrice,
    total_shares_before: round0Shares,
    total_shares_after: totalSharesAfter,
    total_converted_shares: 0,
    instrumentType: "Safe",
    roundSize: roundSizeVal,
    preMoney: preMoneyVal,
  });

  return {
    success: true,
    data: dbUpdateData,
    roundId: id,
  };
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
async function handleConvertibleNoteCalculation(params, updateFlag = false) {
  const {
    id,
    company_id,
    preMoney,
    roundSize,
    optionPoolPercentValue, // 👈 YEH PRE-SEED OPTION POOL % HAI (10%)
    total_shares_before,
    instrumentData,
    isUpdate: isUpdateFromParams = false,
    optionPoolPercent_post,
  } = params;

  const isUpdate = updateFlag || isUpdateFromParams;

  // ==================== PARSE INPUTS ====================
  const preMoneyVal = parseFloat(preMoney) || 0; // $45,000
  const roundSizeVal = parseFloat(roundSize) || 0; // $120,000
  const preSeedOptionPoolPercent = parseFloat(optionPoolPercentValue) || 0; // 10%

  // Parse total_shares_before (Round 0 shares = 100,000)
  let totalSharesBefore = 0;
  if (total_shares_before) {
    if (typeof total_shares_before === "string") {
      totalSharesBefore = parseInt(total_shares_before) || 0;
    } else if (typeof total_shares_before === "number") {
      totalSharesBefore = total_shares_before;
    }
  }

  // ==================== PARSE INSTRUMENT DATA ====================
  let parsedInstrumentData = {};

  if (instrumentData) {
    if (typeof instrumentData === "string") {
      try {
        parsedInstrumentData = JSON.parse(instrumentData);
      } catch (e) {
        console.error("Error parsing instrumentData string:", e);
      }
    } else if (typeof instrumentData === "object") {
      parsedInstrumentData = instrumentData;
    }
  }

  // Extract Convertible Note terms
  const discountRate = parseFloat(parsedInstrumentData.discountRate_note) || 0;
  const valuationCap = parseFloat(parsedInstrumentData.valuationCap_note) || 0;
  const interestRate = parseFloat(parsedInstrumentData.interestRate_note) || 0;
  const maturityDate = parsedInstrumentData.maturityDate || "";

  // ==================== GET FOUNDER DATA ====================
  let founderList = [];
  let founderData = null;
  let round0Shares = 0;

  try {
    const round0Data = await getFounderDataFromRound0(company_id);
    if (round0Data && round0Data.founder_data) {
      founderData = round0Data.founder_data;
      round0Shares = round0Data.total_founder_shares || 0;

      if (founderData.founders && Array.isArray(founderData.founders)) {
        founderList = founderData.founders.map((founder, index) => ({
          name:
            `${founder.firstName || ""} ${founder.lastName || ""}`.trim() ||
            `Founder ${index + 1}`,
          shares: parseFloat(founder.shares) || 0,
          email: founder.email || "",
          founder_code: `F${index + 1}`,
          share_type: founder.shareType || "common",
          voting: founder.voting || "voting",
        }));
      }
    }
  } catch (error) {
    console.error("❌ Error fetching founder data:", error);
  }

  // ==================== ✅ STEP 1: CALCULATE OPTION POOL SHARES ====================
  // Document Formula: Employee # shares = Total # of shares/ (1-pre seed option pool) * pre seed option pool
  // = 100,000 / (1-0.10) * 0.10 = 11,111

  let optionPoolShares = 0;

  if (preSeedOptionPoolPercent > 0 && totalSharesBefore > 0) {
    optionPoolShares = Math.round(
      (totalSharesBefore / (1 - preSeedOptionPoolPercent / 100)) *
        (preSeedOptionPoolPercent / 100),
    );
  }

  // ==================== ✅ STEP 2: PRE-MONEY TOTAL SHARES ====================
  const preMoneyTotalShares = totalSharesBefore + optionPoolShares; // 100,000 + 11,111 = 111,111

  // ==================== ✅ STEP 3: PRE-MONEY OWNERSHIP % ====================

  const founderOwnership = (totalSharesBefore / preMoneyTotalShares) * 100; // 90%
  const optionPoolOwnership = (optionPoolShares / preMoneyTotalShares) * 100; // 10%

  // ==================== ✅ STEP 4: PRE-MONEY VALUES ====================

  const founderValue = (founderOwnership / 100) * preMoneyVal; // $40,500
  const optionPoolValue = (optionPoolOwnership / 100) * preMoneyVal; // $4,500

  // ==================== ✅ STEP 5: CONVERTIBLE NOTE - NO IMMEDIATE SHARES ====================
  const newInvestorShares = 0; // No shares issued now
  const conversionPrice = 0; // Will be calculated in next round
  const conversionShares = 0; // Will be calculated in next round
  const totalSharesAfter = preMoneyTotalShares; // 111,111 (with option pool)
  const totalConvertedShares = 0;
  const postMoneyValuation = preMoneyVal; // Post-money = Pre-money for convertible note
  const investorPostMoneyOwnership = 0;

  // ==================== CREATE PRE-MONEY CAP TABLE ====================
  const preMoneyCapTable = {
    total_shares: preMoneyTotalShares,
    pre_money_valuation: preMoneyVal,
    share_price: (preMoneyVal / totalSharesBefore).toFixed(4),
    founders: {
      list: founderList.map((f) => ({
        ...f,
        shares: f.shares,
        percentage: ((f.shares / preMoneyTotalShares) * 100).toFixed(2) + "%",
        value: ((f.shares / preMoneyTotalShares) * preMoneyVal).toFixed(2),
      })),
      total_shares: totalSharesBefore,
      total_percentage:
        ((totalSharesBefore / preMoneyTotalShares) * 100).toFixed(2) + "%",
      total_value: (
        (totalSharesBefore / preMoneyTotalShares) *
        preMoneyVal
      ).toFixed(2),
    },
    option_pool: {
      shares: optionPoolShares,
      percentage:
        ((optionPoolShares / preMoneyTotalShares) * 100).toFixed(2) + "%",
      value: ((optionPoolShares / preMoneyTotalShares) * preMoneyVal).toFixed(
        2,
      ),
    },
  };

  // ==================== CREATE POST-MONEY CAP TABLE ====================
  const postMoneyCapTable = {
    total_shares: totalSharesAfter,
    post_money_valuation: postMoneyValuation,
    share_price: (preMoneyVal / totalSharesBefore).toFixed(4),
    founders: {
      list: founderList.map((f) => ({
        ...f,
        shares: f.shares,
        new_shares: 0,
        total: f.shares,
        percentage: ((f.shares / totalSharesAfter) * 100).toFixed(2) + "%",
        value: ((f.shares / totalSharesAfter) * postMoneyValuation).toFixed(2),
      })),
      total_shares: totalSharesBefore,
      total_percentage:
        ((totalSharesBefore / totalSharesAfter) * 100).toFixed(2) + "%",
      total_value: (
        (totalSharesBefore / totalSharesAfter) *
        postMoneyValuation
      ).toFixed(2),
    },
    option_pool: {
      shares: optionPoolShares,
      existing_shares: 0,
      new_shares: optionPoolShares,
      total: optionPoolShares,
      percentage:
        ((optionPoolShares / totalSharesAfter) * 100).toFixed(2) + "%",
      value: (
        (optionPoolShares / totalSharesAfter) *
        postMoneyValuation
      ).toFixed(2),
    },
    convertible_note: {
      type: "Convertible Note",
      investment: roundSizeVal,
      discount_rate: discountRate,
      interest_rate: interestRate,
      valuation_cap: valuationCap,
      maturity_date: maturityDate,
      conversion_price: 0,
      conversion_shares: 0,
      share_price_at_creation: preMoneyVal / totalSharesBefore,
      status: "pending",
    },
  };

  // ==================== PREPARE INSTRUMENT DATA FOR STORAGE ====================
  const instrumentDataToStore = {
    discountRate_note: discountRate,
    interestRate_note: interestRate,
    valuationCap_note: valuationCap,
    maturityDate: maturityDate,
    originalInvestment: roundSizeVal,
    sharePriceAtCreation: preMoneyVal / totalSharesBefore,
    totalSharesAtCreation: totalSharesBefore,
    optionPoolShares: optionPoolShares,
    preMoneyTotalShares: preMoneyTotalShares,
    createdAt: new Date().toISOString(),
    status: "pending",
    convertedInRound: null,
    convertedAt: null,
  };

  // ==================== DATABASE UPDATE DATA ====================
  const dbUpdateData = {
    // Core fields
    share_price: (preMoneyVal / totalSharesBefore).toString(),
    issuedshares: "0",
    investorPostMoney: investorPostMoneyOwnership.toString(),
    pre_money: preMoneyVal.toString(),
    post_money: postMoneyValuation.toString(),
    roundsize: roundSizeVal.toString(),

    // Share tracking
    conversion_shares: conversionShares.toString(),
    total_converted_shares: totalConvertedShares.toString(),
    option_pool_shares: optionPoolShares.toString(), // 👈 11,111
    option_pool_percentage: preSeedOptionPoolPercent.toString(),

    // Total shares
    total_shares_before: totalSharesBefore.toString(), // 100,000
    total_shares_after: totalSharesAfter.toString(), // 111,111
    total_option_pool: optionPoolShares.toString(), // 11,111

    // Instrument data
    instrument_type_data: JSON.stringify(instrumentDataToStore),

    // Cap tables
    founder_data: founderData ? JSON.stringify(founderData) : null,
    pre_money_cap_table: JSON.stringify(preMoneyCapTable),
    post_money_cap_table: JSON.stringify(postMoneyCapTable),

    // Status
    roundStatus: "COMPLETED",
    updated_at: new Date(),
  };

  // ==================== UPDATE DATABASE ====================
  try {
    await updateRoundRecordData(id, dbUpdateData);

    return {
      success: true,
      message: `Convertible Note round ${isUpdate ? "updated" : "created"} successfully`,
      data: dbUpdateData,
      roundId: id,
    };
  } catch (error) {
    console.error("❌ DATABASE ERROR:", error);
    return {
      success: false,
      error: error.message,
    };
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
exports.SendRecordRoundToinvestor = async (req, res) => {
  try {
    const {
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

    // Fetch entrepreneur name
    const [userRows] = await db
      .promise()
      .query("SELECT * FROM company WHERE id = ? LIMIT 1", [company_id]);

    const displayName = userRows.length
      ? `${userRows[0].company_name || ""}`.trim()
      : "Entrepreneur";

    const currentDate = new Date();
    const expiredAt = new Date();
    expiredAt.setDate(currentDate.getDate() + 30);

    for (const investor_id of selectedRecords) {
      // Fetch investor info including email, registration status, and unique_code
      const [investorRows] = await db
        .promise()
        .query(
          "SELECT first_name,last_name, email, is_register, unique_code FROM investor_information WHERE id = ?",
          [investor_id],
        );

      if (!investorRows.length) continue;

      const { email, first_name, last_name, is_register, unique_code } =
        investorRows[0];

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
            "INSERT INTO sharerecordround (created_by_role,created_by_id,company_id, investor_id, roundrecord_id, sent_date, created_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())",
            [
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
        // Determine URL based on registration
        const isRegistered = is_register === "Yes";
        const url =
          "https://capavate.com/investor/company/capital-round-list/" +
          company_id;

        // Send email using your template
        emailPromises.push(
          transporter.sendMail({
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
          }),
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
    SELECT roundrecord.*, sharerecordround.sent_date,sharerecordround.investor_id
    FROM sharerecordround
    JOIN roundrecord ON roundrecord.id = sharerecordround.roundrecord_id
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
      sharerecordround.signature_status,
      sharerecordround.termsChecked,
      sharerecordround.signature,
      sharerecordround.investor_id AS sharerecord_investor_id,
      sharerecordround.id AS sharerecordround_id,
      company.company_name,
      irc.id AS request_id,
      irc.investor_id AS request_investor_id,
      irc.shares AS requested_shares,
      irc.investment_amount
    FROM roundrecord
    JOIN company ON company.id = roundrecord.company_id
    JOIN sharerecordround ON sharerecordround.roundrecord_id = roundrecord.id
    LEFT JOIN investorrequest_company irc
      ON irc.roundrecord_id = roundrecord.id
      AND irc.request_confirm = 'Yes'
      AND irc.investor_id = ?
    WHERE roundrecord.id = ?
      AND sharerecordround.investor_id = ?;
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

// services/emailService.js

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
    SELECT roundrecord.*, company.year_registration FROM roundrecord JOIN company ON roundrecord.company_id = company.id WHERE roundrecord.company_id = ? AND roundrecord.id = ?;
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
// Controller: capitalRoundController.js
// Controller: capitalRoundController.js

// 🔹 Round 0 Cap Table Calculation (Incorporation)
// Controller: capitalRoundController.js - Round 0 के लिए सही implementation
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

function calculateRoundZeroCapTable(round) {
  let shareholders = [];
  let totalShares = 0;
  let totalValue = 0;
  let pricePerShare = 0;

  try {
    const founderData = safeJSONParse(round.founder_data); // assuming safeJSONParse

    if (
      !founderData ||
      !founderData.founders ||
      founderData.founders.length === 0
    ) {
      throw new Error("Empty or invalid founder data");
    }

    // Use dynamic pricePerShare from JSON
    pricePerShare = parseFloat(founderData.pricePerShare);
    if (isNaN(pricePerShare)) {
      throw new Error("Invalid pricePerShare in founder data");
    }

    shareholders = founderData.founders.map((founder) => {
      const shares = parseInt(founder.shares) || 0;
      return {
        firstName: founder.firstName,
        lastName: founder.lastName,
        email: founder.email || "-",
        phone: founder.phone || "-",
        type: "Founder",
        round: "Round 0",
        shareClass: founder.shareClass || "Class A",
        customShareType: founder.customShareType || "",
        customShareClass: founder.customShareClass || "",
        votingRights: founder.voting || "voting",
        shares: shares,
        ownership: 0, // will calculate later
        value: shares * pricePerShare,
        round_type: round.round_type,
        instrumentType: round.instrumentType,
        shareType: founder.shareType || "common",
      };
    });

    totalShares = shareholders.reduce((sum, s) => sum + s.shares, 0);
    totalValue = shareholders.reduce((sum, s) => sum + s.value, 0);

    shareholders.forEach((sh) => {
      sh.ownership = totalShares > 0 ? (sh.shares / totalShares) * 100 : 0;
    });
  } catch (error) {
    console.error("Error parsing Round 0 data:", error);
    return { error: error.message };
  }

  const chartData = {
    labels: shareholders.map((sh, idx) =>
      sh.firstName || sh.lastName
        ? `${sh.firstName} ${sh.lastName}`.trim()
        : `Founder ${idx + 1}`,
    ),
    datasets: [
      {
        label: "Ownership %",
        data: shareholders.map((sh) => sh.ownership),
        backgroundColor: [
          "#FF6384",
          "#36A2EB",
          "#FFCE56",
          "#4BC0C0",
          "#9966FF",
          "#FF9F40",
          "#FF6384",
          "#C9CBCF",
        ],
        borderColor: [
          "#FF6384",
          "#36A2EB",
          "#FFCE56",
          "#4BC0C0",
          "#9966FF",
          "#FF9F40",
          "#FF6384",
          "#C9CBCF",
        ],
        borderWidth: 1,
      },
    ],
  };

  return {
    currency: round.currency || "USD",
    shareClassType: round.shareClassType,

    roundType: round.nameOfRound || "Round 0 - Incorporation",
    round_type: round.round_type,
    instrumentType: round.instrumentType,
    shareClass: round.shareClassType || "Common Shares",
    currency: round.currency || "USD",
    totalShares,
    totalValue,
    shareholders,
    chartData,
    calculations: {
      totalSharesIssued: totalShares,
      sharePrice: pricePerShare,
      totalValue: totalValue,
      founderCount: shareholders.length,
    },
    isRoundZero: true,
  };
}

exports.getRoundCapTableSingleRecord = (req, res) => {
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
        console.log(currentRound);
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

            preMoneyCapTable = calculateCPAVATEPreMoneyCapTableInvestment(
              allRounds,
              currentRound,
              conversionData,
            );

            postMoneyCapTable = calculateCPAVATEPostMoneyCapTableInvestment(
              allRounds,
              currentRound,
              conversionData,
            );
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
function calculateCPAVATEPreMoneyCapTablePreferred(
  allRounds,
  currentRound,
  conversionData = [],
) {
  const capTable = [];
  let totalShares = 0;
  const preMoneyValuation = parseFloat(currentRound.pre_money) || 0;

  // Check if current round is Round 0
  const isCurrentRoundRound0 = currentRound.round_type === "Round 0";

  // Get all rounds BEFORE current round
  const previousRounds = allRounds.filter(
    (round) => parseInt(round.id) < parseInt(currentRound.id),
  );

  // ========== STEP 1: COLLECT ALL SHARES FROM PREVIOUS ROUNDS ==========
  for (const round of previousRounds) {
    // ========== ROUND 0 - FOUNDERS ==========
    if (round.round_type === "Round 0") {
      if (
        round.founder_data?.founders &&
        Array.isArray(round.founder_data.founders)
      ) {
        round.founder_data.founders.forEach((founder, idx) => {
          const shares = parseFloat(founder.shares) || 0;
          const firstName = founder.firstName || "";
          const lastName = founder.lastName || "";
          const founderName =
            `${firstName} ${lastName}`.trim() || `Founder ${idx + 1}`;

          capTable.push({
            type: "founder",
            name: founderName,
            shares: shares,
            percentage: "0.00",
            round_id: round.id,
            round_name: round.nameOfRound || "Round 0",
            investment: 0,
            share_price: parseFloat(round.share_price) || 0.01,
            value: 0,
            founder_id: idx + 1,
            founder_code: `F${idx + 1}`,
            email: founder.email || "",
            phone: founder.phone || "",
            share_type: founder.shareType || "common",
            voting: founder.voting || "voting",
            original_share_price: parseFloat(round.share_price) || 0.01,
            original_value: shares * (parseFloat(round.share_price) || 0.01),
            pre_money_display_value: 0,
            pre_money_display_share_price: 0,
            instrument_type: "Common Stock", // Round 0 is always Common Stock
          });

          totalShares += shares;
        });
      }
    }

    // ========== SAFE ROUNDS (PENDING OR CONVERTED) ==========
    else if (round.instrumentType === "Safe") {
      // Check if this SAFE was converted in a previous round
      const previousConversions = conversionData.filter(
        (conv) =>
          parseInt(conv.original_round_id) === parseInt(round.id) &&
          parseInt(conv.conversion_round_id) < parseInt(currentRound.id),
      );

      if (previousConversions.length > 0) {
        // CONVERTED SAFE - Add as investors
        previousConversions.forEach((conversion) => {
          const shares = parseFloat(conversion.converted_shares) || 0;
          if (shares > 0) {
            capTable.push({
              type: "investor",
              name: conversion.investor_name || "SAFE Investor",
              shares: shares,
              percentage: "0.00",
              round_id: conversion.conversion_round_id,
              round_name: `Converted from ${round.nameOfRound || `Round ${round.id}`}`,
              investment:
                parseFloat(conversion.original_investment_amount) || 0,
              share_price: parseFloat(conversion.conversion_price) || 0,
              value: 0,
              is_converted: true,
              instrument_type: "SAFE",
              pre_money_display_value: 0,
              pre_money_display_share_price: 0,
            });
            totalShares += shares;
          }
        });
      } else {
        // PENDING SAFE - Add to pending
        const investment = parseFloat(round.roundsize) || 0;
        if (investment > 0) {
          let instrumentData = {};
          try {
            instrumentData = round.instrument_type_data
              ? typeof round.instrument_type_data === "string"
                ? JSON.parse(round.instrument_type_data)
                : round.instrument_type_data
              : {};
          } catch (e) {}

          capTable.push({
            type: "pending",
            name: `SAFE - ${round.nameOfRound || `Round ${round.id}`}`,
            shares: 0,
            percentage: "0.00",
            round_id: round.id,
            round_name: round.nameOfRound || `Round ${round.id}`,
            investment: investment,
            share_price: null,
            value: 0,
            is_pending: true,
            instrument_type: "SAFE",
            discount_rate: parseFloat(
              instrumentData.discountRate || instrumentData.discount_rate || 0,
            ),
            valuation_cap: parseFloat(
              instrumentData.valuationCap || instrumentData.valuation_cap || 0,
            ),
            pre_money_display_value: 0,
            pre_money_display_share_price: 0,
          });
        }
      }
    }

    // ========== CONVERTIBLE NOTE ROUNDS (PENDING OR CONVERTED) ==========
    else if (round.instrumentType === "Convertible Note") {
      // Check if this Note was converted in a previous round
      const previousConversions = conversionData.filter(
        (conv) =>
          parseInt(conv.original_round_id) === parseInt(round.id) &&
          parseInt(conv.conversion_round_id) < parseInt(currentRound.id),
      );

      if (previousConversions.length > 0) {
        // CONVERTED NOTE - Add as investors
        previousConversions.forEach((conversion) => {
          const shares = parseFloat(conversion.converted_shares) || 0;
          if (shares > 0) {
            capTable.push({
              type: "investor",
              name: conversion.investor_name || "Convertible Note Investor",
              shares: shares,
              percentage: "0.00",
              round_id: conversion.conversion_round_id,
              round_name: `Converted from ${round.nameOfRound || `Round ${round.id}`}`,
              investment:
                parseFloat(conversion.original_investment_amount) || 0,
              share_price: parseFloat(conversion.conversion_price) || 0,
              value: 0,
              is_converted: true,
              instrument_type: "Convertible Note",
              pre_money_display_value: 0,
              pre_money_display_share_price: 0,
            });
            totalShares += shares;
          }
        });
      } else {
        // PENDING NOTE - Add to pending
        const investment = parseFloat(round.roundsize) || 0;
        if (investment > 0) {
          let instrumentData = {};
          try {
            instrumentData = round.instrument_type_data
              ? typeof round.instrument_type_data === "string"
                ? JSON.parse(round.instrument_type_data)
                : round.instrument_type_data
              : {};
          } catch (e) {}

          capTable.push({
            type: "pending",
            name: `Convertible Note - ${round.nameOfRound || `Round ${round.id}`}`,
            shares: 0,
            percentage: "0.00",
            round_id: round.id,
            round_name: round.nameOfRound || `Round ${round.id}`,
            investment: investment,
            share_price: null,
            value: 0,
            is_pending: true,
            instrument_type: "Convertible Note",
            discount_rate: parseFloat(
              instrumentData.discountRate_note ||
                instrumentData.discount_rate_note ||
                0,
            ),
            valuation_cap: parseFloat(
              instrumentData.valuationCap_note ||
                instrumentData.valuation_cap_note ||
                0,
            ),
            interest_rate: parseFloat(
              instrumentData.interestRate_note ||
                instrumentData.interest_rate_note ||
                8,
            ),
            pre_money_display_value: 0,
            pre_money_display_share_price: 0,
          });
        }
      }
    }

    // ========== COMMON STOCK ROUNDS ==========
    else if (round.instrumentType === "Common Stock") {
      const issuedShares = parseFloat(round.issuedshares) || 0;
      const optionPoolShares = parseFloat(round.option_pool_shares) || 0;
      const investorShares = issuedShares - optionPoolShares;
      const sharePrice = parseFloat(round.share_price) || 0;

      // Add investors from this round
      if (investorShares > 0) {
        capTable.push({
          type: "investor",
          name: `${round.nameOfRound || `Round ${round.id}`} Investors`,
          shares: investorShares,
          percentage: "0.00",
          round_id: round.id,
          round_name: round.nameOfRound || `Round ${round.id}`,
          investment: parseFloat(round.roundsize) || 0,
          share_price: sharePrice,
          value: 0,
          is_investor: true,
          instrument_type: "Common Stock",
          pre_money_display_value: 0,
          pre_money_display_share_price: 0,
        });
        totalShares += investorShares;
      }
    }

    // ========== PREFERRED EQUITY ROUNDS ==========
    else if (round.instrumentType === "Preferred Equity") {
      const issuedShares = parseFloat(round.issuedshares) || 0;
      const optionPoolShares = parseFloat(round.option_pool_shares) || 0;
      const investorShares = issuedShares - optionPoolShares;
      const sharePrice = parseFloat(round.share_price) || 0;

      // Add investors from this round
      if (investorShares > 0) {
        capTable.push({
          type: "investor",
          name: `${round.nameOfRound || `Round ${round.id}`} Investors`,
          shares: investorShares,
          percentage: "0.00",
          round_id: round.id,
          round_name: round.nameOfRound || `Round ${round.id}`,
          investment: parseFloat(round.roundsize) || 0,
          share_price: sharePrice,
          value: 0,
          is_investor: true,
          instrument_type: "Preferred Equity",
          pre_money_display_value: 0,
          pre_money_display_share_price: 0,
        });
        totalShares += investorShares;
      }
    }

    // ========== OPTION POOL FROM ANY ROUND ==========
    // Check for option pool shares in ANY round type
    if (round.option_pool_shares && parseFloat(round.option_pool_shares) > 0) {
      // Skip current round's option pool
      if (parseInt(round.id) === parseInt(currentRound.id)) {
        continue;
      }

      const optionPoolShares = parseFloat(round.option_pool_shares);

      // Check if already added
      const existingOptionPool = capTable.find(
        (item) =>
          item.type === "option_pool" && item.round_id === parseInt(round.id),
      );

      if (!existingOptionPool) {
        // Get share price for valuation (if available)
        const sharePrice = parseFloat(round.share_price) || 0;

        capTable.push({
          type: "option_pool",
          name: `${round.nameOfRound || `Round ${round.id}`} Option Pool`,
          shares: optionPoolShares,
          percentage: "0.00",
          round_id: round.id,
          round_name: round.nameOfRound || `Round ${round.id}`,
          investment: 0,
          share_price: sharePrice,
          value: 0,
          is_option_pool: true,
          is_new_pool: false,
          pre_money_display_value: 0,
          pre_money_display_share_price: 0,
        });

        totalShares += optionPoolShares;
      }
    }
  }

  // ========== STEP 2: CALCULATE PERCENTAGES ==========
  if (totalShares > 0) {
    capTable.forEach((item) => {
      if (item.type !== "pending") {
        item.percentage = ((item.shares / totalShares) * 100).toFixed(2);
      }
    });
  }

  // ========== STEP 3: CALCULATE PRE-MONEY DISPLAY VALUES ==========
  if (!isCurrentRoundRound0 && preMoneyValuation > 0 && totalShares > 0) {
    capTable.forEach((item) => {
      if (item.type !== "pending") {
        item.pre_money_display_value =
          (parseFloat(item.percentage) / 100) * preMoneyValuation;
        item.pre_money_display_share_price = preMoneyValuation / totalShares;
        item.display_value = item.pre_money_display_value;
        item.value = item.pre_money_display_value;
      }
    });
  }

  // ========== STEP 4: CALCULATE TOTALS ==========
  const totalFounders = capTable
    .filter((item) => item.type === "founder")
    .reduce((sum, item) => sum + item.shares, 0);

  const totalOptionPool = capTable
    .filter((item) => item.type === "option_pool")
    .reduce((sum, item) => sum + item.shares, 0);

  const totalInvestors = capTable
    .filter((item) => item.type === "investor")
    .reduce((sum, item) => sum + item.shares, 0);

  const totalPending = capTable
    .filter((item) => item.type === "pending")
    .reduce((sum, item) => sum + (item.investment || 0), 0);

  // Calculate original Round 0 value
  const originalRound0Value = capTable
    .filter((item) => item.type === "founder")
    .reduce((sum, item) => sum + (item.original_value || 0), 0);

  const totals = {
    total_shares: totalShares,
    total_founders: totalFounders,
    total_investors: totalInvestors,
    total_option_pool: totalOptionPool,
    total_pending: totalPending,
    original_round_0_value: originalRound0Value,
    total_value: preMoneyValuation,
    pre_money_valuation: preMoneyValuation,
    display_share_price: totalShares > 0 ? preMoneyValuation / totalShares : 0,
    is_round_0: isCurrentRoundRound0,
    pre_money_share_price:
      totalShares > 0 ? preMoneyValuation / totalShares : 0,
  };

  // ========== STEP 5: SORT ITEMS FOR DISPLAY ==========
  const sortedItems = [
    ...capTable
      .filter((item) => item.type === "founder")
      .sort((a, b) =>
        (a.founder_code || "").localeCompare(b.founder_code || ""),
      ),
    ...capTable.filter((item) => item.type === "option_pool"),
    ...capTable.filter((item) => item.type === "investor"),
    ...capTable.filter((item) => item.type === "pending"),
  ];

  // Debug log

  return {
    items: sortedItems,
    totals,
  };
}

// ============================================
function calculateCPAVATEPreMoneyCapTableInvestment(
  allRounds,
  currentRound,
  conversionData = [],
) {
  const capTable = [];
  let totalShares = 0;
  const preMoneyValuation = parseFloat(currentRound.pre_money) || 0;

  // Check if current round is Round 0
  const isCurrentRoundRound0 = currentRound.round_type === "Round 0";

  // Get the LATEST previous round (not all previous rounds)
  const previousRounds = allRounds.filter(
    (round) => parseInt(round.id) < parseInt(currentRound.id),
  );

  // Sort to get the most recent previous round
  const sortedPreviousRounds = [...previousRounds].sort((a, b) => b.id - a.id);
  const latestPreviousRound = sortedPreviousRounds[0];

  // ========== GET FOUNDER SHARES FROM ROUND 0 ==========
  let founderShares = 0;
  let founderList = [];
  const round0 = allRounds.find((r) => r.round_type === "Round 0");

  if (round0 && round0.founder_data) {
    try {
      const founderData =
        typeof round0.founder_data === "string"
          ? JSON.parse(round0.founder_data)
          : round0.founder_data;

      if (founderData.founders && Array.isArray(founderData.founders)) {
        founderData.founders.forEach((founder, idx) => {
          const shares = parseFloat(founder.shares) || 0;
          founderShares += shares;
          founderList.push({
            name:
              `${founder.firstName || ""} ${founder.lastName || ""}`.trim() ||
              `Founder ${idx + 1}`,
            shares: shares,
            email: founder.email || "",
            founder_code: `F${idx + 1}`,
            share_type: founder.shareType || "common",
            voting: founder.voting || "voting",
            round_id: round0.id,
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
      round_id: founder.round_id,
      round_name: "Round 0",
      founder_code: founder.founder_code,
      email: founder.email,
      share_type: founder.share_type,
      voting: founder.voting,
      original_value: founder.shares * 0.01,
      pre_money_display_value: 0,
    });
    totalShares += founder.shares;
  });
  // == ======== GET DATA FROM LATEST PREVIOUS ROUND ==========
  if (latestPreviousRound) {
    const round = latestPreviousRound;

    // Get total investors from latest round's post-money table
    let totalInvestors = 0;
    let totalOptionPool = 0;

    if (round.post_money_cap_table) {
      try {
        const postTable =
          typeof round.post_money_cap_table === "string"
            ? JSON.parse(round.post_money_cap_table)
            : round.post_money_cap_table;

        // Check if postTable has items array (most detailed)
        if (postTable.items && Array.isArray(postTable.items)) {
          // Extract all investors from items
          postTable.items.forEach((item, idx) => {
            if (item.type === "investor") {
              // Get investor name
              let investorName = item.name;

              // If name not available, try to construct from investor_details
              if (!investorName && item.investor_details) {
                investorName = [
                  item.investor_details.firstName,
                  item.investor_details.lastName,
                ]
                  .filter(Boolean)
                  .join(" ");
              }

              // Determine investor type for display
              let displayName = investorName || `Investor ${idx + 1}`;

              // Add individual investor to capTable
              capTable.push({
                type: "investor",
                name: displayName,
                investor_details: item.investor_details || {
                  firstName: "",
                  lastName: "",
                  email: item.email || "",
                  phone: item.phone || "",
                },
                email: item.email || item.investor_details?.email || "",
                phone: item.phone || item.investor_details?.phone || "",
                shares: item.shares || 0,
                percentage: "0.00",
                shareClassType: item.share_class_type || round.shareClassType,
                share_class_type: item.share_class_type || round.shareClassType,
                instrument_type: item.instrument_type || round.instrumentType,
                round_id: round.id,
                round_name: round.nameOfRound || `Round ${round.id}`,
                investment: item.investment || 0,
                share_price: item.share_price || 0,
                investor_index: idx + 1,
                is_previous: true, // Mark as previous round investor
                pre_money_display_value: 0,
              });

              totalInvestors += item.shares || 0;
            }
          });
        }
        // Fallback to grouped data if items array doesn't exist
        else {
          // Handle previous_investors (Seed Investors)
          if (postTable.previous_investors) {
            if (
              postTable.previous_investors.items &&
              Array.isArray(postTable.previous_investors.items)
            ) {
              // Individual investors within previous_investors
              postTable.previous_investors.items.forEach((inv, idx) => {
                // Get investor name
                let investorName = inv.name;
                if (!investorName && inv.investor_details) {
                  investorName = [
                    inv.investor_details.firstName,
                    inv.investor_details.lastName,
                  ]
                    .filter(Boolean)
                    .join(" ");
                }

                capTable.push({
                  type: "investor",
                  name: investorName || `Seed Investor ${idx + 1}`,
                  investor_details: inv.investor_details || {
                    firstName: "",
                    lastName: "",
                    email: inv.email || "",
                    phone: inv.phone || "",
                  },
                  email: inv.email || "",
                  phone: inv.phone || "",
                  shares: inv.shares || 0,
                  percentage: "0.00",
                  shareClassType: round.shareClassType,
                  share_class_type: round.shareClassType,
                  round_id: round.id,
                  round_name: round.nameOfRound || `Round ${round.id}`,
                  investment: inv.investment || 0,
                  share_price: inv.share_price || 0,
                  investor_index: idx + 1,
                  is_previous: true,
                  pre_money_display_value: 0,
                });
                totalInvestors += inv.shares || 0;
              });
            } else {
              // Grouped fallback - USE ROUND NAME
              const investorName =
                round.nameOfRound === "Seed Round"
                  ? "Seed Investors"
                  : `${round.shareClassType || "Previous"} Investors`;

              capTable.push({
                type: "investor",
                name: investorName,
                shares: postTable.previous_investors.shares || 0,
                percentage: "0.00",
                round_id: round.id,
                round_name: round.nameOfRound || `Round ${round.id}`,
                pre_money_display_value: 0,
                is_grouped: true,
              });
              totalInvestors += postTable.previous_investors.shares || 0;
            }
          }

          // Handle investors (new investors from that round) - SERIES INVESTORS
          if (postTable.investors) {
            if (
              postTable.investors.items &&
              Array.isArray(postTable.investors.items)
            ) {
              // Individual investors
              postTable.investors.items.forEach((inv, idx) => {
                // Get investor name
                let investorName = inv.name;
                if (!investorName && inv.investor_details) {
                  investorName = [
                    inv.investor_details.firstName,
                    inv.investor_details.lastName,
                  ]
                    .filter(Boolean)
                    .join(" ");
                }

                // Use the actual investor name
                capTable.push({
                  type: "investor",
                  name:
                    investorName ||
                    `${round.shareClassType || "Series"} Investor ${idx + 1}`,
                  investor_details: inv.investor_details || {
                    firstName: "",
                    lastName: "",
                    email: inv.email || "",
                    phone: inv.phone || "",
                  },
                  email: inv.email || "",
                  phone: inv.phone || "",
                  shares: inv.shares || 0,
                  percentage: "0.00",
                  shareClassType: inv.share_class_type || round.shareClassType,
                  share_class_type:
                    inv.share_class_type || round.shareClassType,
                  instrument_type: inv.instrument_type || round.instrumentType,
                  round_id: round.id,
                  round_name: round.nameOfRound || `Round ${round.id}`,
                  investment: inv.investment || 0,
                  share_price: inv.share_price || 0,
                  investor_index: idx + 100, // Offset to avoid conflicts
                  is_previous: true,
                  pre_money_display_value: 0,
                });
                totalInvestors += inv.shares || 0;
              });
            } else {
              // Grouped fallback - USE ROUND NAME AND SHARE CLASS
              const investorName = `${round.shareClassType || "Series"} Investors`;

              capTable.push({
                type: "investor",
                name: investorName,
                shares: postTable.investors.shares || 0,
                percentage: "0.00",
                round_id: round.id,
                round_name: round.nameOfRound || `Round ${round.id}`,
                pre_money_display_value: 0,
                is_grouped: true,
              });
              totalInvestors += postTable.investors.shares || 0;
            }
          }

          // Handle converted_investors
          if (postTable.converted_investors) {
            if (
              postTable.converted_investors.items &&
              Array.isArray(postTable.converted_investors.items)
            ) {
              // Individual converted investors
              postTable.converted_investors.items.forEach((inv, idx) => {
                // Get investor name
                let investorName = inv.name;
                if (!investorName && inv.investor_details) {
                  investorName = [
                    inv.investor_details.firstName,
                    inv.investor_details.lastName,
                  ]
                    .filter(Boolean)
                    .join(" ");
                }

                capTable.push({
                  type: "investor",
                  name: investorName || `Converted Investor ${idx + 1}`,
                  investor_details: inv.investor_details || {
                    firstName: "",
                    lastName: "",
                    email: inv.email || "",
                    phone: inv.phone || "",
                  },
                  email: inv.email || "",
                  phone: inv.phone || "",
                  shares: inv.shares || 0,
                  percentage: "0.00",
                  shareClassType: round.shareClassType,
                  share_class_type: round.shareClassType,
                  round_id: round.id,
                  round_name: round.nameOfRound || `Round ${round.id}`,
                  investment: inv.investment || 0,
                  share_price: inv.share_price || 0,
                  investor_index: idx + 200, // Offset
                  is_previous: true,
                  is_converted: true,
                  pre_money_display_value: 0,
                });
                totalInvestors += inv.shares || 0;
              });
            } else {
              // Grouped fallback
              capTable.push({
                type: "investor",
                name: "Converted Investors",
                shares: postTable.converted_investors.shares || 0,
                percentage: "0.00",
                round_id: round.id,
                round_name: round.nameOfRound || `Round ${round.id}`,
                pre_money_display_value: 0,
                is_grouped: true,
              });
              totalInvestors += postTable.converted_investors.shares || 0;
            }
          }
        }

        // Get TOTAL option pool (not just new)
        if (postTable.option_pool) {
          totalOptionPool = postTable.option_pool.shares || 0;
        }
      } catch (e) {
        console.error("Error parsing post_money_cap_table:", e);
      }
    }

    // Add option pool (TOTAL, not per round)
    if (totalOptionPool > 0) {
      capTable.push({
        type: "option_pool",
        name: "Employee Option Pool",
        shares: totalOptionPool,
        percentage: "0.00",
        round_id: round.id,
        round_name: round.nameOfRound || `Round ${round.id}`,
        is_option_pool: true,
        pre_money_display_value: 0,
      });
      totalShares += totalOptionPool;
    }

    // Add investors to total shares
    totalShares += totalInvestors;
  }

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
        item.display_value = item.pre_money_display_value;
        item.value = item.pre_money_display_value;
        item.pre_money_display_share_price = preMoneyValuation / totalShares;
      }
    });
  }

  // ========== CALCULATE TOTALS ==========
  const totalFounders = capTable
    .filter((item) => item.type === "founder")
    .reduce((sum, item) => sum + (item.shares || 0), 0);

  const totalInvestors = capTable
    .filter((item) => item.type === "investor")
    .reduce((sum, item) => sum + (item.shares || 0), 0);

  const totalOptionPool = capTable
    .filter((item) => item.type === "option_pool")
    .reduce((sum, item) => sum + (item.shares || 0), 0);

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

  // ========== SORT ITEMS ==========
  const sortedItems = [
    ...capTable
      .filter((item) => item.type === "founder")
      .sort((a, b) =>
        (a.founder_code || "").localeCompare(b.founder_code || ""),
      ),
    ...capTable.filter((item) => item.type === "investor"),
    ...capTable.filter((item) => item.type === "option_pool"),
    ...capTable.filter((item) => item.type === "pending"),
  ];

  return {
    items: sortedItems,
    totals,
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

        console.log(
          `✅ Added ${activeFounders.length} founders from Round 0 with total shares: ${founderShares}`,
        );
      }
    } catch (e) {
      console.error("Error parsing founder data:", e);
    }
  } else {
    console.log("⚠️ No Round 0 founder data found");
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

      // OPTION POOL FROM PREVIOUS ROUND
      const optionPoolShares = parseFloat(round.option_pool_shares) || 0;
      if (optionPoolShares > 0) {
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

      // OPTION POOL SHARES
      if (optionPoolShares > 0) {
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
  }

  // ========== ADD CURRENT ROUND'S OPTION POOL ==========
  const currentRoundOptionPool =
    parseFloat(currentRound.option_pool_shares) || 0;
  if (currentRoundOptionPool > 0) {
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
  }

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
    ...capTable.filter((item) => item.type === "investor"),
    ...capTable.filter((item) => item.type === "option_pool"),
    ...capTable.filter((item) => item.type === "pending"),
  ];

  console.log("📊 PRE-MONEY TABLE SUMMARY:", {
    totalShares,
    founders: totalFounders,
    investors: totalInvestors,
    optionPool: totalOptionPool,
    founderItems: sortedItems.filter((i) => i.type === "founder").length,
  });

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

  // ========== ✅ CORRECT VALUE CALCULATION ==========
  // postCapTable.forEach((item) => {
  //   if (finalTotalShares > 0 && item.type !== "pending") {
  //     // Calculate percentage
  //     item.percentage = ((item.shares / finalTotalShares) * 100).toFixed(2);

  //     // ✅ FIX 2: Different calculation for different types
  //     if (item.type === "investor" && item.is_new_investment) {
  //       // New investors - use exact investment amount
  //       item.value = item.investment || investment;
  //     } else if (item.type === "investor" && item.is_converted) {
  //       // Converted investors - calculate from shares
  //       item.value = Math.round(
  //         item.shares * (item.conversion_price || sharePrice),
  //       );
  //     } else {
  //       // Everyone else - calculate from post-money valuation
  //       item.value = Math.round(
  //         (item.shares / finalTotalShares) * postMoneyValuation,
  //       );
  //     }
  //   }
  // });
  // In the final value calculation section
  postCapTable.forEach((item) => {
    if (finalTotalShares > 0 && item.type !== "pending") {
      // Calculate percentage
      item.percentage = ((item.shares / finalTotalShares) * 100).toFixed(2);

      // Calculate value based on investor type
      if (item.type === "investor" && item.is_new_investment) {
        // For new investors, use exact investment amount
        item.value = item.investment;
      } else {
        // For others, calculate from post-money valuation
        item.value = Math.round(
          (item.shares / finalTotalShares) * postMoneyValuation,
        );
      }
    }
  });
  // ========== CALCULATE TOTALS ==========
  const totalFounders = postCapTable
    .filter((item) => item.type === "founder")
    .reduce((sum, item) => sum + item.shares, 0);

  const totalInvestors = postCapTable
    .filter((item) => item.type === "investor")
    .reduce((sum, item) => sum + item.shares, 0);

  const totalOptionPool = postCapTable
    .filter((item) => item.type === "option_pool")
    .reduce((sum, item) => sum + item.shares, 0);

  const totals = {
    total_shares: finalTotalShares,
    total_new_shares: totalNewShares,
    total_founders: totalFounders,
    total_investors: totalInvestors,
    total_option_pool: totalOptionPool,
    total_value: Math.round(postMoneyValuation),
    post_money_valuation: Math.round(postMoneyValuation),
    pre_money_valuation: preMoneyValuation,
    investment: investment,
    pre_money_share_price: sharePrice,
    post_money_share_price:
      finalTotalShares > 0 ? postMoneyValuation / finalTotalShares : 0,
  };

  // ========== SORT ITEMS FOR DISPLAY ==========
  const sortedItems = [
    ...postCapTable
      .filter((item) => item.type === "founder")
      .sort((a, b) =>
        (a.founder_code || "").localeCompare(b.founder_code || ""),
      ),
    ...postCapTable.filter(
      (item) => item.type === "investor" && item.is_converted,
    ),
    ...postCapTable.filter(
      (item) => item.type === "investor" && item.is_new_investment,
    ),
    ...postCapTable.filter((item) => item.type === "option_pool"),
    ...postCapTable.filter((item) => item.type === "pending"),
  ];

  console.log(sortedItems);

  return {
    items: sortedItems,
    totals,
  };
}
function calculateCPAVATEPostMoneyCapTableInvestment(
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

  // ========== AUTO-DETECT ROUND TYPE ==========
  const isRound0 = currentRound.round_type === "Round 0";

  // Check if it's a Series A round based on multiple factors
  const isSeriesAFromData =
    currentRound.pre_money > 0 || currentRound.investorPostMoney !== 0;

  // Determine round type
  const isCommonStockRound =
    !isRound0 &&
    currentRound.instrumentType === "Common Stock" &&
    !isSeriesAFromData; // Not Series A

  const isPreferredEquityRound =
    !isRound0 &&
    (currentRound.instrumentType === "Preferred Equity" || isSeriesAFromData); // Auto-detect as Series A

  const isSafeRound = !isRound0 && currentRound.instrumentType === "Safe";
  const isConvertibleNoteRound =
    !isRound0 && currentRound.instrumentType === "Convertible Note";
  const isPricedRound = isCommonStockRound || isPreferredEquityRound;

  // ========== STEP 1: GET PRE-MONEY TABLE ==========
  const preMoneyTable = calculateCPAVATEPreMoneyCapTableInvestment(
    allRounds,
    currentRound,
    conversionData,
  );

  // ========== STEP 2: EXTRACT DATA FROM PRE-MONEY ==========
  let founders = [];
  let seedInvestors = [];
  let existingOptionShares = 0;
  let pendingInstruments = [];

  preMoneyTable.items.forEach((item) => {
    if (item.type === "founder") {
      founders.push(item);
      totalShares += item.shares;
    } else if (item.type === "investor") {
      seedInvestors.push(item);
      totalShares += item.shares;
    } else if (item.type === "option_pool") {
      existingOptionShares += item.shares;
      totalShares += item.shares;
    } else if (item.type === "pending") {
      pendingInstruments.push(item);
    }
  });

  const foundersTotal = founders.reduce((s, f) => s + f.shares, 0);
  const seedTotal = seedInvestors.reduce((s, i) => s + i.shares, 0);

  // ========== STEP 3: GET CURRENT ROUND DATA ==========
  const currentRoundId = parseInt(currentRound.id);
  const conversionsInThisRound = conversionData.filter(
    (conv) => parseInt(conv.conversion_round_id) === currentRoundId,
  );

  // ========== STEP 4: HANDLE SAFE ROUND ==========
  if (isSafeRound) {
    const optionPoolShares = parseFloat(currentRound.option_pool_shares) || 0;
    if (optionPoolShares > 0) {
      postCapTable.push({
        type: "option_pool",
        name: `${currentRound.nameOfRound} Option Pool`,
        shares: optionPoolShares,
        new_shares: optionPoolShares,
        total: optionPoolShares,
        percentage: "0.00",
        round_id: currentRoundId,
        round_name: currentRound.nameOfRound,
        is_option_pool: true,
        is_new_pool: true,
        value: 0,
      });
      totalShares += optionPoolShares;
      totalNewShares += optionPoolShares;
    }

    if (investment > 0) {
      let instrumentData = {};
      try {
        instrumentData = currentRound.instrument_type_data
          ? typeof currentRound.instrument_type_data === "string"
            ? JSON.parse(currentRound.instrument_type_data)
            : currentRound.instrument_type_data
          : {};
      } catch (e) {}

      postCapTable.push({
        type: "pending",
        name: `SAFE - ${currentRound.nameOfRound}`,
        shares: 0,
        new_shares: 0,
        total: 0,
        percentage: "0.00",
        round_id: currentRoundId,
        round_name: currentRound.nameOfRound,
        investment: investment,
        share_price: null,
        value: 0,
        is_pending: true,
        instrument_type: "SAFE",
        discount_rate: parseFloat(
          instrumentData.discountRate || instrumentData.discount_rate || 20,
        ),
        valuation_cap: parseFloat(
          instrumentData.valuationCap || instrumentData.valuation_cap || 0,
        ),
      });
    }
  }

  // ========== STEP 5: HANDLE CONVERTIBLE NOTE ROUND ==========
  else if (isConvertibleNoteRound) {
    const optionPoolShares = parseFloat(currentRound.option_pool_shares) || 0;
    if (optionPoolShares > 0) {
      postCapTable.push({
        type: "option_pool",
        name: `${currentRound.nameOfRound} Option Pool`,
        shares: optionPoolShares,
        new_shares: optionPoolShares,
        total: optionPoolShares,
        percentage: "0.00",
        round_id: currentRoundId,
        round_name: currentRound.nameOfRound,
        is_option_pool: true,
        is_new_pool: true,
        value: 0,
      });
      totalShares += optionPoolShares;
      totalNewShares += optionPoolShares;
    }

    if (investment > 0) {
      let instrumentData = {};
      try {
        instrumentData = currentRound.instrument_type_data
          ? typeof currentRound.instrument_type_data === "string"
            ? JSON.parse(currentRound.instrument_type_data)
            : currentRound.instrument_type_data
          : {};
      } catch (e) {}

      postCapTable.push({
        type: "pending",
        name: `Convertible Note - ${currentRound.nameOfRound}`,
        shares: 0,
        new_shares: 0,
        total: 0,
        percentage: "0.00",
        round_id: currentRoundId,
        round_name: currentRound.nameOfRound,
        investment: investment,
        share_price: null,
        value: 0,
        is_pending: true,
        instrument_type: "Convertible Note",
        discount_rate: parseFloat(
          instrumentData.discountRate_note ||
            instrumentData.discount_rate_note ||
            0,
        ),
        valuation_cap: parseFloat(
          instrumentData.valuationCap_note ||
            instrumentData.valuation_cap_note ||
            0,
        ),
        interest_rate: parseFloat(
          instrumentData.interestRate_note ||
            instrumentData.interest_rate_note ||
            0,
        ),
      });
    }
  }

  // ========== STEP 6: HANDLE PRICED ROUNDS ==========
  else if (isPricedRound) {
    let convertedShares = 0;
    conversionsInThisRound.forEach((conv) => {
      convertedShares += parseFloat(conv.converted_shares) || 0;
    });

    if (isCommonStockRound) {
      // ========== COMMON STOCK ROUND ==========

      sharePrice = preMoneyValuation / totalShares;
      newInvestorShares = Math.round(investment / sharePrice);

      const targetOptionPercent =
        parseFloat(currentRound.option_pool_percentage) / 100 || 0;

      if (targetOptionPercent > 0) {
        const totalAfterInvestors = totalShares + newInvestorShares;
        const targetTotalShares = Math.round(
          totalAfterInvestors / (1 - targetOptionPercent),
        );
        newOptionShares = targetTotalShares - totalAfterInvestors;
        totalShares = targetTotalShares;
      } else {
        totalShares = totalShares + newInvestorShares;
      }
    } else if (isPreferredEquityRound) {
      // ========== PREFERRED EQUITY (SERIES A) ROUND ==========

      // Total existing shares (founders + seed investors)
      const totalExistingShares = foundersTotal + seedTotal;

      // Series A ownership %
      const seriesAOwnership = investment / postMoneyValuation;

      // Target option pool %
      const targetOptionPercent =
        parseFloat(currentRound.option_pool_percentage) / 100 || 0.2;

      // Existing shareholders ownership after
      const existingOwnershipAfter = 1 - seriesAOwnership - targetOptionPercent;

      // Total post shares - USING CORRECT FORMULA
      totalShares = Math.round(totalExistingShares / existingOwnershipAfter);

      // New option shares
      const targetTotalOptionShares = Math.round(
        totalShares * targetOptionPercent,
      );
      newOptionShares = Math.max(
        0,
        targetTotalOptionShares - existingOptionShares,
      );

      // Series A investor shares
      const totalNewShares =
        totalShares -
        (totalExistingShares + existingOptionShares + convertedShares);
      seriesAInvestorShares = totalNewShares - newOptionShares;
      newInvestorShares = seriesAInvestorShares;

      // Share price
      sharePrice =
        preMoneyValuation /
        (totalExistingShares + existingOptionShares + newOptionShares);
    }

    // ========== BUILD POST-MONEY TABLE FOR PRICED ROUNDS ==========

    // Add founders
    founders.forEach((founder) => {
      postCapTable.push({
        type: "founder",
        name: founder.name,
        shares: founder.shares,
        new_shares: 0,
        total: founder.shares,
        percentage: "0.00",
        value: 0,
        founder_code: founder.founder_code,
        email: founder.email,
      });
    });

    // Add seed investors
    seedInvestors.forEach((investor) => {
      postCapTable.push({
        type: "investor",
        name: "Seed Investors",
        shares: investor.shares,

        new_shares: 0,
        total: investor.shares,
        percentage: "0.00",
        value: 0,
        is_previous: true,
      });
    });

    // Add converted investors
    conversionsInThisRound.forEach((conv, idx) => {
      const shares = parseFloat(conv.converted_shares) || 0;
      if (shares > 0) {
        postCapTable.push({
          type: "investor",
          name: conv.investor_name || `Converted Investor`,

          shares: shares,
          new_shares: shares,
          total: shares,
          percentage: "0.00",
          value: 0,
          is_converted: true,
          investment: parseFloat(conv.original_investment_amount) || 0,
          conversion_price: parseFloat(conv.conversion_price) || 0,
        });
      }
    });

    // Add new investors
    // ========== HANDLE NEW INVESTORS WITH DETAILS ==========
    if (newInvestorShares > 0) {
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
        // Process each investor individually
        investors.forEach((investor, idx) => {
          const investorAmount = parseFloat(investor.amount) || 0;
          let investorShares = 0;

          // Calculate shares for this investor based on their investment
          if (investorAmount > 0 && sharePrice > 0) {
            investorShares = Math.round(investorAmount / sharePrice);
          }

          if (investorShares > 0) {
            // Create investor name from firstName and lastName
            const investorName =
              [investor.firstName, investor.lastName]
                .filter(Boolean)
                .join(" ") ||
              (isPreferredEquityRound
                ? `${currentRound.instrumentType} Investor ${idx + 1}`
                : `Investor ${idx + 1}`);

            postCapTable.push({
              type: "investor",
              name: investorName,
              investor_details: {
                firstName: investor.firstName || "",
                lastName: investor.lastName || "",
                email: investor.email || "",
                phone: investor.phone || "",
              },
              instrument_type: currentRound.instrumentType,
              share_class_type: currentRound.shareClassType,
              is_new_investment: true,
              shares: investorShares,
              new_shares: investorShares,
              total: investorShares,
              percentage: "0.00",
              value: 0,
              investment: investorAmount,
              share_price: sharePrice,
              investor_index: idx + 1,
            });

            totalNewShares += investorShares;
          }
        });
      } else {
        // Fallback to single investor if no details provided
        postCapTable.push({
          type: "investor",
          name: currentRound.shareClassType + " Investors",
          instrument_type: currentRound.instrumentType,
          share_class_type: currentRound.shareClassType,
          is_new_investment: true,
          shares: newInvestorShares,
          new_shares: newInvestorShares,
          total: newInvestorShares,
          percentage: "0.00",
          value: 0,
          investment: investment,
          share_price: sharePrice,
        });

        totalNewShares += newInvestorShares;
      }
    }

    // Add existing option pool
    if (existingOptionShares > 0) {
      postCapTable.push({
        type: "option_pool",
        name: "Employee Option Pool",
        shares: existingOptionShares,
        existing_shares: existingOptionShares,
        new_shares: 0,
        total: existingOptionShares,
        percentage: "0.00",
        value: 0,
        is_option_pool: true,
        is_new_pool: false,
      });
    }

    // Add new option pool
    if (newOptionShares > 0) {
      postCapTable.push({
        type: "option_pool",
        name: "Employee Option Pool",
        shares: newOptionShares,
        existing_shares: 0,
        new_shares: newOptionShares,
        total: newOptionShares,
        percentage: "0.00",
        value: 0,
        is_option_pool: true,
        is_new_pool: true,
      });
      totalNewShares += newOptionShares;
    }
  }

  // ========== STEP 7: ADD PENDING INSTRUMENTS ==========
  pendingInstruments.forEach((pending) => {
    postCapTable.push(pending);
  });

  // ========== STEP 8: COMBINE OPTION POOL ==========
  const optionPools = postCapTable.filter(
    (item) => item.type === "option_pool",
  );
  const otherItems = postCapTable.filter((item) => item.type !== "option_pool");

  if (optionPools.length > 1) {
    const totalOptionShares = optionPools.reduce(
      (sum, item) => sum + (item.shares || 0),
      0,
    );
    const existingShares = optionPools
      .filter((item) => !item.is_new_pool)
      .reduce((sum, item) => sum + (item.shares || 0), 0);
    const newShares = optionPools
      .filter((item) => item.is_new_pool)
      .reduce((sum, item) => sum + (item.shares || 0), 0);

    const combinedOption = {
      type: "option_pool",
      name: "Employee Option Pool",
      shares: totalOptionShares,
      existing_shares: existingShares,
      new_shares: newShares,
      total: totalOptionShares,
      percentage: "0.00",
      value: 0,
      is_option_pool: true,
    };

    postCapTable.length = 0;
    postCapTable.push(...otherItems, combinedOption);
  }

  // ========== STEP 9: CALCULATE PERCENTAGES AND VALUES ==========
  postCapTable.forEach((item) => {
    if (item.type !== "pending") {
      const shares = item.shares || 0;
      item.percentage = ((shares / totalShares) * 100).toFixed(2);
      item.value = Math.round((shares / totalShares) * postMoneyValuation);
      item.share_price = sharePrice;
    }
  });

  // ========== STEP 10: CALCULATE TOTALS ==========
  const totalFounders = postCapTable
    .filter((item) => item.type === "founder")
    .reduce((sum, item) => sum + (item.shares || 0), 0);

  const totalInvestors = postCapTable
    .filter((item) => item.type === "investor")
    .reduce((sum, item) => sum + (item.shares || 0), 0);

  const totalOptionPoolCalc = postCapTable
    .filter((item) => item.type === "option_pool")
    .reduce((sum, item) => sum + (item.shares || 0), 0);

  const totals = {
    total_shares: totalShares,
    total_new_shares: totalNewShares,
    total_founders: totalFounders,
    total_investors: totalInvestors,
    total_option_pool: totalOptionPoolCalc,
    total_value: Math.round(postMoneyValuation),
    post_money_valuation: Math.round(postMoneyValuation),
    pre_money_valuation: preMoneyValuation,
    investment: investment,
    share_price: sharePrice,
    round_type: isPreferredEquityRound
      ? "Preferred Equity (Series A)"
      : currentRound.instrumentType,
  };

  // ========== STEP 11: SORT ITEMS ==========
  const sortedItems = [
    ...postCapTable
      .filter((item) => item.type === "founder")
      .sort((a, b) =>
        (a.founder_code || "").localeCompare(b.founder_code || ""),
      ),
    ...postCapTable.filter(
      (item) => item.type === "investor" && item.is_previous,
    ),
    ...postCapTable.filter(
      (item) => item.type === "investor" && item.is_converted,
    ),
    ...postCapTable.filter(
      (item) => item.type === "investor" && item.is_new_investment,
    ),
    ...postCapTable.filter((item) => item.type === "option_pool"),
    ...postCapTable.filter((item) => item.type === "pending"),
  ];

  return {
    items: sortedItems,
    totals,
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
// ============================================
// ============================================
// getConversionTrackingData - ADD THIS FUNCTION
// ============================================
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

// ============================================
// CORRECTED POST-MONEY CAP TABLE USING STORED VALUES
// ============================================

// ============================================
// ROUND 0 SPECIFIC CALCULATIONS
// ============================================

// ============================================
// HELPER FUNCTIONS
// ============================================

function processFounderRound(round, capTable, totalShares, totalFounderShares) {
  if (
    round.founder_data?.founders &&
    Array.isArray(round.founder_data.founders)
  ) {
    round.founder_data.founders.forEach((founder, idx) => {
      const shares = parseFloat(founder.shares) || 0;
      const firstName = founder.firstName || "";
      const lastName = founder.lastName || "";
      const founderName =
        `${firstName} ${lastName}`.trim() || `Founder ${idx + 1}`;

      capTable.push({
        type: "founder",
        name: founderName,
        shares: shares,
        percentage: 0,
        round_id: round.id,
        round_name: round.nameOfRound || "Round 0",
        investment: 0,
        share_price: parseFloat(round.share_price) || 0.001,
        founder_id: idx + 1,
      });

      totalShares += shares;
      totalFounderShares += shares;
    });
  } else {
    const founderShares = parseFloat(round.issuedshares) || 0;
    if (founderShares > 0) {
      capTable.push({
        type: "founder",
        name: "Founders",
        shares: founderShares,
        percentage: 0,
        round_id: round.id,
        round_name: round.nameOfRound || "Round 0",
        investment: 0,
        share_price: parseFloat(round.share_price) || 0.001,
      });
      totalShares += founderShares;
      totalFounderShares += founderShares;
    }
  }

  return { totalShares, totalFounderShares };
}

function processPricedRound(
  round,
  capTable,
  totalShares,
  totalOptionShares,
  conversionData = [],
  includeNewShares = false,
) {
  const optionShares = parseFloat(round.option_pool_shares) || 0;

  // Add option pool
  if (optionShares > 0) {
    capTable.push({
      type: "option_pool",
      name: `${round.nameOfRound} Option Pool`,
      shares: optionShares,
      percentage: 0,
      round_id: round.id,
      round_name: round.nameOfRound,
      investment: 0,
      share_price: parseFloat(round.share_price) || 0,
      ...(includeNewShares && { new_shares: 0 }),
    });
    totalShares += optionShares;
    totalOptionShares += optionShares;
  }

  return { totalShares, totalOptionShares };
}

function applyCPAAdjustment(
  capTable,
  cpaTotal,
  currentTotal,
  totalOptionShares,
) {
  const discrepancy = cpaTotal - currentTotal;

  if (Math.abs(discrepancy) > 1) {
    // Try to adjust option pool first
    const optionPoolItems = capTable.filter(
      (item) => item.type === "option_pool",
    );
    if (optionPoolItems.length > 0) {
      const latestOptionPool = optionPoolItems[optionPoolItems.length - 1];
      latestOptionPool.shares += discrepancy;
      totalOptionShares += discrepancy;
    } else if (discrepancy > 0) {
      // Add as a new option pool adjustment
      capTable.push({
        type: "option_pool",
        name: "CPA Adjustment Pool",
        shares: discrepancy,
        percentage: 0,
        round_id: 0,
        round_name: "CPA Adjustment",
        investment: 0,
        share_price: 0,
        is_adjustment: true,
      });
      totalOptionShares += discrepancy;
    }

    currentTotal = cpaTotal;
  }

  return { totalShares: currentTotal, totalOptionShares };
}

function calculatePreMoneyValuation(currentRound) {
  if (!currentRound.pre_money) return 0;
  const preMoney = parseFloat(currentRound.pre_money) || 0;
  return Math.round(preMoney);
}

function calculatePostMoneyValuation(currentRound, allRounds = []) {
  // Method 1: Use CPA provided post_money if available
  if (currentRound.post_money) {
    const postMoney = parseFloat(currentRound.post_money) || 0;

    return Math.round(postMoney);
  }

  // Method 2: Calculate from share price and total shares after
  const sharePrice = parseFloat(currentRound.share_price) || 0;
  const totalSharesAfter = parseFloat(currentRound.total_shares_after) || 0;

  if (sharePrice > 0 && totalSharesAfter > 0) {
    const calculatedValuation = sharePrice * totalSharesAfter;

    return Math.round(calculatedValuation);
  }

  // Method 3: Use pre_money + investment
  const preMoney = parseFloat(currentRound.pre_money) || 0;
  const investment = parseFloat(currentRound.roundsize) || 0;

  if (preMoney > 0 || investment > 0) {
    const calculatedValuation = preMoney + investment;

    return Math.round(calculatedValuation);
  }

  return 0;
}

// New function specifically for Round 0 cap table
async function getRound0CapTable(company_id, round_id) {
  return new Promise((resolve) => {
    const query = `
      SELECT 
        rr.id,
        rr.founder_data,
        rr.total_founder_shares,
        rr.share_price,
        rr.nameOfRound,
        fd.*
      FROM roundrecord rr
      LEFT JOIN (
        SELECT 
          f.company_id,
          f.roundrecord_id,
          GROUP_CONCAT(CONCAT(f.first_name, ' ', f.last_name) SEPARATOR ', ') as founder_names,
          SUM(f.shares_issued) as total_founder_shares
        FROM founders f
        WHERE f.company_id = ?
        GROUP BY f.roundrecord_id
      ) fd ON rr.id = fd.roundrecord_id
      WHERE rr.company_id = ?
      AND rr.id = ?
      AND rr.round_type = 'Round 0'
      LIMIT 1
    `;

    db.query(query, [company_id, company_id, round_id], (err, results) => {
      if (err) {
        console.error("Error getting Round 0 cap table:", err);
        resolve({ items: [], totals: { total_shares: 0 } });
        return;
      }

      if (!results.length) {
        resolve({ items: [], totals: { total_shares: 0 } });
        return;
      }

      const round = results[0];
      const capTable = [];
      let totalShares = 0;

      // Try to parse founder_data
      let founderData = {};
      try {
        founderData = round.founder_data
          ? typeof round.founder_data === "string"
            ? JSON.parse(round.founder_data)
            : round.founder_data
          : {};
      } catch (e) {
        founderData = {};
      }

      if (founderData.founders && Array.isArray(founderData.founders)) {
        founderData.founders.forEach((founder) => {
          const shares = parseFloat(founder.shares) || 0;
          totalShares += shares;
          capTable.push({
            type: "founder",
            name:
              `${founder.firstName || ""} ${founder.lastName || ""}`.trim() ||
              `Founder`,
            shares: shares,
            percentage: ((shares / totalShares) * 100).toFixed(2),
            round_id: round.id,
            round_name: round.nameOfRound || "Round 0",
            investment: 0,
            share_price:
              parseFloat(founderData.pricePerShare) ||
              parseFloat(round.share_price) ||
              0.01,
            founder_id: founder.founder_id || null,
          });
        });
      } else if (round.total_founder_shares) {
        // Fallback to total_founder_shares
        totalShares = parseFloat(round.total_founder_shares) || 0;
        capTable.push({
          type: "founder",
          name: "Round 0 Founders",
          shares: totalShares,
          percentage: 100.0,
          round_id: round.id,
          round_name: round.nameOfRound || "Round 0",
          investment: 0,
          share_price: parseFloat(round.share_price) || 0.01,
        });
      }

      // Calculate percentages
      capTable.forEach((item) => {
        item.percentage =
          totalShares > 0 ? ((item.shares / totalShares) * 100).toFixed(2) : 0;
      });

      resolve({
        items: capTable,
        totals: {
          total_shares: totalShares,
          total_founders: totalShares,
          total_investors: 0,
          total_option_pool: 0,
        },
      });
    });
  });
}

// New function to get detailed conversion data from conversion_tracking

// New function to calculate investor-wise cap table including investors from investorrequest_company table
async function getInvestorCapTable(company_id, round_id) {
  return new Promise((resolve) => {
    const query = `
      SELECT 
        ir.id as request_id,
        ir.investor_id,
        ir.investment_amount,
        ir.request_confirm,
        r.id as round_id,
        r.nameOfRound,
        r.instrumentType,
        r.share_price,
        r.issuedshares,
        r.total_converted_shares,
        r.option_pool_shares,
        u.name as investor_name,
        u.email as investor_email
      FROM investorrequest_company ir
      INNER JOIN roundrecord r ON ir.roundrecord_id = r.id
      LEFT JOIN users u ON ir.investor_id = u.id
      WHERE ir.company_id = ?
      AND ir.roundrecord_id <= ?
      AND ir.request_confirm = 'Yes'
      ORDER BY r.created_at ASC
    `;

    db.query(query, [company_id, round_id], (err, results) => {
      if (err) {
        console.error("Error fetching investor cap table:", err);
        resolve([]);
        return;
      }

      // Process results to create investor-wise breakdown
      const investorMap = new Map();

      results.forEach((row) => {
        const investorId = row.investor_id;

        if (!investorMap.has(investorId)) {
          investorMap.set(investorId, {
            investor_id: investorId,
            investor_name: row.investor_name || `Investor ${investorId}`,
            investor_email: row.investor_email,
            total_investment: 0,
            total_shares: 0,
            investments: [],
          });
        }

        const investor = investorMap.get(investorId);
        const investmentAmount = parseFloat(row.investment_amount) || 0;
        const shares = parseFloat(row.issuedshares) || 0;

        investor.total_investment += investmentAmount;
        investor.total_shares += shares;

        investor.investments.push({
          round_id: row.round_id,
          round_name: row.nameOfRound,
          instrument_type: row.instrumentType,
          investment_amount: investmentAmount,
          shares: shares,
          share_price: parseFloat(row.share_price) || 0,
          converted_shares: parseFloat(row.total_converted_shares) || 0,
        });
      });

      resolve(Array.from(investorMap.values()));
    });
  });
}

function handlePreferredEquityRoundCalculation(round, company_id, res) {
  // Step 1: Get Round 0 data
  db.query(
    `SELECT * FROM roundrecord WHERE company_id=? AND round_type='Round 0'`,
    [company_id],
    (err, roundZeroData) => {
      if (err) {
        console.error("❌ Database error fetching Round 0:", err);
        return res.status(500).json({
          success: false,
          message: "Database error fetching Round 0",
          error: err.message,
        });
      }

      if (roundZeroData.length === 0) {
        console.error("❌ Round 0 not found for company:", company_id);
        return res.status(400).json({
          success: false,
          message: "Round 0 not found. Please create Round 0 first.",
        });
      }

      const roundZero = roundZeroData[0];

      // Step 2: Get ALL previous investment rounds
      db.query(
        `SELECT * FROM roundrecord 
         WHERE company_id = ? 
         AND round_type = 'Investment'
         AND id < ?
         ORDER BY created_at ASC`,
        [company_id, round.id],
        (err, previousRounds) => {
          if (err) {
            console.error("❌ Database error fetching previous rounds:", err);
            return res.status(500).json({
              success: false,
              message: "Database error fetching previous rounds",
              error: err.message,
            });
          }

          previousRounds.forEach((r, i) => {});

          // Step 3: Get current round investors
          db.query(
            `SELECT ir.*, ii.first_name, ii.last_name, ii.email
             FROM investorrequest_company ir
             LEFT JOIN investor_information ii ON ir.investor_id = ii.id
             WHERE ir.roundrecord_id = ? 
             AND ir.company_id = ? 
             AND (ir.request_confirm = 'Yes' OR ir.request_confirm IS NULL OR ir.request_confirm = 'No')`,
            [round.id, company_id],
            (err, currentInvestors) => {
              if (err) {
                console.error(
                  "❌ Database error fetching current investors:",
                  err,
                );
                return res.status(500).json({
                  success: false,
                  message: "Database error fetching current investors",
                  error: err.message,
                });
              }

              // 🔴 IMPORTANT: If no investors in investorrequest_company, use round data
              if (currentInvestors.length === 0 && round.roundsize) {
                currentInvestors = [
                  {
                    investment_amount: round.roundsize,
                    first_name: "Series A",
                    last_name: "Investor",
                    email: "",
                    request_confirm: "Yes",
                  },
                ];
              }

              // Step 4: Extract warrants from instrument_type_data
              let warrants = [];
              try {
                // ✅ CORRECT: Get warrants from warrants table, NOT instrument_type_data
                const warrantsQuery = `
    SELECT 
      w.id,
      w.roundrecord_id,
      w.company_id,
      w.investor_id,
      w.warrant_coverage_percentage,
      w.warrant_exercise_type,
      w.warrant_adjustment_percent,
      w.warrant_adjustment_direction,
      w.calculated_exercise_price,
      w.calculated_warrant_shares,
      w.warrant_coverage_amount,
      w.warrant_status,
      w.issued_date,
      w.exercised_date,
      w.exercised_in_round_id,
      w.expiration_date,
      w.notes,
      rr.nameOfRound as original_round_name,
      rr.instrumentType as original_instrument_type
    FROM warrants w
    LEFT JOIN roundrecord rr ON w.roundrecord_id = rr.id
    WHERE w.company_id = ?
    AND (w.warrant_status = 'pending' OR w.exercised_in_round_id = ?)
    ORDER BY w.issued_date ASC
  `;

                // Execute query to get warrants from database
                db.query(
                  warrantsQuery,
                  [company_id, round.id],
                  (err, warrantResults) => {
                    if (err) {
                      console.error(
                        "❌ Database error fetching warrants:",
                        err,
                      );
                      warrants = [];
                    } else {
                      warrantResults.forEach((warrant, index) => {
                        warrants.push({
                          id: warrant.id,
                          roundrecord_id: warrant.roundrecord_id,
                          company_id: warrant.company_id,
                          investor_id: warrant.investor_id,
                          warrant_coverage_percentage:
                            parseFloat(warrant.warrant_coverage_percentage) ||
                            0,
                          warrant_exercise_type:
                            warrant.warrant_exercise_type ||
                            "next_round_adjusted",
                          warrant_adjustment_percent:
                            parseFloat(warrant.warrant_adjustment_percent) || 0,
                          warrant_adjustment_direction:
                            warrant.warrant_adjustment_direction || "decrease",
                          expirationDate_preferred: warrant.expiration_date
                            ? new Date(warrant.expiration_date)
                                .toISOString()
                                .split("T")[0]
                            : null,
                          warrant_notes: warrant.notes || null,
                          warrant_status: warrant.warrant_status || "pending",
                          calculated_exercise_price:
                            parseFloat(warrant.calculated_exercise_price) ||
                            null,
                          calculated_warrant_shares:
                            parseFloat(warrant.calculated_warrant_shares) ||
                            null,
                          warrant_coverage_amount:
                            parseFloat(warrant.warrant_coverage_amount) || null,
                          issued_date: warrant.issued_date,
                          exercised_date: warrant.exercised_date,
                          exercised_in_round_id: warrant.exercised_in_round_id,
                          original_round_name: warrant.original_round_name,
                          original_instrument_type:
                            warrant.original_instrument_type,
                        });
                      });

                      // Step 5: Calculate cap table with warrants from database

                      const capTableData =
                        calculatePreferredEquityCapTableFixed(
                          round,
                          currentInvestors,
                          roundZero,
                          previousRounds,
                          warrants,
                        );
                      if (capTableData.error) {
                        console.error(
                          "❌ Calculation error:",
                          capTableData.error,
                        );
                        return res.status(500).json({
                          success: false,
                          message: "Preferred Equity calculation failed",
                          error: capTableData.error,
                        });
                      }

                      // Step 6: Return response
                      return res.status(200).json({
                        success: true,
                        message:
                          "Preferred Equity cap table calculated successfully",
                        round: {
                          id: round.id,
                          name: round.nameOfRound,
                          type: round.round_type,
                          instrumentType: round.instrumentType,
                          shareClassType: round.shareClassType,
                          investmentSize: round.roundsize,
                          preMoneyValuation: round.pre_money,
                          postMoneyValuation:
                            capTableData.calculations.postMoneyValuation,
                          optionPoolPercentPre: round.optionPoolPercent,
                          optionPoolPercentPost: round.optionPoolPercent_post,
                          currency: round.currency || "USD",
                          hasWarrants: warrants.length > 0,
                          hasConversions: previousRounds.length > 0,
                        },
                        capTable: capTableData,
                      });

                      // ... rest of the code
                    }
                  },
                );
              } catch (warrantError) {
                console.error("❌ Error processing warrants:", warrantError);
                warrants = [];
              }
            },
          );
        },
      );
    },
  );
}
function calculatePreferredEquityCapTableFixed(
  round,
  currentInvestors,
  roundZero,
  previousRounds,
  warrants,
) {
  const toNumber = (val, def = 0) => {
    if (val === null || val === undefined || val === "") return def;
    const num = parseFloat(val);
    return isNaN(num) ? def : num;
  };

  // ========== STEP 1: GET FOUNDER SHARES FROM ROUND 0 ==========
  let roundZeroTotalShares = 0;
  let roundZeroFounders = [];

  try {
    if (roundZero.founder_data) {
      const founderData = safeJSONParseRepeated(roundZero.founder_data, 3);
      roundZeroTotalShares =
        toNumber(founderData?.totalShares, 0) ||
        toNumber(roundZero.issuedshares, 0);

      if (founderData?.founders && Array.isArray(founderData.founders)) {
        roundZeroFounders = founderData.founders;
      }
    } else {
      roundZeroTotalShares = toNumber(roundZero.issuedshares, 0);
    }
  } catch (error) {
    roundZeroTotalShares = 0; // Default
  }

  // ========== STEP 2: GET SERIES A DATA ==========
  const seriesA_Investment = toNumber(round.roundsize, 0);
  const seriesA_PreMoney = toNumber(round.pre_money, 0);

  // ========== STEP 3: CALCULATE OPTION POOL FROM PREVIOUS ROUNDS ==========
  let optionPoolPercentPre = 0;
  let existingOptionShares = 0;
  let totalSharesFromSeedRound = roundZeroTotalShares;

  if (previousRounds.length > 0) {
    const seedRound = previousRounds[0];
    optionPoolPercentPre =
      toNumber(
        seedRound.optionPoolPercent || seedRound.optionPoolPercent_post,
        0,
      ) / 100;

    if (optionPoolPercentPre > 0) {
      existingOptionShares = Math.round(
        (roundZeroTotalShares / (1 - optionPoolPercentPre)) *
          optionPoolPercentPre,
      );
      totalSharesFromSeedRound = roundZeroTotalShares + existingOptionShares;
    }
  }

  const optionPoolPercentPost = toNumber(round.optionPoolPercent_post, 0) / 100;

  console.log(
    `\n💰 Series A Investment: $${seriesA_Investment.toLocaleString()}`,
  );
  console.log(`📈 Pre-Money Valuation: $${seriesA_PreMoney.toLocaleString()}`);
  console.log(
    `🎯 Existing Option Pool: ${existingOptionShares.toLocaleString()} shares`,
  );

  // ========== STEP 4: CALCULATE SHARE PRICE ==========
  const seriesA_SharePrice = seriesA_PreMoney / totalSharesFromSeedRound;
  console.log(`\n💎 Series A Share Price: $${seriesA_SharePrice.toFixed(4)}`);
  console.log(
    `   Formula: $${seriesA_PreMoney} ÷ ${totalSharesFromSeedRound} = $${seriesA_SharePrice.toFixed(4)}`,
  );

  // ========== STEP 5: PROCESS PREVIOUS ROUNDS CONVERSION ==========
  let convertedInvestors = [];
  let totalConvertedShares = 0;

  console.log(`\n🔍 Processing ${previousRounds.length} previous rounds...`);

  previousRounds.forEach((prevRound) => {
    let instrumentData = {};
    try {
      if (prevRound.instrument_type_data) {
        if (typeof prevRound.instrument_type_data === "string") {
          instrumentData = JSON.parse(prevRound.instrument_type_data);
        } else {
          instrumentData = prevRound.instrument_type_data;
        }
      }
    } catch (e) {
      instrumentData = {};
    }

    const prevInstrumentType = prevRound.instrumentType;
    const prevInvestment = toNumber(prevRound.roundsize, 0);

    console.log(
      `\n🔄 ${prevRound.nameOfRound} (${prevInstrumentType}): $${prevInvestment.toLocaleString()}`,
    );

    if (prevInstrumentType === "Safe") {
      const safe_DiscountRate = toNumber(instrumentData.discountRate, 0) / 100;
      const safe_ValuationCap = toNumber(instrumentData.valuationCap, 0);

      const discountPrice = seriesA_SharePrice * (1 - safe_DiscountRate);
      const capPrice =
        safe_ValuationCap > 0
          ? safe_ValuationCap / totalSharesFromSeedRound
          : Infinity;

      let safe_ConversionPrice = Math.min(discountPrice, capPrice);

      const safe_Shares =
        safe_ConversionPrice > 0
          ? Math.round(prevInvestment / safe_ConversionPrice)
          : 0;

      console.log(`   📝 SAFE Conversion:`);
      console.log(`      - Discount: ${(safe_DiscountRate * 100).toFixed(1)}%`);
      console.log(
        `      - Valuation Cap: $${safe_ValuationCap.toLocaleString()}`,
      );
      console.log(
        `      - Conversion Price: $${safe_ConversionPrice.toFixed(4)}`,
      );
      console.log(
        `      - Shares: ${safe_Shares.toLocaleString()} ($${prevInvestment} ÷ $${safe_ConversionPrice.toFixed(4)})`,
      );

      totalConvertedShares += safe_Shares;

      convertedInvestors.push({
        roundName: prevRound.nameOfRound,
        type: "SAFE",
        investmentAmount: prevInvestment,
        shares: safe_Shares,
        conversionPrice: safe_ConversionPrice,
      });
    } else if (prevInstrumentType === "Convertible Note") {
      const note_InterestRate =
        toNumber(instrumentData.interestRate_note, 0) / 100;
      const note_ValuationCap = toNumber(instrumentData.valuationCap_note, 0);
      const note_DiscountRate =
        toNumber(instrumentData.discountRate_note, 0) / 100;

      let yearsBetween = 2;
      const principalPlusInterest =
        prevInvestment * Math.pow(1 + note_InterestRate, yearsBetween);

      const discountPrice = seriesA_SharePrice * (1 - note_DiscountRate);
      const capPrice =
        note_ValuationCap > 0
          ? note_ValuationCap / totalSharesFromSeedRound
          : Infinity;

      const note_ConversionPrice = Math.min(discountPrice, capPrice);

      const note_Shares =
        note_ConversionPrice > 0
          ? Math.round(principalPlusInterest / note_ConversionPrice)
          : 0;

      console.log(`   📝 Convertible Note Conversion:`);
      console.log(
        `      - Interest Rate: ${(note_InterestRate * 100).toFixed(1)}%`,
      );
      console.log(`      - Discount: ${(note_DiscountRate * 100).toFixed(1)}%`);
      console.log(
        `      - Valuation Cap: $${note_ValuationCap.toLocaleString()}`,
      );
      console.log(
        `      - Principal+Interest: $${principalPlusInterest.toLocaleString()}`,
      );
      console.log(
        `      - Conversion Price: $${note_ConversionPrice.toFixed(4)}`,
      );
      console.log(
        `      - Shares: ${note_Shares.toLocaleString()} ($${principalPlusInterest} ÷ $${note_ConversionPrice.toFixed(4)})`,
      );

      // ✅ DEBUG: Show simple calculation for comparison
      const simpleShares =
        seriesA_SharePrice > 0
          ? Math.round(prevInvestment / seriesA_SharePrice)
          : 0;
      console.log(
        `      - Simple calc (no terms): ${simpleShares.toLocaleString()} shares ($${prevInvestment} ÷ $${seriesA_SharePrice.toFixed(4)})`,
      );

      if (note_Shares > simpleShares * 3) {
        console.log(
          `      ⚠️ WARNING: Converted shares seem high! Check conversion terms.`,
        );
      }

      totalConvertedShares += note_Shares;

      convertedInvestors.push({
        roundName: prevRound.nameOfRound,
        type: "Convertible Note",
        investmentAmount: prevInvestment,
        principalPlusInterest: principalPlusInterest,
        shares: note_Shares,
        conversionPrice: note_ConversionPrice,
      });
    }
  });

  console.log(
    `\n✅ Total Converted Shares: ${totalConvertedShares.toLocaleString()}`,
  );

  // ========== STEP 6: SERIES A INVESTOR SHARES ==========
  const seriesA_Shares = Math.round(seriesA_Investment / seriesA_SharePrice);
  console.log(`\n💰 Series A Shares: ${seriesA_Shares.toLocaleString()}`);
  console.log(
    `   Formula: $${seriesA_Investment} ÷ $${seriesA_SharePrice.toFixed(4)} = ${seriesA_Shares.toLocaleString()} shares`,
  );

  // ========== STEP 7: TOTAL SHARES BEFORE OPTION POOL EXPANSION ==========
  const totalSharesExcludingNewOptions =
    roundZeroTotalShares + totalConvertedShares + seriesA_Shares;
  console.log(
    `\n📊 Total Shares (before pool expansion): ${totalSharesExcludingNewOptions.toLocaleString()}`,
  );
  console.log(`   - Founders: ${roundZeroTotalShares.toLocaleString()}`);
  console.log(`   - Converted: ${totalConvertedShares.toLocaleString()}`);
  console.log(`   - Series A: ${seriesA_Shares.toLocaleString()}`);

  // ========== STEP 8: OPTION POOL EXPANSION ==========
  let totalSharesAfterPool = totalSharesExcludingNewOptions;
  let newOptionShares = 0;

  if (optionPoolPercentPost > 0) {
    totalSharesAfterPool = Math.round(
      totalSharesExcludingNewOptions / (1 - optionPoolPercentPost),
    );

    newOptionShares =
      totalSharesAfterPool -
      totalSharesExcludingNewOptions -
      existingOptionShares;

    if (newOptionShares < 0) newOptionShares = 0;
  }

  const totalOptionShares = existingOptionShares + newOptionShares;

  console.log(`\n🎯 Option Pool Calculations:`);
  console.log(`   - Existing: ${existingOptionShares.toLocaleString()}`);
  console.log(`   - New: ${newOptionShares.toLocaleString()}`);
  console.log(`   - Total: ${totalOptionShares.toLocaleString()}`);
  console.log(
    `   - Target Pool %: ${(optionPoolPercentPost * 100).toFixed(1)}%`,
  );
  console.log(
    `   - Actual Pool %: ${((totalOptionShares / totalSharesAfterPool) * 100).toFixed(2)}%`,
  );

  // ========== STEP 9: WARRANTS CALCULATION ==========
  let warrantShares = 0;
  let warrantExercisePrice = seriesA_SharePrice;
  let warrantValue = 0;
  let pendingWarrantShares = 0;
  let exercisedWarrantShares = 0;
  let totalSharesAfterWarrants = totalSharesAfterPool;

  let warrantDetails = [];
  let hasExercisedWarrants = false;
  let hasPendingWarrants = false;

  if (warrants && warrants.length > 0) {
    console.log(`\n📜 ===== WARRANTS CALCULATION =====`);

    warrants.forEach((warrant, index) => {
      const coveragePercent = toNumber(warrant.warrant_coverage_percentage, 0);
      const exerciseType =
        warrant.warrant_exercise_type || "next_round_adjusted";
      const adjustmentPercent = toNumber(warrant.warrant_adjustment_percent, 0);
      const adjustmentDirection =
        warrant.warrant_adjustment_direction || "decrease";
      const warrantStatus = warrant.warrant_status || "pending";

      console.log(`\n🔹 Warrant ${index + 1}: ${warrantStatus.toUpperCase()}`);
      console.log(`   - Coverage: ${coveragePercent}%`);
      console.log(`   - Exercise Type: ${exerciseType}`);
      console.log(
        `   - Adjustment: ${adjustmentPercent}% ${adjustmentDirection}`,
      );

      // Calculate exercise price
      let calculatedExercisePrice = seriesA_SharePrice;

      if (exerciseType === "next_round_adjusted") {
        if (adjustmentDirection === "decrease") {
          calculatedExercisePrice =
            seriesA_SharePrice * (1 - adjustmentPercent / 100);
        } else if (adjustmentDirection === "increase") {
          calculatedExercisePrice =
            seriesA_SharePrice * (1 + adjustmentPercent / 100);
        }
      }

      warrantExercisePrice = calculatedExercisePrice;

      // Calculate potential shares
      const potentialWarrantShares = Math.round(
        seriesA_Shares * (coveragePercent / 100),
      );
      const potentialWarrantValue = potentialWarrantShares * seriesA_SharePrice;

      console.log(`   - Series A Shares: ${seriesA_Shares.toLocaleString()}`);
      console.log(
        `   - Exercise Price: $${calculatedExercisePrice.toFixed(4)}`,
      );
      console.log(
        `   - Warrant Shares: ${potentialWarrantShares.toLocaleString()}`,
      );
      console.log(
        `   - Warrant Value: $${potentialWarrantValue.toLocaleString()}`,
      );

      // Check warrant status
      if (warrantStatus === "exercised") {
        warrantShares += potentialWarrantShares;
        warrantValue += potentialWarrantValue;
        exercisedWarrantShares += potentialWarrantShares;
        hasExercisedWarrants = true;
        console.log(`   ✅ EXERCISED: Adding to cap table`);
      } else {
        pendingWarrantShares += potentialWarrantShares;
        hasPendingWarrants = true;
        console.log(`   ⏳ PENDING: Not adding to cap table`);
      }

      warrantDetails.push({
        coveragePercent: coveragePercent,
        exerciseType: exerciseType,
        adjustmentPercent: adjustmentPercent,
        adjustmentDirection: adjustmentDirection,
        status: warrantStatus,
        calculatedExercisePrice: calculatedExercisePrice,
        potentialShares: potentialWarrantShares,
        potentialValue: potentialWarrantValue,
      });
    });

    if (hasExercisedWarrants) {
      totalSharesAfterWarrants = totalSharesAfterPool + warrantShares;
      console.log(
        `\n✅ EXERCISED Warrants: ${warrantShares.toLocaleString()} shares added to cap table`,
      );
    } else {
      totalSharesAfterWarrants = totalSharesAfterPool;
      console.log(
        `\n⏳ NO exercised warrants. All ${pendingWarrantShares.toLocaleString()} shares are pending`,
      );
    }

    console.log(
      `   - Pending Warrant Shares: ${pendingWarrantShares.toLocaleString()}`,
    );
    console.log(
      `   - Exercised Warrant Shares: ${exercisedWarrantShares.toLocaleString()}`,
    );
    console.log(
      `   - Total Shares After Warrants: ${totalSharesAfterWarrants.toLocaleString()}`,
    );
  }

  // ========== STEP 10: BUILD CAP TABLES ==========
  const finalTotalShares = totalSharesAfterWarrants;
  const finalSharePrice = seriesA_SharePrice;
  const finalTotalValue = finalTotalShares * finalSharePrice;

  console.log(`\n📊 Final Total Shares: ${finalTotalShares.toLocaleString()}`);
  console.log(`💰 Post-Money Valuation: $${finalTotalValue.toLocaleString()}`);
  console.log(`💎 Final Share Price: $${finalSharePrice.toFixed(4)}`);

  // Post-Series A Cap Table
  let shareholders = [];

  // Founders
  if (roundZeroFounders.length > 0) {
    roundZeroFounders.forEach((founder, index) => {
      const shares = toNumber(founder.shares, 0);
      if (shares > 0) {
        const ownership = (shares / finalTotalShares) * 100;
        const value = shares * finalSharePrice;

        shareholders.push({
          name:
            `${founder.firstName || ""} ${founder.lastName || ""}`.trim() ||
            `F${index + 1}`,
          fullName: founder.fullName || `Founder ${index + 1}`,
          type: "Founder",
          shares: shares,
          ownership: parseFloat(ownership.toFixed(2)),
          value: parseFloat(value.toFixed(2)),
        });
      }
    });
  }

  // Option Pool
  if (totalOptionShares > 0) {
    const ownership = (totalOptionShares / finalTotalShares) * 100;
    const value = totalOptionShares * finalSharePrice;

    shareholders.push({
      name: "Employee Option Pool",
      fullName: "Employee Option Pool",
      type: "Options Pool",
      shares: totalOptionShares,
      ownership: parseFloat(ownership.toFixed(2)),
      value: parseFloat(value.toFixed(2)),
    });
  }

  // Converted Investors
  convertedInvestors.forEach((inv) => {
    const ownership = (inv.shares / finalTotalShares) * 100;
    const value = inv.shares * finalSharePrice;

    shareholders.push({
      name: inv.type === "SAFE" ? "SAFE Investors" : "Seed Investors",
      fullName: `${inv.type} - ${inv.roundName}`,
      type: "Investor",
      shares: inv.shares,
      ownership: parseFloat(ownership.toFixed(2)),
      value: parseFloat(value.toFixed(2)),
      investmentAmount: inv.investmentAmount,
      conversionPrice: inv.conversionPrice
        ? parseFloat(inv.conversionPrice.toFixed(4))
        : 0,
    });
  });

  // Series A Investors
  let totalSeriesAInvestment = 0;
  currentInvestors.forEach((investor) => {
    totalSeriesAInvestment += toNumber(investor.investment_amount, 0);
  });

  currentInvestors.forEach((investor, index) => {
    const investmentAmount = toNumber(investor.investment_amount, 0);
    const individualShares =
      totalSeriesAInvestment > 0
        ? Math.round(
            (investmentAmount / totalSeriesAInvestment) * seriesA_Shares,
          )
        : 0;

    const ownership = (individualShares / finalTotalShares) * 100;
    const value = individualShares * finalSharePrice;

    shareholders.push({
      name:
        `${investor.first_name || ""} ${investor.last_name || ""}`.trim() ||
        `Series A Investor ${index + 1}`,
      fullName:
        `${investor.first_name || ""} ${investor.last_name || ""}`.trim() ||
        `Series A Investor ${index + 1}`,
      type: "Investor",
      shares: individualShares,
      ownership: parseFloat(ownership.toFixed(2)),
      value: parseFloat(value.toFixed(2)),
      investmentAmount: investmentAmount,
      sharePrice: parseFloat(seriesA_SharePrice.toFixed(4)),
    });
  });

  // Warrants
  if (hasExercisedWarrants && warrantShares > 0) {
    const ownership = (warrantShares / finalTotalShares) * 100;
    const value = warrantShares * finalSharePrice;

    shareholders.push({
      name: "Warrant Holders",
      fullName: "Series A Warrant Exercise",
      type: "Warrant",
      shares: warrantShares,
      ownership: parseFloat(ownership.toFixed(2)),
      value: parseFloat(value.toFixed(2)),
      exercisePrice: parseFloat(warrantExercisePrice.toFixed(4)),
      note: `Exercised at $${warrantExercisePrice.toFixed(4)}/share`,
    });
  } else if (hasPendingWarrants) {
    shareholders.push({
      name: "Potential Warrant Dilution",
      fullName: "Warrants (Pending Exercise)",
      type: "Potential Dilution",
      shares: 0,
      ownership: 0,
      value: 0,
      note: `Potential dilution: ${pendingWarrantShares.toLocaleString()} shares if all warrants exercised`,
      isPending: true,
      pendingShares: pendingWarrantShares,
      pendingValue: pendingWarrantShares * finalSharePrice,
    });
  }

  // ========== STEP 11: RETURN RESULT ==========
  return {
    roundType: round.nameOfRound || "Preferred Equity",
    round_type: round.round_type,
    instrumentType: round.instrumentType,
    currency: round.currency || "USD",
    shareClassType: round.shareClassType,

    postSeriesACapTable: {
      totalSharesBeforeWarrants: totalSharesAfterPool,
      totalSharesAfterWarrants: totalSharesAfterWarrants,
      totalValue: finalTotalValue,
      shareholders: shareholders,
    },

    calculations: {
      // Inputs
      investmentSize: seriesA_Investment,
      preMoneyValuation: seriesA_PreMoney,
      postMoneyValuation: finalTotalValue,
      sharePrice: parseFloat(finalSharePrice.toFixed(4)),

      // Convertible Instruments
      convertibleNoteShares: totalConvertedShares,

      // Series A
      seriesAShares: seriesA_Shares,

      // Option Pool
      existingOptionShares: existingOptionShares,
      newOptionShares: newOptionShares,
      totalOptionShares: totalOptionShares,

      // Warrants
      warrantShares: warrantShares,
      warrantValue: warrantValue,
      warrantExercisePrice: parseFloat(warrantExercisePrice.toFixed(4)),
      pendingWarrantShares: pendingWarrantShares,
      exercisedWarrantShares: exercisedWarrantShares,

      // Final
      totalSharesExcludingNewOptions: totalSharesExcludingNewOptions,
      totalSharesAfterPool: totalSharesAfterPool,
      totalSharesAfterWarrants: totalSharesAfterWarrants,
    },

    warrants: warrantDetails,

    hasConversions: convertedInvestors.length > 0,
    hasWarrants: warrants.length > 0,
    hasExercisedWarrants: hasExercisedWarrants,
    hasPendingWarrants: hasPendingWarrants,
    message: hasExercisedWarrants
      ? "Series A with exercised warrants"
      : hasPendingWarrants
        ? "Series A with pending warrants (not exercised yet)"
        : "Series A - Preferred Equity",
  };
}
// New function specifically for Series A with post-money option pool
// ============================================
// 📦 REQUIRED IMPORTS
// ============================================

function calculateCommonStockCapTable(
  round,
  investors,
  roundZero,
  previousRounds,
  company_id,
  current_user_id,
) {
  try {
    // ============================================
    // 🔧 HELPER FUNCTIONS
    // ============================================

    const toNumber = (value, defaultValue = 0) => {
      if (value === null || value === undefined || value === "")
        return defaultValue;
      if (typeof value === "number") return value;
      const num = parseFloat(String(value).replace(/,/g, ""));
      return isNaN(num) ? defaultValue : num;
    };

    const safeJSONParse = (jsonString) => {
      try {
        if (!jsonString) return {};
        if (typeof jsonString === "object") return jsonString;
        return JSON.parse(jsonString);
      } catch (error) {
        return {};
      }
    };

    const calculateOwnershipPercentage = (shares, totalShares) => {
      if (!totalShares || totalShares <= 0) return 0;
      return (shares / totalShares) * 100;
    };

    const calculateValue = (ownershipPercent, valuation) => {
      return (ownershipPercent / 100) * valuation;
    };

    // ============================================
    // 📊 STEP 1: RECONSTRUCT CAP TABLE FROM PREVIOUS ROUNDS
    // ============================================
    console.log(
      "\n🔍 STEP 1: Reconstructing cap table from previous rounds...",
    );

    let totalExistingShares = 0;
    let existingShareholders = [];
    let existingOptionPoolShares = 0;
    let existingOptionPoolPercent = 0;
    let convertibleInstruments = [];

    // 1.1 PROCESS ROUND 0 (FOUNDERS)
    if (roundZero) {
      console.log(`📌 Processing Round 0 (ID: ${roundZero.id})`);

      try {
        const founderData = safeJSONParse(roundZero.founder_data);

        if (
          founderData &&
          founderData.founders &&
          Array.isArray(founderData.founders)
        ) {
          founderData.founders.forEach((founder, index) => {
            const shares = toNumber(founder.shares, 0);
            const firstName = founder.firstName || "";
            const lastName = founder.lastName || "";
            const name =
              `${firstName} ${lastName}`.trim() || `Founder ${index + 1}`;

            totalExistingShares += shares;

            existingShareholders.push({
              id: `founder_${index}`,
              name: name,
              type: "Founder",
              category: "Founder",
              shares: shares,
              commonShares: shares,
              preferredShares: 0,
              source: "Round 0",
              source_round_id: roundZero.id,
              investmentAmount: 0,
              isExisting: true,
            });
          });
        } else {
          const founderShares = toNumber(roundZero.issuedshares, 100000);
          totalExistingShares = founderShares;

          existingShareholders.push({
            id: "founders_group",
            name: "Founders",
            type: "Founder",
            category: "Founder",
            shares: founderShares,
            commonShares: founderShares,
            preferredShares: 0,
            source: "Round 0",
            source_round_id: roundZero.id,
            investmentAmount: 0,
            isExisting: true,
          });
        }

        console.log(
          `✅ Round 0: ${totalExistingShares.toLocaleString()} founder shares`,
        );
      } catch (error) {
        console.log(`❌ Error processing Round 0:`, error.message);
        const defaultShares = 100000;
        totalExistingShares = defaultShares;
        existingShareholders.push({
          id: "founders_default",
          name: "Founders",
          type: "Founder",
          shares: defaultShares,
          commonShares: defaultShares,
          source: "Round 0",
          isExisting: true,
        });
      }
    } else {
      return {
        success: false,
        error:
          "Round 0 not found. Please create founding share allocation first.",
      };
    }

    // 1.2 TRACK OPTION POOL FROM ROUND 0
    const roundZeroOptionPool = toNumber(roundZero.optionPoolPercent, 0);
    if (roundZeroOptionPool > existingOptionPoolPercent) {
      existingOptionPoolPercent = roundZeroOptionPool;
    }

    // 1.3 PROCESS ALL PREVIOUS ROUNDS DYNAMICALLY
    if (previousRounds && previousRounds.length > 0) {
      console.log(
        `\n📋 Processing ${previousRounds.length} previous rounds...`,
      );

      // We need to process rounds in sequence to build the cap table correctly
      let currentTotalShares = totalExistingShares;
      let currentFounderShares = totalExistingShares;
      let currentOptionPoolShares = 0;
      let currentOptionPoolPercent = existingOptionPoolPercent;

      previousRounds.forEach((prevRound, idx) => {
        try {
          const instrumentData = safeJSONParse(prevRound.instrument_type_data);
          console.log(
            `\n${idx + 1}. ${prevRound.nameOfRound} (${prevRound.instrumentType})`,
          );

          if (
            prevRound.instrumentType === "Safe" ||
            prevRound.instrumentType === "Convertible Note"
          ) {
            // Store convertible instruments for later processing
            const investment = toNumber(prevRound.roundsize, 0);

            convertibleInstruments.push({
              id: prevRound.id,
              name: `${prevRound.instrumentType} Investor`,
              instrumentType: prevRound.instrumentType,
              investment: investment,
              valuationCap: toNumber(
                prevRound.instrumentType === "Safe"
                  ? instrumentData.valuationCap
                  : instrumentData.valuationCap_note,
                0,
              ),
              discountRate: toNumber(
                prevRound.instrumentType === "Safe"
                  ? instrumentData.discountRate
                  : instrumentData.discountRate_note,
                0,
              ),
              status: "pending_conversion",
            });

            // Track option pool percentage
            const roundOptionPool = toNumber(prevRound.optionPoolPercent, 0);
            if (roundOptionPool > currentOptionPoolPercent) {
              currentOptionPoolPercent = roundOptionPool;
            }

            console.log(
              `   ⚠️ ${prevRound.instrumentType} added to pending conversion list`,
            );
          } else if (prevRound.instrumentType === "Common Stock") {
            // Common Stock round - new shares issued
            const roundShares = toNumber(prevRound.issuedshares, 0);
            const investment = toNumber(prevRound.roundsize, 0);
            const preMoneyValuation = toNumber(prevRound.pre_money, 0);

            if (roundShares > 0) {
              // Calculate share price for this round
              const sharePrice =
                currentTotalShares > 0
                  ? preMoneyValuation / currentTotalShares
                  : 0;

              // Calculate how many shares went to investors vs option pool
              const investorShares = Math.round(investment / sharePrice);
              const optionPoolShares = roundShares - investorShares;

              // Add common stock investors
              existingShareholders.push({
                id: `common_${prevRound.id}`,
                name: `Common Stock Investors (${prevRound.nameOfRound || "Common Stock Round"})`,
                type: "Common Investor",
                category: "Common Investor",
                shares: investorShares,
                commonShares: investorShares,
                preferredShares: 0,
                source: prevRound.nameOfRound || "Common Stock Round",
                source_round_id: prevRound.id,
                investmentAmount: investment,
                sharePrice: sharePrice,
                isExisting: true,
              });

              // Update option pool
              currentOptionPoolShares += optionPoolShares;
              currentTotalShares += roundShares;

              console.log(
                `   ✅ Added Common Stock: ${investorShares} investor shares`,
              );
              console.log(`   ✅ Added ${optionPoolShares} option pool shares`);
            }

            // Update option pool percentage
            const roundOptionPoolPost = toNumber(
              prevRound.optionPoolPercent_post,
              0,
            );
            if (roundOptionPoolPost > currentOptionPoolPercent) {
              currentOptionPoolPercent = roundOptionPoolPost;
            }
          } else if (prevRound.instrumentType === "Preferred Equity") {
            // PREFERRED EQUITY ROUND - This is complex because it converts SAFE/Notes

            const roundPreMoney = toNumber(prevRound.pre_money, 0);
            const roundInvestment = toNumber(prevRound.roundsize, 0);
            const roundSharesIssued = toNumber(prevRound.issuedshares, 0);

            console.log(
              `   Round ${prevRound.id}: Pre-money $${roundPreMoney}, Investment $${roundInvestment}, Issued shares ${roundSharesIssued}`,
            );

            // Step 1: Calculate share price for this round
            const sharePrice =
              currentTotalShares > 0 ? roundPreMoney / currentTotalShares : 0;
            console.log(`   Share price: $${sharePrice.toFixed(4)}`);

            // Step 2: Convert all pending convertible instruments
            let totalConvertedShares = 0;
            let totalConvertedInvestment = 0;

            if (convertibleInstruments.length > 0) {
              console.log(
                `   Converting ${convertibleInstruments.length} convertible instruments...`,
              );

              convertibleInstruments.forEach((conv, convIndex) => {
                // Calculate conversion price (min of discount price and cap price)
                const discountPrice =
                  sharePrice * (1 - conv.discountRate / 100);
                const capPrice =
                  conv.valuationCap > 0
                    ? conv.valuationCap / currentTotalShares
                    : 0;
                const conversionPrice =
                  capPrice > 0
                    ? Math.min(discountPrice, capPrice)
                    : discountPrice;

                const convertedShares = Math.round(
                  conv.investment / conversionPrice,
                );
                totalConvertedShares += convertedShares;
                totalConvertedInvestment += conv.investment;

                // Add converted investor to shareholders
                existingShareholders.push({
                  id: `converted_${prevRound.id}_${convIndex}`,
                  name: `${conv.instrumentType} Investor ${convIndex + 1}`,
                  type: "Converted Investor",
                  category: "Converted Investor",
                  shares: convertedShares,
                  commonShares: 0,
                  preferredShares: convertedShares,
                  source: `Converted in ${prevRound.nameOfRound}`,
                  source_round_id: prevRound.id,
                  investmentAmount: conv.investment,
                  sharePrice: conversionPrice,
                  isExisting: true,
                });

                console.log(
                  `   ✅ Converted ${conv.instrumentType}: ${convertedShares} shares @ $${conversionPrice.toFixed(4)}`,
                );
              });

              // Clear convertible instruments after conversion
              convertibleInstruments = [];
            }

            // Step 3: Calculate new Preferred Equity shares
            const newPreferredShares = Math.round(roundInvestment / sharePrice);

            // Add new Preferred Equity investors
            existingShareholders.push({
              id: `preferred_${prevRound.id}`,
              name: `${prevRound.shareClassType || "Preferred Equity"} Investors`,
              type: "Preferred Investor",
              category: "Preferred Investor",
              shares: newPreferredShares,
              commonShares: 0,
              preferredShares: newPreferredShares,
              source: prevRound.nameOfRound || "Preferred Equity Round",
              source_round_id: prevRound.id,
              investmentAmount: roundInvestment,
              sharePrice: sharePrice,
              isExisting: true,
            });

            console.log(
              `   ✅ New Preferred Equity: ${newPreferredShares} shares`,
            );

            // Step 4: Update total shares
            const totalNewSharesInRound =
              totalConvertedShares + newPreferredShares;
            currentTotalShares += totalNewSharesInRound;

            console.log(
              `   Total new shares this round: ${totalNewSharesInRound}`,
            );
            console.log(
              `   Cumulative total shares: ${currentTotalShares.toLocaleString()}`,
            );

            // Step 5: Handle option pool expansion
            const targetOptionPoolPercent = toNumber(
              prevRound.optionPoolPercent_post,
              0,
            );
            if (targetOptionPoolPercent > 0) {
              // Calculate current non-option shares
              const currentNonOptionShares =
                currentTotalShares - currentOptionPoolShares;

              // Calculate total with target pool
              const totalWithPool = Math.round(
                currentNonOptionShares / (1 - targetOptionPoolPercent / 100),
              );

              // Calculate new option shares needed
              const newOptionShares = Math.max(
                0,
                totalWithPool - currentTotalShares,
              );
              currentOptionPoolShares += newOptionShares;
              currentTotalShares = totalWithPool;
              currentOptionPoolPercent = targetOptionPoolPercent;

              console.log(
                `   Option pool expansion to ${targetOptionPoolPercent}%:`,
              );
              console.log(`   Added ${newOptionShares} new option shares`);
              console.log(
                `   Total option pool: ${currentOptionPoolShares.toLocaleString()} shares`,
              );
              console.log(
                `   Final total shares: ${currentTotalShares.toLocaleString()}`,
              );
            }
          }
        } catch (error) {
          console.log(
            `❌ Error processing round ${prevRound.id}:`,
            error.message,
          );
        }
      });

      // After processing all rounds, update the final totals
      totalExistingShares = currentTotalShares;
      existingOptionPoolShares = currentOptionPoolShares;
      existingOptionPoolPercent = currentOptionPoolPercent;

      console.log(`\n📊 FINAL TOTALS AFTER ALL PREVIOUS ROUNDS:`);
      console.log(
        `Total Existing Shares: ${totalExistingShares.toLocaleString()}`,
      );
      console.log(
        `Existing Option Pool: ${existingOptionPoolPercent}% (${existingOptionPoolShares.toLocaleString()} shares)`,
      );
      console.log(
        `Pending Convertible Instruments: ${convertibleInstruments.length}`,
      );
    }

    // Add the final option pool to shareholders
    if (existingOptionPoolShares > 0) {
      existingShareholders.push({
        id: "existing_option_pool",
        name: "Employee Option Pool",
        type: "Options",
        category: "Employee Pool",
        shares: existingOptionPoolShares,
        commonShares: existingOptionPoolShares,
        preferredShares: 0,
        source: "Previous Rounds",
        investmentAmount: 0,
        isExisting: true,
      });
    }

    // ============================================
    // 💰 STEP 2: CURRENT COMMON STOCK ROUND
    // ============================================

    const investmentSize = toNumber(round.roundsize, 0);
    const preMoneyValuation = toNumber(round.pre_money, 0);
    const targetOptionPoolPercent = toNumber(round.optionPoolPercent_post, 0);
    const currency = round.currency || "USD";

    // Validate inputs
    if (investmentSize <= 0 || preMoneyValuation <= 0) {
      return {
        success: false,
        error: "Invalid investment size or pre-money valuation",
        details: { investmentSize, preMoneyValuation, currency },
      };
    }

    console.log(`\n💰 CURRENT ROUND INPUTS:`);
    console.log(`Investment: $${investmentSize.toLocaleString()} ${currency}`);
    console.log(`Pre-money Valuation: $${preMoneyValuation.toLocaleString()}`);
    console.log(`Target Option Pool: ${targetOptionPoolPercent}%`);
    console.log(
      `Existing Total Shares: ${totalExistingShares.toLocaleString()}`,
    );

    // ============================================
    // 🎯 STEP 3: CALCULATE SHARE PRICE
    // ============================================
    const sharePrice =
      totalExistingShares > 0 ? preMoneyValuation / totalExistingShares : 0;

    console.log(`\n🎯 SHARE PRICE CALCULATION:`);
    console.log(
      `Formula: $${preMoneyValuation} ÷ ${totalExistingShares.toLocaleString()} shares`,
    );
    console.log(`Share Price: $${sharePrice.toFixed(6)} per share`);

    // ============================================
    // 📈 STEP 4: CALCULATE NEW INVESTMENT SHARES
    // ============================================
    const newInvestmentShares =
      sharePrice > 0 ? Math.round(investmentSize / sharePrice) : 0;

    const postMoneyValuation = preMoneyValuation + investmentSize;

    console.log(`\n📈 NEW INVESTMENT CALCULATION:`);
    console.log(`Formula: $${investmentSize} ÷ $${sharePrice.toFixed(6)}`);
    console.log(
      `New Investment Shares: ${newInvestmentShares.toLocaleString()}`,
    );
    console.log(
      `Post-money Valuation: $${postMoneyValuation.toLocaleString()}`,
    );

    // ============================================
    // 🎯 STEP 5: OPTION POOL EXPANSION
    // ============================================
    let newOptionShares = 0;
    let totalPostShares = totalExistingShares + newInvestmentShares;
    let totalOptionPoolShares = existingOptionPoolShares;

    if (targetOptionPoolPercent > 0) {
      const currentPoolPercent =
        totalExistingShares > 0
          ? (existingOptionPoolShares / totalExistingShares) * 100
          : 0;

      if (targetOptionPoolPercent > currentPoolPercent) {
        console.log(`\n⚠️ OPTION POOL EXPANSION NEEDED:`);
        console.log(
          `Current: ${currentPoolPercent.toFixed(1)}% → Target: ${targetOptionPoolPercent}%`,
        );

        // Calculate total shares excluding NEW options
        const totalSharesExcludingNewOptions =
          totalExistingShares + newInvestmentShares;

        // Apply target pool percentage
        totalPostShares = Math.round(
          totalSharesExcludingNewOptions / (1 - targetOptionPoolPercent / 100),
        );

        // Calculate new option shares needed
        newOptionShares = Math.max(
          0,
          totalPostShares - totalSharesExcludingNewOptions,
        );
        totalOptionPoolShares = existingOptionPoolShares + newOptionShares;

        console.log(
          `Total excluding new options: ${totalSharesExcludingNewOptions.toLocaleString()}`,
        );
        console.log(
          `Total with ${targetOptionPoolPercent}% pool: ${totalPostShares.toLocaleString()}`,
        );
        console.log(
          `New option shares needed: ${newOptionShares.toLocaleString()}`,
        );
        console.log(
          `Total option pool: ${totalOptionPoolShares.toLocaleString()} shares`,
        );
      } else {
        console.log(`\n✅ No option pool expansion needed`);
        totalPostShares = totalExistingShares + newInvestmentShares;
      }
    } else {
      console.log(`\n✅ No target option pool specified`);
      totalPostShares = totalExistingShares + newInvestmentShares;
    }

    // ============================================
    // 📋 STEP 6: BUILD PRE-INVESTMENT CAP TABLE
    // ============================================
    const preInvestmentShareholders = [];

    // Add existing shareholders
    existingShareholders.forEach((sh) => {
      const ownership = calculateOwnershipPercentage(
        sh.shares,
        totalExistingShares,
      );
      const value = sh.shares * sharePrice;

      preInvestmentShareholders.push({
        id: sh.id,
        name: sh.name,
        type: sh.type,
        category: sh.category,
        shares: sh.shares,
        ownership: parseFloat(ownership.toFixed(2)),
        value: Math.round(value),
        newShares: 0,
        investmentAmount: sh.investmentAmount || 0,
        sharePrice: parseFloat(sharePrice.toFixed(6)),
        source: sh.source,
        isExisting: true,
      });
    });

    // Add pending convertible instruments
    convertibleInstruments.forEach((conv, index) => {
      preInvestmentShareholders.push({
        id: `convertible_${conv.id}_${index}`,
        name: `${conv.instrumentType} Investor ${index + 1}`,
        type: "Convertible",
        category: "Pending Conversion",
        shares: 0,
        ownership: 0,
        value: 0,
        newShares: 0,
        investmentAmount: conv.investment,
        sharePrice: 0,
        source: `${conv.instrumentType} Round`,
        note: `Will convert at next Preferred Equity round`,
      });
    });

    // ============================================
    // 📊 STEP 7: BUILD POST-INVESTMENT CAP TABLE
    // ============================================
    const postInvestmentShareholders = [];
    const totalNewShares = newInvestmentShares + newOptionShares;

    // Add existing shareholders (diluted)
    existingShareholders.forEach((sh) => {
      if (sh.type === "Options") return; // Add option pool separately

      const ownership = calculateOwnershipPercentage(
        sh.shares,
        totalPostShares,
      );
      const value = (ownership / 100) * postMoneyValuation;

      postInvestmentShareholders.push({
        id: sh.id,
        name: sh.name,
        type: sh.type,
        category: sh.category,
        shares: sh.shares,
        ownership: parseFloat(ownership.toFixed(2)),
        value: Math.round(value),
        newShares: 0,
        investmentAmount: sh.investmentAmount || 0,
        sharePrice: parseFloat(sharePrice.toFixed(6)),
        source: sh.source,
        isExisting: true,
      });
    });

    // Add NEW Common Stock Investors
    if (newInvestmentShares > 0) {
      const investorOwnership = calculateOwnershipPercentage(
        newInvestmentShares,
        totalPostShares,
      );
      const investorValue = calculateValue(
        investorOwnership,
        postMoneyValuation,
      );

      postInvestmentShareholders.push({
        id: "new_common_investors",
        name: "Common Stock Investors",
        type: "Common Investor",
        category: "Common Investor",
        shares: newInvestmentShares,
        ownership: parseFloat(investorOwnership.toFixed(2)),
        value: Math.round(investorValue),
        newShares: newInvestmentShares,
        investmentAmount: investmentSize,
        sharePrice: parseFloat(sharePrice.toFixed(6)),
        source: round.nameOfRound || "Common Stock Round",
        note: `Purchased at $${sharePrice.toFixed(6)} per share`,
      });
    }

    // Add Employee Option Pool (expanded)
    if (totalOptionPoolShares > 0) {
      const poolOwnership = calculateOwnershipPercentage(
        totalOptionPoolShares,
        totalPostShares,
      );
      const poolValue = calculateValue(poolOwnership, postMoneyValuation);

      postInvestmentShareholders.push({
        id: "employee_option_pool",
        name: "Employee Option Pool",
        type: "Options",
        category: "Employee Pool",
        shares: totalOptionPoolShares,
        ownership: parseFloat(poolOwnership.toFixed(2)),
        value: Math.round(poolValue),
        newShares: newOptionShares,
        investmentAmount: 0,
        sharePrice: parseFloat(sharePrice.toFixed(6)),
        source: "Option Pool",
        breakdown: {
          existingShares: existingOptionPoolShares,
          newShares: newOptionShares,
          totalShares: totalOptionPoolShares,
        },
      });
    }

    // Add pending convertible instruments (still unconverted)
    convertibleInstruments.forEach((conv, index) => {
      postInvestmentShareholders.push({
        id: `convertible_post_${conv.id}_${index}`,
        name: `${conv.instrumentType} Investor ${index + 1}`,
        type: "Convertible",
        category: "Pending Conversion",
        shares: 0,
        ownership: 0,
        value: 0,
        newShares: 0,
        investmentAmount: conv.investment,
        sharePrice: 0,
        source: `${conv.instrumentType} Round`,
        note: `Will convert at next Preferred Equity round`,
      });
    });

    // ============================================
    // 🎯 STEP 8: BUILD FINAL RESPONSE
    // ============================================
    const investorOwnershipPercent =
      totalPostShares > 0 ? (newInvestmentShares / totalPostShares) * 100 : 0;

    const response = {
      success: true,
      roundType: round.nameOfRound || "Common Stock Round",
      instrumentType: "Common Stock",
      currency: currency,
      shareClassType: round.shareClassType,
      round_type: round.round_type || "Common Stock Round",
      // Debug information
      debug: {
        totalExistingShares: totalExistingShares,
        existingOptionPoolShares: existingOptionPoolShares,
        existingOptionPoolPercent: existingOptionPoolPercent,
        sharePrice: sharePrice,
      },

      // Calculations
      calculations: {
        // Input values
        investmentSize: investmentSize,
        preMoneyValuation: preMoneyValuation,
        targetOptionPoolPercent: targetOptionPoolPercent,

        // Core calculations
        sharePrice: parseFloat(sharePrice.toFixed(6)),
        newInvestmentShares: newInvestmentShares,
        additionalOptionShares: newOptionShares,
        totalNewShares: totalNewShares,
        investorOwnershipPercent: parseFloat(
          investorOwnershipPercent.toFixed(2),
        ),
        postMoneyValuation: postMoneyValuation,

        // Option pool
        existingOptionPoolPercent: parseFloat(
          existingOptionPoolPercent.toFixed(2),
        ),
        existingOptionPoolShares: existingOptionPoolShares,
        totalOptionPoolShares: totalOptionPoolShares,
        newOptionShares: newOptionShares,

        // Share counts
        preInvestmentTotalShares: totalExistingShares,
        postInvestmentTotalShares: totalPostShares,
      },

      // Cap Tables
      preInvestmentCapTable: {
        shareholders: preInvestmentShareholders,
        totalShares: totalExistingShares,
        totalValue: preMoneyValuation,
        message: `Before ${round.nameOfRound || "Common Stock"} investment (${existingOptionPoolPercent}% option pool)`,
      },

      postInvestmentCapTable: {
        shareholders: postInvestmentShareholders,
        totalShares: totalPostShares,
        totalValue: postMoneyValuation,
        message: `After ${round.nameOfRound || "Common Stock"} investment of $${investmentSize.toLocaleString()} ${currency}`,
      },
    };

    console.log("\n✅ CALCULATION COMPLETE");
    console.log("Final Results:");
    console.log("-".repeat(50));
    console.log("Share Price:", response.calculations.sharePrice);
    console.log(
      "New Investment Shares:",
      response.calculations.newInvestmentShares,
    );
    console.log("New Option Shares:", response.calculations.newOptionShares);
    console.log(
      "Total Post Shares:",
      response.calculations.postInvestmentTotalShares,
    );
    console.log(
      "Post-money Valuation:",
      response.calculations.postMoneyValuation,
    );
    console.log(
      "Investor Ownership:",
      response.calculations.investorOwnershipPercent + "%",
    );
    console.log("-".repeat(50));

    return response;
  } catch (error) {
    console.error("❌ Common Stock calculation error:", error);
    return {
      success: false,
      error: "Common Stock calculation failed",
      details: error.message,
      stack: error.stack,
    };
  }
}

function handleConvertibleNote_SeriesRoundCalculation(round, company_id, res) {
  db.query(
    `SELECT * FROM roundrecord WHERE company_id=? AND round_type='Round 0'`,
    [company_id],
    (err, roundZeroData) => {
      if (err)
        return res
          .status(500)
          .json({ success: false, message: "Database error" });
      if (roundZeroData.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Round 0 not found. Please create Round 0 first.",
        });
      }

      const roundZero = roundZeroData[0];

      // ✅ Get Convertible Note round (WITH INTEREST)
      db.query(
        `SELECT * FROM roundrecord WHERE company_id=? AND instrumentType='Convertible Note' AND id < ? ORDER BY id ASC`,
        [company_id, round.id],
        (err, convertibleNoteRounds) => {
          if (err)
            return res
              .status(500)
              .json({ success: false, message: "Database error" });

          if (convertibleNoteRounds.length === 0) {
            return res.status(400).json({
              success: false,
              message:
                "No Convertible Note round found before this Series A round.",
            });
          }

          const convertibleNoteRound = convertibleNoteRounds[0];

          try {
            const noteData =
              safeJSONParseRepeated(
                convertibleNoteRound.instrument_type_data,
                3,
              ) || {};

            // ✅ EXTRACT CONVERTIBLE NOTE DATA (WITH INTEREST)
            const convertibleNoteData = {
              investment_amount: toNumber(convertibleNoteRound.roundsize, 0),
              valuation_cap: toNumber(
                noteData.valuationCap_note,
                noteData.valuationCap,
                0,
              ),
              discount_rate:
                toNumber(noteData.discountRate_note, noteData.discountRate, 0) /
                100,
              interest_rate: toNumber(noteData.interestRate_note, 0) / 100,
              years_between: 2, // Default as per requirements
              existing_option_pool: toNumber(
                convertibleNoteRound.optionPoolPercent,
                0,
              ),
            };

            // ✅ SERIES A ROUND DATA
            const seriesAInvestment = toNumber(round.roundsize, 0);
            const preMoneyValuation = toNumber(round.pre_money, 0);
            const targetOptionPoolPercent = toNumber(
              round.optionPoolPercent_post,
              0,
            );

            // ✅ ROUND 0 FOUNDER DATA
            let roundZeroTotalShares = 0;
            let roundZeroFounders = [];

            try {
              if (roundZero.founder_data) {
                const founderData = safeJSONParseRepeated(
                  roundZero.founder_data,
                  3,
                );
                if (
                  founderData.founders &&
                  Array.isArray(founderData.founders)
                ) {
                  roundZeroFounders = founderData.founders;
                  // Sum individual founder shares
                  roundZeroTotalShares = founderData.founders.reduce(
                    (sum, founder) => {
                      return sum + toNumber(founder.shares, 0);
                    },
                    0,
                  );
                } else if (founderData.totalShares) {
                  roundZeroTotalShares = toNumber(founderData.totalShares, 0);
                }
              }

              if (roundZeroTotalShares === 0) {
                roundZeroTotalShares = toNumber(roundZero.issuedshares, 0);
              }
            } catch (error) {
              roundZeroTotalShares = toNumber(roundZero.issuedshares, 0);
            }

            console.log("🔢 INPUT DATA:");
            console.log(`   Founder shares: ${roundZeroTotalShares}`);
            console.log(
              `   Convertible Note investment: $${convertibleNoteData.investment_amount}`,
            );
            console.log(
              `   Interest rate: ${(
                convertibleNoteData.interest_rate * 100
              ).toFixed(1)}%`,
            );
            console.log(`   Years: ${convertibleNoteData.years_between}`);
            console.log(
              `   Discount rate: ${(
                convertibleNoteData.discount_rate * 100
              ).toFixed(1)}%`,
            );
            console.log(
              `   Valuation cap: $${convertibleNoteData.valuation_cap}`,
            );
            console.log(`   Series A investment: $${seriesAInvestment}`);
            console.log(`   Pre-money valuation: $${preMoneyValuation}`);

            // ✅ CALCULATION 1: EMPLOYEE SHARES FROM SEED ROUND
            let totalSharesBeforeSeriesA = roundZeroTotalShares;
            let employeeSharesSeedRound = 0;

            if (
              convertibleNoteData.existing_option_pool > 0 &&
              roundZeroTotalShares > 0
            ) {
              // Calculate total shares including seed option pool
              totalSharesBeforeSeriesA = Math.round(
                roundZeroTotalShares /
                  (1 - convertibleNoteData.existing_option_pool / 100),
              );
              employeeSharesSeedRound =
                totalSharesBeforeSeriesA - roundZeroTotalShares;
            }

            console.log("🔢 SEED OPTION POOL CALCULATION:");
            console.log(
              `   Total shares before Series A: ${totalSharesBeforeSeriesA}`,
            );
            console.log(
              `   Employee shares from seed: ${employeeSharesSeedRound}`,
            );

            // ✅ CALCULATION 2: SERIES A SHARE PRICE
            const sharePrice =
              totalSharesBeforeSeriesA > 0
                ? preMoneyValuation / totalSharesBeforeSeriesA
                : 0;

            // ✅ CALCULATION 3: CONVERTIBLE NOTE WITH INTEREST
            // Principal + Interest = Investment × (1 + Interest Rate)^Years
            const principalPlusInterest =
              convertibleNoteData.investment_amount *
              Math.pow(
                1 + convertibleNoteData.interest_rate,
                convertibleNoteData.years_between,
              );

            console.log("🔢 CONVERTIBLE NOTE INTEREST:");
            console.log(
              `   Original: $${convertibleNoteData.investment_amount}`,
            );
            console.log(
              `   After ${convertibleNoteData.years_between} years at ${(
                convertibleNoteData.interest_rate * 100
              ).toFixed(1)}%: $${principalPlusInterest.toFixed(2)}`,
            );

            // ✅ CALCULATION 4: CONVERSION PRICES
            const discountPrice =
              sharePrice * (1 - convertibleNoteData.discount_rate);
            const capPrice =
              convertibleNoteData.valuation_cap > 0
                ? convertibleNoteData.valuation_cap / totalSharesBeforeSeriesA
                : Infinity;

            // ✅ Optimal Price = MIN(Discount, Cap)
            const optimalPrice = Math.min(
              discountPrice > 0 ? discountPrice : Infinity,
              capPrice > 0 ? capPrice : Infinity,
            );
            const finalOptimalPrice =
              optimalPrice === Infinity ? sharePrice : optimalPrice;

            // ✅ Convertible Note Conversion Shares
            const noteConversionShares =
              finalOptimalPrice > 0
                ? Math.round(principalPlusInterest / finalOptimalPrice)
                : 0;

            // ✅ Convertible Note Conversion Value
            const noteConversionValue = noteConversionShares * sharePrice;

            // ✅ MOIC
            const noteMOIC =
              convertibleNoteData.investment_amount > 0
                ? (
                    noteConversionValue / convertibleNoteData.investment_amount
                  ).toFixed(2) + "X"
                : "0X";

            // ✅ Series A Investor Shares
            const seriesAShares =
              sharePrice > 0 ? Math.round(seriesAInvestment / sharePrice) : 0;
            const seriesAValue = seriesAShares * sharePrice;
            const seriesAMOIC =
              seriesAInvestment > 0
                ? (seriesAValue / seriesAInvestment).toFixed(2) + "X"
                : "0X";

            // ✅ CALCULATION 5: OPTION POOL (According to NEW requirements)
            // Step 1: Total shares excluding new option shares
            // = Founders (100,000) + Note Conversion (16,806) + Series A (37,037) = 153,843
            const totalSharesExcludingNewOptions =
              roundZeroTotalShares + noteConversionShares + seriesAShares;

            console.log("🔢 OPTION POOL CALCULATION:");
            console.log(`   Founders: ${roundZeroTotalShares}`);
            console.log(`   Note Conversion: ${noteConversionShares}`);
            console.log(`   Series A: ${seriesAShares}`);
            console.log(
              `   Total excluding new options: ${totalSharesExcludingNewOptions}`,
            );

            // Step 2: Total shares after 20% option pool
            // Formula: Total excluding options ÷ (1 - 20%) = 153,843 ÷ 0.8 = 192,303
            let totalPostShares = 0;
            let newOptionShares = 0;

            if (targetOptionPoolPercent > 0) {
              totalPostShares = Math.round(
                totalSharesExcludingNewOptions /
                  (1 - targetOptionPoolPercent / 100),
              );

              // Step 3: New option shares = Total after pool - Total excluding options - Existing employee shares
              // = 192,303 - 153,843 - 11,111 = 27,349
              newOptionShares = Math.max(
                0,
                totalPostShares -
                  totalSharesExcludingNewOptions -
                  employeeSharesSeedRound,
              );
            } else {
              totalPostShares =
                totalSharesBeforeSeriesA + noteConversionShares + seriesAShares;
            }

            // ✅ Final Post-Money Valuation
            const finalPostMoneyValuation = totalPostShares * sharePrice;

            console.log("🔢 FINAL TOTALS:");
            console.log(`   Total shares after pool: ${totalPostShares}`);
            console.log(`   New option shares: ${newOptionShares}`);
            console.log(
              `   Post-money valuation: ${finalPostMoneyValuation.toFixed(2)}`,
            );
            console.log(`   Share price: $${sharePrice.toFixed(4)}`);

            // ✅ BUILD CAP TABLES

            // PRE-SERIES A CAP TABLE (111,111 shares)
            const preSeriesAShareholders = [];

            // Individual Founders
            roundZeroFounders.forEach((founder, index) => {
              const shares = toNumber(founder.shares, 0);
              const ownership =
                totalSharesBeforeSeriesA > 0
                  ? (shares / totalSharesBeforeSeriesA) * 100
                  : 0;
              const value = (ownership / 100) * preMoneyValuation;

              preSeriesAShareholders.push({
                name:
                  `${founder.firstName || ""} ${
                    founder.lastName || ""
                  }`.trim() || `Founder ${index + 1}`,
                type: "Founder",
                shares: shares,
                ownership: parseFloat(ownership.toFixed(1)),
                value: Math.round(value),
              });
            });

            // Employee Pool
            if (employeeSharesSeedRound > 0) {
              const ownership =
                totalSharesBeforeSeriesA > 0
                  ? (employeeSharesSeedRound / totalSharesBeforeSeriesA) * 100
                  : 0;
              const value = (ownership / 100) * preMoneyValuation;

              preSeriesAShareholders.push({
                name: "Employee Option Pool",
                type: "Options Pool",
                shares: employeeSharesSeedRound,
                ownership: parseFloat(ownership.toFixed(1)),
                value: Math.round(value),
              });
            }

            // POST-SERIES A CAP TABLE (192,303 shares)
            const postSeriesAShareholders = [];

            // Individual Founders
            roundZeroFounders.forEach((founder, index) => {
              const shares = toNumber(founder.shares, 0);
              const ownership =
                totalPostShares > 0 ? (shares / totalPostShares) * 100 : 0;
              const value = (ownership / 100) * finalPostMoneyValuation;

              postSeriesAShareholders.push({
                name:
                  `${founder.firstName || ""} ${
                    founder.lastName || ""
                  }`.trim() || `Founder ${index + 1}`,
                type: "Founder",
                shares: shares,
                ownership: parseFloat(ownership.toFixed(1)),
                value: Math.round(value),
              });
            });

            // Employee Pool (Existing + New)
            const totalEmployeeShares =
              employeeSharesSeedRound + newOptionShares;
            if (totalEmployeeShares > 0) {
              const ownership =
                totalPostShares > 0
                  ? (totalEmployeeShares / totalPostShares) * 100
                  : 0;
              const value = (ownership / 100) * finalPostMoneyValuation;

              postSeriesAShareholders.push({
                name: "Employee Option Pool",
                type: "Options Pool",
                shares: totalEmployeeShares,
                ownership: parseFloat(ownership.toFixed(1)),
                value: Math.round(value),
                newShares: newOptionShares,
              });
            }

            // Convertible Note Investors
            if (noteConversionShares > 0) {
              const ownership =
                totalPostShares > 0
                  ? (noteConversionShares / totalPostShares) * 100
                  : 0;
              const value = (ownership / 100) * finalPostMoneyValuation;

              postSeriesAShareholders.push({
                name: "Convertible Note Investors",
                type: "Convertible Note Investor",
                shares: noteConversionShares,
                ownership: parseFloat(ownership.toFixed(1)),
                value: Math.round(value),
                originalInvestment: convertibleNoteData.investment_amount,
                conversionPrice: parseFloat(finalOptimalPrice.toFixed(2)),
                moic: noteMOIC,
                newShares: noteConversionShares,
                principalPlusInterest: Math.round(principalPlusInterest),
              });
            }

            // Series A Investors
            if (seriesAShares > 0) {
              const ownership =
                totalPostShares > 0
                  ? (seriesAShares / totalPostShares) * 100
                  : 0;
              const value = (ownership / 100) * finalPostMoneyValuation;

              postSeriesAShareholders.push({
                name: "Series A Investors",
                type: "Series A Investor",
                shares: seriesAShares,
                ownership: parseFloat(ownership.toFixed(1)),
                value: Math.round(value),
                investment: seriesAInvestment,
                sharePrice: parseFloat(sharePrice.toFixed(2)),
                moic: seriesAMOIC,
                newShares: seriesAShares,
              });
            }

            // ✅ FINAL RESPONSE
            const response = {
              success: true,
              message:
                "Convertible Note (with interest) Series A calculation completed successfully",

              shareClassType: round.shareClassType,
              roundType: round.nameOfRound,
              instrumentType: round.instrumentType,
              round_type: round.round_type,
              currency: round.currency || "USD",
              isSeriesA: true,
              hasConvertibleNoteConversion: true,

              calculations: {
                // Basic
                preMoneyValuation,
                postMoneyValuation: Math.round(finalPostMoneyValuation),
                sharePrice: parseFloat(sharePrice.toFixed(4)),

                // Convertible Note WITH INTEREST
                seedInvestment: convertibleNoteData.investment_amount,
                interestRate: (convertibleNoteData.interest_rate * 100).toFixed(
                  1,
                ),
                yearsBetweenRounds: convertibleNoteData.years_between,
                principalPlusInterest: Math.round(principalPlusInterest),
                discountRate: (convertibleNoteData.discount_rate * 100).toFixed(
                  1,
                ),
                valuationCap: convertibleNoteData.valuation_cap,
                seedConversionShares: noteConversionShares,
                seedConversionValue: Math.round(noteConversionValue),
                seedMOIC: noteMOIC,

                // Series A
                seriesAInvestment,
                seriesAShares,
                seriesAValue: Math.round(seriesAValue),
                seriesAMOIC,

                // Option Pool
                existingOptionPoolPercent:
                  convertibleNoteData.existing_option_pool,
                targetOptionPoolPercent,
                newOptionShares,

                // Totals
                roundZeroTotalShares,
                employeeSharesSeedRound,
                totalSharesPreSeriesA: totalSharesBeforeSeriesA,
                totalPostShares,
                newSharesIssued:
                  noteConversionShares + seriesAShares + newOptionShares,
              },

              // Cap Tables
              preSeedCapTable: {
                shareholders: preSeriesAShareholders,
                totalShares: totalSharesBeforeSeriesA,
                totalValue: preMoneyValuation,
              },

              postSeedCapTable: {
                shareholders: postSeriesAShareholders,
                totalShares: totalPostShares,
                totalValue: Math.round(finalPostMoneyValuation),
              },
            };

            return res.status(200).json({
              success: true,
              message:
                "Convertible Note (with interest) calculation successful",
              round: round,
              capTable: response,
            });
          } catch (error) {
            console.error("Error in calculation:", error);
            return res.status(500).json({
              success: false,
              message: "Error in calculation",
              error: error.message,
            });
          }
        },
      );
    },
  );
}
function handleConvertibleNoteRoundCalculation(
  round,
  company_id,
  instrumentData,
  res,
) {
  db.query(
    `SELECT * FROM roundrecord WHERE company_id=? AND round_type='Round 0'`,
    [company_id],
    (err, roundZeroData) => {
      if (err)
        return res
          .status(500)
          .json({ success: false, message: "Database error", error: err });

      if (roundZeroData.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            "Round 0 (Incorporation) data not found. Please create Round 0 first.",
        });
      }

      const roundZero = roundZeroData[0];

      // Parse Round 1 (Seed Convertible Note) data from form
      const companyValue = toNumber(round.pre_money, 0); // Company Value (Input #1)
      const investmentSize = toNumber(round.roundsize, 0); // Investment Size (Input #2 & #4)
      const discountRate = toNumber(instrumentData.discountRate_note, 0) / 100; // Conversion Discount (Input #3)
      const valuationCap = toNumber(instrumentData.valuationCap_note, 0); // Valuation Cap
      const interestRate = toNumber(instrumentData.interestRate_note, 0) / 100; // Interest Rate %
      const maturityDate = instrumentData.maturityDate || null;
      const optionPoolPercent = toNumber(round.optionPoolPercent, 0) / 100; // Pre-Seed Option Pool % (Input #5)

      // Parse Round 0 founder data
      let roundZeroTotalShares = 0;
      let roundZeroFounders = [];

      try {
        if (roundZero.founder_data) {
          const founderData = safeJSONParseRepeated(roundZero.founder_data, 3);
          roundZeroTotalShares =
            toNumber(founderData.totalShares, 0) ||
            toNumber(roundZero.issuedshares, 0);

          if (founderData.founders && Array.isArray(founderData.founders)) {
            roundZeroFounders = founderData.founders;
          }
        } else {
          roundZeroTotalShares = toNumber(roundZero.issuedshares, 0);
        }
      } catch (error) {
        roundZeroTotalShares = toNumber(roundZero.issuedshares, 0);
      }

      // ============================================
      // ✅ CALCULATIONS ACCORDING TO DOC REQUIREMENTS
      // ============================================

      // 1. CALCULATE EMPLOYEE SHARES (from Option Pool %)
      const employeeShares = Math.round(
        (roundZeroTotalShares * optionPoolPercent) / (1 - optionPoolPercent),
      );

      // 2. TOTAL SHARES PRE-SEED (FOUNDERS + EMPLOYEE POOL)
      const totalSharesPreSeed = roundZeroTotalShares + employeeShares;

      // 3. SHARE PRICE (for valuation purposes only)
      const sharePrice =
        totalSharesPreSeed > 0 ? companyValue / totalSharesPreSeed : 0;

      // 4. POST-MONEY VALUATION (Company Value + Investment Size)
      const postMoneyValuation = companyValue + investmentSize;

      // ============================================
      // ✅ PRE-SEED CAP TABLE (Before Convertible Notes)
      // ============================================
      let preSeedShareholders = [];
      let totalFoundersValue = 0;
      let totalEmployeeValue = 0;

      // Add Founders
      if (roundZeroFounders && roundZeroFounders.length > 0) {
        roundZeroFounders.forEach((founder, index) => {
          const shares = toNumber(founder.shares, 0);
          if (shares > 0) {
            const ownership =
              totalSharesPreSeed > 0 ? (shares / totalSharesPreSeed) * 100 : 0;
            const value = (ownership / 100) * companyValue;
            totalFoundersValue += value;

            preSeedShareholders.push({
              name:
                `${founder.firstName || ""} ${founder.lastName || ""}`.trim() ||
                `F${index + 1}`,
              fullName: `${founder.firstName || ""} ${
                founder.lastName || ""
              }`.trim(),
              type: "Founder",
              shares: shares,
              ownership: ownership.toFixed(1),
              value: Math.round(value),
              newShares: 0,
              voting: founder.voting || "voting",
              email: founder.email || "-",
              note: `F${index + 1} Founder`,
            });
          }
        });
      }

      // Add Employee Option Pool
      if (employeeShares > 0) {
        const employeeOwnership =
          totalSharesPreSeed > 0
            ? (employeeShares / totalSharesPreSeed) * 100
            : 0;
        const employeeValue = (employeeOwnership / 100) * companyValue;
        totalEmployeeValue = employeeValue;

        preSeedShareholders.push({
          name: "Employee Option Pool",
          fullName: "Employee Option Pool",
          type: "Options Pool",
          shares: employeeShares,
          ownership: employeeOwnership.toFixed(1),
          value: Math.round(employeeValue),
          newShares: employeeShares,
          voting: "non-voting",
          note: `${(optionPoolPercent * 100).toFixed(1)}% pool`,
        });
      }

      // ============================================
      // ✅ POST-SEED CAP TABLE (After Convertible Notes)
      // ============================================
      let postSeedShareholders = [...preSeedShareholders];

      // Convertible Note Investors - NO SHARES ISSUED YET
      // Get actual investors from database
      db.query(
        `SELECT ir.*, COALESCE(ii.first_name,'') AS first_name, COALESCE(ii.last_name,'') AS last_name, COALESCE(ii.email,'') AS email
         FROM investorrequest_company ir
         LEFT JOIN investor_information ii ON ir.investor_id = ii.id
         WHERE ir.roundrecord_id=? AND ir.company_id=? AND ir.request_confirm='Yes'`,
        [round.id, company_id],
        (err, investors) => {
          if (err) {
            console.error("Error fetching investors:", err);
            investors = [];
          }

          let totalConfirmedInvestment = 0;
          let investorCount = 0;

          if (investors && investors.length > 0) {
            investors.forEach((investor, index) => {
              const investmentAmount = toNumber(investor.investment_amount, 0);
              if (investmentAmount > 0) {
                totalConfirmedInvestment += investmentAmount;
                investorCount++;

                postSeedShareholders.push({
                  name:
                    `${investor.first_name || ""} ${
                      investor.last_name || ""
                    }`.trim() || `Investor ${index + 1}`,
                  fullName: `${investor.first_name || ""} ${
                    investor.last_name || ""
                  }`.trim(),
                  type: "Convertible Note Investor",
                  shares: 0, // NO SHARES ISSUED - CONVERTIBLE NOTES
                  ownership: 0, // 0% ownership until conversion
                  value: 0,
                  investmentAmount: investmentAmount,
                  voting: "non-voting",
                  note: `Convertible Note - Will convert at next priced round`,
                  isConvertibleNote: true,
                  convertibleDetails: {
                    discountRate: (discountRate * 100).toFixed(1),
                    valuationCap: valuationCap,
                    interestRate: (interestRate * 100).toFixed(1),
                    maturityDate: maturityDate,
                  },
                });
              }
            });
          }

          // If no investors or partial investment, show "Available for Investment"
          const availableForInvestment = Math.max(
            0,
            investmentSize - totalConfirmedInvestment,
          );
          if (availableForInvestment > 0) {
            postSeedShareholders.push({
              name: "Available for Convertible Note Investment",
              fullName: "Available for Convertible Note Investment",
              type: "Available Investment",
              shares: 0,
              ownership: 0,
              value: 0,
              investmentAmount: availableForInvestment,
              voting: "non-voting",
              note: `Convertible Note round not fully subscribed`,
              isAvailable: true,
            });
          }

          // ============================================
          // ✅ CREATE CALCULATIONS OBJECT
          // ============================================
          const calculations = {
            // Inputs from document requirements
            companyValue: companyValue, // Input #1
            investmentSize: investmentSize, // Input #2 & #4
            discountRate: (discountRate * 100).toFixed(1), // Input #3
            valuationCap: valuationCap,
            interestRate: (interestRate * 100).toFixed(1),
            optionPoolPercent: (optionPoolPercent * 100).toFixed(1), // Input #5

            // Calculated outputs
            postMoneyValuation: postMoneyValuation, // Output #1
            postInvestmentShares: totalSharesPreSeed, // Output #2 (no change in shares)
            sharePrice: sharePrice.toFixed(4),

            // Share breakdown
            roundZeroTotalShares: roundZeroTotalShares,
            employeeShares: employeeShares,
            totalSharesPreSeed: totalSharesPreSeed,
            totalSharesPostSeed: totalSharesPreSeed, // Same as pre-seed (no new shares)

            // Investment tracking
            totalConfirmedInvestment: totalConfirmedInvestment,
            availableForInvestment: availableForInvestment,
            investorCount: investorCount,

            // Ownership summary
            totalFoundersOwnership: (
              (totalFoundersValue / companyValue) *
              100
            ).toFixed(1),
            totalEmployeeOwnership: (
              (totalEmployeeValue / companyValue) *
              100
            ).toFixed(1),
            totalInvestorOwnership: "0.0", // Convertible notes have 0% until conversion

            // Values
            totalFoundersValue: Math.round(totalFoundersValue),
            totalEmployeeValue: Math.round(totalEmployeeValue),
            totalCompanyValue: companyValue,
            totalPostMoneyValue: postMoneyValuation,
          };

          // ============================================
          // ✅ CREATE RESPONSE DATA
          // ============================================
          const capTableData = {
            // Basic info
            shareClassType: round.shareClassType,
            roundType: round.nameOfRound || "Seed Round (Convertible Notes)",
            round_type: round.round_type,
            instrumentType: round.instrumentType,
            currency: round.currency || "USD",
            isConvertibleNoteRound: true,
            hasInvestors: investorCount > 0,

            // Pre-seed cap table (Before investment)
            preSeedCapTable: {
              shareholders: preSeedShareholders,
              totalShares: totalSharesPreSeed,
              totalValue: companyValue,
              message: "Before Convertible Note investment",
              summary: {
                founders: `${
                  preSeedShareholders.filter((s) => s.type === "Founder").length
                } founders`,
                employeePool: `${(optionPoolPercent * 100).toFixed(
                  1,
                )}% option pool`,
                totalFoundersOwnership: `${(
                  (totalFoundersValue / companyValue) *
                  100
                ).toFixed(1)}%`,
                totalEmployeeOwnership: `${(
                  (totalEmployeeValue / companyValue) *
                  100
                ).toFixed(1)}%`,
              },
            },

            // Post-seed cap table (After investment - NO SHARES ISSUED)
            postSeedCapTable: {
              shareholders: postSeedShareholders,
              totalShares: totalSharesPreSeed, // No change in shares
              totalValue: postMoneyValuation,
              message: `After ${
                totalConfirmedInvestment > 0
                  ? `${totalConfirmedInvestment.toLocaleString()} ${
                      round.currency || "USD"
                    }`
                  : "Convertible Note"
              } investment - 0 shares issued`,
              summary: {
                convertibleNotes: `${investorCount} investor(s)`,
                totalInvestment: totalConfirmedInvestment,
                availableInvestment: availableForInvestment,
                note: "Convertible notes will convert at next priced equity round",
              },
            },

            // Calculations for display
            calculations: calculations,

            // Important notes
            notes: [
              "⚠️ IMPORTANT: Convertible Notes do NOT issue shares in this round",
              "📝 Notes will convert to equity at the next priced financing round (Series A)",
              `💰 Conversion terms: ${(discountRate * 100).toFixed(
                1,
              )}% discount OR ${valuationCap.toLocaleString()} ${
                round.currency || "USD"
              } valuation cap`,
              `📈 Interest accrual: ${(interestRate * 100).toFixed(
                1,
              )}% per annum`,
            ],
          };

          return res.status(200).json({
            success: true,
            message: "Convertible Note round calculated successfully",
            round: round,
            capTable: capTableData,
          });
        },
      );
    },
  );
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

// COMPLETE FIXED calculateInvestmentRoundCapTable function
// Replace your existing function with this one

// ADD THIS DEBUG CODE to your calculateInvestmentRoundCapTable function
// To find out why founders are not appearing

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

function calculateInvestmentRoundCapTable(round, investors, roundZero) {
  // Parse Round 0 founder data - robust version
  let roundZeroFounders = [];
  let roundZeroTotalShares = 0;
  let originalPricePerShare = 0.001;

  try {
    if (roundZero && roundZero.founder_data) {
      const parsed =
        safeJSONParseRepeated(roundZero.founder_data, 5) ||
        roundZero.founder_data;
      const founderData =
        typeof parsed === "string" ? JSON.parse(parsed) || parsed : parsed;

      // Normalize
      roundZeroFounders = normalizeFounders(founderData);

      // Try to get total shares & price per share from founderData (object)
      if (founderData && typeof founderData === "object") {
        roundZeroTotalShares =
          toNumber(founderData.totalShares, roundZeroTotalShares) ||
          toNumber(founderData.total_founder_shares, roundZeroTotalShares) ||
          toNumber(roundZero.issuedshares, 0);

        originalPricePerShare =
          toNumber(
            founderData.pricePerShare,
            founderData.price_per_share || 0.001,
          ) || 0.001;
      }

      // If founders array items contain numeric strings for shares, ensure they are numbers
      roundZeroFounders = (roundZeroFounders || []).map((f) => {
        const shares = toNumber(
          f.shares || f.shareCount || f.share_count || f.shares_count,
          0,
        );
        return Object.assign({}, f, { shares });
      });
    } else {
      roundZeroTotalShares = toNumber(roundZero.issuedshares, 0);
    }
  } catch (error) {
    roundZeroTotalShares = toNumber(roundZero.issuedshares, 0);
  }

  // If no founders found but we have shares, create generic founders
  if (
    (!roundZeroFounders || roundZeroFounders.length === 0) &&
    roundZeroTotalShares > 0
  ) {
    roundZeroFounders = [
      {
        name: "Founder 1",
        fullName: "Founder 1",
        shares: roundZeroTotalShares,
        shareType: "common",
        voting: "Yes",
      },
    ];
  }

  // Parse investment round parameters
  console.log(round.roundsize);
  const investmentSize = toNumber(round.roundsize, 0);
  const preMoneyValuation = toNumber(round.pre_money, 0);
  const optionPoolPercent = toNumber(round.optionPoolPercent, 0);

  // Liquidation handling
  // Save में - liquidationpreferences को string के रूप में save करें
  const liquidationText = "1x"; // या "2x", "3x"

  // Retrieve में
  let liquidationMultiple = 1.0;
  if (round.liquidation) {
    const pref = round.liquidation.trim().toLowerCase();
    if (pref.includes("1x")) liquidationMultiple = 1.0;
    else if (pref.includes("2x")) liquidationMultiple = 2.0;
    else if (pref.includes("3x")) liquidationMultiple = 3.0;
    else {
      // Fallback - try to extract number
      const match = pref.match(/(\d+(\.\d+)?)x/);
      liquidationMultiple = match ? parseFloat(match[1]) : 1.0;
    }
  }

  // Validate
  if (investmentSize <= 0 || preMoneyValuation <= 0) {
    return {
      roundType: round.nameOfRound || "Investment Round",
      currency: round.currency || "USD",
      error: "Missing required parameters: investmentSize or preMoneyValuation",
    };
  }

  if (roundZeroTotalShares <= 0) {
    return {
      roundType: round.nameOfRound || "Investment Round",
      currency: round.currency || "USD",
      error: "No shares found from Round 0. Please complete Round 0 first.",
    };
  }

  // Calculations
  const postMoneyValuation = investmentSize + preMoneyValuation;
  const investorOwnershipPercent = (investmentSize / postMoneyValuation) * 100;

  // Calculate option pool shares (create new pool to reach specified post-money % of company)
  const optionPoolShares =
    optionPoolPercent > 0
      ? Math.round(
          (roundZeroTotalShares * (optionPoolPercent / 100)) /
            (1 - optionPoolPercent / 100),
        )
      : 0;

  const totalSharesPreSeed = roundZeroTotalShares + optionPoolShares;
  const totalSharesPostInvestment = Math.round(
    totalSharesPreSeed / (1 - investorOwnershipPercent / 100),
  );
  const newSharesIssued = totalSharesPostInvestment - totalSharesPreSeed;
  console.log(newSharesIssued, "ll");
  const sharePrice = newSharesIssued > 0 ? investmentSize / newSharesIssued : 0;
  console.log(sharePrice, "ttt");
  // ===== PRE-SEED CAP TABLE =====
  let preSeedShareholders = [];

  // ADD FOUNDERS to Pre-Seed
  if (roundZeroFounders && roundZeroFounders.length > 0) {
    roundZeroFounders.forEach((founder, index) => {
      const shares = toNumber(founder.shares, 0);
      if (shares > 0) {
        const preSeedOwnership =
          totalSharesPreSeed > 0 ? (shares / totalSharesPreSeed) * 100 : 0;
        const preSeedValue = (preSeedOwnership / 100) * preMoneyValuation;

        preSeedShareholders.push({
          name: founder.firstName + " " + founder.lastName,
          fullName: founder.fullName || founder.name || `F ${index + 1}`,
          firstName:
            founder.firstName || (founder.name || "").split(" ")[0] || "",
          lastName:
            founder.lastName || (founder.name || "").split(" ")[1] || "",
          email: founder.email || "-",
          phone: founder.phone || "-",
          type: "Founder",
          shares: shares,
          ownership: preSeedOwnership,
          value: preSeedValue,
          shareType: founder.shareType || "common",
          votingRights:
            founder.voting === "Yes"
              ? "voting"
              : founder.voting === "No"
                ? "non-voting"
                : founder.voting || "voting",
        });
      }
    });
  }

  // Add employee pool to Pre-Seed
  if (optionPoolShares > 0) {
    const employeePreSeedOwnership =
      totalSharesPreSeed > 0
        ? (optionPoolShares / totalSharesPreSeed) * 100
        : 0;
    const employeePreSeedValue =
      (employeePreSeedOwnership / 100) * preMoneyValuation;
    preSeedShareholders.push({
      name: "Option Pool",
      fullName: "Option Pool",
      type: "Options Pool",
      shares: optionPoolShares,
      ownership: Math.round(employeePreSeedOwnership),
      value: employeePreSeedValue,
      votingRights: "non-voting",
    });
  }

  // ===== POST-SEED CAP TABLE =====
  let postSeedShareholders = [];

  // ADD FOUNDERS to Post-Seed
  if (roundZeroFounders && roundZeroFounders.length > 0) {
    roundZeroFounders.forEach((founder, index) => {
      const shares = toNumber(founder.shares, 0);
      if (shares > 0) {
        const postSeedOwnership =
          totalSharesPostInvestment > 0
            ? (shares / totalSharesPostInvestment) * 100
            : 0;
        const postSeedValue = shares * sharePrice;

        postSeedShareholders.push({
          name: founder.firstName + " " + founder.lastName,
          fullName: founder.fullName || founder.name || `Founder ${index + 1}`,
          firstName:
            founder.firstName || (founder.name || "").split(" ")[0] || "",
          lastName:
            founder.lastName || (founder.name || "").split(" ")[1] || "",
          email: founder.email || "-",
          phone: founder.phone || "-",
          type: "Founder",
          shares: shares,
          ownership: postSeedOwnership,
          value: postSeedValue,
          shareType: founder.shareType || "common",
          votingRights:
            founder.voting === "Yes"
              ? "voting"
              : founder.voting === "No"
                ? "non-voting"
                : founder.voting || "voting",
          newShares: 0,
        });
      }
    });
  }

  // Add employee pool to Post-Seed
  if (optionPoolShares > 0) {
    const employeePostSeedOwnership =
      totalSharesPostInvestment > 0
        ? (optionPoolShares / totalSharesPostInvestment) * 100
        : 0;
    const employeePostSeedValue = optionPoolShares * sharePrice;

    postSeedShareholders.push({
      name: "Option Pool",
      fullName: "Option Pool",
      type: "Options Pool",
      shares: optionPoolShares,
      ownership: employeePostSeedOwnership,
      value: employeePostSeedValue,
      votingRights: "non-voting",
      newShares: 0,
    });
  }

  // Add investors - CORRECTED LOGIC
  if (!investors || investors.length === 0) {
    // Generic investor - use full round investment size
    const investorOwnership =
      totalSharesPostInvestment > 0
        ? (newSharesIssued / totalSharesPostInvestment) * 100
        : 0;
    const investorValue = newSharesIssued * sharePrice;

    postSeedShareholders.push({
      name: "Seed Investors",
      fullName: "Seed Investors",
      type: "Investor",
      shares: newSharesIssued,
      ownership: investorOwnership,
      value: investorValue,
      investmentAmount: investmentSize,
      votingRights: "voting",
      newShares: newSharesIssued,
      isGeneric: true,
    });
  } else {
    // Specific investors - CORRECTED VERSION
    let totalConfirmedInvestment = investors.reduce((sum, investor) => {
      return sum + toNumber(investor.investment_amount, 0);
    }, 0);

    // If total confirmed investment is less than round size, adjust calculations
    const effectiveInvestmentSize = Math.min(
      totalConfirmedInvestment,
      investmentSize,
    );
    const adjustedNewSharesIssued = Math.round(
      (effectiveInvestmentSize / investmentSize) * newSharesIssued,
    );

    let remainingShares = adjustedNewSharesIssued;
    let allocated = 0;

    investors.forEach((investor, index) => {
      const investmentAmount = toNumber(investor.investment_amount, 0);

      // Calculate shares based on ACTUAL investment proportion
      let investorShares = Math.round(
        (investmentAmount / totalConfirmedInvestment) * adjustedNewSharesIssued,
      );

      // Last investor gets remaining shares to avoid rounding issues
      if (index === investors.length - 1) {
        investorShares = remainingShares;
      } else {
        remainingShares -= investorShares;
      }

      allocated += investorShares;

      const investorOwnership =
        totalSharesPostInvestment > 0
          ? (investorShares / totalSharesPostInvestment) * 100
          : 0;
      const investorValue = investorShares * sharePrice;

      postSeedShareholders.push({
        name:
          `${investor.first_name || ""} ${investor.last_name || ""}`.trim() ||
          `Investor ${index + 1}`,
        fullName:
          `${investor.first_name || ""} ${investor.last_name || ""}`.trim() ||
          `Investor ${index + 1}`,
        firstName: investor.first_name || "",
        lastName: investor.last_name || "",
        email: investor.email || "-",
        phone: "-",
        type: "Investor",
        shares: investorShares,
        ownership: investorOwnership,
        value: investorValue,
        investmentAmount: investmentAmount,
        votingRights: "voting",
        newShares: investorShares,
        isGeneric: false,
      });
    });

    // If round is not fully subscribed, show the difference
    if (totalConfirmedInvestment < investmentSize) {
      const unsubscribedShares = newSharesIssued - adjustedNewSharesIssued;
      const unsubscribedOwnership =
        totalSharesPostInvestment > 0
          ? (unsubscribedShares / totalSharesPostInvestment) * 100
          : 0;
      const unsubscribedValue = unsubscribedShares * sharePrice;

      postSeedShareholders.push({
        name: "Available for Investment",
        fullName: "Available for Investment",
        type: "Available",
        shares: unsubscribedShares,
        ownership: unsubscribedOwnership,
        value: unsubscribedValue,
        investmentAmount: investmentSize - totalConfirmedInvestment,
        votingRights: "non-voting",
        newShares: unsubscribedShares,
        isGeneric: true,
        note: `Round not fully subscribed - ${
          investmentSize - totalConfirmedInvestment
        } remaining`,
      });
    }
  }

  // Calculate totals
  const totalPostSeedShares = postSeedShareholders.reduce(
    (sum, s) => sum + toNumber(s.shares, 0),
    0,
  );
  const totalPostSeedValue = postSeedShareholders.reduce(
    (sum, s) => sum + toNumber(s.value, 0),
    0,
  );

  const chartData = {
    labels: postSeedShareholders.map((s) => s.name),
    datasets: [
      {
        label: "Post-Investment Ownership %",
        data: postSeedShareholders.map((s) =>
          Number(toNumber(s.ownership, 0).toFixed(2)),
        ),
        backgroundColor: postSeedShareholders.map((s) =>
          s.type === "Founder"
            ? "hsl(120,70%,50%)"
            : s.type === "Options Pool"
              ? "hsl(40,70%,50%)"
              : s.type === "Available"
                ? "hsl(0,70%,50%)"
                : "hsl(220,70%,50%)",
        ),
      },
    ],
  };

  return {
    roundType: round.nameOfRound || "Investment Round",
    round_type: round.round_type,
    shareClassType: round.shareClassType,
    instrumentType: round.instrumentType,
    currency: round.currency || "USD",
    totalShares: totalPostSeedShares,
    totalValue: totalPostSeedValue,
    shareholders: postSeedShareholders,
    preSeedShareholders: preSeedShareholders,
    chartData,
    calculations: {
      investmentSize,
      preMoneyValuation,
      optionPoolPercent,
      liquidationMultiple,
      postMoneyValuation,
      investorOwnershipPercent,
      sharePrice,
      newShares: newSharesIssued,
      postInvestmentTotalShares: totalSharesPostInvestment,
      preSeedTotalShares: totalSharesPreSeed,
      optionPoolShares,
      roundZeroTotalShares,
      originalPricePerShare,
      originalTotalValue: roundZeroTotalShares * originalPricePerShare,
      hasGenericInvestors: !investors || investors.length === 0,
    },
    isRoundZero: false,
  };
}

// Safe Round

function handlePreferredEquityRoundSafeAndConvertibleCalculation(
  round,
  company_id,
  res,
) {
  db.query(
    `SELECT * FROM roundrecord WHERE company_id=? AND round_type='Round 0'`,
    [company_id],
    (err, roundZeroData) => {
      if (err)
        return res
          .status(500)
          .json({ success: false, message: "Database error" });
      if (roundZeroData.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Round 0 not found. Please create Round 0 first.",
        });
      }

      const roundZero = roundZeroData[0];

      // ✅ Get ALL previous rounds (Convertible, SAFE, AND Common Stock)
      db.query(
        `SELECT * FROM roundrecord WHERE company_id=? AND id < ? And round_type = 'Investment' ORDER BY id ASC`,
        [company_id, round.id],
        (err, allPreviousRounds) => {
          if (err)
            return res
              .status(500)
              .json({ success: false, message: "Database error" });

          // ✅ Parse Round 0 Founder Data
          let roundZeroTotalShares = 0;
          let roundZeroFounders = [];

          try {
            if (roundZero.founder_data) {
              const founderData = safeJSONParseRepeated_preferred(
                roundZero.founder_data,
                3,
              );
              roundZeroTotalShares =
                toNumber(founderData.totalShares, 0) ||
                toNumber(roundZero.issuedshares, 0);
              if (founderData.founders && Array.isArray(founderData.founders)) {
                roundZeroFounders = founderData.founders;
              }
            } else {
              roundZeroTotalShares = toNumber(roundZero.issuedshares, 0);
            }
          } catch (error) {
            roundZeroTotalShares = toNumber(roundZero.issuedshares, 0);
          }

          // ✅ PROCESS ALL PREVIOUS ROUNDS
          const allConvertibles = [];
          const commonStockRounds = [];
          let totalSeedInvestment = 0;
          let existingOptionPoolPercent = 0;
          let employeeSharesSeedRound = 0;
          let commonStockInvestors = [];
          let commonStockTotalShares = 0;
          let commonStockOptionPoolShares = 0;
          let totalCommonStockInvestment = 0;

          allPreviousRounds.forEach((prevRound) => {
            try {
              const instrumentData =
                safeJSONParseRepeated_preferred(
                  prevRound.instrument_type_data,
                  3,
                ) || {};

              // ✅ DETECT COMMON STOCK ROUNDS
              if (prevRound.instrumentType === "Common Stock") {
                const commonStockData = {
                  id: prevRound.id,
                  name:
                    prevRound.nameOfRound ||
                    `Common Stock Round ${prevRound.id}`,
                  investment: toNumber(prevRound.roundsize, 0),
                  preMoney: toNumber(prevRound.pre_money, 0),
                  postMoney: toNumber(prevRound.post_money, 0),
                  issuedShares: toNumber(prevRound.issuedshares, 0),
                  investorPostMoney: toNumber(prevRound.investorPostMoney, 0),
                  optionPoolPre: toNumber(prevRound.optionPoolPercent, 0),
                  optionPoolPost: toNumber(prevRound.optionPoolPercent_post, 0),
                  currency: prevRound.currency || "USD",
                  investorData: instrumentData.investors || [],
                };

                commonStockRounds.push(commonStockData);
                totalCommonStockInvestment += commonStockData.investment;

                // Calculate Common Stock investor shares
                if (commonStockData.issuedShares > 0) {
                  // If investorPostMoney is available, use it to calculate shares
                  let investorShares = 0;
                  if (commonStockData.investorPostMoney > 0) {
                    const investorPercent =
                      commonStockData.investorPostMoney / 100;
                    // investorShares = Math.round(
                    //   commonStockData.issuedShares * investorPercent,
                    // );
                    investorShares = commonStockData.issuedShares;
                  } else {
                    // Estimate based on investment amount
                    if (commonStockData.postMoney > 0) {
                      const investorPercent =
                        commonStockData.investment / commonStockData.postMoney;
                      investorShares = Math.round(
                        commonStockData.issuedShares * investorPercent,
                      );
                    }
                  }

                  // Add Common Stock investors from investorData if available
                  if (commonStockData.investorData.length > 0) {
                    commonStockData.investorData.forEach((investor) => {
                      commonStockInvestors.push({
                        name:
                          investor.name ||
                          `Common Stock Investor ${investor.id}`,
                        type: "Common Stock Investor",
                        investment: toNumber(investor.investment, 0),
                        shares: toNumber(investor.shares, 0),
                        roundName: prevRound.nameOfRound,
                        pricePerShare: toNumber(investor.pricePerShare, 0),
                      });
                    });

                    // Calculate total shares from investor data
                    const sharesFromInvestors =
                      commonStockData.investorData.reduce(
                        (sum, inv) => sum + toNumber(inv.shares, 0),
                        0,
                      );
                    commonStockTotalShares += sharesFromInvestors;
                  } else {
                    // Add generic Common Stock investor
                    commonStockInvestors.push({
                      name: `Common Stock Investors (${prevRound.nameOfRound})`,
                      type: "Common Stock Investor",
                      investment: commonStockData.investment,
                      shares: investorShares,
                      roundName: prevRound.nameOfRound,
                    });

                    commonStockTotalShares += investorShares;
                  }
                }

                // Track option pool from Common Stock round
                if (
                  commonStockData.optionPoolPost > existingOptionPoolPercent
                ) {
                  existingOptionPoolPercent = commonStockData.optionPoolPost;
                }
              }

              // ✅ PROCESS CONVERTIBLE INSTRUMENTS (SAFE & Convertible Notes)
              else if (
                prevRound.instrumentType === "Safe" ||
                prevRound.instrumentType === "Convertible Note"
              ) {
                // Get interest rate for Convertible Notes
                let interestRate = 0;
                if (prevRound.instrumentType === "Convertible Note") {
                  interestRate =
                    toNumber(instrumentData.interestRate_note, 0) ||
                    toNumber(instrumentData.interestRate, 0) ||
                    toNumber(instrumentData.interest, 0) ||
                    10;
                }

                const convertibleData = {
                  id: prevRound.id,
                  name: prevRound.nameOfRound || `Round ${prevRound.id}`,
                  instrumentType: prevRound.instrumentType,
                  investment: toNumber(prevRound.roundsize, 0),
                  valuationCap: toNumber(
                    prevRound.instrumentType === "Safe"
                      ? instrumentData.valuationCap
                      : instrumentData.valuationCap_note,
                    0,
                  ),
                  discountRate: toNumber(
                    prevRound.instrumentType === "Safe"
                      ? instrumentData.discountRate
                      : instrumentData.discountRate_note,
                    0,
                  ),
                  interestRate: interestRate,
                  optionPoolPercent: toNumber(prevRound.optionPoolPercent, 0),
                  yearsToSeriesA: toNumber(
                    instrumentData.yearsToSeriesA || 2,
                    2,
                  ),
                };

                allConvertibles.push(convertibleData);
                totalSeedInvestment += convertibleData.investment;

                if (
                  convertibleData.optionPoolPercent > existingOptionPoolPercent
                ) {
                  existingOptionPoolPercent = convertibleData.optionPoolPercent;
                }
              }
            } catch (e) {
              console.log("Error parsing round:", e);
            }
          });

          // ✅ CALCULATE TOTAL SHARES BEFORE SERIES A (INCLUDING COMMON STOCK)
          // ✅ CORRECTED VERSION:

          // ✅ CALCULATE TOTAL SHARES BEFORE SERIES A (INCLUDING COMMON STOCK)
          let totalSharesBeforeSeriesA = roundZeroTotalShares; // 100,000 (founders)

          // STEP 1: FIRST add Common Stock investors
          totalSharesBeforeSeriesA += commonStockTotalShares; // 100,000 + 27,778 = 127,778

          // STEP 2: THEN calculate option pool based on TOTAL (founders + common stock)
          if (existingOptionPoolPercent > 0 && totalSharesBeforeSeriesA > 0) {
            employeeSharesSeedRound = Math.round(
              totalSharesBeforeSeriesA / (1 - existingOptionPoolPercent / 100) -
                totalSharesBeforeSeriesA,
            );
            totalSharesBeforeSeriesA += employeeSharesSeedRound; // 127,778 + 31,945 = 159,723 ✅
          }

          // ❌ REMOVE THIS ENTIRE BLOCK - IT'S CAUSING DOUBLE COUNTING
          // if (commonStockRounds.length > 0) {
          //   const avgOptionPool = ...
          //   commonStockOptionPoolShares = Math.round(...)
          //   totalSharesBeforeSeriesA += commonStockOptionPoolShares;
          // }

          // ✅ Set commonStockOptionPoolShares to 0 since it's already included
          commonStockOptionPoolShares = 0;

          // ✅ CURRENT SERIES A ROUND DATA
          const seriesAInvestment = toNumber(round.roundsize, 0);
          const preMoneyValuation = toNumber(round.pre_money, 0);
          const targetOptionPoolPercent = toNumber(
            round.optionPoolPercent_post,
            0,
          );
          const currentLiquidationPreference = parseLiquidationPreference(
            round.liquidation,
          );

          // ============================================
          // ✅ STEP 1: CALCULATE SHARE PRICE (INCLUDES ALL SHARES)
          // ============================================
          const sharePrice =
            totalSharesBeforeSeriesA > 0
              ? preMoneyValuation / totalSharesBeforeSeriesA
              : 0;

          // ============================================
          // ✅ STEP 2: CONVERT ALL CONVERTIBLES
          // ============================================
          const convertedInvestors = [];
          let totalSeedConversionShares = 0;
          let totalSeedConversionValue = 0;

          let seedDiscountPrice = 0;
          let seedCapPrice = 0;
          let seedOptimalPrice = 0;

          if (sharePrice > 0 && allConvertibles.length > 0) {
            seedCapPrice =
              allConvertibles[0].valuationCap > 0
                ? allConvertibles[0].valuationCap / totalSharesBeforeSeriesA
                : 0;

            seedDiscountPrice =
              sharePrice * (1 - allConvertibles[0].discountRate / 100);

            seedOptimalPrice =
              seedCapPrice > 0
                ? Math.min(seedDiscountPrice, seedCapPrice)
                : seedDiscountPrice;

            // Convert each convertible
            allConvertibles.forEach((convertible) => {
              const discountPrice =
                sharePrice * (1 - convertible.discountRate / 100);

              const capPrice =
                convertible.valuationCap > 0
                  ? convertible.valuationCap / totalSharesBeforeSeriesA
                  : 0;

              const optimalPrice =
                capPrice > 0
                  ? Math.min(discountPrice, capPrice)
                  : discountPrice;

              // Calculate principal + interest
              let conversionAmount = convertible.investment;
              if (convertible.instrumentType === "Convertible Note") {
                const years = convertible.yearsToSeriesA;
                conversionAmount =
                  convertible.investment *
                  Math.pow(1 + convertible.interestRate / 100, years);
              }

              // Calculate conversion shares
              const seedConversionShares = Math.round(
                conversionAmount / optimalPrice,
              );
              const seedConversionValue = seedConversionShares * sharePrice;
              const seedMOIC =
                (seedConversionValue / convertible.investment).toFixed(2) + "X";

              convertedInvestors.push({
                convertible,
                seedConversionShares,
                seedConversionValue,
                seedOptimalPrice: optimalPrice,
                seedMOIC,
                conversionAmount,
              });

              totalSeedConversionShares += seedConversionShares;
              totalSeedConversionValue += seedConversionValue;
            });
          }

          // ============================================
          // ✅ STEP 3: SERIES A SHARES
          // ============================================
          const seriesAShares =
            sharePrice > 0 ? Math.round(seriesAInvestment / sharePrice) : 0;
          const seriesAValue = seriesAShares * sharePrice;
          const seriesAMOIC =
            sharePrice > 0
              ? (seriesAValue / seriesAInvestment).toFixed(2) + "X"
              : "0X";

          // ============================================
          // ✅ STEP 4: OPTION POOL CALCULATION
          // ============================================
          let newOptionShares = 0;
          let totalPostShares = 0;
          let finalPostMoneyValuation = 0;

          if (targetOptionPoolPercent > 0) {
            const totalSharesExcludingNewOptions =
              totalSharesBeforeSeriesA +
              totalSeedConversionShares +
              seriesAShares;

            totalPostShares = Math.round(
              totalSharesExcludingNewOptions /
                (1 - targetOptionPoolPercent / 100),
            );

            const totalExistingOptionShares =
              employeeSharesSeedRound + commonStockOptionPoolShares;

            newOptionShares = Math.max(
              0,
              totalPostShares -
                totalSharesExcludingNewOptions -
                totalExistingOptionShares,
            );

            finalPostMoneyValuation = totalPostShares * sharePrice;
          } else {
            totalPostShares =
              totalSharesBeforeSeriesA +
              totalSeedConversionShares +
              seriesAShares;
            finalPostMoneyValuation = totalPostShares * sharePrice;
          }

          // ============================================
          // ✅ LIQUIDATION PREFERENCE CALCULATIONS
          // ============================================
          let liquidationCalculations = {
            type: currentLiquidationPreference,
            label: getLiquidationLabel(currentLiquidationPreference),
            preferredLiquidationMultiple: 1,
            participatingCap: currentLiquidationPreference === 3 ? 2 : 0,
            exitScenarios: [],
            currentOwnership: null,
          };

          // ✅ LIQUIDATION ONLY APPLIES TO PREFERRED EQUITY
          if (
            round.instrumentType === "Preferred Equity" &&
            finalPostMoneyValuation > 0
          ) {
            // Create exit scenarios
            const exitScenarios = [
              { label: "Scenario 1", multiplier: 0.5 },
              { label: "Scenario 2", multiplier: 1.0 },
              { label: "Scenario 3", multiplier: 2.0 },
              { label: "Scenario 4", multiplier: 5.0 },
            ].map((scenario) => ({
              label: scenario.label,
              value: finalPostMoneyValuation * scenario.multiplier,
            }));

            liquidationCalculations.exitScenarios = exitScenarios.map(
              (scenario) => {
                return calculateLiquidationDistributionWithCommonStock(
                  scenario.value,
                  currentLiquidationPreference,
                  seriesAInvestment,
                  totalSeedInvestment,
                  totalCommonStockInvestment,
                  totalPostShares,
                  seriesAShares,
                  totalSeedConversionShares,
                  roundZeroTotalShares,
                  employeeSharesSeedRound +
                    commonStockOptionPoolShares +
                    newOptionShares,
                  commonStockTotalShares,
                  commonStockInvestors,
                );
              },
            );

            // Current ownership percentages INCLUDING COMMON STOCK
            liquidationCalculations.currentOwnership = {
              seriesA: {
                shares: seriesAShares,
                ownership:
                  ((seriesAShares / totalPostShares) * 100).toFixed(1) + "%",
                investment: seriesAInvestment,
                type: "Preferred Equity",
                hasLiquidationPreference: true,
              },
              seed: {
                shares: totalSeedConversionShares,
                ownership:
                  ((totalSeedConversionShares / totalPostShares) * 100).toFixed(
                    1,
                  ) + "%",
                investment: totalSeedInvestment,
                type: "Converted from SAFE/Convertible Note",
                hasLiquidationPreference: true, // Converted shares get liquidation preference
              },
              commonStock: {
                shares: commonStockTotalShares,
                ownership:
                  ((commonStockTotalShares / totalPostShares) * 100).toFixed(
                    1,
                  ) + "%",
                investment: totalCommonStockInvestment,
                type: "Common Stock",
                hasLiquidationPreference: false, // Common stock has NO liquidation preference
              },
              founders: {
                shares: roundZeroTotalShares,
                ownership:
                  ((roundZeroTotalShares / totalPostShares) * 100).toFixed(1) +
                  "%",
                type: "Common Stock",
                hasLiquidationPreference: false,
              },
              optionPool: {
                shares:
                  employeeSharesSeedRound +
                  commonStockOptionPoolShares +
                  newOptionShares,
                ownership:
                  (
                    ((employeeSharesSeedRound +
                      commonStockOptionPoolShares +
                      newOptionShares) /
                      totalPostShares) *
                    100
                  ).toFixed(1) + "%",
                type: "Options",
                hasLiquidationPreference: false,
              },
            };
          }

          // ============================================
          // ✅ BUILD CAP TABLES (WITH COMMON STOCK)
          // ============================================

          // ✅ PRE-INVESTMENT CAP TABLE
          let preSeriesAShareholders = [];

          // Founders
          roundZeroFounders.forEach((founder) => {
            const shares = toNumber(founder.shares, 0);
            const ownership =
              totalSharesBeforeSeriesA > 0
                ? (shares / totalSharesBeforeSeriesA) * 100
                : 0;
            const value = (ownership / 100) * preMoneyValuation;

            preSeriesAShareholders.push({
              name: `${founder.firstName || ""} ${founder.lastName || ""}`.trim(),
              type: "Founder",
              shares: shares,
              ownership: ownership.toFixed(1),
              value: Math.round(value),
              newShares: 0,
            });
          });

          // Common Stock Investors
          if (commonStockInvestors.length > 0) {
            commonStockInvestors.forEach((investor) => {
              const ownership =
                totalSharesBeforeSeriesA > 0
                  ? (investor.shares / totalSharesBeforeSeriesA) * 100
                  : 0;
              const value = (ownership / 100) * preMoneyValuation;

              preSeriesAShareholders.push({
                name: investor.name,
                type: "Common Stock Investor",
                shares: investor.shares,
                ownership: ownership.toFixed(1),
                value: Math.round(value),
                investment: investor.investment,
                note: `Invested ${investor.investment.toLocaleString()} ${investor.currency || round.currency || "USD"} @ ${investor.pricePerShare ? investor.pricePerShare.toFixed(2) : "N/A"} per share`,
              });
            });
          }

          // Employee/Option Pool
          const totalExistingOptionShares =
            employeeSharesSeedRound + commonStockOptionPoolShares;

          if (totalExistingOptionShares > 0) {
            const ownership =
              totalSharesBeforeSeriesA > 0
                ? (totalExistingOptionShares / totalSharesBeforeSeriesA) * 100
                : 0;
            const value = (ownership / 100) * preMoneyValuation;

            preSeriesAShareholders.push({
              name: "Employee Option Pool",
              type: "Options Pool",
              shares: totalExistingOptionShares,
              ownership: ownership.toFixed(1),
              value: Math.round(value),
              note: `${existingOptionPoolPercent}% existing pool`,
            });
          }
          // ✅ POST-INVESTMENT CAP TABLE (INCLUDES COMMON STOCK)
          let postSeriesAShareholders = [];

          // Founders
          roundZeroFounders.forEach((founder) => {
            const shares = toNumber(founder.shares, 0);
            const ownership =
              totalPostShares > 0 ? (shares / totalPostShares) * 100 : 0;
            const value = (ownership / 100) * finalPostMoneyValuation;

            postSeriesAShareholders.push({
              name: `${founder.firstName || ""} ${founder.lastName || ""}`.trim(),
              type: "Founder",
              shares: shares,
              commonShares: shares,
              newShares: 0,
              totalShares: shares,
              ownership: ownership.toFixed(1),
              value: Math.round(value),
            });
          });

          // ✅ COMMON STOCK INVESTORS (CARRY OVER - 444,444 SHARES)
          if (commonStockInvestors.length > 0) {
            commonStockInvestors.forEach((investor) => {
              const ownership =
                totalPostShares > 0
                  ? (investor.shares / totalPostShares) * 100
                  : 0;
              const value = (ownership / 100) * finalPostMoneyValuation;

              postSeriesAShareholders.push({
                name: investor.name,
                type: "Common Stock Investor",
                shares: investor.shares,
                commonShares: investor.shares,
                newShares: 0,
                totalShares: investor.shares,
                ownership: ownership.toFixed(1),
                value: Math.round(value),
                investment: investor.investment,
                note: `From ${investor.roundName || "Common Stock"} round @ ${investor.pricePerShare ? investor.pricePerShare.toFixed(2) : "N/A"} per share`,
              });
            });
          }

          // Converted Investors
          convertedInvestors.forEach((conversion, index) => {
            const ownership =
              totalPostShares > 0
                ? (conversion.seedConversionShares / totalPostShares) * 100
                : 0;
            const value = (ownership / 100) * finalPostMoneyValuation;

            const displayName =
              conversion.convertible.instrumentType === "Safe"
                ? `SAFE Investor ${index + 1}`
                : `Convertible Note Investor ${index + 1}`;

            const note =
              conversion.convertible.instrumentType === "Convertible Note"
                ? `Convertible Note: $${conversion.convertible.investment.toLocaleString()} + ${conversion.convertible.interestRate}% interest`
                : `Converted at $${conversion.seedOptimalPrice.toFixed(2)} per share (${conversion.convertible.discountRate}% discount)`;

            postSeriesAShareholders.push({
              name: displayName,
              type:
                conversion.convertible.instrumentType === "Safe"
                  ? "SAFE Investor"
                  : "Convertible Note Investor",
              shares: conversion.seedConversionShares,
              commonShares: 0,
              newShares: conversion.seedConversionShares,
              totalShares: conversion.seedConversionShares,
              ownership: ownership.toFixed(1),
              value: Math.round(value),
              investmentAmount: conversion.convertible.investment,
              conversionPrice: conversion.seedOptimalPrice,
              moic: conversion.seedMOIC,
              conversionAmount: Math.round(conversion.conversionAmount),
              note: note,
            });
          });

          // Series A/B Investors
          if (seriesAShares > 0) {
            const ownership =
              totalPostShares > 0 ? (seriesAShares / totalPostShares) * 100 : 0;
            const value = (ownership / 100) * finalPostMoneyValuation;

            postSeriesAShareholders.push({
              name: `${round.shareClassType || "Series A"} Investors`,
              type: "Preferred Equity Investor",
              shares: seriesAShares,
              roundid: round.id,
              commonShares: 0,
              newShares: seriesAShares,
              totalShares: seriesAShares,
              ownership: ownership.toFixed(1),
              value: Math.round(value),
              investmentAmount: seriesAInvestment,
              moic: seriesAMOIC,
              note: `Purchased at $${sharePrice.toFixed(2)} per share | Liquidation: ${getLiquidationLabel(currentLiquidationPreference)}`,
            });
          }

          // Employee Option Pool
          const totalEmployeeShares =
            employeeSharesSeedRound +
            commonStockOptionPoolShares +
            newOptionShares;

          if (totalEmployeeShares > 0) {
            const ownership =
              totalPostShares > 0
                ? (totalEmployeeShares / totalPostShares) * 100
                : 0;
            const value = (ownership / 100) * finalPostMoneyValuation;
            console.log(totalEmployeeShares);
            postSeriesAShareholders.push({
              name: "Employee Option Pool",
              type: "Options Pool",
              shares: totalEmployeeShares,
              roundid: "",
              commonShares:
                employeeSharesSeedRound + commonStockOptionPoolShares,
              newShares: newOptionShares,
              totalShares: totalEmployeeShares,
              ownership: ownership.toFixed(1),
              value: Math.round(value),
              breakdown: {
                existingShares:
                  employeeSharesSeedRound + commonStockOptionPoolShares,
                newShares: newOptionShares,
                totalShares: totalEmployeeShares,
              },
            });
          }

          // Add TOTAL row
          let totalInvestment = 0;
          let totalAllShares = 0;
          let totalAllValue = 0;
          console.log(postSeriesAShareholders, "kkkk");
          postSeriesAShareholders.forEach((sh) => {
            totalAllShares += sh.totalShares || sh.shares || 0;
            totalAllValue += sh.value || 0;

            // ✅ FIX: Use EITHER investmentAmount OR investment, not both
            if (sh.investmentAmount !== undefined) {
              totalInvestment += sh.investmentAmount;
            } else if (sh.investment !== undefined) {
              totalInvestment += sh.investment;
            }
            // Don't add both!
          });
          const totalCommonSharesCorrect =
            roundZeroTotalShares + // Founders
            commonStockTotalShares + // Common Stock Investors
            (employeeSharesSeedRound + commonStockOptionPoolShares); // Existing Option Pool

          // ✅ CORRECT: Calculate new shares properly
          const totalNewSharesCorrect =
            totalSeedConversionShares + // Converted SAFE/Notes
            seriesAShares + // Series A/B Investors
            newOptionShares; // Only NEW options
          postSeriesAShareholders.push({
            name: "TOTAL",
            type: "Total",
            shares: totalAllShares,
            roundid: round.id,
            commonShares:
              roundZeroTotalShares +
              commonStockTotalShares +
              (employeeSharesSeedRound + commonStockOptionPoolShares),
            newShares: totalNewSharesCorrect,
            totalShares: totalAllShares,
            ownership: "100%",
            value: Math.round(totalAllValue),
            investmentAmount: totalInvestment,
            isTotal: true,
          });

          // ============================================
          // ✅ FINAL RESPONSE (WITH COMMON STOCK)
          // ============================================
          console.log(postSeriesAShareholders, "kkk");
          const responseData = {
            success: true,
            roundType: round.nameOfRound || "Series A",
            shareClassType: round.shareClassType || "Series A",
            instrumentType: round.instrumentType || "Preferred Equity",
            currency: round.currency || "USD",
            round_type: round.nameOfRound || "Series A",

            // Flags
            isSeriesA: round.instrumentType === "Preferred Equity",
            hasSAFEConversion: allConvertibles.some(
              (c) => c.instrumentType === "Safe",
            ),
            hasConvertibleConversion: allConvertibles.some(
              (c) => c.instrumentType === "Convertible Note",
            ),
            hasMultipleConvertibles: allConvertibles.length > 1,
            convertibleCount: allConvertibles.length,
            hasCommonStockRounds: commonStockRounds.length > 0,
            commonStockRoundCount: commonStockRounds.length,
            commonStockShares: commonStockTotalShares,
            commonStockInvestment: totalCommonStockInvestment,

            // Inputs (INCLUDES COMMON STOCK)
            inputs: {
              preMoneyValuation: preMoneyValuation,
              seriesAInvestment: seriesAInvestment,
              targetOptionPoolPercent: targetOptionPoolPercent,
              roundZeroShares: roundZeroTotalShares,
              founderCount: roundZeroFounders.length,
              seedInvestment: totalSeedInvestment,
              commonStockInvestment: totalCommonStockInvestment,
              commonStockShares: commonStockTotalShares,
              existingOptionPoolPercent: existingOptionPoolPercent,
              liquidationPreference: currentLiquidationPreference,
              convertibles: allConvertibles.map((c) => ({
                name: c.name,
                type: c.instrumentType,
                investment: c.investment,
                discount: c.discountRate,
                cap: c.valuationCap,
                interest: c.interestRate,
              })),
              commonStockRounds: commonStockRounds.map((cs) => ({
                name: cs.name,
                investment: cs.investment,
                shares: cs.issuedShares,
                optionPoolPre: cs.optionPoolPre,
                optionPoolPost: cs.optionPoolPost,
              })),
            },

            // ✅ CALCULATIONS (INCLUDES COMMON STOCK)
            calculations: {
              // Core calculations
              sharePrice: sharePrice,
              seedOptimalPrice: seedOptimalPrice,
              seedDiscountPrice: seedDiscountPrice,
              seedCapPrice: seedCapPrice,

              // Shares breakdown
              seedConversionShares: totalSeedConversionShares,
              seriesAShares: seriesAShares,
              newOptionShares: newOptionShares,
              employeeSharesSeedRound: employeeSharesSeedRound,
              commonStockShares: commonStockTotalShares,
              commonStockOptionPoolShares: commonStockOptionPoolShares,

              // Totals
              totalSharesPostSeed: totalPostShares,
              totalSharesPreSeed: totalSharesBeforeSeriesA,
              roundZeroTotalShares: roundZeroTotalShares,

              // Values
              finalPostMoneyValuation: finalPostMoneyValuation,
              seedConversionValue: totalSeedConversionValue,
              seriesAValue: seriesAValue,
              preMoneyValuation: preMoneyValuation,

              // Investment
              seedInvestment: totalSeedInvestment,
              seriesAInvestment: seriesAInvestment,
              commonStockInvestment: totalCommonStockInvestment,

              // MOIC
              seedMOIC:
                totalSeedInvestment > 0
                  ? (totalSeedConversionValue / totalSeedInvestment).toFixed(
                      2,
                    ) + "X"
                  : "0X",
              seriesAMOIC: seriesAMOIC,

              // Option pool
              targetOptionPoolPercent: targetOptionPoolPercent,
              existingOptionPoolPercent: existingOptionPoolPercent,

              // Convertible terms (for frontend display)
              valuationCap:
                allConvertibles.length > 0
                  ? allConvertibles[0].valuationCap
                  : 0,
              discountRate:
                allConvertibles.length > 0
                  ? allConvertibles[0].discountRate
                  : 0,
              interestRate:
                allConvertibles.length > 0
                  ? allConvertibles[0].interestRate
                  : 0,
            },

            // Cap tables
            preSeedCapTable: {
              shareholders: preSeriesAShareholders,
              totalShares: totalSharesBeforeSeriesA,
              totalValue: preMoneyValuation,
              message: `Before ${round.shareClassType || "Series A"} investment (with ${commonStockRounds.length > 0 ? `${commonStockRounds.length} Common Stock rounds, ` : ""}${existingOptionPoolPercent}% option pool)`,
            },

            postSeedCapTable: {
              shareholders: postSeriesAShareholders,
              totalShares: totalPostShares,
              totalValue: finalPostMoneyValuation,
              seedInvestment: totalSeedInvestment,
              commonStockInvestment: totalCommonStockInvestment,
              message: `After ${round.shareClassType || "Series A"} investment of ${seriesAInvestment.toLocaleString()} ${round.currency || "USD"}${allConvertibles.length > 0 ? ` with ${allConvertibles.length} convertible instrument${allConvertibles.length !== 1 ? "s" : ""} conversion` : ""}${commonStockRounds.length > 0 ? ` and ${commonStockRounds.length} Common Stock round${commonStockRounds.length !== 1 ? "s" : ""}` : ""}`,
            },

            // Liquidation (ONLY FOR PREFERRED EQUITY)
            liquidationPreference:
              round.instrumentType === "Preferred Equity"
                ? {
                    type: currentLiquidationPreference,
                    label: getLiquidationLabel(currentLiquidationPreference),
                    appliesTo: "Preferred Equity Investors Only",
                    note: "Common Stock investors do not have liquidation preference",
                  }
                : null,

            liquidationCalculations:
              round.instrumentType === "Preferred Equity"
                ? liquidationCalculations
                : null,

            // Conversion details
            conversionDetails: convertedInvestors.map((c) => ({
              type: c.convertible.instrumentType,
              shares: c.seedConversionShares,
              value: Math.round(c.seedConversionValue),
              moic: c.seedMOIC,
              investment: c.convertible.investment,
              conversionPrice: c.seedOptimalPrice,
              conversionAmount: Math.round(c.conversionAmount),
              discountRate: c.convertible.discountRate,
              interestRate: c.convertible.interestRate,
            })),

            // Common Stock investors list
            commonStockInvestors: commonStockInvestors.map((cs) => ({
              name: cs.name,
              shares: cs.shares,
              investment: cs.investment,
              roundName: cs.roundName,
              pricePerShare: cs.pricePerShare,
            })),
          };

          const issuedSharesThisRound = Math.round(
            seriesAShares + totalSeedConversionShares + newOptionShares,
          );

          // UPDATE roundrecord table
          const updateQuery = `
            UPDATE roundrecord 
            SET 
              total_shares_before = ?,
              total_shares_after = ?,
              share_price = ?
            WHERE id = ?
          `;

          const updateValues = [
            totalSharesBeforeSeriesA, // total_shares_before
            totalPostShares, // total_shares_after (CRITICAL!)
            sharePrice, // share_price

            round.id, // WHERE id
          ];

          db.query(updateQuery, updateValues, (updateErr, updateResult) => {
            if (updateErr) {
              console.error("❌ Database update failed:", updateErr);
              // Still return response
              return res.status(200).json({
                success: true,
                message: "Calculation completed but database save failed",
                capTable: responseData,
                savedToDatabase: false,
                error: updateErr.message,
              });
            }

            console.log("✅ Database updated successfully!");
            console.log("   Rows affected:", round.id);

            // Return success response
            return res.status(200).json({
              success: true,
              message: "Cap table calculated and saved successfully",
              capTable: responseData,
              savedToDatabase: true,
              savedData: {
                total_shares_before: totalSharesBeforeSeriesA,
                total_shares_after: totalPostShares,
                share_price: sharePrice,
                issuedshares: issuedSharesThisRound,
              },
            });
          });
        },
      );
    },
  );
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
        console.log(`✅ Updated round record ${roundId} successfully`);
      }
    },
  );
}
function updateIssuedShares(seriesAShares, roundId) {
  console.log(`💾 Saving issued shares: ${seriesAShares} for round ${roundId}`);

  db.query(
    `UPDATE roundrecord SET issuedshares = ? WHERE id = ?`,
    [seriesAShares, roundId],
    (err, result) => {
      if (err) {
        console.error("❌ Error updating issued shares:", err);
      } else {
        console.log(
          `✅ Successfully saved ${seriesAShares} issued shares for round ${roundId}`,
        );

        // Optional: Verify the update
        if (result.affectedRows > 0) {
          console.log(`📋 Updated ${result.affectedRows} record(s)`);
        }
      }
    },
  );
}
function parseLiquidationPreference(liquidationValue) {
  console.log("Parsing liquidation preference:", liquidationValue);

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

function safeJSONParseRepeated_preferred(jsonString, maxAttempts = 3) {
  if (!jsonString) return null;

  let parsed = jsonString;
  for (let i = 0; i < maxAttempts; i++) {
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch (e) {
        return parsed;
      }
    } else {
      break;
    }
  }
  return parsed;
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
// Safe Round - CORRECTED VERSION
function handleSAFERoundCalculation(round, company_id, res) {
  // Get Round 0 data
  db.query(
    `SELECT * FROM roundrecord WHERE company_id=? AND round_type='Round 0'`,
    [company_id],
    (err, roundZeroData) => {
      if (err)
        return res
          .status(500)
          .json({ success: false, message: "Database error" });
      if (roundZeroData.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Round 0 not found. Please create Round 0 first.",
        });
      }

      const roundZero = roundZeroData[0];

      // Parse SAFE data
      let safeData = {};
      try {
        safeData = safeJSONParseRepeated(round.instrument_type_data, 3) || {};
      } catch (e) {
        safeData = {};
      }

      const investmentSize = toNumber(round.roundsize, 0);
      const companyValue = toNumber(round.pre_money, 0); // ✅ Company Value (Input)
      const valuationCap = toNumber(safeData.valuationCap, 0);
      const discountRate = toNumber(safeData.discountRate, 0) / 100;
      const optionPoolPercent = toNumber(round.optionPoolPercent, 0) / 100; // ✅ Pre-Seed Option Pool %

      // Parse Round 0 data
      let roundZeroTotalShares = 0;
      let roundZeroFounders = [];

      try {
        if (roundZero.founder_data) {
          const founderData = safeJSONParseRepeated(roundZero.founder_data, 3);
          roundZeroTotalShares =
            toNumber(founderData.totalShares, 0) ||
            toNumber(roundZero.issuedshares, 0);
          if (founderData.founders && Array.isArray(founderData.founders)) {
            roundZeroFounders = founderData.founders;
          }
        } else {
          roundZeroTotalShares = toNumber(roundZero.issuedshares, 0);
        }
      } catch (error) {
        roundZeroTotalShares = toNumber(roundZero.issuedshares, 0);
      }

      // ✅ CRITICAL FIX: Calculate Employee shares using correct formula
      // Formula: Total / (1 - pool%) * pool%
      // Example: 100,000 / (1 - 0.10) * 0.10 = 100,000 / 0.90 * 0.10 = 11,111
      const employeeShares = Math.round(
        (roundZeroTotalShares / (1 - optionPoolPercent)) * optionPoolPercent,
      );

      const totalSharesPreSeed = roundZeroTotalShares + employeeShares;

      // ✅ Get SAFE investors
      db.query(
        `SELECT ir.*, COALESCE(ii.first_name,'') AS first_name, COALESCE(ii.last_name,'') AS last_name, 
         COALESCE(ii.email,'') AS email
         FROM investorrequest_company ir
         LEFT JOIN investor_information ii ON ir.investor_id = ii.id
         WHERE ir.roundrecord_id=? AND ir.company_id=? AND ir.request_confirm='Yes'`,
        [round.id, company_id],
        (err, investors) => {
          if (err) {
            return res
              .status(500)
              .json({ success: false, message: "Database error" });
          }

          // Calculate total SAFE investment
          let totalSafeInvestment = 0;
          if (investors && investors.length > 0) {
            investors.forEach((investor) => {
              totalSafeInvestment += toNumber(investor.investment_amount, 0);
            });
          }
          const effectiveInvestment =
            totalSafeInvestment > 0 ? totalSafeInvestment : investmentSize;

          // ============================================
          // PRE-SEED ROUND 1 CAP TABLE
          // ============================================
          let preSeedShareholders = [];

          // Add founders
          if (roundZeroFounders && roundZeroFounders.length > 0) {
            roundZeroFounders.forEach((founder, index) => {
              const shares = toNumber(founder.shares, 0);
              if (shares > 0) {
                const ownership = (shares / totalSharesPreSeed) * 100;
                const value = (ownership / 100) * companyValue;

                preSeedShareholders.push({
                  name: `${founder.firstName || ""} ${
                    founder.lastName || ""
                  }`.trim(),
                  fullName: founder.fullName || `Founder ${index + 1}`,
                  email: founder.email || "-",
                  phone: founder.phone || "-",
                  type: "Founder",
                  shares: shares,
                  ownership: ownership,
                  value: value,
                  newShares: 0, // No new shares in pre-seed
                });
              }
            });
          }

          // Add Employee Option Pool
          if (employeeShares > 0) {
            const ownership = (employeeShares / totalSharesPreSeed) * 100;
            const value = (ownership / 100) * companyValue;

            preSeedShareholders.push({
              name: "Employee Option Pool",
              fullName: "Employee Option Pool",
              type: "Options Pool",
              shares: employeeShares,
              ownership: ownership,
              value: value,
              newShares: employeeShares, // ✅ NEW shares created in this round
            });
          }

          // ============================================
          // POST-SEED ROUND 1 CAP TABLE
          // ============================================
          let postSeedShareholders = [];

          // Add founders (same as pre-seed, no new shares)
          if (roundZeroFounders && roundZeroFounders.length > 0) {
            roundZeroFounders.forEach((founder, index) => {
              const shares = toNumber(founder.shares, 0);
              if (shares > 0) {
                const ownership = (shares / totalSharesPreSeed) * 100;
                const value = (ownership / 100) * companyValue;

                postSeedShareholders.push({
                  name: `${founder.firstName || ""} ${
                    founder.lastName || ""
                  }`.trim(),
                  fullName: founder.fullName || `Founder ${index + 1}`,
                  email: founder.email || "-",
                  phone: founder.phone || "-",
                  type: "Founder",
                  shares: shares,
                  ownership: ownership,
                  value: value,
                  newShares: 0,
                });
              }
            });
          }

          // Add Employee Option Pool (same as pre-seed)
          if (employeeShares > 0) {
            const ownership = (employeeShares / totalSharesPreSeed) * 100;
            const value = (ownership / 100) * companyValue;

            postSeedShareholders.push({
              name: "Employee Option Pool",
              fullName: "Employee Option Pool",
              type: "Options Pool",
              shares: employeeShares,
              ownership: ownership,
              value: value,
              newShares: 0, // Already counted in pre-seed
            });
          }

          // ✅ Add SAFE investors (0 shares - not converted yet)
          if (investors && investors.length > 0) {
            investors.forEach((investor, index) => {
              const investmentAmount = toNumber(investor.investment_amount, 0);

              postSeedShareholders.push({
                name:
                  `${investor.first_name || ""} ${
                    investor.last_name || ""
                  }`.trim() || `SAFE Investor ${index + 1}`,
                fullName:
                  `${investor.first_name || ""} ${
                    investor.last_name || ""
                  }`.trim() || `SAFE Investor ${index + 1}`,
                email: investor.email || "-",
                phone: "-",
                type: "SAFE Investor",
                shares: 0, // ✅ NO SHARES until conversion at Series A
                ownership: 0,
                value: 0,
                investmentAmount: investmentAmount,
                newShares: 0,
                isSAFE: true,
                note: `$${investmentAmount.toLocaleString()} SAFE investment - Will convert at next priced round`,
              });
            });
          }

          // ✅ RESPONSE with Pre-Seed and Post-Seed tables
          const capTableData = {
            shareClassType: round.shareClassType,
            roundType: round.nameOfRound || "SAFE Round (Seed)",
            round_type: round.round_type,
            instrumentType: round.instrumentType,

            currency: round.currency || "USD",

            // ✅ PRE-SEED CAP TABLE
            preSeedCapTable: {
              totalShares: totalSharesPreSeed,
              totalValue: companyValue,
              shareholders: preSeedShareholders,
              message: "✅ Before SAFE investment (with option pool)",
            },

            // ✅ POST-SEED CAP TABLE
            postSeedCapTable: {
              totalShares: totalSharesPreSeed, // ✅ Same - no new shares from SAFE
              totalValue: companyValue,
              shareholders: postSeedShareholders,
              message:
                "✅ After SAFE investment - Notes have NOT converted yet",
              safeInvestment: effectiveInvestment,
              safeInvestorCount: investors ? investors.length : 0,
            },

            // Calculations summary
            calculations: {
              companyValue: companyValue,
              investmentSize: effectiveInvestment,
              valuationCap: valuationCap,
              discountRate: discountRate * 100,
              optionPoolPercent: optionPoolPercent * 100,
              roundZeroTotalShares: roundZeroTotalShares,
              employeeShares: employeeShares,
              totalSharesPreSeed: totalSharesPreSeed,
              totalSharesPostSeed: totalSharesPreSeed, // ✅ Same as pre-seed
              totalSafeInvestment: effectiveInvestment,
              investorCount: investors ? investors.length : 0,
              preMoney: companyValue,
              postMoney: companyValue + effectiveInvestment,
            },

            // Conversion information
            conversionInfo: {
              note: "⚠️ SAFE notes will convert at next priced equity round",
              conversionTrigger: "Next priced equity financing",
              valuationCap: valuationCap,
              discountRate: discountRate * 100,
            },

            isSAFERound: true,
            hasPrePostTables: true, // ✅ NOW we have both tables
            message: `SAFE Round - Conversion will happen at next priced equity round`,
          };
          console.log(capTableData);
          var sharePrice = round.pre_money / totalSharesPreSeed;
          const updatedRecord = updateRoundRecordWithCalculations(
            totalSharesPreSeed,
            totalSharesPreSeed,
            sharePrice,
            round.id,
          );
          return res.status(200).json({
            success: true,
            message: "SAFE round data retrieved successfully",
            round,
            capTable: capTableData,
          });
        },
      );
    },
  );
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
    console.log(results.length);
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

//         console.log(
//           `✅ Previous round option pool: ${existingOptionPoolPercent}%`
//         );
//         console.log(`   Previous round type: ${previousRound.round_type}`);
//         console.log(`   Previous round name: ${previousRound.nameOfRound}`);

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
                  console.log(
                    `   Founder ${founder.name || "Unnamed"}: ${shares} shares`,
                  );
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
          } catch (e) {
            console.log("⚠️ Could not parse founder_data:", e.message);
          }
        }

        // FALLBACK: If no founder shares found, use all Round 0 shares as founder shares
        if (round0FounderShares === 0) {
          round0FounderShares = round0TotalShares;
          console.log(
            `⚠️ Using fallback: All ${round0TotalShares} shares as founder shares`,
          );
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
          } catch (e) {
            console.log("⚠️ Could not parse Seed instrument_type_data");
          }
        }

        // If pre-money valuation seems wrong, calculate it properly
        // if (previousRoundData.preMoneyValuation < 100000) {
        //   // If less than 100k, it's probably wrong
        //   // Pre-money = (Founder Shares / Total Shares) * (Something sensible)
        //   // Or use a sensible default
        //   previousRoundData.preMoneyValuation = 1200000; // Default for calculation
        //   console.log(
        //     `⚠️ Low pre-money detected. Using default: ${previousRoundData.preMoneyValuation}`
        //   );
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
          console.log(
            `✅ Using Series's POST-MONEY pool: ${existingOptionPoolPercent}%`,
          );
        } else if (
          latestSeriesRound.optionPoolPercent &&
          parseFloat(latestSeriesRound.optionPoolPercent) > 0
        ) {
          existingOptionPoolPercent = parseFloat(
            latestSeriesRound.optionPoolPercent,
          );
          console.log(
            `✅ Using Series's PRE-MONEY pool: ${existingOptionPoolPercent}%`,
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

      console.log("📊 All Rounds Found:");
      allResults.forEach((round, index) => {
        console.log(
          `${index + 1}. ${round.nameOfRound} (${round.round_type}) - ${
            round.instrumentType
          } - ${round.roundsize || 0}`,
        );
      });

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
        console.log("🔍 Processing Round 0...");

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
          } catch (e) {
            console.log("⚠️ Could not parse Round 0 founder_data:", e);
          }
        }

        // Fallback: if no founder shares parsed, use round0 total shares
        if (founderShares === 0) {
          founderShares = round0TotalShares;
        }

        console.log(`✅ Founder shares from Round 0: ${founderShares}`);
      }

      // 2. Get Seed Convertible Note details
      if (seedConvertibleRound) {
        console.log("🔍 Processing Convertible Note Round...");

        seedInvestment = parseFloat(seedConvertibleRound.roundsize) || 0;
        seedOptionPoolPercent =
          parseFloat(seedConvertibleRound.optionPoolPercent) || 0;

        console.log(`✅ Seed Convertible Note Investment: $${seedInvestment}`);
        console.log(`✅ Seed Option Pool: ${seedOptionPoolPercent}%`);

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

            console.log(`✅ Convertible Note Terms:`);
            console.log(`   Valuation Cap: $${valuationCap}`);
            console.log(`   Discount Rate: ${discountRate}%`);
            console.log(`   Interest Rate: ${interestRate}%`);
          } catch (e) {
            console.log("⚠️ Could not parse instrument_type_data:", e);
          }
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

        console.log(`📊 Seed Round Share Calculations:`);
        console.log(`   Founder Shares: ${founderShares}`);
        console.log(`   Seed Option Pool: ${seedOptionPoolPercent}%`);
        console.log(`   Total Shares (including pool): ${totalShares}`);
        console.log(`   Employee Shares Created: ${employeeSharesFromSeed}`);
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
        console.log(`💰 Convertible Note with Interest (${years} years):`);
        console.log(`   Original Principal: $${seedInvestment}`);
        console.log(`   Interest Rate: ${interestRate}%`);
        console.log(`   Years: ${years} (static)`);
        console.log(
          `   Principal + Interest: $${principalPlusInterest.toFixed(2)}`,
        );
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

      console.log("📊 Final Data for Series A Calculations:");
      console.log(
        `   Total Shares (for Series A): ${responseData.totalShares}`,
      );
      console.log(`   Founder Shares: ${responseData.founderShares}`);
      console.log(
        `   Employee Shares from Seed: ${responseData.employeeSharesFromSeed}`,
      );
      console.log(`   Seed Investment: $${responseData.seedInvestment}`);
      console.log(
        `   Principal + Interest: $${responseData.principalPlusInterest}`,
      );
      console.log(`   Valuation Cap: $${responseData.valuationCap}`);
      console.log(`   Discount Rate: ${responseData.discountRate}%`);
      console.log(`   Interest Rate: ${responseData.interestRate}%`);
      console.log(
        `   Years Between Rounds: ${responseData.yearsBetweenRounds} (STATIC)`,
      );

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
function calculateOptionPoolFromSAFERound(previousRound, company_id) {
  return new Promise((resolve, reject) => {
    // Get Round 0 data
    db.query(
      `SELECT * FROM roundrecord WHERE company_id=? AND round_type='Round 0'`,
      [company_id],
      (err, roundZeroData) => {
        if (err) {
          reject(err);
          return;
        }

        if (roundZeroData.length === 0) {
          resolve({
            optionPoolPercent: 0,
            existingShares: 0,
            calculationMethod: "No Round 0 found",
          });
          return;
        }

        const roundZero = roundZeroData[0];

        try {
          // Parse SAFE round data (SAME as handleSAFERoundCalculation)
          const investmentSize = parseFloat(previousRound.roundsize) || 0;
          const companyValue = parseFloat(previousRound.pre_money) || 0;
          const optionPoolPercentInput =
            parseFloat(previousRound.optionPoolPercent) || 0;

          // Get founder shares from Round 0
          let roundZeroTotalShares = 0;

          if (roundZero.founder_data) {
            try {
              const founderData = JSON.parse(roundZero.founder_data);
              roundZeroTotalShares =
                parseFloat(founderData.totalShares) ||
                parseFloat(roundZero.issuedshares) ||
                0;
            } catch (e) {
              roundZeroTotalShares = parseFloat(roundZero.issuedshares) || 0;
            }
          } else {
            roundZeroTotalShares = parseFloat(roundZero.issuedshares) || 0;
          }

          // ✅ SAFE ROUND CALCULATION (SAME as handleSAFERoundCalculation)
          // Calculate Employee shares using SAFE formula
          const employeeShares = Math.round(
            (roundZeroTotalShares / (1 - optionPoolPercentInput / 100)) *
              (optionPoolPercentInput / 100),
          );

          const totalShares = roundZeroTotalShares + employeeShares;

          // Calculate ACTUAL option pool percentage
          const actualOptionPoolPercent =
            totalShares > 0 ? (employeeShares / totalShares) * 100 : 0;

          console.log(`🔢 SAFE Round Calculation Results:`);
          console.log(
            `   - Input option pool %: ${optionPoolPercentInput}% (pre-money)`,
          );
          console.log(`   - Founder shares: ${roundZeroTotalShares}`);
          console.log(`   - Employee shares: ${employeeShares}`);
          console.log(`   - Total shares: ${totalShares}`);
          console.log(
            `   - Actual option pool %: ${actualOptionPoolPercent.toFixed(
              2,
            )}% (post-money)`,
          );

          resolve({
            optionPoolPercent: parseFloat(actualOptionPoolPercent.toFixed(2)), // 10%
            existingShares: totalShares, // 111,111
            calculationMethod: "SAFE Round Calculation",
            details: {
              founderShares: roundZeroTotalShares,
              employeeShares: employeeShares,
              totalShares: totalShares,
              inputOptionPoolPercent: optionPoolPercentInput,
            },
          });
        } catch (error) {
          console.error("Error in SAFE calculation:", error);
          reject(error);
        }
      },
    );
  });
}
// ✅ NEW Helper Function for Convertible Note Seed Round Calculation
function calculateOptionPoolFromConvertibleNoteRound(
  previousRound,
  company_id,
) {
  return new Promise((resolve, reject) => {
    // Get Round 0 data
    db.query(
      `SELECT * FROM roundrecord WHERE company_id=? AND round_type='Round 0'`,
      [company_id],
      (err, roundZeroData) => {
        if (err) {
          reject(err);
          return;
        }

        if (roundZeroData.length === 0) {
          resolve({
            optionPoolPercent: 0,
            existingShares: 0,
            calculationMethod: "No Round 0 found",
          });
          return;
        }

        const roundZero = roundZeroData[0];

        try {
          // Parse Convertible Note round data (SAME as handleConvertibleNoteRoundCalculation)
          const companyValue = parseFloat(previousRound.pre_money) || 0;
          const investmentSize = parseFloat(previousRound.roundsize) || 0;
          const optionPoolPercentInput =
            parseFloat(previousRound.optionPoolPercent) || 0;

          // Get founder shares from Round 0
          let roundZeroTotalShares = 0;

          if (roundZero.founder_data) {
            try {
              const founderData = JSON.parse(roundZero.founder_data);
              roundZeroTotalShares =
                parseFloat(founderData.totalShares) ||
                parseFloat(roundZero.issuedshares) ||
                0;
            } catch (e) {
              roundZeroTotalShares = parseFloat(roundZero.issuedshares) || 0;
            }
          } else {
            roundZeroTotalShares = parseFloat(roundZero.issuedshares) || 0;
          }

          // ✅ CONVERTIBLE NOTE ROUND CALCULATION (SAME as handleConvertibleNoteRoundCalculation)
          // Calculate Employee shares using Convertible Note formula
          const employeeShares = Math.round(
            (roundZeroTotalShares * (optionPoolPercentInput / 100)) /
              (1 - optionPoolPercentInput / 100),
          );

          const totalShares = roundZeroTotalShares + employeeShares;

          // Calculate ACTUAL option pool percentage
          const actualOptionPoolPercent =
            totalShares > 0 ? (employeeShares / totalShares) * 100 : 0;

          resolve({
            optionPoolPercent: parseFloat(actualOptionPoolPercent.toFixed(2)), // 10%
            existingShares: totalShares, // 111,111
            calculationMethod: "Convertible Note Round Calculation",
            details: {
              founderShares: roundZeroTotalShares,
              employeeShares: employeeShares,
              totalShares: totalShares,
              inputOptionPoolPercent: optionPoolPercentInput,
            },
          });
        } catch (error) {
          console.error("Error in Convertible Note calculation:", error);
          reject(error);
        }
      },
    );
  });
}
// ✅ Helper Function for Common Stock/OTHER instrument type
function calculateOptionPoolFromCommonStockFunction(previousRound, company_id) {
  return new Promise((resolve, reject) => {
    // First, get Round 0 data
    db.query(
      `SELECT * FROM roundrecord WHERE company_id=? AND round_type='Round 0'`,
      [company_id],
      (err, roundZeroData) => {
        if (err) {
          reject(err);
          return;
        }

        if (roundZeroData.length === 0) {
          resolve({
            optionPoolPercent: 0,
            existingShares: 0,
            calculationMethod: "No Round 0 found",
          });
          return;
        }

        const roundZero = roundZeroData[0];

        // Get investors for this round
        db.query(
          `SELECT ir.*, COALESCE(ii.first_name,'') AS first_name, COALESCE(ii.last_name,'') AS last_name
           FROM investorrequest_company ir
           LEFT JOIN investor_information ii ON ir.investor_id = ii.id
           WHERE ir.roundrecord_id=? AND ir.company_id=? AND ir.request_confirm='Yes'`,
          [previousRound.id, company_id],
          (err, investors) => {
            if (err) {
              console.error("Error fetching investors:", err);
              investors = [];
            }

            try {
              // Extract parameters (SAME as calculateInvestmentRoundCapTable)
              const investmentSize = parseFloat(previousRound.roundsize) || 0;
              const preMoneyValuation =
                parseFloat(previousRound.pre_money) || 0;
              const optionPoolPercentInput =
                parseFloat(previousRound.optionPoolPercent) || 0;

              // Get founder shares from Round 0
              let roundZeroTotalShares = 0;
              let roundZeroFounders = [];

              if (roundZero.founder_data) {
                try {
                  const founderData = JSON.parse(roundZero.founder_data);
                  roundZeroTotalShares =
                    parseFloat(founderData.totalShares) ||
                    parseFloat(roundZero.issuedshares) ||
                    0;

                  if (
                    founderData.founders &&
                    Array.isArray(founderData.founders)
                  ) {
                    roundZeroFounders = founderData.founders;
                  }
                } catch (e) {
                  roundZeroTotalShares =
                    parseFloat(roundZero.issuedshares) || 0;
                }
              } else {
                roundZeroTotalShares = parseFloat(roundZero.issuedshares) || 0;
              }

              // ✅ CALCULATION (SAME as calculateInvestmentRoundCapTable)
              // 1. Calculate option pool shares
              const optionPoolShares =
                optionPoolPercentInput > 0
                  ? Math.round(
                      (roundZeroTotalShares * (optionPoolPercentInput / 100)) /
                        (1 - optionPoolPercentInput / 100),
                    )
                  : 0;

              const totalSharesPreSeed =
                roundZeroTotalShares + optionPoolShares;

              // 2. Calculate post-money shares
              const postMoneyValuation = investmentSize + preMoneyValuation;
              const investorOwnershipPercent =
                (investmentSize / postMoneyValuation) * 100;
              const totalSharesPostInvestment = Math.round(
                totalSharesPreSeed / (1 - investorOwnershipPercent / 100),
              );

              // 3. Calculate ACTUAL option pool percentage (post-money basis)
              const actualOptionPoolPercent =
                totalSharesPostInvestment > 0
                  ? (optionPoolShares / totalSharesPostInvestment) * 100
                  : 0;

              resolve({
                optionPoolPercent: parseFloat(
                  optionPoolPercentInput.toFixed(2),
                ),
                existingShares: totalSharesPostInvestment,
                calculationMethod: "calculateInvestmentRoundCapTable logic",
                details: {
                  founderShares: roundZeroTotalShares,
                  optionPoolShares: optionPoolShares,
                  totalShares: totalSharesPostInvestment,
                  inputOptionPoolPercent: optionPoolPercentInput,
                },
              });
            } catch (error) {
              console.error("Error in Common Stock calculation:", error);
              reject(error);
            }
          },
        );
      },
    );
  });
}

// ✅ Helper function to get seed round option pool for Series rounds
function getSeedRoundOptionPoolForSeries(company_id, current_round_id) {
  return new Promise((resolve, reject) => {
    let whereCondition = `WHERE rr.company_id = ? AND rr.round_type = 'Investment'`;
    const params = [company_id];

    if (current_round_id !== 0) {
      whereCondition += ` AND rr.id < ?`;
      params.push(current_round_id);
    }

    const query = `
      SELECT 
        rr.id,
        rr.nameOfRound,
        rr.optionPoolPercent,
        rr.optionPoolPercent_post,
        rr.issuedshares,
        rr.instrumentType
      FROM roundrecord rr
      ${whereCondition}
      ORDER BY rr.id DESC 
      LIMIT 1
    `;
    db.query(query, params, (err, results) => {
      if (err) {
        reject(err);
        return;
      }
      console.log(results);
      if (results.length === 0) {
        resolve({ optionPoolPercent: 0, existingShares: 0, roundName: null });
      } else {
        const seedRound = results[0];
        const optionPoolPercent = parseFloat(seedRound.optionPoolPercent) || 0;
        const existingShares = parseFloat(seedRound.issuedshares) || 0;

        resolve({
          optionPoolPercent,
          existingShares,
          roundName: seedRound.nameOfRound,
          instrumentType: seedRound.instrumentType,
        });
      }
    });
  });
}

// Then in your getPreviousRoundForAutoFill:

exports.getIndustryExpertise = (req, res) => {
  db.query(
    `SELECT *
    FROM industry_expertise
    ORDER BY id DESC`,
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
    warrant_exercise_type,
    warrant_adjustment_percent,
    warrant_adjustment_direction,
    warrant_status,
    issued_date,
    expiration_date,
    notes,
  } = req.body;

  const sql = `
    INSERT INTO warrants (
      roundrecord_id,
      company_id,
      investor_id,
      warrant_coverage_percentage,
      warrant_exercise_type,
      warrant_adjustment_percent,
      warrant_adjustment_direction,
      warrant_status,
      issued_date,
      expiration_date,
      notes,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
  `;

  const values = [
    roundrecord_id,
    company_id,
    investor_id || 0,
    warrant_coverage_percentage || 0,
    warrant_exercise_type || "next_round_adjusted",
    warrant_adjustment_percent || 0,
    warrant_adjustment_direction || "decrease",
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

    return res.status(200).json({
      success: true,
      message: "Warrant created successfully",
      warrantId: result.insertId,
    });
  });
};

exports.warrantDataUpdate = (req, res) => {
  const {
    roundrecord_id,
    company_id,
    investor_id,
    warrant_coverage_percentage,
    warrant_exercise_type,
    warrant_adjustment_percent,
    warrant_adjustment_direction,
    warrant_status,
    issued_date,
    expiration_date,
    notes,
  } = req.body;

  const sql = `
    UPDATE warrants 
    SET 
     
      company_id = ?,
      investor_id = ?,
      warrant_coverage_percentage = ?,
      warrant_exercise_type = ?,
      warrant_adjustment_percent = ?,
      warrant_adjustment_direction = ?,
      warrant_status = ?,
      issued_date = ?,
      expiration_date = ?,
      notes = ?,
      updated_at = NOW()
    WHERE roundrecord_id = ?
  `;

  const values = [
    company_id,
    investor_id || 0,
    warrant_coverage_percentage || 0,
    warrant_exercise_type || "next_round_adjustment",
    warrant_adjustment_percent || 0,
    warrant_adjustment_direction || "decrease",
    warrant_status || "pending",
    issued_date || new Date(),
    expiration_date || null,
    notes || null,
    roundrecord_id, // WHERE clause के लिए last में
  ];
  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("Error updating warrant:", err);
      return res.status(500).json({
        success: false,
        message: "Error updating warrant",
        error: err,
      });
    }

    return res.status(200).json({
      success: true,
      // message: "Warrant updated successfully",
      // affectedRows: result.affectedRows,
    });
  });
};

exports.getPreviousFundingRound = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    console.log("❌ Company ID missing");
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
        console.log("❌ Database Error:", err.message);
        return res.status(500).json({
          success: false,
          message: "Database error",
          error: err.message,
        });
      }

      console.log("📊 Database Results:", results);
      console.log("📊 Results Length:", results.length);

      // STEP 1: Check karo results empty hai ya nahi
      if (!results || results.length === 0) {
        console.log("✅ First Time - No previous rounds found");
        const allRounds = [
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

        return res.status(200).json({
          success: true,
          results: [],
          allowedRounds: allRounds,
          message: "First funding round - All options available",
          isFirstRound: true,
        });
      }

      // STEP 2: Agar results hai, tabhi condition check karo
      console.log("🔄 Applying sequence rules...");
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
  console.log("🔍 Analyzing previous rounds:", previousRounds);

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

  console.log("Highest Round Index:", highestIndex);
  console.log("Highest Round:", roundSequence[highestIndex] || "None");

  // Step 2: Check what's the highest MAIN series round
  let highestSeriesIndex = -1;
  previousRounds.forEach((round) => {
    const type = round.shareClassType;
    if (type.includes("Series") && !type.includes("Extension")) {
      const index = roundSequence.indexOf(type);
      if (index > highestSeriesIndex) highestSeriesIndex = index;
    }
  });

  console.log("Highest Series Index:", highestSeriesIndex);

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

  console.log("Started with:", {
    startedWithPreSeed,
    startedWithSeed,
    startedWithPostSeed,
    startedWithSeries,
    startedWithExtension,
  });

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
          console.log(`❌ Blocked ${round} - Started with Series D Extension`);
        }
      }
      // If started with Series, block all Seed rounds
      else if (
        startedWithSeries &&
        ["Pre-Seed", "Seed", "Post-Seed"].includes(round)
      ) {
        shouldAllow = false;
        console.log(`❌ Blocked ${round} - Company started with Series`);
      }
      // If started with Post-Seed, block Pre-Seed and Seed
      else if (startedWithPostSeed && ["Pre-Seed", "Seed"].includes(round)) {
        shouldAllow = false;
        console.log(`❌ Blocked ${round} - Company started with Post-Seed`);
      }
      // If started with Seed, block Pre-Seed
      else if (startedWithSeed && round === "Pre-Seed") {
        shouldAllow = false;
        console.log(`❌ Blocked ${round} - Company started with Seed`);
      }
    }

    if (shouldAllow) {
      allowedRounds.push(round);
      console.log(`✅ Allowed ${round}`);
    }
  });

  console.log("🎯 Final Allowed Rounds:", allowedRounds);
  return allowedRounds;
}
