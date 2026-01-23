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
            try {
              const aiRes = await openai.chat.completions.create({
                model: "gpt-4-turbo",
                messages: [
                  {
                    role: "system",
                    content: "You summarize investment rounds.",
                  },
                  { role: "user", content: prompt },
                ],
                max_tokens: 500,
              });
              executiveSummary = aiRes.choices[0].message.content.trim();
            } catch (e) {}

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

        // ✅ Create warrant record in warrants table if this round has warrants

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
        try {
          const aiRes = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: [
              { role: "system", content: "You summarize investment rounds." },
              { role: "user", content: prompt },
            ],
            max_tokens: 500,
          });
          executiveSummary = aiRes.choices[0].message.content.trim();
        } catch (e) {}

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
      if (
        instrumentType === "Safe" &&
        (round.shareClassType === "Seed" ||
          round.shareClassType === "Pre-Seed" ||
          round.shareClassType === "Post-Seed")
      ) {
        return handleSAFERoundCalculation(round, company_id, res);
      }
      if (
        instrumentType === "Safe" &&
        round.shareClassType?.includes("Series")
      ) {
        return handleSAFESeriesRoundCalculation(round, company_id, res);
      }

      // Step 5: For Convertible Note rounds
      if (
        instrumentType === "Convertible Note" &&
        (round.shareClassType === "Seed" ||
          round.shareClassType === "Pre-Seed" ||
          round.shareClassType === "Post-Seed")
      ) {
        return handleConvertibleNoteRoundCalculation(round, company_id, res);
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
      if (
        instrumentType === "Preferred Equity" &&
        round.shareClassType?.includes("Series")
      ) {
        return handlePreferredEquityRoundCalculation(round, company_id, res);
      }
      // if (
      //   instrumentType === "Common Stock" &&
      //   round.shareClassType?.includes("Series")
      // ) {
      //   return calculateSeriesARoundCapTableCommon(round, company_id, res);
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
              const isSeriesA =
                round.nameOfRound?.toLowerCase().includes("series a") ||
                round.nameOfRound?.toLowerCase().includes("series-a") ||
                (round.optionPoolPercent_post &&
                  round.optionPoolPercent_post > 0);

              if (
                round.instrumentType === "Common Stock" &&
                round.shareClassType?.toLowerCase().includes("series")
              ) {
                // Get all previous rounds for Series A calculation
                // In your API function, add this before calculation:

                // Get ALL previous rounds with their investors
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
                              async (err, currentInvestors) => {
                                // ✅ async जोड़ें
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
                                    `   ${idx + 1}. ${inv.first_name} ${inv.last_name} - $${inv.investment_amount}`,
                                  );
                                });

                                try {
                                  // ✅ await के साथ call करें
                                  const capTableData =
                                    await calculateSeriesARoundCapTableCommon(
                                      round,
                                      currentInvestors,
                                      roundZero,
                                      previousRounds,
                                      company_id,
                                      round_id,
                                    );
                                  console.log(capTableData);
                                  // ✅ Check if calculation was successful
                                  if (!capTableData.success) {
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

                                  // ✅ SUCCESS RESPONSE (Preferred Equity function जैसा format)
                                  // ✅ SUCCESS RESPONSE (Preferred Equity function जैसा format)
                                  return res.status(200).json({
                                    success: true,
                                    message:
                                      "Series A cap table calculated successfully",
                                    round_type: round.round_type,
                                    shareClassType: round.shareClassType,
                                    instrumentType: round.instrumentType,
                                    currency: round.currency || "USD",
                                    isRoundZero: false,

                                    // ये round object
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

                                    // ये capTable data (Preferred Equity function जैसा)
                                    capTable: {
                                      success: true,
                                      message:
                                        "Series A Common Stock calculation completed successfully",
                                      round_type: "Investment",
                                      shareClassType: round.shareClassType,
                                      instrumentType: round.instrumentType,
                                      currency: round.currency || "USD",
                                      isRoundZero: false,
                                      calculationType: "Series A Common Stock",

                                      // ✅ Frontend के लिए capTable object
                                      capTable: {
                                        totalShares:
                                          capTableData.calculations
                                            .totalSharesAfterSeriesA,
                                        totalValue:
                                          capTableData.calculations
                                            .postMoneyValuation,
                                        sharePrice:
                                          capTableData.calculations.sharePrice,
                                        shareholders: capTableData.shareholders, // Use flat array
                                        calculationType:
                                          "Series A Common Stock with Warrant Exercise",
                                      },

                                      // ✅ Calculations - FIXED PROPERTY NAMES
                                      calculations: {
                                        sharePrice: parseFloat(
                                          capTableData.calculations.sharePrice,
                                        ),
                                        preMoneyValuation:
                                          capTableData.calculations
                                            .preMoneyValuation,
                                        postMoneyValuation:
                                          capTableData.calculations
                                            .postMoneyValuation,
                                        investmentSize:
                                          capTableData.calculations
                                            .investmentSize,
                                        founderShares:
                                          capTableData.calculations
                                            .totalfoundershares || 0, // FIXED: lowercase 'f'
                                        existingEmployeeShares:
                                          capTableData.calculations
                                            .existingOptionPoolShares || 0,
                                        seedInvestorShares:
                                          capTableData.calculations
                                            .seedInvestorShares || 0,
                                        newOptionShares:
                                          capTableData.calculations
                                            .additionalOptionPoolShares || 0,
                                        convertedShares:
                                          capTableData.calculations
                                            .convertedShares || 0,
                                        seriesAShares:
                                          capTableData.calculations
                                            .seriesAInvestorShares || 0,
                                        warrantShares:
                                          capTableData.calculations
                                            .totalWarrantShares || 0,
                                        totalSharesAfterPool:
                                          capTableData.calculations
                                            .totalSharesAfterSeriesA,
                                        totalFounderShares:
                                          capTableData.calculations
                                            .totalfoundershares || 0, // Also add this for consistency
                                      },

                                      // ✅ Post Series A cap table
                                      postSeriesACapTable: {
                                        totalSharesAfterWarrants:
                                          capTableData.calculations
                                            .totalSharesAfterSeriesA,
                                        totalValue:
                                          capTableData.calculations
                                            .postMoneyValuation,
                                        shareholders: capTableData.shareholders, // Use flat array
                                      },

                                      // ✅ Warrants data
                                      hasWarrants: capTableData.hasWarrants,
                                      hasExercisedWarrants:
                                        capTableData.exercisedWarrantCount > 0,
                                      hasPendingWarrants: false,
                                      pendingWarrantShares: 0,
                                      exercisedWarrantShares:
                                        capTableData.totalWarrantShares,
                                      warrantDetails:
                                        capTableData.warrantDetails,

                                      // ✅ Round info
                                      roundInfo: capTableData.roundInfo,

                                      // ✅ ADD THESE FOR COMPLETENESS
                                      preSeriesAShareholders:
                                        capTableData.preSeriesAShareholders,
                                      chartData: capTableData.chartData,
                                      totalfoundershares:
                                        capTableData.calculations
                                          .totalfoundershares, // Ensure this is passed
                                    },
                                  });
                                } catch (calculationError) {
                                  console.error(
                                    "❌ Calculation execution error:",
                                    calculationError,
                                  );
                                  return res.status(500).json({
                                    success: false,
                                    message:
                                      "Series A calculation execution failed",
                                    error: calculationError.message,
                                  });
                                }
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
                calculateInvestmentRoundCapTable(
                  round,
                  investors,
                  roundZero,
                  company_id,
                )
                  .then((capTableData) => {
                    console.log(
                      "✅ Warrants data:",
                      capTableData.calculations.warrants,
                    );
                    return res.status(200).json({
                      success: true,
                      message: "Cap table data retrieved successfully",
                      capTable: capTableData,
                    });
                  })
                  .catch((error) => {
                    console.error("❌ Error:", error);
                    return res.status(500).json({
                      success: false,
                      error: error.message,
                    });
                  });
              }
            },
          );
        },
      );
    },
  );
};

// capitalRoundController.js mein add karein
async function handlePreferredEquityRoundCalculation(round, company_id, res) {
  try {
    // ✅ STEP 1: Get Round 0 (Founder) Data
    const roundZeroData = await new Promise((resolve, reject) => {
      db.query(
        `SELECT * FROM roundrecord WHERE company_id = ? AND round_type = 'Round 0'`,
        [company_id],
        (err, result) => (err ? reject(err) : resolve(result)),
      );
    });

    if (roundZeroData.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Round 0 (Founder Round) not found",
      });
    }

    const roundZero = roundZeroData[0];

    // ✅ STEP 2: Parse Round 0 Founder Data
    let founderShares = 0;
    let founderDataArray = [];
    try {
      if (roundZero.founder_data) {
        const founderData =
          typeof roundZero.founder_data === "string"
            ? JSON.parse(roundZero.founder_data)
            : roundZero.founder_data;

        founderShares = parseInt(founderData.totalShares) || 100000;
        founderDataArray = founderData.founders || [];

        founderDataArray.forEach((f, i) => {
          console.log(`  Founder ${i + 1}: ${f.shares} shares`);
        });
      } else {
        founderShares = parseInt(roundZero.issuedshares) || 100000;
      }
    } catch (error) {
      console.error("Error parsing founder data:", error);
      founderShares = 100000;
    }

    // ✅ STEP 3: Get ALL previous investment rounds
    const previousRounds = await new Promise((resolve, reject) => {
      db.query(
        `SELECT * FROM roundrecord 
         WHERE company_id = ? 
         AND round_type = 'Investment'
         AND id < ?
         ORDER BY created_at DESC`,
        [company_id, round.id],
        (err, result) => (err ? reject(err) : resolve(result)),
      );
    });

    // ✅ STEP 4: Check if there's a SAFE or Convertible Note round
    const safeRound = previousRounds.find((r) => r.instrumentType === "Safe");
    const convertibleNoteRound = previousRounds.find(
      (r) => r.instrumentType === "Convertible Note",
    );

    let calculationResult;
    let calculationType = "Simple Preferred Equity";

    if (safeRound) {
      calculationResult = calculateWithSAFEDoc34(
        round,
        safeRound,
        founderShares,
      );
      calculationType = "SAFE Conversion (Doc 3 & 4)";
    } else if (convertibleNoteRound) {
      calculationResult = calculateWithConvertibleNoteDoc56(
        round,
        convertibleNoteRound,
        founderShares,
      );
      calculationType = "Convertible Note Conversion (Doc 5 & 6)";
    } else {
      calculationResult = calculateSimplePreferredEquity(round, founderShares);
    }

    // ✅ STEP 5A: AUTOMATICALLY EXERCISE WARRANTIES FROM PREVIOUS ROUNDS
    let totalWarrantShares = 0;
    let warrantDetails = [];
    let newlyExercisedCount = 0;

    if (calculationResult && calculationResult.sharePrice) {
      console.log("\n🎯 HANDLING WARRANTS FOR CURRENT ROUND");

      // ✅ STEP 1: Get ALL warrants that should be included in this round
      const warrantsForThisRound = await new Promise((resolve, reject) => {
        db.query(
          `SELECT w.*, 
       CONCAT(COALESCE(ii.first_name, ''), ' ', COALESCE(ii.last_name, '')) AS investor_name,
       r.nameOfRound AS round_name
       FROM warrants w
       LEFT JOIN investor_information ii ON w.investor_id = ii.id
       LEFT JOIN roundrecord r ON w.roundrecord_id = r.id
       WHERE w.company_id = ? 
       AND (
         -- CASE 1: Pending warrants from previous rounds
         (w.warrant_status = 'pending' AND w.roundrecord_id < ?)
         OR
         -- CASE 2: Already exercised warrants in THIS round
         (w.exercised_in_round_id = ?)
       )`,
          [company_id, round.id, round.id],
          (err, result) => (err ? reject(err) : resolve(result)),
        );
      });

      if (warrantsForThisRound.length > 0) {
        totalWarrantShares = 0;
        newlyExercisedCount = 0;
        warrantDetails = []; // ✅ Reset the array here

        // Calculate total new shares for warrant coverage
        const totalNewSharesInRound =
          (calculationResult.seriesAShares || 0) +
          (calculationResult.convertedShares || 0);

        for (const warrant of warrantsForThisRound) {
          let warrantShares = 0;
          let exercisePrice = calculationResult.sharePrice;
          let isNewlyExercised = false;

          // ✅ CASE A: Warrant already exercised in THIS round
          if (warrant.exercised_in_round_id === round.id) {
            // Use values from database
            warrantShares = parseFloat(warrant.calculated_warrant_shares) || 0;
            exercisePrice =
              parseFloat(warrant.calculated_exercise_price) ||
              calculationResult.sharePrice;
          }
          // ✅ CASE B: Warrant pending (exercise it NOW)
          else if (warrant.warrant_status === "pending") {
            isNewlyExercised = true;

            // Calculate exercise price
            if (warrant.warrant_exercise_type === "next_round_adjusted") {
              const adjPercent = warrant.warrant_adjustment_percent || 0;
              const direction =
                warrant.warrant_adjustment_direction || "decrease";

              if (direction === "decrease") {
                exercisePrice =
                  calculationResult.sharePrice * (1 - adjPercent / 100);
              } else if (direction === "increase") {
                exercisePrice =
                  calculationResult.sharePrice * (1 + adjPercent / 100);
              }
            } else {
            }

            // Calculate warrant shares
            const coveragePercent = warrant.warrant_coverage_percentage || 0;

            if (coveragePercent > 0) {
              // Based on Series A shares (as per document examples)
              warrantShares = Math.round(
                calculationResult.seriesAShares * (coveragePercent / 100),
              );
            }

            // Alternative: If coverage amount specified
            if (
              warrant.warrant_coverage_amount &&
              warrant.warrant_coverage_amount > 0
            ) {
              warrantShares = Math.round(
                warrant.warrant_coverage_amount / exercisePrice,
              );
            }

            // ✅ Update warrant status in database
            if (warrantShares > 0) {
              await new Promise((resolve, reject) => {
                db.query(
                  `UPDATE warrants 
               SET warrant_status = 'exercised',
                   exercised_in_round_id = ?,
                   calculated_exercise_price = ?,
                   calculated_warrant_shares = ?,
                   exercised_date = NOW()
               WHERE id = ?`,
                  [round.id, exercisePrice, warrantShares, warrant.id],
                  (err) => (err ? reject(err) : resolve()),
                );
              });

              newlyExercisedCount++;
            }
          }

          // Add to warrant details for response
          if (warrantShares > 0) {
            totalWarrantShares += warrantShares;

            warrantDetails.push({
              warrant_id: warrant.id,
              investor_id: warrant.investor_id,
              investor_name: warrant.investor_name || "Warrant Holder",
              exercise_price: exercisePrice,
              warrant_shares: warrantShares,
              coverage_percentage: warrant.warrant_coverage_percentage,
              adjustment_percent: warrant.warrant_adjustment_percent || 0,
              adjustment_direction:
                warrant.warrant_adjustment_direction || "none",
              original_round: warrant.round_name,
              status: isNewlyExercised
                ? "newly_exercised"
                : "already_exercised",
              exercised_in_round: round.id,
            });
          }
        }

        // Update calculation result with warrant shares
        if (totalWarrantShares > 0) {
          calculationResult.warrantShares = totalWarrantShares;
          calculationResult.warrantDetails = warrantDetails;
          calculationResult.totalSharesAfterPool += totalWarrantShares;
          calculationResult.postMoneyValuation =
            calculationResult.totalSharesAfterPool *
            calculationResult.sharePrice;
        } else {
        }
      } else {
      }
    }

    // ✅ STEP 5: Get warrants for this round (new warrants being issued now)
    const warrantsData = await new Promise((resolve, reject) => {
      db.query(
        `SELECT * FROM warrants 
         WHERE roundrecord_id = ? 
         AND company_id = ? 
         AND warrant_status = 'pending'`,
        [round.id, company_id],
        (err, result) => (err ? reject(err) : resolve(result)),
      );
    });

    // ✅ STEP 6: Apply warrant calculations if exists (for new warrants in current round)
    if (warrantsData.length > 0 && calculationResult) {
      calculationResult = applyWarrantCalculations(
        calculationResult,
        warrantsData,
        round,
      );
    }

    // ✅ STEP 7: Get investors for this round
    const currentInvestors = await new Promise((resolve, reject) => {
      db.query(
        `SELECT ir.*, ii.first_name, ii.last_name, ii.email
         FROM investorrequest_company ir
         LEFT JOIN investor_information ii ON ir.investor_id = ii.id
         WHERE ir.roundrecord_id = ? 
         AND ir.company_id = ? 
         AND ir.request_confirm = 'Yes'`,
        [round.id, company_id],
        (err, result) => (err ? reject(err) : resolve(result)),
      );
    });

    // ✅ STEP 8: Build cap table with shareholders
    const capTable = buildCapTable(
      calculationResult,
      founderDataArray,
      currentInvestors,
      round,
      calculationType,
    );

    // ✅ STEP 9: Prepare final response - CORRECTED VARIABLES
    const totalCalculatedShares = capTable.totalShares || 0;
    const sharePrice = capTable.sharePrice || 0;
    const shareholders = capTable.shareholders || [];
    const calcResult = calculationResult || {};

    // ✅ FIXED: Calculate warrant flags from actual warrantDetails array
    const actuallyHasWarrants = warrantDetails.length > 0;
    const actuallyExercisedWarrants = warrantDetails.length > 0;
    const actuallyHasPendingWarrants = warrantsData.length > 0;

    // ✅ FIXED: Calculate total warrant shares from warrantDetails
    let totalWarrantSharesFromDetails = 0;
    if (warrantDetails && warrantDetails.length > 0) {
      totalWarrantSharesFromDetails = warrantDetails.reduce(
        (sum, w) => sum + (w.warrant_shares || 0),
        0,
      );
    }

    // Backend API mein response format update karein
    const finalResponse = {
      success: true,
      message: `${calculationType} calculation completed successfully`,

      // ✅ FRONTEND KE LIYE REQUIRED FIELDS
      round_type: "Investment",
      shareClassType: round.shareClassType,
      instrumentType: round.instrumentType,
      currency: round.currency || "USD",
      isRoundZero: false,
      calculationType: calculationType,

      // ✅ Cap table data - FRONTEND COMPATIBLE FORMAT
      capTable: {
        totalShares: totalCalculatedShares,
        totalValue: totalCalculatedShares * sharePrice,
        sharePrice: sharePrice,
        shareholders: shareholders,
        calculationType: calculationType,
      },

      // ✅ Calculations - FRONTEND COMPATIBLE FORMAT
      calculations: {
        sharePrice: parseFloat(sharePrice.toFixed(4)),
        preMoneyValuation: parseFloat(round.pre_money || 0),
        postMoneyValuation: parseFloat(
          (totalCalculatedShares * sharePrice).toFixed(2),
        ),
        investmentSize: parseFloat(round.roundsize || 0),

        // Specific calculations
        founderShares: calcResult.founderShares || founderShares,
        existingEmployeeShares: calcResult.existingEmployeeShares || 0,
        newOptionShares: calcResult.newOptionShares || 0,
        convertedShares: calcResult.convertedShares || 0,
        seriesAShares: calcResult.seriesAShares || 0,
        warrantShares: totalWarrantSharesFromDetails, // ✅ Use calculated warrant shares
        totalSharesAfterPool: totalCalculatedShares,

        // For SAFE/Convertible
        conversionPrice: calcResult.conversionPrice || 0,
        conversionMOIC: calcResult.conversionMOIC || 0,
        principalPlusInterest: calcResult.principalPlusInterest || 0,
        safeInvestment: calcResult.safeInvestment || 0,
        noteInvestment: calcResult.noteInvestment || 0,
      },

      // ✅ Post Series A cap table
      postSeriesACapTable: {
        totalSharesAfterWarrants: totalCalculatedShares,
        totalValue: totalCalculatedShares * sharePrice,
        shareholders: shareholders,
      },

      // ✅ FIXED: Warrants data - Use actual warrantDetails array
      hasWarrants: actuallyHasWarrants,
      hasExercisedWarrants: actuallyExercisedWarrants,
      hasPendingWarrants: actuallyHasPendingWarrants,
      pendingWarrantShares:
        warrantsData.length > 0
          ? warrantsData.reduce((sum, w) => sum + (w.potential_shares || 0), 0)
          : 0,
      exercisedWarrantShares: totalWarrantSharesFromDetails,
      warrantDetails: warrantDetails, // ✅ This will have the actual array data

      // ✅ Round info
      roundInfo: {
        id: round.id,
        name: round.nameOfRound,
        instrumentType: round.instrumentType,
        shareClassType: round.shareClassType,
        investmentSize: round.roundsize,
        preMoneyValuation: round.pre_money,
        postMoneyValuation: (totalCalculatedShares * sharePrice).toFixed(2),
        optionPoolPercentPost: round.optionPoolPercent_post,
        currency: round.currency || "USD",
      },
    };

    // ✅ STEP 10: Update issued shares in database
    try {
      const updated = await updateExistingShares(
        company_id,
        round.id,
        totalCalculatedShares,
      );

      if (updated) {
        // Also update the final response to reflect this
        finalResponse.roundInfo.issuedShares = totalCalculatedShares;
      }
    } catch (updateError) {
      console.error(
        "⚠️ Failed to update issued shares, but calculation completed:",
        updateError,
      );
      // Don't fail the whole request if update fails
    }

    return res.status(200).json({
      success: true,
      message: "",
      round: round,
      capTable: finalResponse,
    });
  } catch (error) {
    console.error("❌ Calculation error:", error);
    return res.status(500).json({
      success: false,
      message: "Preferred Equity calculation failed",
      error: error.message,
    });
  }
}

// ✅ Add this function at the end of your file
async function updateExistingShares(company_id, round_id, totalShares) {
  return;
  try {
    await new Promise((resolve, reject) => {
      db.query(
        `UPDATE roundrecord 
         SET issuedshares = ?, 
             updated_at = NOW()
         WHERE id = ? 
         AND company_id = ?`,
        [totalShares, round_id, company_id],
        (err, result) => (err ? reject(err) : resolve(result)),
      );
    });

    return true;
  } catch (error) {
    console.error("❌ Error updating issued shares:", error);
    throw error;
  }
}

// ========== REQUIRED HELPER FUNCTIONS ==========

function calculateWithSAFEDoc34(currentRound, safeRound, founderShares) {
  const toNumber = (val, def = 0) => {
    if (val === null || val === undefined || val === "") return def;
    const num = parseFloat(val);
    return isNaN(num) ? def : num;
  };

  // Parse SAFE round data
  let safeInstrumentData = {};
  try {
    if (safeRound.instrument_type_data) {
      safeInstrumentData =
        typeof safeRound.instrument_type_data === "string"
          ? JSON.parse(safeRound.instrument_type_data)
          : safeRound.instrument_type_data;
    }
  } catch (e) {
    console.error("Error parsing SAFE data:", e);
  }

  // SAFE parameters
  const safeInvestment = toNumber(safeRound.roundsize, 0);
  const safeValuationCap = toNumber(safeInstrumentData.valuationCap, 0);
  const safeDiscountRate = toNumber(safeInstrumentData.discountRate, 0) / 100;
  const safeOptionPoolPercent = toNumber(safeRound.optionPoolPercent, 0) / 100;

  // Calculate employee shares from SAFE round
  const existingEmployeeShares = Math.round(
    founderShares * (safeOptionPoolPercent / (1 - safeOptionPoolPercent)),
  );

  const totalSharesFromSeedRound = founderShares + existingEmployeeShares;

  // Current round inputs
  const seriesA_Investment = toNumber(currentRound.roundsize, 0);
  const seriesA_PreMoney = toNumber(currentRound.pre_money, 0);
  const optionPoolPercentPost =
    toNumber(currentRound.optionPoolPercent_post, 20) / 100;

  // Calculate Series A share price
  const seriesA_SharePrice = seriesA_PreMoney / totalSharesFromSeedRound;

  // SAFE conversion calculation
  const safeDiscountPrice = seriesA_SharePrice * (1 - safeDiscountRate);
  const safeCapPrice = safeValuationCap / totalSharesFromSeedRound;
  const safeOptimalPrice = Math.min(safeDiscountPrice, safeCapPrice);

  const safeConversionShares = Math.round(safeInvestment / safeOptimalPrice);
  const safeConversionValue = safeConversionShares * seriesA_SharePrice;
  const safeMOIC = safeConversionValue / safeInvestment;

  // Series A new shares
  const seriesA_Shares = Math.round(seriesA_Investment / seriesA_SharePrice);

  // Total new shares
  const totalNewShares = safeConversionShares + seriesA_Shares;

  // Option pool expansion
  const totalSharesExcludingOptions = founderShares + totalNewShares;
  const totalSharesAfterPool = Math.round(
    totalSharesExcludingOptions / (1 - optionPoolPercentPost),
  );
  const newOptionShares = Math.max(
    0,
    totalSharesAfterPool - totalSharesExcludingOptions - existingEmployeeShares,
  );
  const totalEmployeeShares = existingEmployeeShares + newOptionShares;

  // Final calculation
  const postMoneyValuation = totalSharesAfterPool * seriesA_SharePrice;

  return {
    sharePrice: seriesA_SharePrice,
    totalSharesAfterPool: totalSharesAfterPool,
    postMoneyValuation: postMoneyValuation,
    founderShares: founderShares,
    existingEmployeeShares: existingEmployeeShares,
    newOptionShares: newOptionShares,
    totalEmployeeShares: totalEmployeeShares,
    convertedShares: safeConversionShares,
    conversionPrice: safeOptimalPrice,
    conversionMOIC: safeMOIC,
    seriesAShares: seriesA_Shares,
    safeInvestment: safeInvestment,
    seriesAInvestment: seriesA_Investment,
    preMoneyValuation: seriesA_PreMoney,
  };
}

function calculateWithConvertibleNoteDoc56(
  currentRound,
  noteRound,
  founderShares,
) {
  const toNumber = (val, def = 0) => {
    if (val === null || val === undefined || val === "") return def;
    const num = parseFloat(val);
    return isNaN(num) ? def : num;
  };

  // Parse Convertible Note data
  let noteInstrumentData = {};
  try {
    if (noteRound.instrument_type_data) {
      noteInstrumentData =
        typeof noteRound.instrument_type_data === "string"
          ? JSON.parse(noteRound.instrument_type_data)
          : noteRound.instrument_type_data;
    }
  } catch (e) {
    console.error("Error parsing Convertible Note data:", e);
  }

  // Convertible Note parameters
  const noteInvestment = toNumber(noteRound.roundsize, 0);
  const noteValuationCap = toNumber(noteInstrumentData.valuationCap_note, 0);
  const noteDiscountRate =
    toNumber(noteInstrumentData.discountRate_note, 0) / 100;
  const noteInterestRate =
    toNumber(noteInstrumentData.interestRate_note, 10) / 100;
  const noteOptionPoolPercent = toNumber(noteRound.optionPoolPercent, 0) / 100;
  const yearsBetween = 2;

  // Calculate employee shares from note round
  const existingEmployeeShares = Math.round(
    founderShares * (noteOptionPoolPercent / (1 - noteOptionPoolPercent)),
  );

  const totalSharesFromSeedRound = founderShares + existingEmployeeShares;

  // Current round inputs
  const seriesA_Investment = toNumber(currentRound.roundsize, 0);
  const seriesA_PreMoney = toNumber(currentRound.pre_money, 0);
  const optionPoolPercentPost =
    toNumber(currentRound.optionPoolPercent_post, 20) / 100;

  // Calculate Series A share price
  const seriesA_SharePrice = seriesA_PreMoney / totalSharesFromSeedRound;

  // Convertible Note conversion
  const principalPlusInterest =
    noteInvestment * Math.pow(1 + noteInterestRate, yearsBetween);

  const noteDiscountPrice = seriesA_SharePrice * (1 - noteDiscountRate);
  const noteCapPrice = noteValuationCap / totalSharesFromSeedRound;
  const noteOptimalPrice = Math.min(noteDiscountPrice, noteCapPrice);

  const noteConversionShares = Math.round(
    principalPlusInterest / noteOptimalPrice,
  );
  const noteConversionValue = noteConversionShares * seriesA_SharePrice;
  const noteMOIC = noteConversionValue / noteInvestment;

  // Series A new shares
  const seriesA_Shares = Math.round(seriesA_Investment / seriesA_SharePrice);

  // Total new shares
  const totalNewShares = noteConversionShares + seriesA_Shares;

  // Option pool expansion
  const totalSharesExcludingOptions = founderShares + totalNewShares;
  const totalSharesAfterPool = Math.round(
    totalSharesExcludingOptions / (1 - optionPoolPercentPost),
  );
  const newOptionShares = Math.max(
    0,
    totalSharesAfterPool - totalSharesExcludingOptions - existingEmployeeShares,
  );
  const totalEmployeeShares = existingEmployeeShares + newOptionShares;

  // Final calculation
  const postMoneyValuation = totalSharesAfterPool * seriesA_SharePrice;

  return {
    sharePrice: seriesA_SharePrice,
    totalSharesAfterPool: totalSharesAfterPool,
    postMoneyValuation: postMoneyValuation,
    founderShares: founderShares,
    existingEmployeeShares: existingEmployeeShares,
    newOptionShares: newOptionShares,
    totalEmployeeShares: totalEmployeeShares,
    convertedShares: noteConversionShares,
    conversionPrice: noteOptimalPrice,
    conversionMOIC: noteMOIC,
    principalPlusInterest: principalPlusInterest,
    seriesAShares: seriesA_Shares,
    noteInvestment: noteInvestment,
    seriesAInvestment: seriesA_Investment,
    preMoneyValuation: seriesA_PreMoney,
  };
}

function calculateSimplePreferredEquity(currentRound, founderShares) {
  const toNumber = (val, def = 0) => {
    if (val === null || val === undefined || val === "") return def;
    const num = parseFloat(val);
    return isNaN(num) ? def : num;
  };

  // Inputs
  const investment = toNumber(currentRound.roundsize, 0);
  const preMoney = toNumber(currentRound.pre_money, 0);
  const optionPoolPost =
    toNumber(currentRound.optionPoolPercent_post, 20) / 100;

  // Calculate share price
  const sharePrice = preMoney / founderShares;

  // New Series A shares
  const seriesAShares = Math.round(investment / sharePrice);

  // Option pool expansion
  const totalSharesBeforePool = founderShares + seriesAShares;
  const totalSharesAfterPool = Math.round(
    totalSharesBeforePool / (1 - optionPoolPost),
  );
  const newOptionShares = Math.max(
    0,
    totalSharesAfterPool - totalSharesBeforePool,
  );
  const totalEmployeeShares = newOptionShares;

  // Final calculation
  const postMoneyValuation = totalSharesAfterPool * sharePrice;

  return {
    sharePrice: sharePrice,
    totalSharesAfterPool: totalSharesAfterPool,
    postMoneyValuation: postMoneyValuation,
    founderShares: founderShares,
    newOptionShares: newOptionShares,
    totalEmployeeShares: totalEmployeeShares,
    seriesAShares: seriesAShares,
    investment: investment,
    preMoneyValuation: preMoney,
  };
}

function applyWarrantCalculations(result, warrantsData, round) {
  const warrant = warrantsData[0];
  const warrantCoveragePercent = warrant.warrant_coverage_percentage || 0;

  if (warrantCoveragePercent <= 0) {
    return result;
  }

  // Calculate warrant shares
  const warrantShares = Math.round(
    result.seriesAShares * (warrantCoveragePercent / 100),
  );

  // Calculate exercise price
  let warrantExercisePrice = result.sharePrice;
  const adjustmentPercent = warrant.warrant_adjustment_percent || 0;
  const adjustmentDirection =
    warrant.warrant_adjustment_direction || "decrease";

  if (warrant.warrant_exercise_type === "next_round_adjusted") {
    if (adjustmentDirection === "decrease") {
      warrantExercisePrice = result.sharePrice * (1 - adjustmentPercent / 100);
    } else {
      warrantExercisePrice = result.sharePrice * (1 + adjustmentPercent / 100);
    }
  }

  // Update result
  result.warrantShares = warrantShares;
  result.warrantExercisePrice = warrantExercisePrice;
  result.totalSharesAfterPool += warrantShares;
  result.postMoneyValuation = result.totalSharesAfterPool * result.sharePrice;

  return result;
}

function buildCapTable(
  calcResult,
  founderData,
  investors,
  round,
  calculationType,
) {
  const totalShares = calcResult.totalSharesAfterPool || 0;
  const sharePrice = calcResult.sharePrice || 0;
  const shareholders = [];

  // Add Founders
  if (founderData && founderData.length > 0) {
    founderData.forEach((founder, index) => {
      const founderShares = parseInt(founder.shares) || 0;
      const ownershipPercent =
        totalShares > 0 ? (founderShares / totalShares) * 100 : 0;

      shareholders.push({
        name:
          `${founder.firstName || ""} ${founder.lastName || ""}`.trim() ||
          `Founder ${index + 1}`,
        type: "Founder",
        shares: founderShares,
        ownership: parseFloat(ownershipPercent.toFixed(2)),
        value: parseFloat((founderShares * sharePrice).toFixed(2)),
        sharePrice: parseFloat(sharePrice.toFixed(4)),
        note: "Round 0 Founder",
      });
    });
  } else {
    const founderShares = calcResult.founderShares || 0;
    const ownershipPercent =
      totalShares > 0 ? (founderShares / totalShares) * 100 : 0;

    shareholders.push({
      name: "Founders",
      type: "Founder",
      shares: founderShares,
      ownership: parseFloat(ownershipPercent.toFixed(2)),
      value: parseFloat((founderShares * sharePrice).toFixed(2)),
      sharePrice: parseFloat(sharePrice.toFixed(4)),
      note: "Round 0 Founders",
    });
  }

  // Add Employee Option Pool
  if (calcResult.totalEmployeeShares > 0) {
    const ownershipPercent =
      totalShares > 0
        ? (calcResult.totalEmployeeShares / totalShares) * 100
        : 0;

    shareholders.push({
      name: "Employee Option Pool",
      type: "Options Pool",
      shares: calcResult.totalEmployeeShares,
      ownership: parseFloat(ownershipPercent.toFixed(2)),
      value: parseFloat(
        (calcResult.totalEmployeeShares * sharePrice).toFixed(2),
      ),
      sharePrice: parseFloat(sharePrice.toFixed(4)),
      note:
        calcResult.newOptionShares > 0
          ? `Existing: ${calcResult.existingEmployeeShares || 0} + New: ${
              calcResult.newOptionShares
            }`
          : `Total: ${calcResult.totalEmployeeShares} shares`,
    });
  }

  // Add Converted Investors (SAFE/Convertible Notes)
  if (calcResult.convertedShares > 0) {
    const ownershipPercent =
      totalShares > 0 ? (calcResult.convertedShares / totalShares) * 100 : 0;

    let investorType = "Seed Investor";
    let note = `Converted at $${calcResult.conversionPrice?.toFixed(4) || "0.0000"}`;

    if (calcResult.principalPlusInterest) {
      investorType = "Convertible Note Investor";
      note = `Principal+Interest: $${calcResult.principalPlusInterest.toLocaleString()}`;
    } else if (calcResult.safeInvestment) {
      investorType = "SAFE Investor";
    }

    shareholders.push({
      name: investorType,
      type: "Investor",
      investorType: investorType,
      shares: calcResult.convertedShares,
      ownership: parseFloat(ownershipPercent.toFixed(2)),
      value: parseFloat((calcResult.convertedShares * sharePrice).toFixed(2)),
      investmentAmount:
        calcResult.safeInvestment || calcResult.noteInvestment || 0,
      sharePrice: parseFloat(sharePrice.toFixed(4)),
      conversionPrice: calcResult.conversionPrice,
      moic: (calcResult.conversionMOIC?.toFixed(2) || "1.00") + "X",
      note: note,
    });
  }

  // ✅ ADD WARRANT HOLDERS (BEFORE SERIES A INVESTORS)
  if (calcResult.warrantDetails && calcResult.warrantDetails.length > 0) {
    calcResult.warrantDetails.forEach((warrant, index) => {
      const warrantShares = warrant.warrant_shares || 0;
      if (warrantShares > 0) {
        const ownershipPercent =
          totalShares > 0 ? (warrantShares / totalShares) * 100 : 0;
        const exercisePrice = warrant.exercise_price || sharePrice;
        const warrantValue = warrantShares * sharePrice;
        const warrantInvestment = warrantShares * exercisePrice;

        shareholders.push({
          name: warrant.investor_name || `Warrant Holder ${index + 1}`,
          type: "Warrant",
          investorType: "Warrant Holder",
          shares: warrantShares,
          ownership: parseFloat(ownershipPercent.toFixed(2)),
          value: parseFloat(warrantValue.toFixed(2)),
          exercisePrice: parseFloat(exercisePrice.toFixed(4)),
          sharePrice: parseFloat(sharePrice.toFixed(4)),
          investmentAmount: parseFloat(warrantInvestment.toFixed(2)),
          moic: parseFloat((warrantValue / warrantInvestment).toFixed(2)) + "X",
          email: "",
          note: `Warrant from ${warrant.original_round || "Previous Round"}, ${warrant.coverage_percentage}% coverage`,
          isWarrant: true,
          originalType: "Warrant",
          warrantDetails: {
            coverage_percentage: warrant.coverage_percentage,
            adjustment_percent: warrant.adjustment_percent || 0,
            adjustment_direction: warrant.adjustment_direction || "none",
          },
        });
      }
    });
  } else if (calcResult.warrantShares > 0) {
    // If warrant details not available but shares calculated
    const ownershipPercent =
      totalShares > 0 ? (calcResult.warrantShares / totalShares) * 100 : 0;
    const exercisePrice = calcResult.warrantExercisePrice || sharePrice * 0; // Default 20% discount
    const warrantValue = calcResult.warrantShares * sharePrice;
    const warrantInvestment = calcResult.warrantShares * exercisePrice;

    shareholders.push({
      name: "Warrant Holders",
      type: "Warrant",
      investorType: "Warrant Holder",
      shares: calcResult.warrantShares,
      ownership: parseFloat(ownershipPercent.toFixed(2)),
      value: parseFloat(warrantValue.toFixed(2)),
      exercisePrice: parseFloat(exercisePrice.toFixed(4)),
      sharePrice: parseFloat(sharePrice.toFixed(4)),
      investmentAmount: parseFloat(warrantInvestment.toFixed(2)),
      moic: parseFloat((warrantValue / warrantInvestment).toFixed(2)) + "X",
      email: "",
      note: "Warrants exercised in Series A",
      isWarrant: true,
      originalType: "Warrant",
    });
  }

  // Add Series A Investors (AFTER WARRANTS)
  if (investors && investors.length > 0) {
    let totalSeriesAInvestment = 0;
    investors.forEach((investor) => {
      totalSeriesAInvestment += parseFloat(investor.investment_amount || 0);
    });

    investors.forEach((investor, index) => {
      const investmentAmount = parseFloat(investor.investment_amount || 0);
      const proRataShare =
        totalSeriesAInvestment > 0
          ? investmentAmount / totalSeriesAInvestment
          : 1 / investors.length;

      const individualShares = Math.round(
        calcResult.seriesAShares * proRataShare,
      );
      const ownershipPercent =
        totalShares > 0 ? (individualShares / totalShares) * 100 : 0;

      shareholders.push({
        name:
          `${investor.first_name || ""} ${investor.last_name || ""}`.trim() ||
          `Series A Investor ${index + 1}`,
        type: "Investor",
        investorType: "Series A",
        shares: individualShares,
        ownership: parseFloat(ownershipPercent.toFixed(2)),
        value: parseFloat((individualShares * sharePrice).toFixed(2)),
        investmentAmount: investmentAmount,
        sharePrice: parseFloat(sharePrice.toFixed(4)),
        moic: "1.00X",
        email: investor.email || "",
        note: `Invested: $${investmentAmount.toLocaleString()}`,
        originalType: "Series A Investor",
      });
    });
  } else if (calcResult.seriesAShares > 0) {
    const ownershipPercent =
      totalShares > 0 ? (calcResult.seriesAShares / totalShares) * 100 : 0;

    shareholders.push({
      name: "Series A Investors",
      type: "Investor",
      investorType: "Series A",
      shares: calcResult.seriesAShares,
      ownership: parseFloat(ownershipPercent.toFixed(2)),
      value: parseFloat((calcResult.seriesAShares * sharePrice).toFixed(2)),
      investmentAmount:
        calcResult.seriesAInvestment || calcResult.investment || 0,
      sharePrice: parseFloat(sharePrice.toFixed(4)),
      moic: "1.00X",
      note: `Total Investment: $${(
        calcResult.seriesAInvestment ||
        calcResult.investment ||
        0
      ).toLocaleString()}`,
      originalType: "Series A Investor",
    });
  }

  // Calculate totals
  let totalCalculatedShares = 0;
  shareholders.forEach((sh) => {
    totalCalculatedShares += sh.shares;
  });

  return {
    totalShares: totalCalculatedShares,
    totalValue: totalCalculatedShares * sharePrice,
    sharePrice: sharePrice,
    shareholders: shareholders,
    calculationType: calculationType,
  };
}

function getFormulaExplanation(calculationType, calcResult) {
  const explanations = [];

  if (calculationType.includes("SAFE")) {
    explanations.push({
      title: "SAFE Conversion Formula",
      formula: "Conversion Price = min(Discounted Price, Cap Price)",
      explanation: `Discounted Price = Series A Price × (1 - Discount Rate)
Cap Price = SAFE Valuation Cap ÷ Total Pre-Series A Shares
Optimal Price = $${calcResult.conversionPrice?.toFixed(4) || "0.0000"}`,
    });
  } else if (calculationType.includes("Convertible Note")) {
    explanations.push({
      title: "Convertible Note Formula",
      formula: "Principal + Interest = Investment × (1 + Interest Rate)^Years",
      explanation: `Interest Rate: ${(calcResult.noteInterestRate || 0.1) * 100}% for ${calcResult.years || 2} years
Principal+Interest = $${calcResult.principalPlusInterest?.toLocaleString() || "0"}`,
    });
  }

  explanations.push({
    title: "Option Pool Formula",
    formula:
      "Total Shares After Pool = Total Excluding Options ÷ (1 - Target Pool %)",
    explanation: `Ensures option pool reaches target percentage post-investment`,
  });

  explanations.push({
    title: "Warrant Coverage",
    formula: "Warrant Shares = Series A Shares × Warrant Coverage %",
    explanation: `Warrants give right to purchase additional shares at predetermined price`,
  });

  return explanations;
}
// New function specifically for Series A with post-money option pool
const calculateSeriesARoundCapTableCommon = async (
  round,
  investors,
  roundZero,
  previousRounds,
  company_id,
  round_id,
) => {
  try {
    // Helper function to parse numbers safely
    const toNumber = (val, def = 0) => {
      if (val === null || val === undefined || val === "") return def;
      const num = parseFloat(val);
      return isNaN(num) ? def : num;
    };

    // Helper function to safely parse JSON
    const safeJSONParseRepeated = (str, maxAttempts = 3) => {
      if (!str) return null;
      let parsed = str;
      for (let i = 0; i < maxAttempts; i++) {
        try {
          if (typeof parsed === "string") {
            parsed = JSON.parse(parsed);
          } else {
            return parsed;
          }
        } catch (e) {
          console.warn(`JSON parse attempt ${i + 1} failed:`, e.message);
          break;
        }
      }
      return parsed;
    };

    // ========== STEP 1: GET WARRANTS FOR THIS ROUND ==========
    const warrantQuery = `
      SELECT w.*, 
             rr.nameOfRound as original_round_name,
             rr.instrumentType as original_instrument,
             rr.round_type as original_round_type,
             rr.shareClassType as original_share_class,
             rr.created_at as round_created_at,
             ii.first_name, ii.last_name, ii.email as investor_email,
             ii.id as investor_id
      FROM warrants w
      LEFT JOIN roundrecord rr ON w.roundrecord_id = rr.id
      LEFT JOIN investor_information ii ON w.investor_id = ii.id
      WHERE w.company_id = ? 
      AND rr.instrumentType != 'Safe'
      AND (
        w.exercised_in_round_id = ?
        OR
        (w.warrant_status = 'pending' AND w.roundrecord_id < ?)
      )
      ORDER BY w.issued_date ASC
    `;

    const warrantsForThisRound = await new Promise((resolve, reject) => {
      db.query(
        warrantQuery,
        [company_id, round_id, round_id],
        (err, results) => {
          if (err) {
            console.error("❌ Error executing warrant query:", err);
            reject(err);
          } else {
            resolve(results || []);
          }
        },
      );
    });

    // ========== STEP 2: COLLECT ALL EXISTING SHARES ==========
    const existingShareholders = [];
    let totalExistingShares = 0;
    let totalOptionPoolShares = 0;
    let totalFounderShares = 0; // Added to track founder shares

    // 1. Add Round 0 Founders
    if (roundZero && roundZero.founder_data) {
      try {
        const founderData = safeJSONParseRepeated(roundZero.founder_data, 5);
        if (founderData?.founders && Array.isArray(founderData.founders)) {
          founderData.founders.forEach((founder, index) => {
            const shares = toNumber(founder.shares, 0);
            if (shares > 0) {
              totalExistingShares += shares;
              totalFounderShares += shares; // Track total founder shares
              existingShareholders.push({
                name:
                  `${founder.firstName || ""} ${founder.lastName || ""}`.trim() ||
                  `Founder ${index + 1}`,
                type: "Founder",
                shares: shares,
                originalType: "Founder",
                source: "Round 0",
                votingRights: founder.voting || "voting",
                email: founder.email || "",
              });
            }
          });
        }
      } catch (error) {
        console.error("❌ Error parsing founder data:", error);
      }
    }

    // 2. Process ALL previous investment rounds
    let totalPreviousInvestorShares = 0;
    let safeRound = null;
    let convertibleNoteRound = null;
    let previousInvestmentRounds = [];

    if (previousRounds && previousRounds.length > 0) {
      safeRound = previousRounds.find((r) => r.instrumentType === "Safe");
      convertibleNoteRound = previousRounds.find(
        (r) => r.instrumentType === "Convertible Note",
      );

      previousInvestmentRounds = previousRounds.filter(
        (r) =>
          r.round_type === "Investment" &&
          r.instrumentType !== "Safe" &&
          r.instrumentType !== "Convertible Note",
      );

      // Track if we've already added option pool for this round
      let optionPoolAdded = false;

      previousInvestmentRounds.forEach((prevRound) => {
        if (!prevRound) return;

        const prevRoundInvestorShares = toNumber(prevRound.issuedshares, 0);
        const prevRoundPreMoneyPool = toNumber(prevRound.optionPoolPercent, 0);

        // Handle PRE-MONEY Option Pool - CHECK FOR DUPLICATES
        if (prevRoundPreMoneyPool > 0 && !optionPoolAdded) {
          const sharesBeforePool = totalExistingShares;
          const optionPoolShares = Math.round(
            (sharesBeforePool * (prevRoundPreMoneyPool / 100)) /
              (1 - prevRoundPreMoneyPool / 100),
          );

          totalOptionPoolShares += optionPoolShares;
          totalExistingShares += optionPoolShares;
          optionPoolAdded = true; // Mark as added to prevent duplicates

          existingShareholders.push({
            name: `Employee Option Pool`,
            type: "Options Pool",
            shares: optionPoolShares,
            originalType: "Options Pool",
            source: prevRound.nameOfRound || "Previous Round",
            votingRights: "non-voting",
          });
        }

        // Add investor shares - CHECK FOR DUPLICATES
        if (prevRoundInvestorShares > 0) {
          totalPreviousInvestorShares += prevRoundInvestorShares;
          totalExistingShares += prevRoundInvestorShares;

          // Check if investor entry already exists
          const existingInvestorIndex = existingShareholders.findIndex(
            (sh) =>
              sh.type === "Investor" &&
              sh.source === (prevRound.nameOfRound || "Previous Round"),
          );

          if (existingInvestorIndex >= 0) {
            // Update existing investor
            existingShareholders[existingInvestorIndex].shares +=
              prevRoundInvestorShares;
          } else {
            // Add new investor
            existingShareholders.push({
              name: `Investors (${prevRound.nameOfRound || "Seed"})`,
              type: "Investor",
              shares: prevRoundInvestorShares,
              originalType: prevRound.nameOfRound?.includes("Seed")
                ? "Seed Investor"
                : "Previous Investor",
              source: prevRound.nameOfRound || "Previous Round",
              votingRights: "voting",
            });
          }
        }
      });
    }

    // Calculate existing option pool percentage
    const existingOptionPoolPercent =
      totalExistingShares > 0
        ? (totalOptionPoolShares / totalExistingShares) * 100
        : 0;

    // ========== STEP 3: HANDLE SAFE OR CONVERTIBLE NOTE CONVERSIONS ==========
    let convertedShares = 0;
    let conversionDetails = {};
    let totalSharesBeforeSeriesA = totalExistingShares;

    if (safeRound || convertibleNoteRound) {
      const founderOnlyShares = totalFounderShares; // Use tracked founder shares
      if (convertibleNoteRound) {
        const noteResult = calculateWithConvertibleNoteDoc56Common(
          round,
          convertibleNoteRound,
          founderOnlyShares,
          totalOptionPoolShares,
        );
        convertedShares = noteResult.convertedShares || 0;
        conversionDetails = noteResult;
        totalSharesBeforeSeriesA = totalExistingShares + convertedShares;
      }
    }

    // ========== STEP 4: SERIES A CALCULATION ==========
    const investmentSize = toNumber(round.roundsize, 0);
    const preMoneyValuation = toNumber(round.pre_money, 0);
    const optionPoolPercentPost = toNumber(round.optionPoolPercent_post, 0);
    const currency = round.currency || "USD";

    if (investmentSize <= 0 || preMoneyValuation <= 0) {
      return {
        success: false,
        error: "Invalid Series A parameters",
        details: `Investment: ${investmentSize}, Pre-Money: ${preMoneyValuation}`,
      };
    }

    // Calculate share price
    const sharePrice = preMoneyValuation / totalSharesBeforeSeriesA;

    // Calculate Series A investor shares
    const seriesAInvestorShares = Math.round(investmentSize / sharePrice);
    const postMoneyValuation = investmentSize + preMoneyValuation;
    const investorOwnershipPercent =
      (investmentSize / postMoneyValuation) * 100;

    // Handle option pool expansion if needed
    const needsOptionPoolExpansion =
      optionPoolPercentPost > existingOptionPoolPercent;
    let totalSharesAfterPool = totalSharesBeforeSeriesA + seriesAInvestorShares;
    let additionalOptionPoolShares = 0;
    let finalTotalShares = totalSharesAfterPool;

    if (needsOptionPoolExpansion) {
      const foundersSeedShares =
        totalSharesBeforeSeriesA - totalOptionPoolShares;
      const foundersSeedPercent =
        100 - investorOwnershipPercent - optionPoolPercentPost;

      finalTotalShares = Math.round(
        foundersSeedShares / (foundersSeedPercent / 100),
      );
      additionalOptionPoolShares = Math.max(
        0,
        Math.round(finalTotalShares * (optionPoolPercentPost / 100)) -
          totalOptionPoolShares,
      );

      totalSharesAfterPool =
        totalSharesBeforeSeriesA +
        seriesAInvestorShares +
        additionalOptionPoolShares;
    }

    // ========== STEP 5: EXERCISE AND PROCESS WARRANTS ==========
    console.log("\n🎯 ===== PROCESSING WARRANTS =====");

    let totalWarrantShares = 0;
    let warrantDetails = [];
    let newlyExercisedCount = 0;

    if (warrantsForThisRound.length > 0) {
      totalWarrantShares = 0;
      newlyExercisedCount = 0;
      warrantDetails = [];

      for (const warrant of warrantsForThisRound) {
        let warrantShares = 0;
        let exercisePrice = sharePrice;
        let isNewlyExercised = false;

        if (parseInt(warrant.exercised_in_round_id) === parseInt(round_id)) {
          warrantShares = parseFloat(warrant.calculated_warrant_shares) || 0;
          exercisePrice =
            parseFloat(warrant.calculated_exercise_price) || sharePrice;
        } else if (warrant.warrant_status === "pending") {
          isNewlyExercised = true;

          if (warrant.warrant_exercise_type === "next_round_adjusted") {
            const adjPercent =
              parseFloat(warrant.warrant_adjustment_percent) || 0;
            const direction =
              warrant.warrant_adjustment_direction || "decrease";
            if (direction === "decrease") {
              exercisePrice = sharePrice * (1 - adjPercent / 100);
            } else if (direction === "increase") {
              exercisePrice = sharePrice * (1 + adjPercent / 100);
            }
          }

          const coveragePercent =
            parseFloat(warrant.warrant_coverage_percentage) || 0;
          if (coveragePercent > 0) {
            const getOriginalInvestment = `SELECT roundsize FROM roundrecord WHERE id = ?`;
            const originalRoundResult = await new Promise((resolve, reject) => {
              db.query(
                getOriginalInvestment,
                [warrant.roundrecord_id],
                (err, result) => {
                  if (err) reject(err);
                  else resolve(result);
                },
              );
            });

            let originalInvestment = 0;
            if (originalRoundResult && originalRoundResult.length > 0) {
              originalInvestment =
                parseFloat(originalRoundResult[0].roundsize) || 0;
            }

            if (originalInvestment > 0) {
              const coverageAmount =
                originalInvestment * (coveragePercent / 100);
              warrantShares = Math.round(coverageAmount / exercisePrice);
            } else {
              warrantShares = Math.round(
                seriesAInvestorShares * (coveragePercent / 100),
              );
            }
          }

          if (
            warrant.warrant_coverage_amount &&
            warrant.warrant_coverage_amount > 0
          ) {
            warrantShares = Math.round(
              warrant.warrant_coverage_amount / exercisePrice,
            );
          }

          if (warrantShares > 0) {
            const updateQuery = `
              UPDATE warrants 
              SET warrant_status = 'exercised',
                  exercised_date = NOW(),
                  exercised_in_round_id = ?,
                  calculated_exercise_price = ?,
                  calculated_warrant_shares = ?,
                  updated_at = NOW()
              WHERE id = ?
            `;

            await new Promise((resolve, reject) => {
              db.query(
                updateQuery,
                [round_id, exercisePrice, warrantShares, warrant.id],
                (err, result) => {
                  if (err) reject(err);
                  else resolve(result);
                },
              );
            });
            newlyExercisedCount++;
          }
        }

        if (warrantShares > 0) {
          totalWarrantShares += warrantShares;
          warrantDetails.push({
            warrant_id: warrant.id,
            investor_id: warrant.investor_id,
            investor_name:
              `${warrant.first_name || ""} ${warrant.last_name || ""}`.trim() ||
              "Warrant Holder",
            email: warrant.investor_email,
            original_round: warrant.original_round_name,
            original_instrument: warrant.original_instrument,
            warrant_shares: warrantShares,
            exercise_price: exercisePrice,
            stock_type: warrant.original_share_class || "Common Stock",
            coverage_percentage: warrant.warrant_coverage_percentage,
            adjustment_percent: warrant.warrant_adjustment_percent || 0,
            adjustment_direction:
              warrant.warrant_adjustment_direction || "none",
            status: isNewlyExercised ? "newly_exercised" : "already_exercised",
            exercised_in_round: round_id,
            round_name: round.nameOfRound,
          });
        }
      }
    }

    // ========== STEP 6: UPDATE FINAL SHARE COUNT WITH WARRANTS ==========
    let finalTotalSharesWithWarrants = totalSharesAfterPool;
    if (totalWarrantShares > 0) {
      finalTotalSharesWithWarrants += totalWarrantShares;
    }

    // ========== STEP 7: BUILD CAP TABLES ==========
    console.log("\n📊 ===== BUILDING CAP TABLES =====");

    // Build pre-Series A cap table (remove duplicates)
    const uniquePreSeriesAShareholders = [];
    const seenPreSeriesA = new Set();

    existingShareholders.forEach((sh) => {
      const key = `${sh.name}_${sh.type}`;
      if (!seenPreSeriesA.has(key)) {
        seenPreSeriesA.add(key);
        uniquePreSeriesAShareholders.push(sh);
      } else {
        // Update existing entry if duplicate found
        const existingIndex = uniquePreSeriesAShareholders.findIndex(
          (s) => `${s.name}_${s.type}` === key,
        );
        if (existingIndex >= 0) {
          uniquePreSeriesAShareholders[existingIndex].shares += sh.shares;
        }
      }
    });

    // Add converted SAFE/Note investors if any
    if (convertedShares > 0) {
      const conversionName = safeRound
        ? "SAFE Investors"
        : "Convertible Note Investors";
      uniquePreSeriesAShareholders.push({
        name: conversionName,
        type: "Investor",
        shares: convertedShares,
        originalType: "Convertible Investor",
        source:
          safeRound?.nameOfRound ||
          convertibleNoteRound?.nameOfRound ||
          "Convertible Round",
        votingRights: "voting",
      });
    }

    const preSeriesAShareholders = uniquePreSeriesAShareholders;

    // Build post-Series A cap table
    const postSeriesAShareholders = [...preSeriesAShareholders];

    // Add Series A investors
    postSeriesAShareholders.push({
      name: `Series A Investors`,
      type: "Investor",
      shares: seriesAInvestorShares,
      originalType: "Series A Investor",
      source: round.nameOfRound,
      votingRights: "voting",
    });

    // Add expanded option pool if any - UPDATE EXISTING, DON'T CREATE NEW
    if (additionalOptionPoolShares > 0) {
      const existingPoolIndex = postSeriesAShareholders.findIndex(
        (s) => s.type === "Options Pool",
      );

      if (existingPoolIndex >= 0) {
        postSeriesAShareholders[existingPoolIndex].shares +=
          additionalOptionPoolShares;
      } else {
        postSeriesAShareholders.push({
          name: `Employee Option Pool`,
          type: "Options Pool",
          shares: additionalOptionPoolShares,
          originalType: "Options Pool",
          source: round.nameOfRound,
          votingRights: "non-voting",
        });
      }
    }

    // Add warrant holders
    if (warrantDetails.length > 0) {
      warrantDetails.forEach((warrant) => {
        const warrantShares = warrant.warrant_shares;
        postSeriesAShareholders.push({
          name: warrant.investor_name,
          type: "Warrant Holder",
          shares: warrantShares,
          originalType: warrant.stock_type || "Common Stock",
          source: `Warrant from ${warrant.original_round}`,
          votingRights: "voting",
          details: {
            exercise_price: warrant.exercise_price,
            original_round: warrant.original_round,
            status: warrant.status,
          },
        });
      });
    }

    // Calculate ownership percentages
    const calculateOwnership = (shareholders, totalShares, valuation) => {
      return shareholders.map((sh) => ({
        ...sh,
        ownershipPercent: totalShares > 0 ? (sh.shares / totalShares) * 100 : 0,
        value: valuation > 0 ? (sh.shares / totalShares) * valuation : 0,
      }));
    };

    const preSeriesATotalShares = totalSharesBeforeSeriesA;
    const postSeriesATotalShares = finalTotalSharesWithWarrants;

    const preSeriesACapTable = calculateOwnership(
      preSeriesAShareholders,
      preSeriesATotalShares,
      preMoneyValuation,
    );
    const postSeriesACapTable = calculateOwnership(
      postSeriesAShareholders,
      postSeriesATotalShares,
      postMoneyValuation,
    );

    // ========== STEP 8: PREPARE FINAL RESPONSE ==========
    const createChartData = (shareholders) => {
      if (!shareholders || shareholders.length === 0) {
        return {
          labels: ["Founders", "Investors", "Option Pool"],
          datasets: [
            {
              data: [60, 25, 15],
              backgroundColor: ["#4e73df", "#1cc88a", "#f6c23e"],
              borderColor: "#fff",
              borderWidth: 2,
            },
          ],
        };
      }

      const colors = {
        Founder: "#4e73df",
        "Options Pool": "#f6c23e",
        "Seed Investor": "#1cc88a",
        "Convertible Investor": "#6c757d",
        "Series A Investor": "#e74a3b",
        "Warrant Holder": "#5a5c69",
        Investor: "#36b9cc",
      };

      return {
        labels: shareholders.map((sh) => sh.name || "Unknown"),
        datasets: [
          {
            data: shareholders.map((sh) => sh.ownershipPercent || 0),
            backgroundColor: shareholders.map((sh) => {
              const type =
                sh.type === "Investor"
                  ? sh.originalType || "Investor"
                  : sh.type;
              return colors[type] || "#858796";
            }),
            borderColor: "#fff",
            borderWidth: 2,
          },
        ],
      };
    };

    const response = {
      success: true,
      message: "Series A Common Stock calculation completed successfully",
      round_type: round.round_type,
      shareClassType: round.shareClassType,
      instrumentType: round.instrumentType,
      currency: round.currency || "USD",
      isRoundZero: false,
      roundType: round.nameOfRound || "Series A Round",
      roundInfo: {
        id: round.id,
        name: round.nameOfRound,
        type: round.round_type,
        instrumentType: round.instrumentType,
        shareClassType: round.shareClassType,
        investmentSize: investmentSize,
        preMoneyValuation: preMoneyValuation,
        postMoneyValuation: postMoneyValuation,
        optionPoolPercentPost: optionPoolPercentPost,
        currency: currency,
        sharePrice: sharePrice.toFixed(4),
      },
      calculations: {
        investmentSize,
        preMoneyValuation,
        postMoneyValuation,
        sharePrice: sharePrice.toFixed(4),
        existingOptionPoolPercent: existingOptionPoolPercent.toFixed(2),
        optionPoolPercentPost,
        investorOwnershipPercent: investorOwnershipPercent.toFixed(2),
        seriesAInvestorShares,
        totalSharesBeforeSeriesA,
        totalSharesAfterSeriesA: finalTotalSharesWithWarrants,
        additionalOptionPoolShares,
        convertedShares,
        totalWarrantShares,
        newlyExercisedWarrants: newlyExercisedCount,
        totalWarrantsProcessed: warrantsForThisRound.length,
        needsExpansion: needsOptionPoolExpansion,
        totalfoundershares: totalFounderShares,
        preInvestmentTotalShares: totalSharesBeforeSeriesA,
        postInvestmentTotalShares: finalTotalSharesWithWarrants,
        totalNewShares:
          seriesAInvestorShares +
          additionalOptionPoolShares +
          convertedShares +
          totalWarrantShares,
        existingOptionPoolShares: totalOptionPoolShares,
        totalOptionPoolShares:
          totalOptionPoolShares + additionalOptionPoolShares,
        foundersSeedShares: totalFounderShares, // Changed to use totalFounderShares
        existingShareholdersPercent:
          100 - parseFloat(investorOwnershipPercent) - optionPoolPercentPost,
        seedInvestorShares: totalPreviousInvestorShares,
        totalSharesAfterPool: finalTotalSharesWithWarrants,
      },
      capTables: {
        preSeriesA: {
          totalShares: preSeriesATotalShares,
          totalValue: preMoneyValuation,
          shareholders: preSeriesACapTable,
        },
        postSeriesA: {
          totalShares: postSeriesATotalShares,
          totalValue: postMoneyValuation,
          shareholders: postSeriesACapTable,
        },
      },
      preSeriesAShareholders: preSeriesACapTable,
      shareholders: postSeriesACapTable,
      chartData: createChartData(postSeriesACapTable),
      hasWarrants: warrantDetails.length > 0,
      warrantDetails: warrantDetails,
      exercisedWarrantCount: warrantDetails.length,
      newlyExercisedCount: newlyExercisedCount,
      totalWarrantShares,
      hasConvertibleInstruments: !!(safeRound || convertibleNoteRound),
      conversionDetails: conversionDetails,
      isSeriesA: true,
      calculationType: "Series A Common Stock with Warrant Exercise",
      isPostMoneyOptionPool: needsOptionPoolExpansion,
    };

    return response;
  } catch (error) {
    console.error("❌ Series A calculation error:", error);
    console.error("Error stack:", error.stack);
    return {
      success: false,
      error: "Series A calculation failed",
      details: error.message,
      stack: error.stack,
    };
  }
};

// ========== SUPPORTING FUNCTIONS FOR COMMON STOCK ==========

// ========== SUPPORTING FUNCTIONS FOR COMMON STOCK ==========

function calculateWithSAFEDoc34Common(
  currentRound,
  safeRound,
  founderShares,
  existingOptionPoolShares,
) {
  console.log("\n🔵 ===== DOC 3 & 4: SAFE NOTES CONVERSION (COMMON) =====");

  const toNumber = (val, def = 0) => {
    if (val === null || val === undefined || val === "") return def;
    const num = parseFloat(val);
    return isNaN(num) ? def : num;
  };

  // Parse SAFE round data
  let safeInstrumentData = {};
  try {
    if (safeRound.instrument_type_data) {
      safeInstrumentData =
        typeof safeRound.instrument_type_data === "string"
          ? JSON.parse(safeRound.instrument_type_data)
          : safeRound.instrument_type_data;
    }
  } catch (e) {
    console.error("Error parsing SAFE data:", e);
  }

  // SAFE parameters
  const safeInvestment = toNumber(safeRound.roundsize, 0);
  const safeValuationCap = toNumber(safeInstrumentData.valuationCap, 0);
  const safeDiscountRate = toNumber(safeInstrumentData.discountRate, 0) / 100;
  const safeOptionPoolPercent = toNumber(safeRound.optionPoolPercent, 0) / 100;

  // Current round inputs (Series A)
  const seriesA_Investment = toNumber(currentRound.roundsize, 0);
  const seriesA_PreMoney = toNumber(currentRound.pre_money, 0);
  const optionPoolPercentPost =
    toNumber(currentRound.optionPoolPercent_post, 20) / 100;

  // Calculate total shares including existing option pool
  const totalSharesFromSeedRound = founderShares + existingOptionPoolShares;

  // Calculate Series A share price
  const seriesA_SharePrice = seriesA_PreMoney / totalSharesFromSeedRound;
  console.log(`💰 Series A Share Price: $${seriesA_SharePrice.toFixed(4)}`);
  console.log(`   Pre-Money: $${seriesA_PreMoney.toLocaleString()}`);
  console.log(`   Total Shares: ${totalSharesFromSeedRound.toLocaleString()}`);

  // SAFE conversion calculation
  const safeDiscountPrice = seriesA_SharePrice * (1 - safeDiscountRate);
  const safeCapPrice = safeValuationCap / totalSharesFromSeedRound;
  const safeOptimalPrice = Math.min(safeDiscountPrice, safeCapPrice);

  const safeConversionShares = Math.round(safeInvestment / safeOptimalPrice);
  const safeConversionValue = safeConversionShares * seriesA_SharePrice;
  const safeMOIC = safeConversionValue / safeInvestment;

  console.log(`📊 SAFE Conversion:`);
  console.log(`   Discount Price: $${safeDiscountPrice.toFixed(4)}`);
  console.log(`   Cap Price: $${safeCapPrice.toFixed(4)}`);
  console.log(`   Optimal Price: $${safeOptimalPrice.toFixed(4)}`);
  console.log(`   Conversion Shares: ${safeConversionShares.toLocaleString()}`);
  console.log(`   MOIC: ${safeMOIC.toFixed(2)}x`);

  return {
    sharePrice: seriesA_SharePrice,
    founderShares: founderShares,
    existingOptionPoolShares: existingOptionPoolShares,
    convertedShares: safeConversionShares,
    conversionPrice: safeOptimalPrice,
    conversionMOIC: safeMOIC,
    safeInvestment: safeInvestment,
    seriesAInvestment: seriesA_Investment,
    preMoneyValuation: seriesA_PreMoney,
    safeDiscountPrice: safeDiscountPrice,
    safeCapPrice: safeCapPrice,
  };
}

function calculateWithConvertibleNoteDoc56Common(
  currentRound,
  noteRound,
  founderShares,
  existingOptionPoolShares,
) {
  console.log(
    "\n🟣 ===== DOC 5 & 6: CONVERTIBLE NOTES CONVERSION (COMMON) =====",
  );

  const toNumber = (val, def = 0) => {
    if (val === null || val === undefined || val === "") return def;
    const num = parseFloat(val);
    return isNaN(num) ? def : num;
  };

  // Parse Convertible Note data
  let noteInstrumentData = {};
  try {
    if (noteRound.instrument_type_data) {
      noteInstrumentData =
        typeof noteRound.instrument_type_data === "string"
          ? JSON.parse(noteRound.instrument_type_data)
          : noteRound.instrument_type_data;
    }
  } catch (e) {
    console.error("Error parsing Convertible Note data:", e);
  }

  // Convertible Note parameters
  const noteInvestment = toNumber(noteRound.roundsize, 0);
  const noteValuationCap = toNumber(noteInstrumentData.valuationCap_note, 0);
  const noteDiscountRate =
    toNumber(noteInstrumentData.discountRate_note, 0) / 100;
  const noteInterestRate =
    toNumber(noteInstrumentData.interestRate_note, 10) / 100;
  const noteOptionPoolPercent = toNumber(noteRound.optionPoolPercent, 0) / 100;
  const yearsBetween = 2; // Default, could be parameterized

  // Current round inputs (Series A)
  const seriesA_Investment = toNumber(currentRound.roundsize, 0);
  const seriesA_PreMoney = toNumber(currentRound.pre_money, 0);
  const optionPoolPercentPost =
    toNumber(currentRound.optionPoolPercent_post, 20) / 100;

  // Calculate total shares including existing option pool
  const totalSharesFromSeedRound = founderShares + existingOptionPoolShares;

  // Calculate Series A share price
  const seriesA_SharePrice = seriesA_PreMoney / totalSharesFromSeedRound;
  console.log(`💰 Series A Share Price: $${seriesA_SharePrice.toFixed(4)}`);
  console.log(`   Pre-Money: $${seriesA_PreMoney.toLocaleString()}`);
  console.log(`   Total Shares: ${totalSharesFromSeedRound.toLocaleString()}`);

  // Convertible Note conversion
  const principalPlusInterest =
    noteInvestment * Math.pow(1 + noteInterestRate, yearsBetween);

  const noteDiscountPrice = seriesA_SharePrice * (1 - noteDiscountRate);
  const noteCapPrice = noteValuationCap / totalSharesFromSeedRound;
  const noteOptimalPrice = Math.min(noteDiscountPrice, noteCapPrice);

  const noteConversionShares = Math.round(
    principalPlusInterest / noteOptimalPrice,
  );
  const noteConversionValue = noteConversionShares * seriesA_SharePrice;
  const noteMOIC = noteConversionValue / noteInvestment;

  console.log(`📊 Convertible Note Conversion:`);
  console.log(
    `   Principal + Interest: $${principalPlusInterest.toLocaleString()}`,
  );
  console.log(`   Discount Price: $${noteDiscountPrice.toFixed(4)}`);
  console.log(`   Cap Price: $${noteCapPrice.toFixed(4)}`);
  console.log(`   Optimal Price: $${noteOptimalPrice.toFixed(4)}`);
  console.log(`   Conversion Shares: ${noteConversionShares.toLocaleString()}`);
  console.log(`   MOIC: ${noteMOIC.toFixed(2)}x`);

  return {
    sharePrice: seriesA_SharePrice,
    founderShares: founderShares,
    existingOptionPoolShares: existingOptionPoolShares,
    convertedShares: noteConversionShares,
    conversionPrice: noteOptimalPrice,
    conversionMOIC: noteMOIC,
    principalPlusInterest: principalPlusInterest,
    noteInvestment: noteInvestment,
    seriesAInvestment: seriesA_Investment,
    preMoneyValuation: seriesA_PreMoney,
    noteDiscountPrice: noteDiscountPrice,
    noteCapPrice: noteCapPrice,
  };
}

// Helper functions

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
function handleConvertibleNoteRoundCalculation(round, company_id, res) {
  // ✅ Store response object reference
  const response = res;

  // Get Round 0 data
  db.query(
    `SELECT * FROM roundrecord WHERE company_id=? AND round_type='Round 0'`,
    [company_id],
    (err, roundZeroData) => {
      if (err) {
        return response.status(500).json({
          success: false,
          message: "Database error",
          error: err,
        });
      }

      if (roundZeroData.length === 0) {
        return response.status(400).json({
          success: false,
          message: "Round 0 (Incorporation) data not found.",
        });
      }

      const roundZero = roundZeroData[0];

      // Parse instrument data
      let instrumentData = {};
      try {
        instrumentData =
          safeJSONParseRepeated(round.instrument_type_data, 3) || {};
      } catch (error) {
        instrumentData = {};
      }

      // Input parameters
      const companyValue = toNumber(round.pre_money, 0);
      const investmentSize = toNumber(round.roundsize, 0);
      const discountRate = toNumber(instrumentData.discountRate_note, 0) / 100;
      const valuationCap = toNumber(instrumentData.valuationCap_note, 0);
      const interestRate = toNumber(instrumentData.interestRate_note, 0) / 100;
      const maturityDate = instrumentData.maturityDate || null;
      const optionPoolPercent = toNumber(round.optionPoolPercent, 0) / 100;

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

      // Calculate Employee shares
      const employeeShares = Math.round(
        (roundZeroTotalShares / (1 - optionPoolPercent)) * optionPoolPercent,
      );

      const totalSharesPreSeed = roundZeroTotalShares + employeeShares;

      // ✅ Get investors (using response variable)
      db.query(
        `SELECT ir.*, COALESCE(ii.first_name,'') AS first_name, 
                COALESCE(ii.last_name,'') AS last_name, COALESCE(ii.email,'') AS email
         FROM investorrequest_company ir
         LEFT JOIN investor_information ii ON ir.investor_id = ii.id
         WHERE ir.roundrecord_id=? AND ir.company_id=? AND ir.request_confirm='Yes'`,
        [round.id, company_id],
        (err, investors) => {
          if (err) {
            console.error("Error fetching investors:", err);
            investors = [];
          }

          // ✅ Get warrants for this round
          db.query(
            `SELECT w.*, 
                    CONCAT(COALESCE(ii.first_name,''), ' ', COALESCE(ii.last_name,'')) AS investorName
             FROM warrants w
             LEFT JOIN investor_information ii ON w.investor_id = ii.id
             WHERE w.roundrecord_id=? AND w.company_id=? AND w.warrant_status != 'cancelled'`,
            [round.id, company_id],
            (warrantErr, warrants) => {
              if (warrantErr) {
                console.error("Error fetching warrants:", warrantErr);
                warrants = [];
              }

              // Calculate total investment
              let totalConfirmedInvestment = 0;
              let investorCount = 0;

              if (investors && investors.length > 0) {
                investors.forEach((investor) => {
                  const investmentAmount = toNumber(
                    investor.investment_amount,
                    0,
                  );
                  if (investmentAmount > 0) {
                    totalConfirmedInvestment += investmentAmount;
                    investorCount++;
                  }
                });
              }

              const availableForInvestment = Math.max(
                0,
                investmentSize - totalConfirmedInvestment,
              );

              // Pre-Seed shareholders
              let preSeedShareholders = [];
              let totalFoundersValue = 0;
              let totalEmployeeValue = 0;

              // Add founders
              if (roundZeroFounders && roundZeroFounders.length > 0) {
                roundZeroFounders.forEach((founder, index) => {
                  const shares = toNumber(founder.shares, 0);
                  if (shares > 0) {
                    const ownership = (shares / totalSharesPreSeed) * 100;
                    const value = (ownership / 100) * companyValue;
                    totalFoundersValue += value;

                    preSeedShareholders.push({
                      name:
                        `${founder.firstName || ""} ${founder.lastName || ""}`.trim() ||
                        `F${index + 1}`,
                      fullName:
                        `${founder.firstName || ""} ${founder.lastName || ""}`.trim(),
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
                  (employeeShares / totalSharesPreSeed) * 100;
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

              // Post-Seed shareholders
              let postSeedShareholders = [...preSeedShareholders];

              // Add Convertible Note Investors
              if (investors && investors.length > 0) {
                investors.forEach((investor, index) => {
                  const investmentAmount = toNumber(
                    investor.investment_amount,
                    0,
                  );
                  if (investmentAmount > 0) {
                    // Check if investor has warrants
                    const investorWarrants = warrants.filter(
                      (w) => w.investor_id === investor.investor_id,
                    );

                    postSeedShareholders.push({
                      name:
                        `${investor.first_name || ""} ${investor.last_name || ""}`.trim() ||
                        `Investor ${index + 1}`,
                      fullName:
                        `${investor.first_name || ""} ${investor.last_name || ""}`.trim(),
                      type: "Convertible Note Investor",
                      investorId: investor.investor_id,
                      shares: 0,
                      ownership: 0,
                      value: 0,
                      investmentAmount: investmentAmount,
                      voting: "non-voting",
                      note: `Convertible Note - Will convert at next priced round`,
                      isConvertibleNote: true,
                      hasWarrants: investorWarrants.length > 0,
                      warrantCount: investorWarrants.length,
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

              // Available for investment
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

              // Calculations object
              const calculations = {
                companyValue: companyValue,
                investmentSize: investmentSize,
                discountRate: (discountRate * 100).toFixed(1),
                valuationCap: valuationCap,
                interestRate: (interestRate * 100).toFixed(1),
                optionPoolPercent: (optionPoolPercent * 100).toFixed(1),
                postMoneyValuation: companyValue + investmentSize,
                postInvestmentShares: totalSharesPreSeed,
                sharePrice:
                  totalSharesPreSeed > 0
                    ? (companyValue / totalSharesPreSeed).toFixed(4)
                    : "0.0000",
                roundZeroTotalShares: roundZeroTotalShares,
                employeeShares: employeeShares,
                totalSharesPreSeed: totalSharesPreSeed,
                totalSharesPostSeed: totalSharesPreSeed,
                totalConfirmedInvestment: totalConfirmedInvestment,
                availableForInvestment: availableForInvestment,
                investorCount: investorCount,
                totalFoundersOwnership: (
                  (totalFoundersValue / companyValue) *
                  100
                ).toFixed(1),
                totalEmployeeOwnership: (
                  (totalEmployeeValue / companyValue) *
                  100
                ).toFixed(1),
                totalInvestorOwnership: "0.0",
                totalFoundersValue: Math.round(totalFoundersValue),
                totalEmployeeValue: Math.round(totalEmployeeValue),
                totalCompanyValue: companyValue,
                totalPostMoneyValue: companyValue + investmentSize,
              };

              // ✅ Warrant Data
              const warrantData = {
                hasWarrants: warrants.length > 0,
                totalWarrants: warrants.length,
                warrants: warrants.map((w) => ({
                  id: w.id,
                  investor_id: w.investor_id,
                  investorName: w.investorName || `Investor ${w.investor_id}`,
                  warrant_coverage_percentage: w.warrant_coverage_percentage,
                  warrant_exercise_type: w.warrant_exercise_type,
                  warrant_adjustment_percent: w.warrant_adjustment_percent,
                  warrant_adjustment_direction: w.warrant_adjustment_direction,
                  warrant_status: w.warrant_status,
                  issued_date: w.issued_date,
                  expiration_date: w.expiration_date,
                  notes: w.notes,
                  will_exercise: "Next Priced Equity Round (Series A)",
                })),
                note:
                  warrants.length > 0
                    ? `${warrants.length} warrant(s) issued - Will be exercisable at next priced round`
                    : null,
              };

              // Response data
              const capTableData = {
                shareClassType: round.shareClassType,
                roundType:
                  round.nameOfRound || "Seed Round (Convertible Notes)",
                round_type: round.round_type,
                instrumentType: round.instrumentType,
                currency: round.currency || "USD",
                isConvertibleNoteRound: true,
                hasInvestors: investorCount > 0,

                // Pre-seed cap table
                preSeedCapTable: {
                  shareholders: preSeedShareholders,
                  totalShares: totalSharesPreSeed,
                  totalValue: companyValue,
                  message: "Before Convertible Note investment",
                  summary: {
                    founders: `${preSeedShareholders.filter((s) => s.type === "Founder").length} founders`,
                    employeePool: `${(optionPoolPercent * 100).toFixed(1)}% option pool`,
                    totalFoundersOwnership: `${((totalFoundersValue / companyValue) * 100).toFixed(1)}%`,
                    totalEmployeeOwnership: `${((totalEmployeeValue / companyValue) * 100).toFixed(1)}%`,
                  },
                },

                // Post-seed cap table
                postSeedCapTable: {
                  shareholders: postSeedShareholders,
                  totalShares: totalSharesPreSeed,
                  totalValue: companyValue + investmentSize,
                  message: `After Convertible Note investment - 0 shares issued`,
                  summary: {
                    convertibleNotes: `${investorCount} investor(s)`,
                    totalInvestment: totalConfirmedInvestment,
                    availableInvestment: availableForInvestment,
                    note: "Convertible notes will convert at next priced equity round",
                  },
                },

                // Warrant Data
                warrantData: warrantData,

                // Calculations
                calculations: calculations,

                // Important notes
                notes: [
                  "⚠️ Convertible Notes do NOT issue shares in this round",
                  `📝 Notes will convert to equity at next priced round with ${calculations.discountRate}% discount OR ${valuationCap.toLocaleString()} valuation cap`,
                  `💰 Interest accrual: ${calculations.interestRate}% per annum`,
                  warrants.length > 0
                    ? `📜 ${warrants.length} warrant(s) issued - Will be exercisable at Series A`
                    : null,
                ].filter(Boolean),
              };

              // ✅ Use response variable instead of res
              return response.status(200).json({
                success: true,
                message: "Convertible Note round calculated successfully",
                round: round,
                capTable: capTableData,
              });
            },
          );
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

const fetchWarrants = (roundId, companyId) => {
  return new Promise((resolve, reject) => {
    db.query(
      `SELECT w.*, 
       CONCAT(COALESCE(ii.first_name,''), ' ', COALESCE(ii.last_name,'')) AS investor_name
       FROM warrants w
       LEFT JOIN investor_information ii ON w.investor_id = ii.id
       WHERE w.roundrecord_id=? AND w.company_id=? AND w.warrant_status != 'cancelled'`,
      [roundId, companyId],
      (err, warrantResults) => {
        if (err) {
          console.error("❌ Error fetching warrants from database:", err);
          reject(err);
        } else {
          console.log(
            `✅ Successfully fetched ${(warrantResults || []).length} warrants`,
          );
          resolve(warrantResults || []);
        }
      },
    );
  });
};

// ============================================
// STEP 2: Make the main function ASYNC
// ============================================
async function calculateInvestmentRoundCapTable(
  round,
  investors,
  roundZero,
  company_id,
) {
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
    console.error("❌ Error parsing Round 0 founder data:", error);
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
  console.log("📊 Processing round size:", round.roundsize);
  const investmentSize = toNumber(round.roundsize, 0);
  const preMoneyValuation = toNumber(round.pre_money, 0);
  const optionPoolPercent = toNumber(round.optionPoolPercent, 0);

  // ✅ STEP 3: FETCH WARRANTS - NOW WITH AWAIT
  let warrants = [];
  try {
    console.log(
      `🔍 Fetching warrants for round ID: ${round.id}, company ID: ${company_id}`,
    );
    warrants = await fetchWarrants(round.id, company_id);
    console.log(`📜 Warrants fetched successfully. Total: ${warrants.length}`);

    // Debug: Log first warrant if exists
    if (warrants.length > 0) {
      console.log("First warrant data:", warrants[0]);
    }
  } catch (error) {
    console.error(
      "❌ Warrant fetch error (will continue with empty warrants):",
      error,
    );
    warrants = [];
  }

  // Liquidation handling
  const liquidationText = "1x";

  // Retrieve liquidation multiple
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

  // ============================================
  // Calculations
  // ============================================
  const postMoneyValuation = investmentSize + preMoneyValuation;
  const investorOwnershipPercent = (investmentSize / postMoneyValuation) * 100;

  // Calculate option pool shares
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
  const sharePrice = newSharesIssued > 0 ? investmentSize / newSharesIssued : 0;

  console.log("💰 Calculations:");
  console.log(`   Post-Money Valuation: $${postMoneyValuation}`);
  console.log(`   New Shares Issued: ${newSharesIssued}`);
  console.log(`   Share Price: $${sharePrice.toFixed(8)}`);

  // ============================================
  // ✅ CALCULATE WARRANT SHARES (Now with actual data)
  // ============================================
  let warrantShares = 0;
  let warrantCoverageAmount = 0;
  let warrantCalculations = [];

  console.log(`\n📜 Processing ${warrants.length} warrants...`);

  if (warrants.length > 0) {
    warrants.forEach((warrant, index) => {
      console.log(`\n  Processing Warrant ${index + 1}:`);
      console.log(`    - ID: ${warrant.id}`);
      console.log(`    - Investor: ${warrant.investor_name || "Unknown"}`);

      const coveragePercent = toNumber(warrant.warrant_coverage_percentage, 0);
      const adjustmentPercent = toNumber(warrant.warrant_adjustment_percent, 0);
      const adjustmentDirection =
        warrant.warrant_adjustment_direction || "decrease";

      console.log(`    - Coverage: ${coveragePercent}%`);
      console.log(
        `    - Adjustment: ${adjustmentPercent}% ${adjustmentDirection}`,
      );

      // Calculate adjusted exercise price for next round
      let adjustedExercisePrice = sharePrice;

      if (adjustmentPercent > 0) {
        if (adjustmentDirection === "increase") {
          adjustedExercisePrice = sharePrice * (1 + adjustmentPercent / 100);
        } else {
          adjustedExercisePrice = sharePrice * (1 - adjustmentPercent / 100);
        }
      }

      // Calculate warrant shares based on coverage percentage
      const warrantShareCount = Math.round(
        (newSharesIssued * coveragePercent) / 100,
      );
      const warrantValue = warrantShareCount * adjustedExercisePrice;

      console.log(`    - Warrant Shares: ${warrantShareCount}`);
      console.log(`    - Base Price: $${sharePrice.toFixed(8)}`);
      console.log(`    - Adjusted Price: $${adjustedExercisePrice.toFixed(8)}`);
      console.log(`    - Warrant Value: $${warrantValue.toFixed(2)}`);

      warrantCalculations.push({
        warrantId: warrant.id || index + 1,
        investorName: warrant.investor_name || `Investor ${index + 1}`,
        coveragePercentage: coveragePercent,
        exerciseType: warrant.warrant_exercise_type || "next_round_adjusted",
        adjustmentPercent: adjustmentPercent,
        adjustmentDirection: adjustmentDirection,
        baseExercisePrice: sharePrice,
        adjustedExercisePrice: adjustedExercisePrice,
        warrantShares: warrantShareCount,
        warrantValue: warrantValue,
        status: warrant.warrant_status || "pending",
        expirationDate: warrant.expiration_date,
        notes: warrant.notes,
      });

      warrantShares += warrantShareCount;
      warrantCoverageAmount += warrantValue;
    });

    console.log(`\n✅ Warrant Summary:`);
    console.log(`   Total Warrant Shares: ${warrantShares}`);
    console.log(`   Total Warrant Value: $${warrantCoverageAmount.toFixed(2)}`);
  } else {
    console.log("   ℹ️ No warrants for this round");
  }

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

  // ✅ ADD WARRANT HOLDER AS SEPARATE ENTRY
  if (warrantShares > 0) {
    const warrantOwnership =
      totalSharesPostInvestment > 0
        ? (warrantShares / totalSharesPostInvestment) * 100
        : 0;

    postSeedShareholders.push({
      name: "Warrants (Pending Exercise)",
      fullName: "Warrants - To be Exercised in Next Priced Round",
      type: "Warrants",
      shares: 0, // No shares issued yet
      futureShares: warrantShares, // Shares that will be issued when exercised
      ownership: warrantOwnership,
      value: 0, // No value yet
      futureValue: warrantCoverageAmount,
      votingRights: "non-voting",
      newShares: 0,
      isWarrant: true,
      warrantCalculations: warrantCalculations,
      note: `Will be exercisable at next priced equity round. Total warrants: ${warrantShares} shares`,
    });
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

  // Create chart data including warrants
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
              : s.type === "Investor"
                ? "hsl(220,70%,50%)"
                : s.type === "Warrants"
                  ? "hsl(300,70%,50%)" // Purple for warrants
                  : s.type === "Available"
                    ? "hsl(0,70%,50%)"
                    : "hsl(180,70%,50%)",
        ),
      },
    ],
  };

  console.log("\n✅ Cap table calculation completed successfully!");

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
      // ✅ Warrant calculations - NOW POPULATED!
      warrants: warrantCalculations,
      totalWarrantShares: warrantShares,
      totalWarrantValue: warrantCoverageAmount,
      hasWarrants: warrants.length > 0,
    },
    isRoundZero: false,
  };
}

// Safe Round

function handleSAFESeriesRoundCalculation(round, company_id, res) {
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

      // ✅ Step 1: Get ALL previous rounds to find SAFE round
      db.query(
        `SELECT * FROM roundrecord WHERE company_id=? AND instrumentType='Safe' AND id < ? ORDER BY id ASC`,
        [company_id, round.id],
        (err, allRounds) => {
          if (err)
            return res
              .status(500)
              .json({ success: false, message: "Database error" });

          let seedInvestment = 0;
          let valuationCap = 0;
          let discountRate = 0;
          let existingOptionPoolPercent = 0;
          let employeeSharesSeedRound = 0;

          // ✅ Find SAFE round in all previous rounds
          allRounds.forEach((prevRound) => {
            if (
              (prevRound.instrumentType === "Safe" &&
                prevRound.shareClassType === "Seed") ||
              prevRound.shareClassType === "Pre-Seed" ||
              prevRound.shareClassType === "Post-Seed"
            ) {
              try {
                const safeData =
                  safeJSONParseRepeated(prevRound.instrument_type_data, 3) ||
                  {};
                seedInvestment = toNumber(prevRound.roundsize, 0);
                valuationCap = toNumber(safeData.valuationCap, 0);
                discountRate = toNumber(safeData.discountRate, 0);
                existingOptionPoolPercent = toNumber(
                  prevRound.optionPoolPercent,
                  0,
                );
              } catch (e) {
                console.log("Error parsing SAFE data:", e);
              }
            }
          });

          // ✅ CURRENT ROUND DATA (Series A) - Dynamic from current form
          const seriesAInvestment = toNumber(round.roundsize, 0);
          const preMoneyValuation = toNumber(round.pre_money, 0);
          const targetOptionPoolPercent = toNumber(
            round.optionPoolPercent_post,
            0,
          );

          // ✅ Parse Round 0 Founder Data
          let roundZeroTotalShares = 0;
          let roundZeroFounders = [];

          try {
            if (roundZero.founder_data) {
              const founderData = safeJSONParseRepeated(
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

          // ✅ Check if this is a Series A round
          const isSeriesA =
            round.shareClassType?.includes("Series") ||
            round.nameOfRound?.includes("Series") ||
            round.instrumentType === "Common Stock";

          // ✅ STEP 1: CALCULATE EMPLOYEE SHARES FROM SEED ROUND
          if (existingOptionPoolPercent > 0 && roundZeroTotalShares > 0) {
            const totalSharesWithPool = Math.round(
              roundZeroTotalShares / (1 - existingOptionPoolPercent / 100),
            );
            employeeSharesSeedRound =
              totalSharesWithPool - roundZeroTotalShares;
            console.log(
              "Employee shares from seed round:",
              employeeSharesSeedRound,
            );
          }

          // ✅ STEP 2: CALCULATE SHARE PRICE
          const totalPreSeriesAShares =
            roundZeroTotalShares + employeeSharesSeedRound;
          const sharePrice =
            totalPreSeriesAShares > 0
              ? preMoneyValuation / totalPreSeriesAShares
              : 0;

          // ✅ STEP 3: SAFE CONVERSION CALCULATIONS - CRITICAL FIX
          let seedDiscountPrice = 0;
          let seedCapPrice = 0;
          let seedOptimalPrice = 0;
          let seedConversionShares = 0;
          let seedConversionValue = 0;
          let seedMOIC = "0X";

          if (
            isSeriesA &&
            seedInvestment > 0 &&
            totalPreSeriesAShares > 0 &&
            sharePrice > 0
          ) {
            // FIXED: Calculate discount price properly
            seedDiscountPrice = sharePrice * (1 - discountRate / 100);

            // FIXED: Use roundZeroTotalShares (not totalPreSeriesAShares) for cap price
            // According to requirements: cap from last round / total number of shares from last round
            seedCapPrice =
              valuationCap > 0 ? valuationCap / roundZeroTotalShares : 0;

            // FIXED: Choose the lower price (more favorable for investors)
            seedOptimalPrice = Math.min(
              seedDiscountPrice > 0 ? seedDiscountPrice : Infinity,
              seedCapPrice > 0 ? seedCapPrice : Infinity,
            );

            // If both are 0, use share price
            if (seedOptimalPrice === Infinity || seedOptimalPrice === 0) {
              seedOptimalPrice = sharePrice;
            }

            if (seedOptimalPrice > 0) {
              seedConversionShares = Math.round(
                seedInvestment / seedOptimalPrice,
              );
              seedConversionValue = seedConversionShares * sharePrice;
              seedMOIC =
                (seedConversionValue / seedInvestment).toFixed(2) + "X";
            }
          }

          // ✅ Series A Investor Shares
          const seriesAShares =
            sharePrice > 0 ? Math.round(seriesAInvestment / sharePrice) : 0;
          const seriesAValue = seriesAShares * sharePrice;
          const seriesAMOIC =
            sharePrice > 0
              ? (seriesAValue / seriesAInvestment).toFixed(2) + "X"
              : "0X";

          // ✅ STEP 4: CALCULATE OPTION POOL FOR SERIES A - FIXED
          let newOptionShares = 0;
          let totalPostShares = 0;
          let finalPostMoneyValuation = 0;

          // According to requirements:
          // Total shares excluding option shares = seedConversionShares + seriesAShares + roundZeroTotalShares
          // Total shares after pool = totalSharesExcludingOption / (1 - targetOptionPoolPercent)
          if (isSeriesA && targetOptionPoolPercent > 0) {
            const totalSharesExcludingOption =
              roundZeroTotalShares + seedConversionShares + seriesAShares;

            if (totalSharesExcludingOption > 0) {
              totalPostShares = Math.round(
                totalSharesExcludingOption /
                  (1 - targetOptionPoolPercent / 100),
              );

              // FIXED: New option shares = totalPostShares - totalSharesExcludingOption - existingEmployeeShares
              newOptionShares = Math.max(
                0,
                totalPostShares -
                  totalSharesExcludingOption -
                  employeeSharesSeedRound,
              );
              finalPostMoneyValuation = totalPostShares * sharePrice;

              console.log("Option pool results:", {
                totalPostShares,
                newOptionShares,
                employeeSharesSeedRound,
                finalPostMoneyValuation,
              });
            }
          } else {
            totalPostShares =
              roundZeroTotalShares +
              employeeSharesSeedRound +
              seedConversionShares +
              seriesAShares;
            finalPostMoneyValuation = totalPostShares * sharePrice;
          }

          // ============================================
          // CAP TABLE CALCULATIONS - FIXED!
          // ============================================

          // ✅ PRE-SERIES A CAP TABLE (with PRE-Series A ownership)
          let preSeriesAShareholders = [];

          if (roundZeroFounders && roundZeroFounders.length > 0) {
            roundZeroFounders.forEach((founder, index) => {
              const shares = toNumber(founder.shares, 0);
              const ownership =
                totalPreSeriesAShares > 0
                  ? (shares / totalPreSeriesAShares) * 100
                  : 0;
              const value = (ownership / 100) * preMoneyValuation;

              preSeriesAShareholders.push({
                name: `${founder.firstName || ""} ${
                  founder.lastName || ""
                }`.trim(),
                fullName: `${founder.firstName || ""} ${
                  founder.lastName || ""
                }`.trim(),
                type: "Founder",
                shares: shares,
                ownership: ownership.toFixed(1), // 45%, 27%, 18% etc.
                value: Math.round(value),
                newShares: 0,
              });
            });
          }

          if (employeeSharesSeedRound > 0) {
            const ownership =
              totalPreSeriesAShares > 0
                ? (employeeSharesSeedRound / totalPreSeriesAShares) * 100
                : 0;
            const value = (ownership / 100) * preMoneyValuation;

            preSeriesAShareholders.push({
              name: "Employee Option Pool",
              fullName: "Employee Option Pool",
              type: "Options Pool",
              shares: employeeSharesSeedRound,
              ownership: ownership.toFixed(1), // 10%
              value: Math.round(value),
              newShares: employeeSharesSeedRound,
              note: `Existing ${existingOptionPoolPercent}% pool`,
            });
          }

          // ✅ POST-SERIES A CAP TABLE - FIXED: RECALCULATE ALL OWNERSHIP!
          let postSeriesAShareholders = [];

          // 1. Founders - RECALCULATE with POST-Series A totals
          if (roundZeroFounders && roundZeroFounders.length > 0) {
            roundZeroFounders.forEach((founder, index) => {
              const shares = toNumber(founder.shares, 0);
              const ownership =
                totalPostShares > 0 ? (shares / totalPostShares) * 100 : 0;
              const value = (ownership / 100) * finalPostMoneyValuation;

              postSeriesAShareholders.push({
                name: `${founder.firstName || ""} ${
                  founder.lastName || ""
                }`.trim(),
                fullName: `${founder.firstName || ""} ${
                  founder.lastName || ""
                }`.trim(),
                type: "Founder",
                shares: shares, // Total shares
                commonShares: shares, // ✅ NEW: Existing shares
                newShares: 0, // ✅ NEW: New shares issued
                totalShares: shares, // ✅ NEW: common + new
                ownership: ownership.toFixed(1),
                value: Math.round(value),
              });
            });
          }

          // 2. Seed Investors (Converted SAFE)
          if (seedConversionShares > 0) {
            const ownership =
              totalPostShares > 0
                ? (seedConversionShares / totalPostShares) * 100
                : 0;
            const value = (ownership / 100) * finalPostMoneyValuation;

            postSeriesAShareholders.push({
              name: "Seed Investors (SAFE)",
              fullName: "Seed Investors (SAFE)",
              type: "SAFE Investor",
              shares: seedConversionShares, // Total shares
              commonShares: 0, // ✅ NEW: No existing shares
              newShares: seedConversionShares, // ✅ NEW: All are new shares
              totalShares: seedConversionShares, // ✅ NEW: common + new
              ownership: ownership.toFixed(1),
              value: Math.round(value),
              investmentAmount: seedInvestment,
              conversionPrice: seedOptimalPrice,
              moic: seedMOIC,
              isSAFE: true,
              note:
                discountRate > 0
                  ? `Converted at $${seedOptimalPrice.toFixed(
                      2,
                    )} per share (${discountRate}% discount)`
                  : `Converted at $${seedOptimalPrice.toFixed(2)} per share`,
            });
          }

          // 3. Series A Investors
          if (seriesAShares > 0) {
            const ownership =
              totalPostShares > 0 ? (seriesAShares / totalPostShares) * 100 : 0;
            const value = (ownership / 100) * finalPostMoneyValuation;

            postSeriesAShareholders.push({
              name: "Series A Investors",
              fullName: "Series A Investors",
              type: "Series A Investor",
              shares: seriesAShares, // Total shares
              commonShares: 0, // ✅ NEW: No existing shares
              newShares: seriesAShares, // ✅ NEW: All are new shares
              totalShares: seriesAShares, // ✅ NEW: common + new
              ownership: ownership.toFixed(1),
              value: Math.round(value),
              investmentAmount: seriesAInvestment,
              moic: seriesAMOIC,
              note: `Purchased at $${sharePrice.toFixed(2)} per share`,
            });
          }

          // 4. SINGLE Employee Option Pool Row (Combined existing + top-up)
          if (employeeSharesSeedRound > 0 || newOptionShares > 0) {
            const totalEmployeeOptionShares =
              employeeSharesSeedRound + newOptionShares;
            const ownership =
              totalPostShares > 0
                ? (totalEmployeeOptionShares / totalPostShares) * 100
                : 0;
            const value = (ownership / 100) * finalPostMoneyValuation;

            // Create note showing the combined pool
            let note = "";
            let newSharesText = "";

            if (employeeSharesSeedRound > 0 && newOptionShares > 0) {
              note = ``;
              newSharesText = `+${newOptionShares.toLocaleString()} new`;
            } else if (employeeSharesSeedRound > 0) {
              note = `Existing ${existingOptionPoolPercent}% pool`;
              newSharesText = `+${employeeSharesSeedRound.toLocaleString()} new`;
            } else if (newOptionShares > 0) {
              note = ``;
              newSharesText = `+${newOptionShares.toLocaleString()} new`;
            }

            postSeriesAShareholders.push({
              name: "Employee Option Pool",
              fullName: "Employee Option Pool",
              type: "Options Pool",
              shares: totalEmployeeOptionShares, // Total shares
              commonShares: employeeSharesSeedRound, // ✅ NEW: Existing option pool shares
              newShares: newOptionShares, // ✅ NEW: New option pool shares
              totalShares: totalEmployeeOptionShares, // ✅ NEW: common + new
              ownership: ownership.toFixed(1),
              value: Math.round(value),
              note: note,
              displayText: newSharesText,
              breakdown: {
                existingShares: employeeSharesSeedRound,
                newShares: newOptionShares,
                totalShares: totalEmployeeOptionShares,
              },
            });
          }

          // ✅ NEW: Calculate TOTALS for all columns
          let totalCommonShares = 0;
          let totalNewShares = 0;
          let totalAllShares = 0;
          let totalValue = 0;

          postSeriesAShareholders.forEach((shareholder) => {
            totalCommonShares += shareholder.commonShares || 0;
            totalNewShares += shareholder.newShares || 0;
            totalAllShares += shareholder.totalShares || 0;
            totalValue += shareholder.value || 0;
          });

          // ✅ NEW: Add TOTALS row
          postSeriesAShareholders.push({
            name: "TOTAL",
            type: "Total",
            shares: totalAllShares,
            commonShares: totalCommonShares,
            newShares: totalNewShares,
            totalShares: totalAllShares,
            ownership: "100%",
            value: Math.round(totalValue),
            isTotal: true,
          });
          // ============================================
          // VERIFY TOTALS
          // ============================================

          let totalPostSharesFromArray = 0;
          postSeriesAShareholders.forEach((sh) => {
            totalPostSharesFromArray += sh.shares;
          });

          // ============================================
          // RESPONSE DATA - FIXED STRUCTURE
          // ============================================

          const responseData = {
            // Basic info
            shareClassType: round.shareClassType,
            roundType: round.nameOfRound,
            round_type: round.round_type,
            instrumentType: round.instrumentType,
            currency: round.currency,
            isSeriesA: isSeriesA,
            isSAFERound: false,
            hasSAFEConversion: seedInvestment > 0,

            // Inputs summary
            inputs: {
              seedInvestment: seedInvestment,
              valuationCap: valuationCap,
              discountRate: discountRate,
              seriesAInvestment: seriesAInvestment,
              preMoneyValuation: preMoneyValuation,
              targetOptionPoolPercent: targetOptionPoolPercent,
              existingOptionPoolPercent: existingOptionPoolPercent,
              roundZeroShares: roundZeroTotalShares,
              founderCount: roundZeroFounders.length,
            },

            // Pre-investment cap table
            preSeedCapTable: {
              shareholders: preSeriesAShareholders,
              totalShares: totalPreSeriesAShares,
              totalValue: preMoneyValuation,
              message: `Before Series A investment ${
                existingOptionPoolPercent > 0
                  ? `(with ${existingOptionPoolPercent}% option pool)`
                  : ""
              }`,
            },

            // Post-investment cap table
            postSeedCapTable: {
              shareholders: postSeriesAShareholders,
              totalShares: totalPostShares,
              totalValue: finalPostMoneyValuation,
              safeInvestment: seedInvestment,
              postMoneyValuation: finalPostMoneyValuation,
              message: `After Series A investment of ${seriesAInvestment.toLocaleString()} ${
                round.currency || "USD"
              } ${seedInvestment > 0 ? "with SAFE conversion" : ""}`,
            },

            // Calculations
            calculations: {
              // Inputs
              seedInvestment: seedInvestment,
              valuationCap: valuationCap,
              discountRate: discountRate,
              seriesAInvestment: seriesAInvestment,
              preMoneyValuation: preMoneyValuation,
              targetOptionPoolPercent: targetOptionPoolPercent,
              existingOptionPoolPercent: existingOptionPoolPercent,

              // Share Prices
              sharePrice: sharePrice,
              seriesASharePrice: sharePrice,
              seedDiscountPrice: seedDiscountPrice,
              seedCapPrice: seedCapPrice,
              seedOptimalPrice: seedOptimalPrice,

              // Shares
              seedConversionShares: seedConversionShares,
              seriesAShares: seriesAShares,
              employeeSharesSeedRound: employeeSharesSeedRound,
              newOptionShares: newOptionShares,
              totalNewShares:
                seedConversionShares + seriesAShares + newOptionShares,

              // Values
              seedConversionValue: seedConversionValue,
              seriesAValue: seriesAValue,
              finalPostMoneyValuation: finalPostMoneyValuation,

              // MOIC
              seedMOIC: seedMOIC,
              seriesAMOIC: seriesAMOIC,

              // Totals
              roundZeroTotalShares: roundZeroTotalShares,
              totalSharesPreSeed: totalPreSeriesAShares,
              totalSharesPostSeed: totalPostShares,
            },

            message: `Series A round calculated successfully`,
          };

          console.log(responseData);

          return res.status(200).json({
            success: true,
            message: "Cap table data retrieved successfully",
            round: round,
            capTable: responseData,
          });
        },
      );
    },
  );
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
      const companyValue = toNumber(round.pre_money, 0);
      const valuationCap = toNumber(safeData.valuationCap, 0);
      const discountRate = toNumber(safeData.discountRate, 0) / 100;
      const optionPoolPercent = toNumber(round.optionPoolPercent, 0) / 100;

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

      // Calculate Employee shares
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

          // ✅ Get Warrants for this round
          db.query(
            `SELECT w.*, 
             CONCAT(COALESCE(ii.first_name,''), ' ', COALESCE(ii.last_name,'')) AS investorName
             FROM warrants w
             LEFT JOIN investor_information ii ON w.investor_id = ii.id
             WHERE w.roundrecord_id=? AND w.company_id=? AND w.warrant_status != 'cancelled'`,
            [round.id, company_id],
            (err, warrants) => {
              if (err) {
                console.error("Error fetching warrants:", err);
                warrants = [];
              }

              // Calculate total SAFE investment
              let totalSafeInvestment = 0;
              if (investors && investors.length > 0) {
                investors.forEach((investor) => {
                  totalSafeInvestment += toNumber(
                    investor.investment_amount,
                    0,
                  );
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
                      newShares: 0,
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
                  newShares: employeeShares,
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
                  newShares: 0,
                });
              }

              // ✅ Add SAFE investors (0 shares - not converted yet)
              if (investors && investors.length > 0) {
                investors.forEach((investor, index) => {
                  const investmentAmount = toNumber(
                    investor.investment_amount,
                    0,
                  );

                  // Check if this investor has warrants
                  const investorWarrants = warrants.filter(
                    (w) => w.investor_id === investor.investor_id,
                  );
                  const hasWarrant = investorWarrants.length > 0;

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
                    investorId: investor.investor_id,
                    shares: 0,
                    ownership: 0,
                    value: 0,
                    investmentAmount: investmentAmount,
                    newShares: 0,
                    isSAFE: true,
                    hasWarrant: hasWarrant,
                    note:
                      `$${investmentAmount.toLocaleString()} SAFE investment - Will convert at next priced round` +
                      (hasWarrant ? " + Has warrant" : ""),
                  });
                });
              }

              // ✅ RESPONSE with Pre-Seed and Post-Seed tables INCLUDING WARRANT DATA
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
                  totalShares: totalSharesPreSeed,
                  totalValue: companyValue,
                  shareholders: postSeedShareholders,
                  message:
                    "✅ After SAFE investment - Notes have NOT converted yet",
                  safeInvestment: effectiveInvestment,
                  safeInvestorCount: investors ? investors.length : 0,
                },

                // ✅ WARRANT DATA
                warrantData: {
                  hasWarrants: warrants.length > 0,
                  totalWarrants: warrants.length,
                  warrants: warrants.map((w) => ({
                    id: w.id,
                    investor_id: w.investor_id,
                    investorName: w.investorName || `Investor ${w.investor_id}`,
                    warrant_coverage_percentage: w.warrant_coverage_percentage,
                    warrant_exercise_type: w.warrant_exercise_type,
                    warrant_adjustment_percent: w.warrant_adjustment_percent,
                    warrant_adjustment_direction:
                      w.warrant_adjustment_direction,
                    warrant_status: w.warrant_status,
                    issued_date: w.issued_date,
                    expiration_date: w.expiration_date,
                    notes: w.notes,
                    will_exercise: "Next Priced Equity Round (Series A)",
                  })),
                  note:
                    warrants.length > 0
                      ? `📜 ${warrants.length} warrant(s) issued in this round. These will be exercisable at the next priced equity round (Series A) based on Series A price with adjustments.`
                      : null,
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
                  totalSharesPostSeed: totalSharesPreSeed,
                  totalSafeInvestment: effectiveInvestment,
                  investorCount: investors ? investors.length : 0,
                  warrantCount: warrants.length,
                  preMoney: companyValue,
                  postMoney: companyValue + effectiveInvestment,
                },

                // Conversion information
                conversionInfo: {
                  note: "⚠️ SAFE notes will convert at next priced equity round",
                  conversionTrigger: "Next priced equity financing",
                  valuationCap: valuationCap,
                  discountRate: discountRate * 100,
                  hasWarrants: warrants.length > 0,
                  warrantNote:
                    warrants.length > 0
                      ? `Warrants will be exercisable at Series A round price with adjustments`
                      : null,
                },

                isSAFERound: true,
                hasPrePostTables: true,
                hasWarrants: warrants.length > 0,
                message:
                  `SAFE Round - Conversion will happen at next priced equity round` +
                  (warrants.length > 0
                    ? `, ${warrants.length} warrant(s) issued`
                    : ""),
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

      console.log("📊 Found Rounds:");
      console.log(`   Round 0: ${round0 ? "Yes" : "No"}`);
      console.log(`   Seed Round: ${seedRound ? seedRound.nameOfRound : "No"}`);
      console.log(
        `   Series Round: ${
          latestSeriesRound ? latestSeriesRound.nameOfRound : "No"
        }`,
      );

      // 1. Get Round 0 (Founder) data
      let round0FounderShares = 0;
      let round0TotalShares = 0;

      if (round0) {
        round0TotalShares = parseInt(round0.issuedshares) || 0;
        previousRoundData.roundZeroTotalShares = round0TotalShares;

        // DEBUG: Log the founder_data structure
        console.log(
          "🔍 Round 0 founder_data structure:",
          typeof round0.founder_data,
        );
        console.log(
          "🔍 Round 0 founder_data raw:",
          round0.founder_data?.substring(0, 200),
        );

        if (round0.founder_data) {
          try {
            const founderData =
              typeof round0.founder_data === "string"
                ? JSON.parse(round0.founder_data)
                : round0.founder_data;

            console.log(
              "🔍 Parsed Founder Data:",
              JSON.stringify(founderData, null, 2),
            );

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

        console.log(`✅ Round 0: ${round0TotalShares} total shares`);
        console.log(`✅ Round 0 Founder Shares: ${round0FounderShares}`);
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

          console.log(
            `🔢 CALCULATION: ${round0FounderShares} ÷ (1 - ${seedPreMoneyPool}%) = ${totalSharesAfterSeedPool}`,
          );
          console.log(
            `✅ Total Shares (with ${seedPreMoneyPool}% Seed option pool): ${totalSharesAfterSeedPool}`,
          );
          console.log(`✅ Founder Shares: ${round0FounderShares}`);
          console.log(
            `✅ Employee Shares Created in Seed: ${employeeSharesCreatedInSeed}`,
          );
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

        console.log(`✅ Seed Round: ${seedRound.nameOfRound}`);
        console.log(`✅ Investment: ${previousRoundData}`);
        console.log(`✅ Option Pool: ${existingOptionPoolPercent}%`);
        console.log(`✅ Valuation Cap: ${previousRoundData.valuationCap}`);
        console.log(`✅ Discount Rate: ${previousRoundData.discountRate}%`);

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
        console.log(
          `✅ Using default option pool: ${existingOptionPoolPercent}%`,
        );
      }

      // FINAL VALIDATION: If totalShares is still Round 0 value, recalculate
      if (previousRoundData.totalShares === round0TotalShares && seedRound) {
        console.log("⚠️ WARNING: totalShares still equals round0TotalShares!");
        console.log("   Recalculating with seed option pool...");

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

          console.log(`   Recalculated total shares: ${recalculatedTotal}`);
        }
      }

      console.log("📊 FINAL Previous Round Data:");
      console.log("   totalShares:", previousRoundData.totalShares);
      console.log("   founderShares:", previousRoundData.founderShares);
      console.log("   employeeShares:", previousRoundData.employeeShares);
      console.log(
        "   totalSharesPreSeed:",
        previousRoundData.totalSharesPreSeed,
      );
      console.log(
        "   roundZeroTotalShares:",
        previousRoundData.roundZeroTotalShares,
      );
      console.log(
        "   employeeSharesSeedRound:",
        previousRoundData.employeeSharesSeedRound,
      );

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
      console.log("🔍 Getting existing shares for Preferred Equity round...");

      // Function to get existing shares from database
      const getExistingSharesForPreferredEquity = (
        previousRound,
        company_id,
        callback,
      ) => {
        // Step 1: Check executive_summary first (most accurate)
        if (previousRound.executive_summary) {
          try {
            const summary = JSON.parse(previousRound.executive_summary);
            console.log("📊 Found executive_summary");

            if (summary.calculations) {
              const calc = summary.calculations;

              const existingShares =
                calc.totalSharesAfterPool || calc.totalShares || 0;

              const existingOptionPoolPercent = calc.optionPoolPercent || 0;

              if (existingShares > 0) {
                console.log(
                  `✅ From executive_summary: ${existingShares} shares, ${existingOptionPoolPercent}% pool`,
                );

                return callback(null, {
                  existingOptionPoolPercent: existingOptionPoolPercent,
                  existingShares: Math.round(existingShares),
                  previousRoundName: previousRound.nameOfRound,
                  instrumentType: previousRound.instrumentType,
                  shareClassType: previousRound.shareClassType,
                  calculationMethod: "from_executive_summary",
                  note: "Data from saved calculation",
                });
              }
            }
          } catch (e) {
            console.error("Error parsing executive_summary:", e);
          }
        }

        // Step 2: If no executive_summary, use issuedshares
        const issuedShares = parseFloat(previousRound.issuedshares) || 0;
        const optionPoolPercent =
          parseFloat(previousRound.optionPoolPercent_post) ||
          parseFloat(previousRound.optionPoolPercent) ||
          0;

        if (issuedShares > 0) {
          console.log(`✅ From issuedshares field: ${issuedShares} shares`);

          return callback(null, {
            existingOptionPoolPercent: optionPoolPercent,
            existingShares: Math.round(issuedShares),
            previousRoundName: previousRound.nameOfRound,
            instrumentType: previousRound.instrumentType,
            shareClassType: previousRound.shareClassType,
            calculationMethod: "from_issuedshares",
            note: "Using issuedshares field from database",
          });
        }

        // Step 3: If issuedshares is 0 or not available, check if we can calculate
        console.log(
          "⚠️ No existing shares data found, attempting calculation...",
        );

        // Get Round 0 for base
        const roundZeroQuery = `SELECT * FROM roundrecord WHERE company_id = ? AND round_type = 'Round 0'`;
        db.query(roundZeroQuery, [company_id], (err, roundZeroResults) => {
          if (err) {
            console.error("Error fetching Round 0:", err);
            return callback(err, null);
          }

          if (roundZeroResults.length === 0) {
            return callback(new Error("Round 0 not found"), null);
          }

          const roundZero = roundZeroResults[0];
          let founderShares = 0;

          try {
            if (roundZero.founder_data) {
              const founderData =
                typeof roundZero.founder_data === "string"
                  ? JSON.parse(roundZero.founder_data)
                  : roundZero.founder_data;
              founderShares = parseInt(founderData.totalShares) || 100000;
            } else {
              founderShares = parseInt(roundZero.issuedshares) || 100000;
            }
          } catch (parseErr) {
            founderShares = 100000;
          }

          console.log(`📍 Base founder shares: ${founderShares}`);

          // Simple calculation: founder shares as minimum
          const estimatedShares = founderShares;

          return callback(null, {
            existingOptionPoolPercent: optionPoolPercent,
            existingShares: Math.round(estimatedShares),
            previousRoundName: previousRound.nameOfRound,
            instrumentType: previousRound.instrumentType,
            shareClassType: previousRound.shareClassType,
            calculationMethod: "estimated_from_round0",
            note: "Estimated from Round 0 founder shares",
          });
        });
      };

      // Execute
      getExistingSharesForPreferredEquity(
        previousRound,
        company_id,
        (err, data) => {
          if (err) {
            console.error("Error getting existing shares:", err);

            // Final fallback
            return res.status(200).json({
              success: true,
              data: {
                existingOptionPoolPercent: 0,
                existingShares: 0,
                previousRoundName: previousRound.nameOfRound,
                instrumentType: previousRound.instrumentType,
                shareClassType: previousRound.shareClassType,
                note: "Could not retrieve existing shares",
              },
            });
          }

          console.log(`✅ Returning existing shares: ${data.existingShares}`);

          res.status(200).json({
            success: true,
            data: data,
          });
        },
      );
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
        const optionPoolPercent =
          parseFloat(seedRound.optionPoolPercent_post) || 0;
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
