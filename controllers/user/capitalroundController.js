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
      filetype
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
    }
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
            (date) => date && date.trim() !== "" && date !== "null"
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
            investorPostMoney=?,optionPoolPercent =?, pre_money = ?, post_money = ?, company_id = ?, roundStatus = ?, instrument_type_data = ?, created_by_id = ?, created_by_role = ?, 
            dateroundclosed = ?, nameOfRound = ?, shareClassType = ?, shareclassother = ?, description = ?, 
            instrumentType = ?, customInstrument = ?, roundsize = ?, currency = ?, issuedshares = ?, rights = ?, 
            liquidationpreferences = ?, liquidation = ?, liquidationOther = ?, convertible = ?, convertibleType = ?, 
            voting = ?, generalnotes = ?, updated_by_id = ?, updated_by_role = ?, round_type = ?, founder_data = ?, 
            total_founder_shares = ?, founder_count = ?`;

          const values = [
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
                  f
                )
              );
            }
            for (const f of finalSubscriptionDocs) {
              allFileText += await extractFileText(
                path.join(
                  "upload",
                  "docs",
                  `doc_${company_id}`,
                  "companyRound",
                  f
                )
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
        }
      );
    }

    // ---------------- INSERT ----------------
    else {
      const sql = `INSERT INTO roundrecord (investorPostMoney,optionPoolPercent,pre_money,post_money,company_id,created_by_id,created_by_role,updated_by_id,updated_by_role,round_type, nameOfRound, shareClassType, shareclassother,description,instrumentType,instrument_type_data,customInstrument,roundsize,currency,issuedshares, rights, liquidationpreferences,liquidation,liquidationOther,convertible, convertibleType, voting, termsheetFile, subscriptiondocument, 
      generalnotes, dateroundclosed, roundStatus, is_shared, is_locked, created_at, founder_data, total_founder_shares, founder_count)
      VALUES (?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      let processedDateRoundClosed = dateroundclosed;
      if (Array.isArray(processedDateRoundClosed)) {
        processedDateRoundClosed =
          processedDateRoundClosed.find((x) => x.trim() !== "") || null;
      }

      const parsedFounderCount = founder_count ? parseInt(founder_count) : null;
      const parsedTotalFounderShares = total_founder_shares
        ? parseInt(total_founder_shares)
        : null;

      const values = [
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

        // >>> AI EXECUTIVE SUMMARY START <<<
        let allFileText = "";

        for (const f of newTermsheetFiles) {
          allFileText += await extractFileText(
            path.join("upload", "docs", `doc_${company_id}`, "companyRound", f)
          );
        }
        for (const f of newSubscriptionDocs) {
          allFileText += await extractFileText(
            path.join("upload", "docs", `doc_${company_id}`, "companyRound", f)
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
    }
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
          [investor_id]
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
            [company_id, investor_id, roundrecord_id]
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
            ]
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
          "https://blueprintcatalyst.com/investor/company/capital-round-list/" +
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
                  <img src="https://blueprintcatalyst.com/api/upload/images/logo.png" alt="logo" style="width:130px;" />
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
                                  record.roundsize
                                ).toLocaleString("en-US")}`
                              : Number(record.roundsize).toLocaleString(
                                  "en-US"
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
                              "en-US"
                            ) || "N/A"
                          }
                        </p>
                        <p style="margin:0 0 15px 0;font-size:14px;color:#111;">
                          You can view the full record details by clicking the button below:
                        </p>
                        <div style="padding:0 20px 20px 20px;">
                          <a href="${url}" style="
                            background:#ff3c3e;
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
          })
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
    }
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
  const { id, signature_authorize, reports, company_id, user_id } = req.body;
  if (!id || !signature_authorize) {
    return res
      .status(400)
      .json({ message: "Record ID and signature are required" });
  }
  var date = new Date();
  const query = `
    UPDATE sharerecordround
    SET signature_status = 'Yes', signature = ?,activity_date=NOW()
    WHERE id = ? AND signature_status != 'Yes'
  `;

  db.query(query, [signature_authorize, id], async (err, results) => {
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
      const companyEmail = companyRows[0].email;

      // Fetch investor name
      const [investorRows] = await db
        .promise()
        .query(
          "SELECT first_name, last_name FROM investor_information WHERE id = ?",
          [user_id]
        );

      if (investorRows.length === 0) throw new Error("Investor not found");

      const investorName = `${investorRows[0].first_name} ${investorRows[0].last_name}`;

      // Compose message
      const reportUrl = "https://blueprintcatalyst.com/crm/investorreport";

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
                    <a href="${reportUrl}" style="background:#ff3c3e;color:#fff;text-decoration:none;font-size:14px;padding:10px 30px;border-radius:10px;display:inline-block;">View Report</a>
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
    } catch (emailErr) {
      console.error("Error sending email:", emailErr);
    }

    res.status(200).json({
      message: "Signature authorized successfully and email sent",
      updated: true,
      results: results,
    });
  });
};

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
      `inv_${userId}`
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
        }
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
      }
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
      }
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
    // Check if user already exists
    db.query(
      `SELECT sharereport.*,investor_updates.version,investor_updates.document_name,investor_updates.type,investor_updates.created_at as shared_date from sharereport join investor_updates on investor_updates.id = sharereport.investor_updates_id where sharereport.investor_id = ? And investor_updates.type =? order by sharereport.id Desc`,
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
      }
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
      }
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
        : `Founder ${idx + 1}`
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

      // Step 3: Check instrument type - SAFE requires different calculation
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

      // Step 4: For SAFE rounds, use different calculation
      if (instrumentType === "Safe") {
        return handleSAFERoundCalculation(round, company_id, res);
      }

      // ✅ STEP 4.1: FOR CONVERTIBLE NOTE ROUNDS, USE DIFFERENT CALCULATION
      if (instrumentType === "Convertible Note") {
        return handleConvertibleNoteRoundCalculation(
          round,
          company_id,
          instrumentData,
          res
        );
      }

      // Step 5: For regular investment rounds, get investors
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

          // Step 6: Get Round 0 data for calculations
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
                  message:
                    "Round 0 (Incorporation) data not found. Please create Round 0 first.",
                });
              }

              const roundZero = roundZeroData[0];
              const capTableData = calculateInvestmentRoundCapTable(
                round,
                investors,
                roundZero
              );

              return res.status(200).json({
                success: true,
                message: "Cap table data retrieved successfully",
                round,
                capTable: capTableData,
              });
            }
          );
        }
      );
    }
  );
};
function handleConvertibleNoteRoundCalculation(
  round,
  company_id,
  instrumentData,
  res
) {
  // Get Round 0 data for base shares
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

      // Parse Convertible Note specific data
      const investmentSize = toNumber(round.roundsize, 0);
      const valuationCap = toNumber(instrumentData.valuationCap_note, 0);
      const discountRate = toNumber(instrumentData.discountRate_note, 0) / 100;
      const interestRate = toNumber(instrumentData.interestRate_note, 0) / 100;
      const convertibleTrigger =
        instrumentData.convertibleTrigger || "QUALIFIED_FINANCING";
      const optionPoolPercent = toNumber(round.optionPoolPercent, 0) / 100;
      const preMoneyValuation = toNumber(round.pre_money, 0);
      const postMoneyValuation = toNumber(round.post_money, 0);

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

      // Calculate option pool shares
      const optionPoolShares = Math.round(
        (roundZeroTotalShares * optionPoolPercent) / (1 - optionPoolPercent)
      );

      const totalSharesPreSeed = roundZeroTotalShares + optionPoolShares;

      // Get investors for this Convertible Note round
      db.query(
        `SELECT ir.*, COALESCE(ii.first_name,'') AS first_name, COALESCE(ii.last_name,'') AS last_name, COALESCE(ii.email,'') AS email
         FROM investorrequest_company ir
         LEFT JOIN investor_information ii ON ir.investor_id = ii.id
         WHERE ir.roundrecord_id=? AND ir.company_id=? AND ir.request_confirm='Yes'`,
        [round.id, company_id],
        (err, investors) => {
          if (err) {
            return res.status(500).json({
              success: false,
              message: "Database error fetching investors",
              error: err,
            });
          }

          // DEBUG: Log investors data
          console.log("Investors found:", investors);
          console.log("Round investment size:", investmentSize);

          // Calculate total Convertible Note investment
          let totalConfirmedInvestment = 0;
          if (investors && investors.length > 0) {
            investors.forEach((investor) => {
              const invAmount = toNumber(investor.investment_amount, 0);
              totalConfirmedInvestment += invAmount;
              console.log(
                "Investor:",
                investor.first_name,
                "Amount:",
                invAmount
              );
            });
          }

          console.log("Total confirmed investment:", totalConfirmedInvestment);

          // ✅ FIXED: Calculate available for investment
          const availableForInvestment = Math.max(
            0,
            investmentSize - totalConfirmedInvestment
          );

          console.log("Available for investment:", availableForInvestment);

          // ===== PRE-SEED CAP TABLE =====
          let preSeedShareholders = [];

          // ADD FOUNDERS to Pre-Seed
          if (roundZeroFounders && roundZeroFounders.length > 0) {
            roundZeroFounders.forEach((founder, index) => {
              const shares = toNumber(founder.shares, 0);
              if (shares > 0) {
                const preSeedOwnership =
                  totalSharesPreSeed > 0
                    ? (shares / totalSharesPreSeed) * 100
                    : 0;
                const preSeedValue =
                  (preSeedOwnership / 100) * preMoneyValuation;

                preSeedShareholders.push({
                  name:
                    `${founder.firstName || ""} ${
                      founder.lastName || ""
                    }`.trim() || `Founder ${index + 1}`,
                  fullName:
                    founder.fullName || founder.name || `Founder ${index + 1}`,
                  firstName:
                    founder.firstName ||
                    (founder.name || "").split(" ")[0] ||
                    "",
                  lastName:
                    founder.lastName ||
                    (founder.name || "").split(" ")[1] ||
                    "",
                  email: founder.email || "-",
                  phone: founder.phone || "-",
                  type: "Founder",
                  shares: shares,
                  ownership: preSeedOwnership,
                  value: preSeedValue,
                  shareType: founder.shareType || "common",
                  votingRights:
                    founder.voting === "Yes" ? "voting" : "non-voting",
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
              name: "Employee Option Pool",
              fullName: "Employee Option Pool",
              type: "Options Pool",
              shares: optionPoolShares,
              ownership: employeePreSeedOwnership,
              value: employeePreSeedValue,
              votingRights: "non-voting",
            });
          }

          // ===== POST-SEED CAP TABLE =====
          let postSeedShareholders = [];

          // ADD FOUNDERS to Post-Seed (same shares, no change)
          if (roundZeroFounders && roundZeroFounders.length > 0) {
            roundZeroFounders.forEach((founder, index) => {
              const shares = toNumber(founder.shares, 0);
              if (shares > 0) {
                const postSeedOwnership =
                  totalSharesPreSeed > 0
                    ? (shares / totalSharesPreSeed) * 100
                    : 0;
                const postSeedValue =
                  (postSeedOwnership / 100) * postMoneyValuation;

                postSeedShareholders.push({
                  name:
                    `${founder.firstName || ""} ${
                      founder.lastName || ""
                    }`.trim() || `Founder ${index + 1}`,
                  fullName:
                    founder.fullName || founder.name || `Founder ${index + 1}`,
                  firstName:
                    founder.firstName ||
                    (founder.name || "").split(" ")[0] ||
                    "",
                  lastName:
                    founder.lastName ||
                    (founder.name || "").split(" ")[1] ||
                    "",
                  email: founder.email || "-",
                  phone: founder.phone || "-",
                  type: "Founder",
                  shares: shares,
                  ownership: postSeedOwnership,
                  value: postSeedValue,
                  shareType: founder.shareType || "common",
                  votingRights:
                    founder.voting === "Yes" ? "voting" : "non-voting",
                  newShares: 0,
                });
              }
            });
          }

          // Add employee pool to Post-Seed (same shares, no change)
          if (optionPoolShares > 0) {
            const employeePostSeedOwnership =
              totalSharesPreSeed > 0
                ? (optionPoolShares / totalSharesPreSeed) * 100
                : 0;
            const employeePostSeedValue =
              (employeePostSeedOwnership / 100) * postMoneyValuation;

            postSeedShareholders.push({
              name: "Employee Option Pool",
              fullName: "Employee Option Pool",
              type: "Options Pool",
              shares: optionPoolShares,
              ownership: employeePostSeedOwnership,
              value: employeePostSeedValue,
              votingRights: "non-voting",
              newShares: 0,
            });
          }

          // ✅ ADD CONVERTIBLE NOTE INVESTORS
          if (investors && investors.length > 0) {
            investors.forEach((investor, index) => {
              const investmentAmount = toNumber(investor.investment_amount, 0);

              postSeedShareholders.push({
                name:
                  `${investor.first_name || ""} ${
                    investor.last_name || ""
                  }`.trim() || `Investor ${index + 1}`,
                fullName:
                  `${investor.first_name || ""} ${
                    investor.last_name || ""
                  }`.trim() || `Investor ${index + 1}`,
                firstName: investor.first_name || "",
                lastName: investor.last_name || "",
                email: investor.email || "-",
                phone: "-",
                type: "Investor",
                shares: 0, // NO SHARES - Convertible Note
                ownership: 0, // 0% ownership
                value: 0,
                investmentAmount: investmentAmount,
                votingRights: "non-voting",
                newShares: 0,
                isConvertibleNote: true,
                convertibleNoteDetails: {
                  valuationCap: valuationCap,
                  discountRate: discountRate * 100,
                  interestRate: interestRate * 100,
                  convertibleTrigger: convertibleTrigger,
                  principalAmount: investmentAmount,
                  accruedInterest: investmentAmount * interestRate,
                  totalConversionAmount: investmentAmount * (1 + interestRate),
                  conversionNote:
                    "Shares will be issued at next qualified financing round",
                },
              });
            });
          }

          // ✅ FIXED: ADD "AVAILABLE FOR INVESTMENT" - PROPERLY CALCULATED
          // Show available investment if round is not fully subscribed
          if (availableForInvestment > 0) {
            // Calculate value for available investment
            const availableValue =
              (availableForInvestment / investmentSize) * postMoneyValuation;

            postSeedShareholders.push({
              name: "Available for Investment",
              fullName: "Available for Investment",
              type: "Available",
              shares: 0,
              ownership: 0,
              value: availableValue, // ✅ FIXED: Show actual value
              investmentAmount: availableForInvestment, // ✅ FIXED: Show actual available amount
              votingRights: "non-voting",
              newShares: 0,
              isGeneric: true,
              note: `Convertible Note round not fully subscribed - ${availableForInvestment} remaining for investment`,
              isConvertibleNote: true,
            });
          }

          // If no investors at all, show generic investor placeholder
          if ((!investors || investors.length === 0) && investmentSize > 0) {
            postSeedShareholders.push({
              name: "Convertible Note Investors",
              fullName: "Convertible Note Investors",
              type: "Investor",
              shares: 0,
              ownership: 0,
              value: 0,
              investmentAmount: 0,
              votingRights: "non-voting",
              newShares: 0,
              isConvertibleNote: true,
              isGeneric: true,
              convertibleNoteDetails: {
                valuationCap: valuationCap,
                discountRate: discountRate * 100,
                interestRate: interestRate * 100,
                convertibleTrigger: convertibleTrigger,
                principalAmount: 0,
                accruedInterest: 0,
                totalConversionAmount: 0,
                conversionNote:
                  "Shares will be issued at next qualified financing round",
              },
            });

            // Also add available investment when no investors
            const availableValue = investmentSize;
            postSeedShareholders.push({
              name: "Available for Investment",
              fullName: "Available for Investment",
              type: "Available",
              shares: 0,
              ownership: 0,
              value: availableValue, // ✅ FIXED: Show actual value
              investmentAmount: investmentSize, // ✅ FIXED: Show full round size
              votingRights: "non-voting",
              newShares: 0,
              isGeneric: true,
              note: `Full round available for convertible note investment`,
              isConvertibleNote: true,
            });
          }

          // Calculate totals for Convertible Note round
          const totalPostSeedShares = postSeedShareholders.reduce(
            (sum, s) => sum + toNumber(s.shares, 0),
            0
          );
          const totalPostSeedValue = postSeedShareholders.reduce(
            (sum, s) => sum + toNumber(s.value, 0),
            0
          );

          const chartData = {
            labels: postSeedShareholders.map((s) => s.name),
            datasets: [
              {
                label: "Current Ownership %",
                data: postSeedShareholders.map((s) =>
                  Number(toNumber(s.ownership, 0).toFixed(2))
                ),
                backgroundColor: postSeedShareholders.map(
                  (s) =>
                    s.type === "Founder"
                      ? "hsl(120,70%,50%)"
                      : s.type === "Options Pool"
                      ? "hsl(40,70%,50%)"
                      : s.type === "Available"
                      ? "hsl(0,70%,50%)" // Red for available
                      : "hsl(220,70%,50%)" // Investor color
                ),
              },
            ],
          };

          // Calculate proper ownership percentages
          const totalFoundersOwnership = preSeedShareholders
            .filter((sh) => sh.type === "Founder")
            .reduce((sum, sh) => sum + sh.ownership, 0);

          const totalEmployeeOwnership = preSeedShareholders
            .filter((sh) => sh.type === "Options Pool")
            .reduce((sum, sh) => sum + sh.ownership, 0);

          // Create calculations object
          const calculations = {
            investmentSize,
            preMoneyValuation,
            postMoneyValuation,
            optionPoolPercent: optionPoolPercent * 100,
            investorOwnershipPercent: 0, // 0% for convertible notes
            sharePrice:
              totalSharesPreSeed > 0
                ? preMoneyValuation / totalSharesPreSeed
                : 0,
            newShares: 0, // No new shares issued
            postInvestmentTotalShares: totalSharesPreSeed, // Same as pre-seed
            preSeedTotalShares: totalSharesPreSeed,
            optionPoolShares,
            roundZeroTotalShares,
            valuationCap,
            discountRate: discountRate * 100,
            interestRate: interestRate * 100,
            convertibleTrigger,
            totalNoteInvestment: totalConfirmedInvestment,
            availableForInvestment: availableForInvestment,
            investorCount: investors ? investors.length : 0,
            isConvertibleNoteRound: true,
            totalFoundersOwnership: totalFoundersOwnership,
            totalEmployeeOwnership: totalEmployeeOwnership,
          };

          const capTableData = {
            roundType: round.nameOfRound || "Convertible Note Round",
            round_type: round.round_type,
            instrumentType: round.instrumentType,
            currency: round.currency || "USD",
            totalShares: totalPostSeedShares,
            totalValue: totalPostSeedValue,
            shareholders: postSeedShareholders,
            preSeedShareholders: preSeedShareholders,
            chartData,
            calculations,
            isConvertibleNoteRound: true,
            message:
              investors && investors.length > 0
                ? `Convertible Note round with ${investors.length} investor(s) - ${totalConfirmedInvestment} committed (0 shares issued)`
                : `Convertible Note round - ${investmentSize} available for investment`,
          };

          // DEBUG: Final check
          console.log("Final cap table data:", {
            totalConfirmedInvestment,
            availableForInvestment,
            shareholders: postSeedShareholders.map((sh) => ({
              name: sh.name,
              investmentAmount: sh.investmentAmount,
              value: sh.value,
            })),
          });

          return res.status(200).json({
            success: true,
            message: "Convertible Note round data retrieved successfully",
            round,
            capTable: capTableData,
          });
        }
      );
    }
  );
}

// Helper function for currency formatting
// Helper function for currency formatting
function formatCurrencyy(amount, currency = "USD") {
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
            founderData.price_per_share || 0.001
          ) || 0.001;
      }

      // If founders array items contain numeric strings for shares, ensure they are numbers
      roundZeroFounders = (roundZeroFounders || []).map((f) => {
        const shares = toNumber(
          f.shares || f.shareCount || f.share_count || f.shares_count,
          0
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
            (1 - optionPoolPercent / 100)
        )
      : 0;

  const totalSharesPreSeed = roundZeroTotalShares + optionPoolShares;
  const totalSharesPostInvestment = Math.round(
    totalSharesPreSeed / (1 - investorOwnershipPercent / 100)
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
      name: "Employee Option Pool",
      fullName: "Employee Option Pool",
      type: "Options Pool",
      shares: optionPoolShares,
      ownership: employeePreSeedOwnership,
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
      name: "Employee Option Pool",
      fullName: "Employee Option Pool",
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
      investmentSize
    );
    const adjustedNewSharesIssued = Math.round(
      (effectiveInvestmentSize / investmentSize) * newSharesIssued
    );

    let remainingShares = adjustedNewSharesIssued;
    let allocated = 0;

    investors.forEach((investor, index) => {
      const investmentAmount = toNumber(investor.investment_amount, 0);

      // Calculate shares based on ACTUAL investment proportion
      let investorShares = Math.round(
        (investmentAmount / totalConfirmedInvestment) * adjustedNewSharesIssued
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
    0
  );
  const totalPostSeedValue = postSeedShareholders.reduce(
    (sum, s) => sum + toNumber(s.value, 0),
    0
  );

  const chartData = {
    labels: postSeedShareholders.map((s) => s.name),
    datasets: [
      {
        label: "Post-Investment Ownership %",
        data: postSeedShareholders.map((s) =>
          Number(toNumber(s.ownership, 0).toFixed(2))
        ),
        backgroundColor: postSeedShareholders.map((s) =>
          s.type === "Founder"
            ? "hsl(120,70%,50%)"
            : s.type === "Options Pool"
            ? "hsl(40,70%,50%)"
            : s.type === "Available"
            ? "hsl(0,70%,50%)"
            : "hsl(220,70%,50%)"
        ),
      },
    ],
  };

  return {
    roundType: round.nameOfRound || "Investment Round",
    round_type: round.round_type,
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
// Safe Round - CORRECTED VERSION
function handleSAFERoundCalculation(round, company_id, res) {
  // Get Round 0 data for base shares
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

      // Parse SAFE specific data
      let safeData = {};
      try {
        safeData = safeJSONParseRepeated(round.instrument_type_data, 3) || {};
      } catch (e) {
        safeData = {};
      }

      const investmentSize = toNumber(round.roundsize, 0);
      const valuationCap = toNumber(safeData.valuationCap, 0);
      const discountRate = toNumber(safeData.discountRate, 0) / 100;
      const safeType = safeData.safeType || "PRE_MONEY";
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

          // Get founder details for cap table
          if (founderData.founders && Array.isArray(founderData.founders)) {
            roundZeroFounders = founderData.founders;
          }
        } else {
          roundZeroTotalShares = toNumber(roundZero.issuedshares, 0);
        }
      } catch (error) {
        roundZeroTotalShares = toNumber(roundZero.issuedshares, 0);
      }

      // Calculate option pool shares (as per client formula)
      const optionPoolShares = Math.round(
        (roundZeroTotalShares * optionPoolPercent) / (1 - optionPoolPercent)
      );

      const totalSharesIncludingPool = roundZeroTotalShares + optionPoolShares;

      // 🟢 STEP 1: Get investors for this SAFE round
      db.query(
        `SELECT ir.*, COALESCE(ii.first_name,'') AS first_name, COALESCE(ii.last_name,'') AS last_name, COALESCE(ii.email,'') AS email
         FROM investorrequest_company ir
         LEFT JOIN investor_information ii ON ir.investor_id = ii.id
         WHERE ir.roundrecord_id=? AND ir.company_id=? AND ir.request_confirm='Yes'`,
        [round.id, company_id],
        (err, investors) => {
          if (err) {
            return res.status(500).json({
              success: false,
              message: "Database error fetching investors",
              error: err,
            });
          }

          // Calculate total SAFE investment
          let totalSafeInvestment = 0;
          if (investors && investors.length > 0) {
            investors.forEach((investor) => {
              totalSafeInvestment += toNumber(investor.investment_amount, 0);
            });
          }

          // If no investors, use round size as potential investment
          const effectiveInvestment =
            totalSafeInvestment > 0 ? totalSafeInvestment : investmentSize;

          // 🟢 STEP 2: Calculate potential conversion for ALL SAFE investors
          let totalPotentialShares = 0;
          let conversionDetails = {};

          if (
            valuationCap > 0 &&
            totalSharesIncludingPool > 0 &&
            effectiveInvestment > 0
          ) {
            if (safeType === "POST_MONEY") {
              // CORRECT POST-MONEY SAFE CALCULATION
              const ownershipPercentage = effectiveInvestment / valuationCap;

              // Total shares after conversion
              const totalSharesPostConversion = Math.round(
                totalSharesIncludingPool / (1 - ownershipPercentage)
              );
              totalPotentialShares =
                totalSharesPostConversion - totalSharesIncludingPool;

              // Conversion prices
              const conversionPriceAtCap =
                valuationCap / totalSharesPostConversion;
              const sharesAtValuationCap = Math.round(
                effectiveInvestment / conversionPriceAtCap
              );

              // Apply discount
              const conversionPriceWithDiscount =
                conversionPriceAtCap * (1 - discountRate);
              const sharesWithDiscount = Math.round(
                effectiveInvestment / conversionPriceWithDiscount
              );

              // Final conversion (better for investor)
              totalPotentialShares = Math.max(
                totalPotentialShares,
                sharesWithDiscount
              );

              conversionDetails = {
                atValuationCap: sharesAtValuationCap,
                atDiscount: sharesWithDiscount,
                conversionPriceAtCap: conversionPriceAtCap,
                conversionPriceWithDiscount: conversionPriceWithDiscount,
                finalShares: totalPotentialShares,
                conversionPrice:
                  discountRate > 0
                    ? conversionPriceWithDiscount
                    : conversionPriceAtCap,
                foundersOwnership:
                  totalSharesPostConversion > 0
                    ? (totalSharesIncludingPool / totalSharesPostConversion) *
                      100
                    : 0,
                postConversionOwnership:
                  totalSharesPostConversion > 0
                    ? (totalPotentialShares / totalSharesPostConversion) * 100
                    : 0,
              };
            } else {
              // PRE-MONEY SAFE (your existing logic)
              const conversionPriceAtCap =
                valuationCap / totalSharesIncludingPool;
              const sharesAtValuationCap = Math.round(
                effectiveInvestment / conversionPriceAtCap
              );

              const conversionPriceWithDiscount =
                conversionPriceAtCap * (1 - discountRate);
              const sharesWithDiscount = Math.round(
                effectiveInvestment / conversionPriceWithDiscount
              );

              totalPotentialShares = Math.max(
                sharesAtValuationCap,
                sharesWithDiscount
              );

              conversionDetails = {
                atValuationCap: sharesAtValuationCap,
                atDiscount: sharesWithDiscount,
                conversionPriceAtCap: conversionPriceAtCap,
                conversionPriceWithDiscount: conversionPriceWithDiscount,
                finalShares: totalPotentialShares,
                conversionPrice:
                  discountRate > 0
                    ? conversionPriceWithDiscount
                    : conversionPriceAtCap,
                foundersOwnership:
                  totalSharesIncludingPool + totalPotentialShares > 0
                    ? (totalSharesIncludingPool /
                        (totalSharesIncludingPool + totalPotentialShares)) *
                      100
                    : 0,
                postConversionOwnership:
                  totalSharesIncludingPool + totalPotentialShares > 0
                    ? (totalPotentialShares /
                        (totalSharesIncludingPool + totalPotentialShares)) *
                      100
                    : 0,
              };
            }
          }

          // 🟢 STEP 3: Create shareholders array for SAFE round
          let shareholders = [];

          // Add founders from Round 0
          if (roundZeroFounders && roundZeroFounders.length > 0) {
            roundZeroFounders.forEach((founder, index) => {
              const shares = toNumber(founder.shares, 0);
              if (shares > 0) {
                const ownership =
                  totalSharesIncludingPool > 0
                    ? (shares / totalSharesIncludingPool) * 100
                    : 0;
                const value = (ownership / 100) * valuationCap;

                shareholders.push({
                  name: founder.firstName + " " + founder.lastName,
                  fullName:
                    founder.fullName || founder.name || `Founder ${index + 1}`,
                  firstName:
                    founder.firstName ||
                    (founder.name || "").split(" ")[0] ||
                    "",
                  lastName:
                    founder.lastName ||
                    (founder.name || "").split(" ")[1] ||
                    "",
                  email: founder.email || "-",
                  phone: founder.phone || "-",
                  type: "Founder",
                  shares: shares,
                  ownership: ownership,
                  value: value,
                  shareType: founder.shareType || "common",
                  votingRights:
                    founder.voting === "Yes" ? "voting" : "non-voting",
                  newShares: 0,
                });
              }
            });
          }

          // Add Employee Option Pool
          if (optionPoolShares > 0) {
            const employeeOwnership =
              totalSharesIncludingPool > 0
                ? (optionPoolShares / totalSharesIncludingPool) * 100
                : 0;
            const employeeValue = (employeeOwnership / 100) * valuationCap;

            shareholders.push({
              name: "Employee Option Pool",
              fullName: "Employee Option Pool",
              type: "Options Pool",
              shares: optionPoolShares,
              ownership: employeeOwnership,
              value: employeeValue,
              votingRights: "non-voting",
              newShares: 0,
            });
          }

          // Add SAFE investors
          if (investors && investors.length > 0) {
            investors.forEach((investor, index) => {
              const investmentAmount = toNumber(investor.investment_amount, 0);

              // Calculate individual investor's share of total potential shares
              const individualPotentialShares =
                totalSafeInvestment > 0
                  ? Math.round(
                      (investmentAmount / totalSafeInvestment) *
                        totalPotentialShares
                    )
                  : 0;

              const individualPostConversionOwnership =
                conversionDetails.postConversionOwnership > 0
                  ? (individualPotentialShares /
                      (totalSharesIncludingPool + totalPotentialShares)) *
                    100
                  : 0;

              shareholders.push({
                name:
                  `${investor.first_name || ""} ${
                    investor.last_name || ""
                  }`.trim() || `SAFE Investor ${index + 1}`,
                fullName:
                  `${investor.first_name || ""} ${
                    investor.last_name || ""
                  }`.trim() || `SAFE Investor ${index + 1}`,
                firstName: investor.first_name || "",
                lastName: investor.last_name || "",
                email: investor.email || "-",
                phone: "-",
                type: "SAFE Investor",
                shares: 0, // No immediate shares in SAFE
                ownership: 0,
                value: 0,
                investmentAmount: investmentAmount,
                votingRights: "non-voting",
                newShares: 0,
                isSAFE: true,
                safeDetails: {
                  valuationCap: valuationCap,
                  discountRate: discountRate * 100,
                  safeType: safeType,
                  potentialShares: individualPotentialShares,
                  conversionPrice: conversionDetails.conversionPrice,
                  postConversionOwnership: individualPostConversionOwnership,
                },
              });
            });
          }

          // 🟢 STEP 4: Create proper cap table data for SAFE round
          const capTableData = {
            roundType: round.nameOfRound || "SAFE Round",
            round_type: round.round_type,
            instrumentType: round.instrumentType,
            currency: round.currency || "USD",
            totalShares: totalSharesIncludingPool,
            totalValue: valuationCap > 0 ? valuationCap : 0,
            shareholders: shareholders,
            chartData: {
              labels: shareholders.map((s) => s.name),
              datasets: [
                {
                  label: "Current Ownership %",
                  data: shareholders.map((s) => Number(s.ownership.toFixed(2))),
                  backgroundColor: shareholders.map((s) =>
                    s.type === "Founder"
                      ? "hsl(120,70%,50%)"
                      : s.type === "Options Pool"
                      ? "hsl(40,70%,50%)"
                      : "hsl(220,70%,50%)"
                  ),
                },
              ],
            },
            calculations: {
              investmentSize,
              valuationCap,
              discountRate: discountRate * 100,
              safeType,
              totalSafeInvestment:
                totalSafeInvestment > 0 ? totalSafeInvestment : investmentSize,
              investorCount: investors ? investors.length : 0,
              roundZeroTotalShares,
              optionPoolPercent: optionPoolPercent * 100,
              optionPoolShares,
              totalSharesIncludingPool,
              potentialConversion: conversionDetails, // ✅ ADD THIS LINE
              safeNote:
                "SAFE investors will receive shares at next priced round conversion",
            },
            isSAFERound: true,
            message:
              investors && investors.length > 0
                ? `${safeType} SAFE round with ${
                    investors.length
                  } investor(s) - ${formatCurrency(
                    totalSafeInvestment
                  )} committed`
                : `${safeType} SAFE round - no investors confirmed yet`,
          };

          return res.status(200).json({
            success: true,
            message: "SAFE round data retrieved successfully",
            round,
            capTable: capTableData,
          });
        }
      );
    }
  );
}

// Helper function for currency formatting
function formatCurrency(amount, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
  }).format(amount);
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
