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
    console.log(req.body.company_id);
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
  } catch (error) {
    console.log("File read error:", filePath, error);
  }

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

    // ---------------- UPDATE ----------------
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
        (err, results) => {
          if (err) {
            return res.status(500).json({ message: "DB fetch error", err });
          }
          if (!results.length) {
            return res.status(404).json({ message: "Record not found" });
          }

          const existingTermsheetFiles = results[0].termsheetFile;
          const existingSubscriptionDocs = results[0].subscriptiondocument;

          let sql = `UPDATE roundrecord SET 
            optionPoolPercent_post=?,investorPostMoney=?,optionPoolPercent =?, pre_money = ?, post_money = ?, company_id = ?, roundStatus = ?, instrument_type_data = ?, created_by_id = ?, created_by_role = ?, 
            dateroundclosed = ?, nameOfRound = ?, shareClassType = ?, shareclassother = ?, description = ?, 
            instrumentType = ?, customInstrument = ?, roundsize = ?, currency = ?, issuedshares = ?, rights = ?, 
            liquidationpreferences = ?, liquidation = ?, liquidationOther = ?, convertible = ?, convertibleType = ?, 
            voting = ?, generalnotes = ?, updated_by_id = ?, updated_by_role = ?, round_type = ?, founder_data = ?, 
            total_founder_shares = ?, founder_count = ?`;

          const values = [
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
            issuedshares || "",
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

          sql += `, termsheetFile = ?, subscriptiondocument = ?`;
          values.push(JSON.stringify(finalTermsheetFiles));
          values.push(JSON.stringify(finalSubscriptionDocs));

          sql += " WHERE id = ?";
          values.push(id);

          db.query(sql, values, async (err) => {
            if (err) {
              return res.status(500).json({ message: "DB update error", err });
            }

            // >>> AI EXECUTIVE SUMMARY START <<<
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
            // try {
            //   const aiRes = await openai.chat.completions.create({
            //     model: "gpt-4-turbo",
            //     messages: [
            //       {
            //         role: "system",
            //         content: "You summarize investment rounds.",
            //       },
            //       { role: "user", content: prompt },
            //     ],
            //     max_tokens: 500,
            //   });
            //   executiveSummary = aiRes.choices[0].message.content.trim();
            // } catch (e) {}

            await db
              .promise()
              .query(`UPDATE roundrecord SET executive_summary=? WHERE id=?`, [
                executiveSummary,
                id,
              ]);
            // >>> AI EXECUTIVE SUMMARY END <<<

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
            });

            return res.status(200).json({
              message: "Record updated successfully",
              id,
              executive_summary: executiveSummary,
            });
          });
        },
      );
    }

    // ---------------- INSERT ----------------
    else {
      const sql = `INSERT INTO roundrecord (optionPoolPercent_post,investorPostMoney,optionPoolPercent,pre_money,post_money,company_id,created_by_id,created_by_role,updated_by_id,updated_by_role,round_type, nameOfRound, shareClassType, shareclassother,description,instrumentType,instrument_type_data,customInstrument,roundsize,currency,issuedshares, rights, liquidationpreferences,liquidation,liquidationOther,convertible, convertibleType, voting, termsheetFile, subscriptiondocument, 
  generalnotes, dateroundclosed, roundStatus, is_shared, is_locked, created_at, founder_data, total_founder_shares, founder_count)
  VALUES (?, ?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
        optionPoolPercent_post,
        investorPostMoney,
        optionPoolPercent,
        pre_money || null,
        post_money || null,
        company_id,
        created_by_id,
        created_by_role,
        0,
        null,
        round_type || "Investment",
        nameOfRound || "",
        shareClassType || "",
        shareclassother || "",
        description || "",
        instrumentType || "",
        JSON.stringify(parsedInstrumentData),
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
        JSON.stringify(newTermsheetFiles),
        JSON.stringify(newSubscriptionDocs),
        generalnotes || "",
        processedDateRoundClosed,
        roundStatus || "",
        "No",
        "No",
        new Date(),
        JSON.stringify(founder_data) || null,
        parsedTotalFounderShares,
        parsedFounderCount,
      ];

      db.query(sql, values, async (err, result) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB insert error", error: err });
        }

        const newId = result.insertId;

        // ✅ CRITICAL: Check if this is a Preferred Equity round
        // If yes, then exercise ALL pending warrants from previous rounds
        if (instrumentType === "Preferred Equity") {
          // Step 1: Get ALL pending warrants from previous rounds
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
                console.log(
                  `Found ${pendingWarrants.length} pending warrants to exercise in round ${newId}`,
                );

                // Step 2: UPDATE each pending warrant to EXERCISED
                for (const warrant of pendingWarrants) {
                  try {
                    // Update warrants table
                    await db.promise().query(
                      `
                UPDATE warrants 
                SET 
                  warrant_status = 'exercised',
                  exercised_date = NOW(),
                  exercised_in_round_id = ?,
                  updated_at = NOW()
                WHERE id = ?
              `,
                      [newId, warrant.id],
                    );

                    console.log(
                      `✅ Warrant ${warrant.id} EXERCISED in round ${newId}`,
                    );

                    // Also update the original round's instrument_type_data to record exercise
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

                            // Add exercise info
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

                            // Update original round
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

                // Step 3: Also update current round's instrument_type_data to show exercised warrants
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

                        // Add exercised warrants info to current round
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
          roundrecord_id,
          company_id,
          investor_id,
          warrant_coverage_percentage,
          warrant_exercise_type,
          warrant_adjustment_percent,
          warrant_adjustment_direction,
          expiration_date,
          notes,
          warrant_status,
          issued_date,
          created_at,
          updated_at
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
              console.log(
                `Created warrant with ID: ${warrantResult.insertId} for round ${newId}`,
              );
            }
          });
        }

        // >>> AI EXECUTIVE SUMMARY START <<<
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
        // try {
        //   const aiRes = await openai.chat.completions.create({
        //     model: "gpt-4-turbo",
        //     messages: [
        //       { role: "system", content: "You summarize investment rounds." },
        //       { role: "user", content: prompt },
        //     ],
        //     max_tokens: 500,
        //   });
        //   executiveSummary = aiRes.choices[0].message.content.trim();
        // } catch (e) {}

        await db
          .promise()
          .query(`UPDATE roundrecord SET executive_summary=? WHERE id=?`, [
            executiveSummary,
            newId,
          ]);
        // >>> AI EXECUTIVE SUMMARY END <<<

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
        });

        return res.status(200).json({
          message: "Record created successfully",
          id: newId,
          executive_summary: executiveSummary,
          warrant_created: parsedInstrumentData.hasWarrants_preferred || false,
          warrants_exercised:
            instrumentType === "Preferred Equity"
              ? "Pending warrants from previous rounds will be exercised when this round is calculated"
              : "N/A",
        });
      });
    }
  });
};

function insertAuditLog({
  userId,
  companyId,
  module,
  action,
  entityId,
  entityType,
  details,
  ip,
}) {
  const sql = `
    INSERT INTO audit_logs 
    (user_id, company_id, module, action, entity_id, entity_type, details, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;

  const values = [
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
}) {
  const sql = `
    INSERT INTO access_logs_company_round 
    (user_id, user_role, company_id, action, target_table, target_id, description, ip_address) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [
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
        console.log("Access Log Added ✅");
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
    SELECT * from roundrecord where company_id = ? And id = ?
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
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
  }

  // Step 1: Get round details
  db.query(
    "SELECT * FROM roundrecord WHERE id = ? AND company_id = ?",
    [round_id, company_id],
    (err, roundData) => {
      if (err)
        return res
          .status(500)
          .json({ success: false, message: "Database error", error: err });
      if (roundData.length === 0)
        return res
          .status(404)
          .json({ success: false, message: "Round not found" });

      const round = roundData[0];

      // Step 2: Check if this is Round 0
      if (round.round_type === "Round 0") {
        const capTableData = calculateRoundZeroCapTable(round);
        return res.status(200).json({
          success: true,
          message: "Round 0 cap table data retrieved successfully",
          round,
          capTable: capTableData,
        });
      }

      // Step 3: Check instrument type
      let instrumentType = "";
      let instrumentData = {};
      try {
        if (round.instrument_type_data) {
          instrumentData = safeJSONParseRepeated(round.instrument_type_data, 3);
          instrumentType =
            instrumentData?.instrumentType || round.instrumentType || "";
        } else {
          instrumentType = round.instrumentType || "";
        }
      } catch (e) {
        instrumentType = round.instrumentType || "";
      }

      // Step 4: For SAFE rounds
      if (instrumentType === "Safe") {
        return handleSAFERoundCalculation(round, company_id, res);
      }
      if (instrumentType === "Preferred Equity") {
        //return handleSAFESeriesRoundCalculation(round, company_id, res);
        return handlePreferredEquityRoundSafeAndConvertibleCalculation(
          round,
          company_id,
          res,
        );
      }

      // Step 5: For Convertible Note rounds
      if (instrumentType === "Convertible Note") {
        return handleConvertibleNoteRoundCalculation(
          round,
          company_id,
          instrumentData,
          res,
        );
      }
      if (
        instrumentType === "Convertible Note" &&
        round.shareClassType?.includes("Series")
      ) {
        return handleConvertibleNote_SeriesRoundCalculation(
          round,
          company_id,
          res,
        );
      }
      // if (instrumentType === "Preferred Equity") {
      //   return handlePreferredEquityRoundCalculation(round, company_id, res);
      // }
      // Step 6: Get investors
      db.query(
        `SELECT ir.*, COALESCE(ii.first_name,'') AS first_name, COALESCE(ii.last_name,'') AS last_name, COALESCE(ii.email,'') AS email
         FROM investorrequest_company ir
         LEFT JOIN investor_information ii ON ir.investor_id = ii.id
         WHERE ir.roundrecord_id=? AND ir.company_id=? AND ir.request_confirm='Yes'`,
        [round_id, company_id],
        (err, investors) => {
          if (err)
            return res
              .status(500)
              .json({ success: false, message: "Database error", error: err });

          // Step 7: Get Round 0 data
          db.query(
            `SELECT * FROM roundrecord WHERE company_id=? AND round_type='Round 0'`,
            [company_id],
            (err, roundZeroData) => {
              if (err)
                return res.status(500).json({
                  success: false,
                  message: "Database error",
                  error: err,
                });

              if (roundZeroData.length === 0) {
                return res.status(400).json({
                  success: false,
                  message: "Round 0 data not found",
                });
              }

              const roundZero = roundZeroData[0];

              // Step 8: NEW - Check if this is Series A with post-money option pool

              if (round.instrumentType === "Common Stock") {
                db.query(
                  `SELECT * FROM roundrecord WHERE id = ? AND company_id = ?`,
                  [round_id, company_id],
                  (err, roundResults) => {
                    if (err) {
                      console.error("❌ Database error fetching round:", err);
                      return res.status(500).json({
                        success: false,
                        message: "Database error fetching round",
                        error: err.message,
                      });
                    }

                    if (roundResults.length === 0) {
                      return res.status(404).json({
                        success: false,
                        message: "Round not found",
                      });
                    }

                    const round = roundResults[0];

                    // Step 2: Get Round 0 (founder data)
                    db.query(
                      `SELECT * FROM roundrecord 
                      WHERE company_id = ? AND round_type = 'Round 0' 
                      ORDER BY created_at ASC LIMIT 1`,
                      [company_id],
                      (err, roundZeroResults) => {
                        if (err) {
                          console.error(
                            "❌ Database error fetching Round 0:",
                            err,
                          );
                          return res.status(500).json({
                            success: false,
                            message: "Database error fetching Round 0",
                            error: err.message,
                          });
                        }

                        const roundZero =
                          roundZeroResults.length > 0
                            ? roundZeroResults[0]
                            : null;

                        // Step 3: Get ALL previous investment rounds (before Series A)
                        db.query(
                          `SELECT * FROM roundrecord 
                          WHERE company_id = ? 
                          AND round_type = 'Investment'
                          AND id < ?
                          AND created_at < (SELECT created_at FROM roundrecord WHERE id = ?)
                          ORDER BY created_at ASC`,
                          [company_id, round_id, round_id],
                          (err, previousRounds) => {
                            if (err) {
                              console.error(
                                "❌ Database error fetching previous rounds:",
                                err,
                              );
                              return res.status(500).json({
                                success: false,
                                message:
                                  "Database error fetching previous rounds",
                                error: err.message,
                              });
                            }

                            previousRounds.forEach((pr, idx) => {
                              console.log(
                                `   ${idx + 1}. ${pr.nameOfRound} - ${
                                  pr.issuedshares
                                } shares`,
                              );
                            });

                            // Step 4: Get Series A investors
                            db.query(
                              `SELECT ir.*, ii.first_name, ii.last_name, ii.email
                              FROM investorrequest_company ir
                              LEFT JOIN investor_information ii ON ir.investor_id = ii.id
                              WHERE ir.roundrecord_id = ? 
                              AND ir.company_id = ? 
                              AND ir.request_confirm = 'Yes'`,
                              [round_id, company_id],
                              (err, currentInvestors) => {
                                if (err) {
                                  console.error(
                                    "❌ Database error fetching investors:",
                                    err,
                                  );
                                  return res.status(500).json({
                                    success: false,
                                    message:
                                      "Database error fetching current investors",
                                    error: err.message,
                                  });
                                }

                                currentInvestors.forEach((inv, idx) => {
                                  console.log(
                                    `   ${idx + 1}. ${inv.first_name} ${
                                      inv.last_name
                                    } - $${inv.investment_amount}`,
                                  );
                                });

                                const capTableData =
                                  calculateCommonStockCapTable(
                                    round,
                                    currentInvestors,
                                    roundZero,
                                    previousRounds,
                                  );
                                console.log(capTableData);
                                if (capTableData.error) {
                                  console.error(
                                    "❌ Calculation error:",
                                    capTableData.error,
                                  );
                                  return res.status(500).json({
                                    success: false,
                                    message: "Series A calculation failed",
                                    error: capTableData.error,
                                    details: capTableData.details,
                                  });
                                }
                                return res.status(200).json({
                                  success: true,
                                  message:
                                    "Series A cap table calculated successfully",
                                  round: {
                                    id: round.id,
                                    name: round.nameOfRound,
                                    type: round.round_type,
                                    investmentSize: round.roundsize,
                                    preMoneyValuation: round.pre_money,
                                    postMoneyValuation: round.post_money,
                                    optionPoolPercentPost:
                                      round.optionPoolPercent_post,
                                    currency: round.currency,
                                  },
                                  capTable: capTableData,
                                });
                              },
                            );
                          },
                        );
                      },
                    );
                  },
                );
              } else {
                // Regular round (Seed, etc.)
                const capTableData = calculateInvestmentRoundCapTable(
                  round,
                  investors,
                  roundZero,
                );

                return res.status(200).json({
                  success: true,
                  message: "Cap table data retrieved successfully",
                  round,
                  capTable: capTableData,
                });
              }
            },
          );
        },
      );
    },
  );
};

function handlePreferredEquityRoundCalculation(round, company_id, res) {
  console.log("\n🚀 ==== PREFERRED EQUITY CALCULATION STARTED ====");
  console.log("Round ID:", round.id);
  console.log("Round Name:", round.nameOfRound);
  console.log("Instrument:", round.instrumentType);
  console.log("Investment:", round.roundsize);
  console.log("Pre-Money:", round.pre_money);

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
      console.log("✅ Round 0 found:", roundZero.nameOfRound);

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

          console.log(
            `✅ Found ${previousRounds.length} previous investment rounds`,
          );
          previousRounds.forEach((r, i) => {
            console.log(
              `  ${i + 1}. ${r.nameOfRound} - ${r.instrumentType} - $${r.roundsize} - Pool: ${r.optionPoolPercent || 0}%`,
            );
          });

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

              console.log(
                `✅ Found ${currentInvestors.length} Series A investors`,
              );

              // 🔴 IMPORTANT: If no investors in investorrequest_company, use round data
              if (currentInvestors.length === 0 && round.roundsize) {
                console.log("⚠️ No investors found, using round data");
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
                      console.log(
                        `✅ Found ${warrantResults.length} warrants from database`,
                      );

                      warrantResults.forEach((warrant, index) => {
                        console.log(
                          `   ${index + 1}. Warrant ID: ${warrant.id}, Status: ${warrant.warrant_status}, Original Round: ${warrant.original_round_name}`,
                        );

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
                      console.log(
                        "\n📊 ===== STARTING CAP TABLE CALCULATION =====",
                      );
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

                      console.log("✅ ===== CALCULATION COMPLETE =====");
                      console.log(
                        "Post-Money Valuation:",
                        capTableData.calculations.postMoneyValuation,
                      );
                      console.log(
                        "Total Shares:",
                        capTableData.postSeriesACapTable
                          .totalSharesAfterWarrants,
                      );

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
  console.log(
    "\n🔵 ===== PREFERRED EQUITY (SERIES A) UNIVERSAL CALCULATION =====",
  );

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
        toNumber(roundZero.issuedshares, 100000);

      if (founderData?.founders && Array.isArray(founderData.founders)) {
        roundZeroFounders = founderData.founders;
      }
    } else {
      roundZeroTotalShares = toNumber(roundZero.issuedshares, 100000);
    }
  } catch (error) {
    roundZeroTotalShares = 100000; // Default
  }

  console.log(
    `📍 Round 0 Founder Shares: ${roundZeroTotalShares.toLocaleString()}`,
  );

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
function calculateCommonStockCapTable(
  round,
  investors,
  roundZero,
  previousRounds,
) {
  try {
    console.log("\n🔵 ========== COMMON STOCK CALCULATION START ==========");
    console.log("Common Stock Round:", round.nameOfRound || "Unknown");

    // Helper functions
    const toNumber = (value, defaultValue = 0) => {
      if (value === null || value === undefined || value === "")
        return defaultValue;
      const num = Number(value);
      return isNaN(num) ? defaultValue : num;
    };

    // ========== STEP 1: BUILD CAP TABLE FROM ALL PREVIOUS ROUNDS ==========
    console.log("\n🔍 Building cap table from all previous rounds...");

    let totalExistingShares = 0;
    let existingShareholders = [];
    let existingOptionPoolShares = 0;
    let existingOptionPoolPercent = 0;

    // 1. Start with Round 0
    if (roundZero) {
      try {
        let roundZeroShares = 0;
        if (roundZero.founder_data) {
          const founderData = JSON.parse(roundZero.founder_data);
          if (founderData.founders && Array.isArray(founderData.founders)) {
            founderData.founders.forEach((founder) => {
              const shares = toNumber(founder.shares, 0);
              roundZeroShares += shares;
              existingShareholders.push({
                name:
                  `${founder.firstName || ""} ${founder.lastName || ""}`.trim() ||
                  "Founder",
                type: "Founder",
                originalType: "Founder",
                source: "Round 0",
                votingRights: founder.voting || "voting",
                shares: shares,
                commonShares: shares,
                investmentAmount: 0,
              });
            });
            totalExistingShares = roundZeroShares;
          } else {
            roundZeroShares = toNumber(
              founderData.totalShares || roundZero.issuedshares,
              100000,
            );
            existingShareholders.push({
              name: "Founders",
              type: "Founder",
              originalType: "Founder",
              source: "Round 0",
              votingRights: "voting",
              shares: roundZeroShares,
              commonShares: roundZeroShares,
              investmentAmount: 0,
            });
            totalExistingShares = roundZeroShares;
          }
        } else {
          roundZeroShares = toNumber(roundZero.issuedshares, 100000);
          existingShareholders.push({
            name: "Founders",
            type: "Founder",
            originalType: "Founder",
            source: "Round 0",
            votingRights: "voting",
            shares: roundZeroShares,
            commonShares: roundZeroShares,
            investmentAmount: 0,
          });
          totalExistingShares = roundZeroShares;
        }
        console.log(
          `✅ Round 0: ${totalExistingShares.toLocaleString()} founder shares`,
        );
      } catch (error) {
        console.log("Error processing Round 0:", error);
        totalExistingShares = 100000;
        existingShareholders.push({
          name: "Founders",
          type: "Founder",
          originalType: "Founder",
          source: "Round 0",
          votingRights: "voting",
          shares: totalExistingShares,
          commonShares: totalExistingShares,
          investmentAmount: 0,
        });
      }
    }

    // ============================================
    // ✅ STEP 2: PROCESS SAFE AND CONVERTIBLE NOTE ROUNDS
    // ============================================
    console.log("\n🔄 Processing convertible rounds...");

    const allConvertibles = [];
    let totalSeedInvestment = 0;
    let convertibleOptionPoolPercent = 0;
    let employeeSharesSeedRound = 0;

    if (previousRounds && previousRounds.length > 0) {
      const convertibleRounds = previousRounds.filter(
        (r) =>
          r.instrumentType === "Safe" ||
          r.instrumentType === "Convertible Note",
      );

      console.log(`Found ${convertibleRounds.length} convertible rounds`);

      convertibleRounds.forEach((convRound) => {
        try {
          const instrumentData = JSON.parse(
            convRound.instrument_type_data || "{}",
          );

          let interestRate = 0;
          if (convRound.instrumentType === "Convertible Note") {
            interestRate = toNumber(instrumentData.interestRate_note, 10);
          }

          const convertibleData = {
            instrumentType: convRound.instrumentType,
            investment: toNumber(convRound.roundsize, 0),
            valuationCap: toNumber(
              convRound.instrumentType === "Safe"
                ? instrumentData.valuationCap
                : instrumentData.valuationCap_note,
              0,
            ),
            discountRate: toNumber(
              convRound.instrumentType === "Safe"
                ? instrumentData.discountRate
                : instrumentData.discountRate_note,
              0,
            ),
            interestRate: interestRate,
            optionPoolPercent: toNumber(convRound.optionPoolPercent, 0),
          };

          allConvertibles.push(convertibleData);
          totalSeedInvestment += convertibleData.investment;

          if (
            convertibleData.optionPoolPercent > convertibleOptionPoolPercent
          ) {
            convertibleOptionPoolPercent = convertibleData.optionPoolPercent;
          }
        } catch (e) {
          console.log("Error parsing convertible round:", e);
        }
      });

      // ✅ IMPORTANT: Calculate employee shares from convertible rounds
      if (convertibleOptionPoolPercent > 0 && totalExistingShares > 0) {
        employeeSharesSeedRound = Math.round(
          totalExistingShares / (1 - convertibleOptionPoolPercent / 100) -
            totalExistingShares,
        );

        if (employeeSharesSeedRound > 0) {
          existingShareholders.push({
            name: "Employee Option Pool",
            type: "Options Pool",
            originalType: "Options Pool",
            source: "Convertible Round(s)",
            votingRights: "non-voting",
            shares: employeeSharesSeedRound,
            commonShares: employeeSharesSeedRound,
            newShares: employeeSharesSeedRound,
            investmentAmount: 0,
          });

          existingOptionPoolShares = employeeSharesSeedRound;
          totalExistingShares += employeeSharesSeedRound;
          existingOptionPoolPercent = convertibleOptionPoolPercent;

          console.log(
            `✅ Added ${employeeSharesSeedRound.toLocaleString()} option pool shares (${convertibleOptionPoolPercent}%)`,
          );
        }
      }
    }

    console.log(`\n🎯 STARTING POINT FOR COMMON STOCK:`);
    console.log(`   Total Shares: ${totalExistingShares.toLocaleString()}`);
    console.log(`   Shareholders: ${existingShareholders.length}`);
    console.log(
      `   Option Pool: ${existingOptionPoolShares.toLocaleString()} shares (${existingOptionPoolPercent.toFixed(1)}%)`,
    );

    // ============================================
    // ✅ STEP 3: COMMON STOCK CALCULATION
    // ============================================
    const investmentSize = toNumber(round.roundsize, 0);
    const preMoneyValuation = toNumber(round.pre_money, 0);
    const targetOptionPoolPercent = toNumber(round.optionPoolPercent_post, 0);
    const currency = round.currency || "USD";

    console.log("\n📊 COMMON STOCK INPUTS:");
    console.log(
      `   Investment: ${investmentSize.toLocaleString()} ${currency}`,
    );
    console.log(
      `   Pre-Money: ${preMoneyValuation.toLocaleString()} ${currency}`,
    );
    console.log(`   Target Option Pool: ${targetOptionPoolPercent}%`);
    console.log(
      `   Existing Option Pool: ${existingOptionPoolPercent.toFixed(1)}%`,
    );

    if (investmentSize <= 0 || preMoneyValuation <= 0) {
      return {
        success: false,
        error: "Invalid investment or valuation for Common Stock round",
        details: { investmentSize, preMoneyValuation },
      };
    }

    // Calculate share price
    const sharePrice =
      totalExistingShares > 0 ? preMoneyValuation / totalExistingShares : 0;
    const newInvestmentShares =
      sharePrice > 0 ? Math.round(investmentSize / sharePrice) : 0;
    const postMoneyValuation = preMoneyValuation + investmentSize;

    console.log(`\n📈 INITIAL CALCULATIONS:`);
    console.log(`   Share Price: ${sharePrice.toFixed(2)} ${currency}`);
    console.log(
      `   New Investment Shares: ${newInvestmentShares.toLocaleString()}`,
    );
    console.log(
      `   Post-Money: ${postMoneyValuation.toLocaleString()} ${currency}`,
    );

    // ============================================
    // ✅ STEP 4: CONVERT SAFE AND CONVERTIBLE NOTES AT COMMON STOCK PRICE
    // ============================================
    let convertibleConversionShares = 0;
    const convertedInvestors = [];

    if (allConvertibles.length > 0 && sharePrice > 0) {
      console.log(
        `\n🔄 Converting ${allConvertibles.length} convertible instrument(s):`,
      );

      allConvertibles.forEach((convertible, index) => {
        // Calculate discount price
        const discountPrice = sharePrice * (1 - convertible.discountRate / 100);

        // Calculate cap price
        const capPrice =
          convertible.valuationCap > 0
            ? convertible.valuationCap / totalExistingShares
            : 0;

        // Optimal price is lower of discount or cap price
        const optimalPrice =
          capPrice > 0 ? Math.min(discountPrice, capPrice) : discountPrice;

        // Calculate conversion amount (with interest for notes)
        let conversionAmount = convertible.investment;
        if (convertible.instrumentType === "Convertible Note") {
          const years = 2; // Assuming 2 years to maturity
          conversionAmount =
            convertible.investment *
            Math.pow(1 + convertible.interestRate / 100, years);
        }

        // Calculate conversion shares
        const conversionShares = Math.round(conversionAmount / optimalPrice);

        if (conversionShares > 0) {
          convertibleConversionShares += conversionShares;

          const displayName =
            convertible.instrumentType === "Safe"
              ? `SAFE Investor ${index + 1}`
              : `Convertible Note Investor ${index + 1}`;

          convertedInvestors.push({
            name: displayName,
            type:
              convertible.instrumentType === "Safe"
                ? "SAFE Investor"
                : "Convertible Note Investor",
            originalType: "Convertible Investor",
            source: "Converted in Common Stock Round",
            votingRights: "voting",
            shares: conversionShares,
            investmentAmount: convertible.investment,
            conversionAmount: conversionAmount,
            conversionPrice: optimalPrice,
          });

          console.log(
            `   ${displayName}: ${conversionShares.toLocaleString()} shares @ ${optimalPrice.toFixed(2)} ${currency}`,
          );
        }
      });
    }

    console.log(
      `   Total convertible shares: ${convertibleConversionShares.toLocaleString()}`,
    );

    // ============================================
    // ✅ STEP 5: OPTION POOL CALCULATION WITH CONVERTIBLE SHARES
    // ============================================
    // Recalculate existing option pool percentage with current total shares
    const updatedExistingOptionPoolPercent =
      totalExistingShares > 0
        ? (existingOptionPoolShares / totalExistingShares) * 100
        : 0;

    console.log(`\n📊 OPTION POOL CALCULATION:`);
    console.log(
      `   Existing Pool: ${existingOptionPoolShares.toLocaleString()} shares (${updatedExistingOptionPoolPercent.toFixed(1)}%)`,
    );
    console.log(`   Target Pool: ${targetOptionPoolPercent}%`);

    // Calculate total shares before option pool expansion
    const totalSharesBeforeOptionPool =
      totalExistingShares + newInvestmentShares + convertibleConversionShares;

    // Handle option pool expansion
    let totalPostInvestmentShares = totalSharesBeforeOptionPool;
    let totalRequiredOptionPoolShares = existingOptionPoolShares;
    let additionalOptionPoolShares = 0;
    let needsOptionPoolExpansion =
      targetOptionPoolPercent > updatedExistingOptionPoolPercent;

    if (needsOptionPoolExpansion) {
      console.log("\n⚠️ OPTION POOL EXPANSION NEEDED:");

      // Exclude existing option pool from calculation
      const totalNonOptionShares =
        totalExistingShares -
        existingOptionPoolShares +
        newInvestmentShares +
        convertibleConversionShares;

      totalPostInvestmentShares = Math.round(
        totalNonOptionShares / (1 - targetOptionPoolPercent / 100),
      );

      totalRequiredOptionPoolShares = Math.round(
        totalPostInvestmentShares * (targetOptionPoolPercent / 100),
      );

      additionalOptionPoolShares = Math.max(
        0,
        totalRequiredOptionPoolShares - existingOptionPoolShares,
      );

      console.log(
        `   Non-option shares: ${totalNonOptionShares.toLocaleString()}`,
      );
      console.log(
        `   Total post shares: ${totalPostInvestmentShares.toLocaleString()}`,
      );
      console.log(
        `   Required pool: ${totalRequiredOptionPoolShares.toLocaleString()}`,
      );
      console.log(
        `   Additional: ${additionalOptionPoolShares.toLocaleString()}`,
      );
    } else {
      // No expansion needed
      totalRequiredOptionPoolShares = existingOptionPoolShares;
      additionalOptionPoolShares = 0;
    }

    // ============================================
    // ✅ STEP 6: BUILD PRE-INVESTMENT CAP TABLE
    // ============================================
    console.log("\n🏗️ BUILDING PRE-INVESTMENT CAP TABLE...");

    const preInvestmentShareholders = existingShareholders.map((sh) => {
      const ownership =
        totalExistingShares > 0 ? (sh.shares / totalExistingShares) * 100 : 0;
      const value = (ownership / 100) * preMoneyValuation;

      return {
        name: sh.name,
        type: sh.type,
        originalType: sh.originalType,
        source: sh.source,
        votingRights: sh.votingRights,
        shares: sh.shares,
        ownership: parseFloat(ownership.toFixed(2)),
        value: Math.round(value),
        newShares: 0,
        investmentAmount: sh.investmentAmount || 0,
        commonShares: sh.commonShares || 0,
      };
    });

    // ============================================
    // ✅ STEP 7: BUILD POST-INVESTMENT CAP TABLE
    // ============================================
    console.log("\n🏗️ BUILDING POST-INVESTMENT CAP TABLE...");

    const postInvestmentShareholders = [];

    // Add existing shareholders (excluding option pool)
    existingShareholders.forEach((sh) => {
      if (sh.type === "Options Pool" || sh.originalType === "Options Pool")
        return;

      const ownership =
        totalPostInvestmentShares > 0
          ? (sh.shares / totalPostInvestmentShares) * 100
          : 0;
      const value = (ownership / 100) * postMoneyValuation;

      postInvestmentShareholders.push({
        name: sh.name,
        type: sh.type,
        originalType: sh.originalType,
        source: sh.source,
        votingRights: sh.votingRights,
        shares: sh.shares,
        ownership: parseFloat(ownership.toFixed(2)),
        value: Math.round(value),
        newShares: 0,
        isExisting: true,
        investmentAmount: sh.investmentAmount || 0,
        commonShares: sh.commonShares || 0,
      });
    });

    // Add converted investors
    convertedInvestors.forEach((investor) => {
      const ownership =
        totalPostInvestmentShares > 0
          ? (investor.shares / totalPostInvestmentShares) * 100
          : 0;
      const value = (ownership / 100) * postMoneyValuation;

      postInvestmentShareholders.push({
        name: investor.name,
        type: investor.type,
        originalType: investor.originalType,
        source: investor.source,
        votingRights: investor.votingRights,
        shares: investor.shares,
        ownership: parseFloat(ownership.toFixed(2)),
        value: Math.round(value),
        newShares: investor.shares,
        isExisting: false,
        investmentAmount: investor.investmentAmount,
        sharePrice: parseFloat(investor.conversionPrice).toFixed(4),
      });
    });

    // Add Common Stock investors
    if (newInvestmentShares > 0) {
      const investorOwnership =
        totalPostInvestmentShares > 0
          ? (newInvestmentShares / totalPostInvestmentShares) * 100
          : 0;
      const investorValue = (investorOwnership / 100) * postMoneyValuation;

      postInvestmentShareholders.push({
        name: "Common Stock Investors",
        type: "Investor",
        originalType: "Common Stock Investor",
        source: round.nameOfRound || "Common Stock Round",
        votingRights: "voting",
        shares: newInvestmentShares,
        ownership: parseFloat(investorOwnership.toFixed(2)),
        value: Math.round(investorValue),
        investmentAmount: investmentSize,
        newShares: newInvestmentShares,
        isExisting: false,
        sharePrice: parseFloat(sharePrice.toFixed(4)),
        isGeneric: true,
      });
    }

    // Add Option Pool
    if (totalRequiredOptionPoolShares > 0) {
      const poolOwnership =
        totalPostInvestmentShares > 0
          ? (totalRequiredOptionPoolShares / totalPostInvestmentShares) * 100
          : 0;
      const poolValue = (poolOwnership / 100) * postMoneyValuation;

      postInvestmentShareholders.push({
        name: "Employee Option Pool",
        type: "Options Pool",
        originalType: "Options Pool",
        source: needsOptionPoolExpansion
          ? "Expanded in Common Stock Round"
          : "Existing",
        votingRights: "non-voting",
        shares: totalRequiredOptionPoolShares,
        ownership: parseFloat(poolOwnership.toFixed(2)),
        value: Math.round(poolValue),
        newShares: additionalOptionPoolShares,
        isExisting: true,
        breakdown: {
          existingShares: existingOptionPoolShares,
          newShares: additionalOptionPoolShares,
          totalShares: totalRequiredOptionPoolShares,
        },
      });
    }

    // Calculate values for formulas
    const nonOptionShares =
      totalExistingShares -
      existingOptionPoolShares +
      newInvestmentShares +
      convertibleConversionShares;

    // ============================================
    // ✅ STEP 8: BUILD FINAL RESPONSE
    // ============================================
    const investorOwnershipPercent =
      totalPostInvestmentShares > 0
        ? (newInvestmentShares / totalPostInvestmentShares) * 100
        : 0;

    const response = {
      success: true,
      roundType: round.nameOfRound || "Common Stock Round",
      instrumentType: round.instrumentType || "Common Stock",
      currency: currency,
      shareClassType: round.shareClassType,
      round_type: round.round_type || "Investment",
      isCommonStock: true,
      isPostMoneyOptionPool: needsOptionPoolExpansion,
      totalShares: totalPostInvestmentShares,
      totalValue: postMoneyValuation,

      // Calculations
      calculations: {
        // Input values
        investmentSize: investmentSize,
        preMoneyValuation: preMoneyValuation,
        targetOptionPoolPercent: targetOptionPoolPercent,

        // Core calculations
        sharePrice: parseFloat(sharePrice.toFixed(4)),
        newInvestmentShares: newInvestmentShares,
        additionalOptionPoolShares: additionalOptionPoolShares,
        convertibleConversionShares: convertibleConversionShares,
        totalNewShares:
          newInvestmentShares +
          additionalOptionPoolShares +
          convertibleConversionShares,
        investorOwnershipPercent: parseFloat(
          investorOwnershipPercent.toFixed(2),
        ),
        postMoneyValuation: postMoneyValuation,

        // Option pool calculations
        existingOptionPoolPercent: parseFloat(
          existingOptionPoolPercent.toFixed(2),
        ),
        existingOptionPoolShares: existingOptionPoolShares,
        totalOptionPoolShares: totalRequiredOptionPoolShares,

        // Share counts
        preInvestmentTotalShares: totalExistingShares,
        postInvestmentTotalShares: totalPostInvestmentShares,

        // Formula calculation values
        nonOptionShares: nonOptionShares,
        needsExpansion: needsOptionPoolExpansion,
      },

      // Financial Summary
      financialSummary: {
        sharePrice: parseFloat(sharePrice.toFixed(4)),
        newSharesIssued: newInvestmentShares,
        additionalOptionShares: additionalOptionPoolShares,
        convertibleShares: convertibleConversionShares,
        totalNewShares:
          newInvestmentShares +
          additionalOptionPoolShares +
          convertibleConversionShares,
        investorOwnership: parseFloat(investorOwnershipPercent.toFixed(2)),
        preMoneyValuation: preMoneyValuation,
        postMoneyValuation: postMoneyValuation,
        totalInvestment: investmentSize,
        existingOptionPool: parseFloat(existingOptionPoolPercent.toFixed(2)),
        targetOptionPool: targetOptionPoolPercent,
      },

      // Cap Tables
      preInvestmentCapTable: {
        shareholders: preInvestmentShareholders,
        totalShares: totalExistingShares,
        totalValue: preMoneyValuation,
        message: `Before Common Stock investment (${existingOptionPoolPercent.toFixed(1)}% option pool)`,
      },

      postInvestmentCapTable: {
        shareholders: postInvestmentShareholders,
        totalShares: totalPostInvestmentShares,
        totalValue: postMoneyValuation,
        message: `After Common Stock investment of ${investmentSize.toLocaleString()} ${currency}`,
      },
    };

    console.log("\n🎉 COMMON STOCK CALCULATION COMPLETE");
    console.log(
      `   Total Shares: ${totalPostInvestmentShares.toLocaleString()}`,
    );
    console.log(
      `   Post-Money: ${postMoneyValuation.toLocaleString()} ${currency}`,
    );
    console.log(`   Share Price: ${sharePrice.toFixed(2)} ${currency}`);
    console.log(
      `   Investor Ownership: ${investorOwnershipPercent.toFixed(2)}%`,
    );
    console.log(
      `   Convertible Shares: ${convertibleConversionShares.toLocaleString()}`,
    );
    console.log(
      `   Additional Option Shares: ${additionalOptionPoolShares.toLocaleString()}`,
    );

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
  console.log(
    "🚀 Starting CORRECTED cap table calculation for:",
    round.nameOfRound,
  );

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

      // ✅ Get ALL convertible rounds
      db.query(
        `SELECT * FROM roundrecord WHERE company_id=? AND (instrumentType='Safe' OR instrumentType='Convertible Note') AND id < ? ORDER BY id ASC`,
        [company_id, round.id],
        (err, convertibleRounds) => {
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

          // ✅ Store ALL convertible rounds with CORRECT data
          const allConvertibles = [];
          let totalSeedInvestment = 0;
          let existingOptionPoolPercent = 0;
          let employeeSharesSeedRound = 0;

          convertibleRounds.forEach((convRound) => {
            try {
              const instrumentData =
                safeJSONParseRepeated_preferred(
                  convRound.instrument_type_data,
                  3,
                ) || {};

              // ✅ IMPORTANT: Get CORRECT interest rate for Convertible Notes
              let interestRate = 0;
              if (convRound.instrumentType === "Convertible Note") {
                // Try multiple possible field names
                interestRate =
                  toNumber(instrumentData.interestRate_note, 0) ||
                  toNumber(instrumentData.interestRate, 0) ||
                  toNumber(instrumentData.interest, 0) ||
                  10; // Default 10% as per document
              }

              const convertibleData = {
                id: convRound.id,
                name: convRound.nameOfRound || `Round ${convRound.id}`,
                instrumentType: convRound.instrumentType,
                investment: toNumber(convRound.roundsize, 0),
                valuationCap: toNumber(
                  convRound.instrumentType === "Safe"
                    ? instrumentData.valuationCap
                    : instrumentData.valuationCap_note,
                  0,
                ),
                discountRate: toNumber(
                  convRound.instrumentType === "Safe"
                    ? instrumentData.discountRate
                    : instrumentData.discountRate_note,
                  0,
                ),
                interestRate: interestRate, // ✅ CORRECT interest rate
                optionPoolPercent: toNumber(convRound.optionPoolPercent, 0),
                yearsToSeriesA: toNumber(instrumentData.yearsToSeriesA || 2, 2), // Default 2 years
              };

              allConvertibles.push(convertibleData);
              totalSeedInvestment += convertibleData.investment;

              if (
                convertibleData.optionPoolPercent > existingOptionPoolPercent
              ) {
                existingOptionPoolPercent = convertibleData.optionPoolPercent;
              }
            } catch (e) {
              console.log("Error parsing convertible round:", e);
            }
          });

          // ✅ CORRECT: Calculate employee shares (DOCUMENT FORMULA)
          if (existingOptionPoolPercent > 0 && roundZeroTotalShares > 0) {
            employeeSharesSeedRound = Math.round(
              roundZeroTotalShares / (1 - existingOptionPoolPercent / 100) -
                roundZeroTotalShares,
            );
          }

          // ✅ CURRENT ROUND DATA
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
          // ✅ STEP 1: CALCULATE SHARE PRICE (CORRECT)
          // ============================================
          const totalSharesFromPreviousRound =
            roundZeroTotalShares + employeeSharesSeedRound;
          const sharePrice =
            totalSharesFromPreviousRound > 0
              ? preMoneyValuation / totalSharesFromPreviousRound
              : 0;

          // ============================================
          // ✅ STEP 2: CONVERT ALL CONVERTIBLES (CORRECTED)
          // ============================================
          const convertedInvestors = [];
          let totalSeedConversionShares = 0;
          let totalSeedConversionValue = 0;

          // Calculate prices for display
          let seedDiscountPrice = 0;
          let seedCapPrice = 0;
          let seedOptimalPrice = 0;

          if (sharePrice > 0 && allConvertibles.length > 0) {
            // ✅ CORRECT: Calculate seed cap price (Document formula)
            // Use total shares from previous round (founder + employee)
            seedCapPrice =
              allConvertibles[0].valuationCap > 0
                ? allConvertibles[0].valuationCap / totalSharesFromPreviousRound
                : 0;

            // ✅ CORRECT: Calculate seed discount price
            seedDiscountPrice =
              sharePrice * (1 - allConvertibles[0].discountRate / 100);

            // ✅ CORRECT: Optimal price is MIN of discount and cap
            seedOptimalPrice =
              seedCapPrice > 0
                ? Math.min(seedDiscountPrice, seedCapPrice)
                : seedDiscountPrice;

            // Convert each convertible instrument
            allConvertibles.forEach((convertible) => {
              // Calculate discount price for this instrument
              const discountPrice =
                sharePrice * (1 - convertible.discountRate / 100);

              // ✅ CORRECT: Cap price uses total shares from previous round
              const capPrice =
                convertible.valuationCap > 0
                  ? convertible.valuationCap / totalSharesFromPreviousRound
                  : 0;

              // Optimal price is the lower of discount price or cap price
              const optimalPrice =
                capPrice > 0
                  ? Math.min(discountPrice, capPrice)
                  : discountPrice;

              // ✅ CORRECT: Calculate principal + interest for Convertible Notes
              let conversionAmount = convertible.investment;
              if (convertible.instrumentType === "Convertible Note") {
                // Document formula: 120,000 * (1+10%)^2 = 145,200
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
          // ✅ STEP 3: SERIES A/B SHARES (CORRECT)
          // ============================================
          const seriesAShares =
            sharePrice > 0 ? Math.round(seriesAInvestment / sharePrice) : 0;
          const seriesAValue = seriesAShares * sharePrice;
          const seriesAMOIC =
            sharePrice > 0
              ? (seriesAValue / seriesAInvestment).toFixed(2) + "X"
              : "0X";

          // ============================================
          // ✅ STEP 4: OPTION POOL CALCULATION (CORRECT)
          // ============================================
          let newOptionShares = 0;
          let totalPostShares = 0;
          let finalPostMoneyValuation = 0;

          if (targetOptionPoolPercent > 0) {
            // Document formula: Total Post Shares = (Founders + Converted + Series A) ÷ (1 - Option Pool %)
            const totalSharesExcludingOption =
              roundZeroTotalShares + totalSeedConversionShares + seriesAShares;

            totalPostShares = Math.round(
              totalSharesExcludingOption / (1 - targetOptionPoolPercent / 100),
            );

            // Document formula: New option shares = Total Post Shares - (Founders + Converted + Series A) - Existing Employee
            newOptionShares = Math.max(
              0,
              totalPostShares -
                totalSharesExcludingOption -
                employeeSharesSeedRound,
            );

            finalPostMoneyValuation = totalPostShares * sharePrice;
          } else {
            totalPostShares =
              roundZeroTotalShares +
              employeeSharesSeedRound +
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

          if (finalPostMoneyValuation > 0) {
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
                return calculateLiquidationDistribution(
                  scenario.value,
                  currentLiquidationPreference,
                  seriesAInvestment,
                  totalSeedInvestment,
                  totalPostShares,
                  seriesAShares,
                  totalSeedConversionShares,
                  roundZeroTotalShares,
                  employeeSharesSeedRound + newOptionShares,
                );
              },
            );

            // Current ownership percentages
            liquidationCalculations.currentOwnership = {
              seriesA: {
                shares: seriesAShares,
                ownership:
                  ((seriesAShares / totalPostShares) * 100).toFixed(1) + "%",
                investment: seriesAInvestment,
              },
              seed: {
                shares: totalSeedConversionShares,
                ownership:
                  ((totalSeedConversionShares / totalPostShares) * 100).toFixed(
                    1,
                  ) + "%",
                investment: totalSeedInvestment,
              },
              founders: {
                shares: roundZeroTotalShares,
                ownership:
                  ((roundZeroTotalShares / totalPostShares) * 100).toFixed(1) +
                  "%",
              },
              optionPool: {
                shares: employeeSharesSeedRound + newOptionShares,
                ownership:
                  (
                    ((employeeSharesSeedRound + newOptionShares) /
                      totalPostShares) *
                    100
                  ).toFixed(1) + "%",
              },
            };
          }

          // ============================================
          // ✅ BUILD CAP TABLES
          // ============================================

          // ✅ PRE-INVESTMENT CAP TABLE
          let preSeriesAShareholders = [];

          // Founders
          roundZeroFounders.forEach((founder) => {
            const shares = toNumber(founder.shares, 0);
            const ownership =
              totalSharesFromPreviousRound > 0
                ? (shares / totalSharesFromPreviousRound) * 100
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

          // Employee Option Pool
          if (employeeSharesSeedRound > 0) {
            const ownership =
              totalSharesFromPreviousRound > 0
                ? (employeeSharesSeedRound / totalSharesFromPreviousRound) * 100
                : 0;
            const value = (ownership / 100) * preMoneyValuation;

            preSeriesAShareholders.push({
              name: "Employee Option Pool",
              type: "Options Pool",
              shares: employeeSharesSeedRound,
              ownership: ownership.toFixed(1),
              value: Math.round(value),
              newShares: employeeSharesSeedRound,
              note: `Existing ${existingOptionPoolPercent}% pool`,
            });
          }

          // ✅ POST-INVESTMENT CAP TABLE
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
          const totalEmployeeShares = employeeSharesSeedRound + newOptionShares;
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
              commonShares: employeeSharesSeedRound,
              newShares: newOptionShares,
              totalShares: totalEmployeeShares,
              ownership: ownership.toFixed(1),
              value: Math.round(value),
              breakdown: {
                existingShares: employeeSharesSeedRound,
                newShares: newOptionShares,
                totalShares: totalEmployeeShares,
              },
            });
          }

          // Add TOTAL row
          let totalAllShares = 0;
          let totalAllValue = 0;
          let totalInvestment = 0;

          postSeriesAShareholders.forEach((sh) => {
            totalAllShares += sh.totalShares || sh.shares || 0;
            totalAllValue += sh.value || 0;
            if (sh.investmentAmount) totalInvestment += sh.investmentAmount;
          });

          postSeriesAShareholders.push({
            name: "TOTAL",
            type: "Total",
            shares: totalAllShares,
            commonShares: roundZeroTotalShares,
            newShares: totalAllShares - roundZeroTotalShares,
            totalShares: totalAllShares,
            ownership: "100%",
            value: Math.round(totalAllValue),
            investmentAmount: totalInvestment,
            isTotal: true,
          });

          // ============================================
          // ✅ FINAL RESPONSE
          // ============================================
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

            // Inputs
            inputs: {
              preMoneyValuation: preMoneyValuation,
              seriesAInvestment: seriesAInvestment,
              targetOptionPoolPercent: targetOptionPoolPercent,
              roundZeroShares: roundZeroTotalShares,
              founderCount: roundZeroFounders.length,
              seedInvestment: totalSeedInvestment,
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
            },

            // ✅ CORRECTED CALCULATIONS
            calculations: {
              // Core calculations
              sharePrice: sharePrice,
              seedOptimalPrice: seedOptimalPrice, // Should be 9.00
              seedDiscountPrice: seedDiscountPrice, // Should be 9.72
              seedCapPrice: seedCapPrice, // Should be 9.00

              // Shares breakdown
              seedConversionShares: totalSeedConversionShares,
              seriesAShares: seriesAShares,
              newOptionShares: newOptionShares,
              employeeSharesSeedRound: employeeSharesSeedRound,

              // Totals
              totalSharesPostSeed: totalPostShares,
              totalSharesPreSeed: totalSharesFromPreviousRound,
              roundZeroTotalShares: roundZeroTotalShares,

              // Values
              finalPostMoneyValuation: finalPostMoneyValuation,
              seedConversionValue: totalSeedConversionValue,
              seriesAValue: seriesAValue,
              preMoneyValuation: preMoneyValuation,

              // Investment
              seedInvestment: totalSeedInvestment,
              seriesAInvestment: seriesAInvestment,

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

              // Other
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
              totalShares: totalSharesFromPreviousRound,
              totalValue: preMoneyValuation,
              message: `Before ${round.shareClassType || "Series A"} investment (with ${existingOptionPoolPercent}% option pool)`,
            },

            postSeedCapTable: {
              shareholders: postSeriesAShareholders,
              totalShares: totalPostShares,
              totalValue: finalPostMoneyValuation,
              seedInvestment: totalSeedInvestment,
              message: `After ${round.shareClassType || "Series A"} investment of ${seriesAInvestment.toLocaleString()} ${round.currency || "USD"} ${allConvertibles.length > 0 ? `with ${allConvertibles.length} convertible instrument${allConvertibles.length !== 1 ? "s" : ""} conversion` : ""}`,
            },

            // Liquidation
            liquidationPreference: {
              type: currentLiquidationPreference,
              label: getLiquidationLabel(currentLiquidationPreference),
            },

            liquidationCalculations: liquidationCalculations,

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
          };

          console.log("✅ CORRECTED CALCULATIONS OUTPUT:", {
            sharePrice: responseData.calculations.sharePrice,
            seedCapPrice: responseData.calculations.seedCapPrice,
            seedDiscountPrice: responseData.calculations.seedDiscountPrice,
            seedOptimalPrice: responseData.calculations.seedOptimalPrice,
            seedConversionShares:
              responseData.calculations.seedConversionShares,
            totalPostShares: responseData.calculations.totalSharesPostSeed,
          });

          return res.status(200).json({
            success: true,
            message: "Cap table calculated with CORRECTED formulas",
            capTable: responseData,
          });
        },
      );
    },
  );
}

// ✅ HELPER FUNCTIONS

// ✅ HELPER FUNCTIONS

// ✅ Helper Functions (ADD THESE AT THE END OF YOUR FILE)

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

function calculateLiquidationDistribution(
  exitValue,
  liquidationType,
  seriesAInvestment,
  seedInvestment,
  totalPostShares,
  seriesAShares,
  seedConversionShares,
  founderShares,
  optionPoolShares,
) {
  // Initialize result object
  const result = {
    exitValue: exitValue,
    liquidationType: liquidationType,
    liquidationLabel: getLiquidationLabel(liquidationType),
    seriesAPreferredAmount: 0,
    seedPreferredAmount: 0,
    remainingAfterPreferred: 0,
    seriesAParticipationAmount: 0,
    seedParticipationAmount: 0,
    founderAmount: 0,
    optionPoolAmount: 0,
    totalDistributed: 0,
  };

  // Calculate ownership percentages
  const seriesAOwnership = seriesAShares / totalPostShares;
  const seedOwnership = seedConversionShares / totalPostShares;
  const founderOwnership = founderShares / totalPostShares;
  const optionPoolOwnership = optionPoolShares / totalPostShares;

  // ============================================
  // AS PER DOCUMENT REQUIREMENTS - ALWAYS 1x
  // ============================================

  // TYPE 1: Non-participating (Default) - Document says ALWAYS 1x
  if (liquidationType === 1) {
    // Investors get EITHER their 1x investment back OR converted value, whichever is higher
    const seriesAConvertedValue = exitValue * seriesAOwnership;
    const seedConvertedValue = exitValue * seedOwnership;

    // Series A chooses between 1x investment or converted value
    result.seriesAPreferredAmount = Math.max(
      seriesAInvestment * 1, // 1x multiple as per document
      seriesAConvertedValue,
    );

    // Seed investors (already converted) - they get converted value
    result.seedPreferredAmount = seedConvertedValue;

    // Remaining goes to founders and option pool
    const totalPreferred =
      result.seriesAPreferredAmount + result.seedPreferredAmount;
    result.remainingAfterPreferred = Math.max(0, exitValue - totalPreferred);

    // Distribute remaining proportionally among common shareholders
    const remainingForCommon = result.remainingAfterPreferred;
    const commonOwnership = founderOwnership + optionPoolOwnership;

    if (commonOwnership > 0) {
      result.founderAmount =
        remainingForCommon * (founderOwnership / commonOwnership);
      result.optionPoolAmount =
        remainingForCommon * (optionPoolOwnership / commonOwnership);
    }

    result.totalDistributed =
      result.seriesAPreferredAmount +
      result.seedPreferredAmount +
      result.founderAmount +
      result.optionPoolAmount;
  }

  // TYPE 2: Participating - Document says ALWAYS 1x
  else if (liquidationType === 2) {
    // Step 1: Investors get their 1x investment back first
    const totalPreferredInvestment = seriesAInvestment * 1 + seedInvestment * 1;
    result.seriesAPreferredAmount = seriesAInvestment * 1; // 1x
    result.seedPreferredAmount = seedInvestment * 1; // 1x
    result.remainingAfterPreferred = Math.max(
      0,
      exitValue - totalPreferredInvestment,
    );

    // Step 2: Remaining proceeds distributed proportionally among ALL shareholders
    if (result.remainingAfterPreferred > 0) {
      result.seriesAParticipationAmount =
        result.remainingAfterPreferred * seriesAOwnership;
      result.seedParticipationAmount =
        result.remainingAfterPreferred * seedOwnership;
      result.founderAmount = result.remainingAfterPreferred * founderOwnership;
      result.optionPoolAmount =
        result.remainingAfterPreferred * optionPoolOwnership;
    }

    result.totalDistributed =
      result.seriesAPreferredAmount +
      result.seedPreferredAmount +
      result.seriesAParticipationAmount +
      result.seedParticipationAmount +
      result.founderAmount +
      result.optionPoolAmount;
  }

  // TYPE 3: Capped Participating - Document says 2x cap
  else if (liquidationType === 3) {
    const participationCap = 2; // Document says 2x cap
    const seriesACap = seriesAInvestment * participationCap;
    const seedCap = seedInvestment * participationCap;

    // Step 1: Investors get 1x investment back
    result.seriesAPreferredAmount = seriesAInvestment * 1;
    result.seedPreferredAmount = seedInvestment * 1;
    result.remainingAfterPreferred = Math.max(
      0,
      exitValue - (result.seriesAPreferredAmount + result.seedPreferredAmount),
    );

    // Step 2: Investors participate until cap is reached
    if (result.remainingAfterPreferred > 0) {
      // Calculate participation amounts
      const potentialSeriesAParticipation =
        result.remainingAfterPreferred * seriesAOwnership;
      const potentialSeedParticipation =
        result.remainingAfterPreferred * seedOwnership;

      // Apply 2x caps as per document
      result.seriesAParticipationAmount = Math.min(
        potentialSeriesAParticipation,
        seriesACap - result.seriesAPreferredAmount,
      );
      result.seedParticipationAmount = Math.min(
        potentialSeedParticipation,
        seedCap - result.seedPreferredAmount,
      );

      // Calculate remaining after capped participation
      const totalCappedParticipation =
        result.seriesAParticipationAmount + result.seedParticipationAmount;
      const remainingAfterCapped = Math.max(
        0,
        result.remainingAfterPreferred - totalCappedParticipation,
      );

      // Remaining goes to founders and option pool
      if (remainingAfterCapped > 0) {
        const commonOwnership = founderOwnership + optionPoolOwnership;
        if (commonOwnership > 0) {
          result.founderAmount =
            remainingAfterCapped * (founderOwnership / commonOwnership);
          result.optionPoolAmount =
            remainingAfterCapped * (optionPoolOwnership / commonOwnership);
        }
      }
    }

    result.totalDistributed =
      result.seriesAPreferredAmount +
      result.seedPreferredAmount +
      result.seriesAParticipationAmount +
      result.seedParticipationAmount +
      result.founderAmount +
      result.optionPoolAmount;
  }

  // Round all values
  Object.keys(result).forEach((key) => {
    if (typeof result[key] === "number") {
      result[key] = Math.round(result[key]);
    }
  });

  return result;
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

// API 2: getPreviousRoundForAutoFill - CORRECTED
exports.getPreviousRoundForAutoFill = (req, res) => {
  const { company_id, current_round_id } = req.body;

  // ✅ Step 1: Get the MOST RECENT previous investment round
  const query = `
    SELECT 
      id,
      nameOfRound,
      round_type,
      instrumentType,
      shareClassType,
      optionPoolPercent,
      optionPoolPercent_post,
      issuedshares,
      investorPostMoney,
      roundsize,
      pre_money,
      post_money,
      created_at
    FROM roundrecord 
    WHERE company_id = ? 
      AND round_type = 'Investment'
      ${current_round_id && current_round_id > 0 ? "AND id < ?" : ""}
    ORDER BY created_at DESC 
    LIMIT 1
  `;

  const params =
    current_round_id && current_round_id > 0
      ? [company_id, current_round_id]
      : [company_id];

  db.query(query, params, (err, results) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (results.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          existingOptionPoolPercent: 0,
          existingShares: 0,
          previousRoundName: null,
        },
      });
    }

    const previousRound = results[0];
    console.log(`📊 Previous Round Found: ${previousRound.nameOfRound}`);
    console.log(`   Instrument: ${previousRound.instrumentType}`);
    console.log(`   Share Class: ${previousRound.shareClassType}`);

    const instrumentType = previousRound.instrumentType || "";
    const shareClassType = previousRound.shareClassType || "";

    const isSeedRound =
      shareClassType.includes("Seed") ||
      shareClassType.includes("Pre-Seed") ||
      shareClassType.includes("Post-Seed");

    const isSeriesRound = shareClassType.includes("Series");

    // ✅ CASE 1: Convertible Note Series Round
    if (instrumentType === "Convertible Note" && isSeriesRound) {
      // For Series Convertible Note, get the seed round's option pool
      return getSeedRoundOptionPoolForSeries(company_id, current_round_id)
        .then((seedData) => {
          res.status(200).json({
            success: true,
            data: {
              existingOptionPoolPercent: seedData.optionPoolPercent,
              existingShares: seedData.existingShares,
              previousRoundName: seedData.roundName,
              instrumentType: previousRound.instrumentType,
              shareClassType: previousRound.shareClassType,
              note: `Seed round had ${seedData.optionPoolPercent}% option pool`,
            },
          });
        })
        .catch((err) => {
          console.error("Error fetching seed round:", err);
          // Fallback
          const optionPoolPercent =
            parseFloat(previousRound.optionPoolPercent) || 0;
          const existingShares = parseFloat(previousRound.issuedshares) || 0;

          res.status(200).json({
            success: true,
            data: {
              existingOptionPoolPercent: optionPoolPercent,
              existingShares: existingShares,
              previousRoundName: previousRound.nameOfRound,
              instrumentType: previousRound.instrumentType,
              shareClassType: previousRound.shareClassType,
            },
          });
        });
    }
    // ✅ CASE 2: Convertible Note Seed Round
    else if (instrumentType === "Convertible Note" && isSeedRound) {
      // Use Convertible Note calculation to get option pool
      return calculateOptionPoolFromConvertibleNoteRound(
        previousRound,
        company_id,
      )
        .then((result) => {
          res.status(200).json({
            success: true,
            data: {
              existingOptionPoolPercent: result.optionPoolPercent, // 10%
              existingShares: result.existingShares, // 111,111
              previousRoundName: previousRound.nameOfRound,
              instrumentType: previousRound.instrumentType,
              shareClassType: previousRound.shareClassType,
              calculationMethod: result.calculationMethod,
              note: `Convertible Note round had ${result.optionPoolPercent}% option pool`,
            },
          });
        })
        .catch((err) => {
          console.error(
            "Error calculating option pool for Convertible Note:",
            err,
          );
          // Fallback
          const optionPoolPercent =
            parseFloat(previousRound.optionPoolPercent) || 0;
          const existingShares = parseFloat(previousRound.issuedshares) || 0;

          res.status(200).json({
            success: true,
            data: {
              existingOptionPoolPercent: optionPoolPercent,
              existingShares: existingShares,
              previousRoundName: previousRound.nameOfRound,
              instrumentType: previousRound.instrumentType,
              shareClassType: previousRound.shareClassType,
              note: "Using stored value (calculation failed)",
            },
          });
        });
    }
    // ✅ CASE 3: "OTHER" Instrument Type (Common Stock, Equity, etc.)
    else if (instrumentType === "OTHER" || instrumentType === "Common Stock") {
      // Use calculateInvestmentRoundCapTable logic to get option pool
      return calculateOptionPoolFromCommonStockFunction(
        previousRound,
        company_id,
      )
        .then((result) => {
          res.status(200).json({
            success: true,
            data: {
              existingOptionPoolPercent: result.optionPoolPercent, // 8%
              existingShares: result.existingShares, // 138,889
              previousRoundName: previousRound.nameOfRound,
              instrumentType: previousRound.instrumentType,
              shareClassType: previousRound.shareClassType,
              calculationMethod: result.calculationMethod,
              note: `Calculated from ${previousRound.nameOfRound} (${result.optionPoolPercent}% option pool)`,
            },
          });
        })
        .catch((err) => {
          console.error("Error calculating option pool for Common Stock:", err);
          // Fallback to simple calculation
          const optionPoolPercent =
            parseFloat(previousRound.optionPoolPercent) || 0;
          const existingShares = parseFloat(previousRound.issuedshares) || 0;

          res.status(200).json({
            success: true,
            data: {
              existingOptionPoolPercent: optionPoolPercent,
              existingShares: existingShares,
              previousRoundName: previousRound.nameOfRound,
              instrumentType: previousRound.instrumentType,
              shareClassType: previousRound.shareClassType,
              note: "Using stored value (calculation failed)",
            },
          });
        });
    }
    // ✅ CASE 4: SAFE Instrument Type (Seed Round)
    else if (instrumentType === "Safe" && isSeedRound) {
      // Use SAFE round calculation to get option pool

      return calculateOptionPoolFromSAFERound(previousRound, company_id)
        .then((result) => {
          res.status(200).json({
            success: true,
            data: {
              existingOptionPoolPercent: result.optionPoolPercent, // 10%
              existingShares: result.existingShares, // 111,111
              previousRoundName: previousRound.nameOfRound,
              instrumentType: previousRound.instrumentType,
              shareClassType: previousRound.shareClassType,
              calculationMethod: result.calculationMethod,
              note: `SAFE round had ${result.optionPoolPercent}% option pool`,
            },
          });
        })
        .catch((err) => {
          console.error("Error calculating option pool for SAFE:", err);
          // Fallback
          const optionPoolPercent =
            parseFloat(previousRound.optionPoolPercent) || 0;
          const existingShares = parseFloat(previousRound.issuedshares) || 0;

          res.status(200).json({
            success: true,
            data: {
              existingOptionPoolPercent: optionPoolPercent,
              existingShares: existingShares,
              previousRoundName: previousRound.nameOfRound,
              instrumentType: previousRound.instrumentType,
              shareClassType: previousRound.shareClassType,
              note: "Using stored value (calculation failed)",
            },
          });
        });
    }
    // ✅ CASE 5: SAFE Series Round
    else if (instrumentType === "Safe" && isSeriesRound) {
      // For SAFE Series round, get the seed round's option pool
      return getSeedRoundOptionPoolForSeries(company_id, current_round_id)
        .then((seedData) => {
          res.status(200).json({
            success: true,
            data: {
              existingOptionPoolPercent: seedData.optionPoolPercent,
              existingShares: seedData.existingShares,
              previousRoundName: seedData.roundName,
              instrumentType: previousRound.instrumentType,
              shareClassType: previousRound.shareClassType,
              note: `Seed round had ${seedData.optionPoolPercent}% option pool`,
            },
          });
        })
        .catch((err) => {
          console.error("Error fetching seed round for SAFE Series:", err);
          // Fallback
          const optionPoolPercent =
            parseFloat(previousRound.optionPoolPercent_post) ||
            parseFloat(previousRound.optionPoolPercent) ||
            0;
          const existingShares = parseFloat(previousRound.issuedshares) || 0;

          res.status(200).json({
            success: true,
            data: {
              existingOptionPoolPercent: optionPoolPercent,
              existingShares: existingShares,
              previousRoundName: previousRound.nameOfRound,
              instrumentType: previousRound.instrumentType,
              shareClassType: previousRound.shareClassType,
            },
          });
        });
    }
    // ✅ CASE 6: Preferred Equity
    else if (instrumentType === "Preferred Equity") {
      let optionPoolPercent =
        parseFloat(previousRound.optionPoolPercent_post) ||
        parseFloat(previousRound.optionPoolPercent) ||
        0;
      const existingShares = parseFloat(previousRound.issuedshares) || 0;

      res.status(200).json({
        success: true,
        data: {
          existingOptionPoolPercent: optionPoolPercent,
          existingShares: Math.round(existingShares),
          previousRoundName: previousRound.nameOfRound,
          instrumentType: previousRound.instrumentType,
          shareClassType: previousRound.shareClassType,
        },
      });
    }
    // ✅ CASE 7: Default (Other instrument types)
    else {
      let optionPoolPercent = 0;

      if (isSeriesRound) {
        // Series rounds use post-money option pool
        optionPoolPercent =
          parseFloat(previousRound.optionPoolPercent_post) ||
          parseFloat(previousRound.optionPoolPercent) ||
          0;
      } else {
        // Seed rounds use pre-money option pool
        optionPoolPercent = parseFloat(previousRound.optionPoolPercent) || 0;
      }

      const existingShares = parseFloat(previousRound.issuedshares) || 0;

      res.status(200).json({
        success: true,
        data: {
          existingOptionPoolPercent: optionPoolPercent,
          existingShares: Math.round(existingShares),
          previousRoundName: previousRound.nameOfRound,
          instrumentType: previousRound.instrumentType,
          shareClassType: previousRound.shareClassType,
        },
      });
    }
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

          console.log(`🔢 Convertible Note Round Calculation Results:`);
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

              console.log(`🔢 Common Stock Calculation Results:`);
              console.log(
                `   - Input option pool %: ${optionPoolPercentInput}% (pre-money)`,
              );
              console.log(`   - Founder shares: ${roundZeroTotalShares}`);
              console.log(`   - Option pool shares: ${optionPoolShares}`);
              console.log(`   - Total shares: ${totalSharesPostInvestment}`);
              console.log(
                `   - Actual option pool %: ${actualOptionPoolPercent.toFixed(
                  2,
                )}% (post-money)`,
              );

              resolve({
                optionPoolPercent: parseFloat(
                  actualOptionPoolPercent.toFixed(2),
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
    console.log(query);
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
