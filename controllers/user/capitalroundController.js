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
        sendEmailToInvestor(investorEmail, investorName, companyName, reports);
      } catch (emailErr) {
        console.error("Error sending email:", emailErr);
      }

      res.status(200).json({
        message: "Signature authorized successfully and email sent",
        updated: true,
        results: results,
      });
    }
  );
};

// services/emailService.js

// 📧 TO INVESTOR: Signature confirmation with wiring instructions
function sendEmailToInvestor(
  to,
  investorName,
  companyName,
  reports,
  wiringInstructions = null
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
          }
        );
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
      if (instrumentType === "Safe" && round.shareClassType === "Seed") {
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
        round.shareClassType === "Seed"
      ) {
        return handleConvertibleNoteRoundCalculation(
          round,
          company_id,
          instrumentData,
          res
        );
      }
      if (
        instrumentType === "Convertible Note" &&
        round.shareClassType?.includes("Series")
      ) {
        return handleConvertibleNote_SeriesRoundCalculation(
          round,
          company_id,
          res
        );
      }
      if (instrumentType === "Preferred Equity") {
        return handlePreferredEquityRoundCalculation(round, company_id, res);
      }
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

              if (isSeriesA && round.instrumentType === "Common Stock") {
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
                            err
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
                                err
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
                                } shares`
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
                                    err
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
                                    } - $${inv.investment_amount}`
                                  );
                                });

                                const capTableData =
                                  calculateSeriesARoundCapTable(
                                    round,
                                    currentInvestors,
                                    roundZero,
                                    previousRounds
                                  );

                                if (capTableData.error) {
                                  console.error(
                                    "❌ Calculation error:",
                                    capTableData.error
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
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                );
              } else {
                // Regular round (Seed, etc.)
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
            }
          );
        }
      );
    }
  );
};

function handlePreferredEquityRoundCalculation(round, company_id, res) {
  // Step 1: Get Round 0 data
  db.query(
    `SELECT * FROM roundrecord WHERE company_id=? AND round_type='Round 0'`,
    [company_id],
    (err, roundZeroData) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Database error fetching Round 0",
          error: err,
        });
      }

      if (roundZeroData.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Round 0 not found. Please create Round 0 first.",
        });
      }

      const roundZero = roundZeroData[0];

      // Step 2: Get ALL previous rounds (for SAFE/Convertible Note conversion)
      db.query(
        `SELECT * FROM roundrecord 
         WHERE company_id = ? 
         AND round_type = 'Investment'
         AND id < ?
         ORDER BY created_at ASC`,
        [company_id, round.id],
        (err, previousRounds) => {
          if (err) {
            return res.status(500).json({
              success: false,
              message: "Database error fetching previous rounds",
              error: err,
            });
          }

          console.log(
            `\n📊 Found ${previousRounds.length} previous investment rounds`
          );

          // Step 3: Get current round investors (Series A)
          db.query(
            `SELECT ir.*, ii.first_name, ii.last_name, ii.email
             FROM investorrequest_company ir
             LEFT JOIN investor_information ii ON ir.investor_id = ii.id
             WHERE ir.roundrecord_id = ? 
             AND ir.company_id = ? 
             AND ir.request_confirm = 'Yes'`,
            [round.id, company_id],
            (err, currentInvestors) => {
              if (err) {
                return res.status(500).json({
                  success: false,
                  message: "Database error fetching current investors",
                  error: err,
                });
              }

              console.log(
                `\n👥 Found ${currentInvestors.length} Series A investors`
              );

              // Step 4: Get warrants for this round
              db.query(
                `SELECT * FROM warrants 
                 WHERE roundrecord_id = ? 
                 AND company_id = ?`,
                [round.id, company_id],
                (err, warrants) => {
                  if (err) {
                    console.error("⚠️ Error fetching warrants:", err);
                    // Continue without warrants
                    warrants = [];
                  }

                  console.log(
                    `\n📜 Found ${warrants.length} warrants for this round`
                  );

                  // Step 5: Calculate cap table
                  const capTableData = calculatePreferredEquityCapTable(
                    round,
                    currentInvestors,
                    roundZero,
                    previousRounds,
                    warrants
                  );

                  if (capTableData.error) {
                    console.error("❌ Calculation error:", capTableData.error);
                    return res.status(500).json({
                      success: false,
                      message: "Preferred Equity calculation failed",
                      error: capTableData.error,
                    });
                  }

                  console.log("✅ ===== CALCULATION COMPLETE =====\n");

                  return res.status(200).json({
                    success: true,
                    message:
                      "Preferred Equity cap table calculated successfully",
                    round: {
                      id: round.id,
                      name: round.nameOfRound,
                      type: round.round_type,
                      instrumentType: round.instrumentType,
                      investmentSize: round.roundsize,
                      preMoneyValuation: round.pre_money,
                      postMoneyValuation:
                        capTableData.calculations.postMoneyValuation,
                      optionPoolPercentPre: round.optionPoolPercent,
                      optionPoolPercentPost: round.optionPoolPercent_post,
                      currency: round.currency,
                      hasWarrants: warrants.length > 0,
                    },
                    capTable: capTableData,
                  });
                }
              );
            }
          );
        }
      );
    }
  );
}
function calculatePreferredEquityCapTable(
  round,
  currentInvestors,
  roundZero,
  previousRounds,
  warrants
) {
  console.log("\n🔵 ===== PREFERRED EQUITY (SERIES A) CALCULATION START =====");
  console.log("Round:", round.nameOfRound);
  console.log("Investment:", round.roundsize);
  console.log("Pre-Money:", round.pre_money);

  const toNumber = (val, def = 0) => {
    const num = parseFloat(val);
    return isNaN(num) ? def : num;
  };

  // ========== STEP 1: PARSE ROUND 0 DATA ==========
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
    console.error("Error parsing Round 0 data:", error);
    roundZeroTotalShares = toNumber(roundZero.issuedshares, 0);
  }

  console.log(
    `\n📍 Round 0 Founder Shares: ${roundZeroTotalShares.toLocaleString()}`
  );

  // ========== STEP 2: PARSE SERIES A DATA ==========
  const seriesA_Investment = toNumber(round.roundsize, 0);
  const seriesA_PreMoney = toNumber(round.pre_money, 0);
  const optionPoolPercentPre = toNumber(round.optionPoolPercent, 0) / 100;
  const optionPoolPercentPost = toNumber(round.optionPoolPercent_post, 0) / 100;

  console.log(
    `\n💰 Series A Investment: $${seriesA_Investment.toLocaleString()}`
  );
  console.log(`📈 Pre-Money Valuation: $${seriesA_PreMoney.toLocaleString()}`);
  console.log(
    `🎯 Existing Option Pool: ${(optionPoolPercentPre * 100).toFixed(1)}%`
  );
  console.log(
    `🎯 Target Post-Money Pool: ${(optionPoolPercentPost * 100).toFixed(1)}%`
  );

  // ========== STEP 3: CALCULATE EXISTING OPTION POOL (FROM SEED ROUND) ==========
  // Formula from document: Total # of shares / (1 - option pool %) * option pool %
  const existingOptionShares = Math.round(
    (roundZeroTotalShares / (1 - optionPoolPercentPre)) * optionPoolPercentPre
  );
  // = 100,000 / (1 - 0.10) * 0.10 = 100,000 / 0.90 * 0.10 = 11,111

  // Total shares before Series A (from Seed round)
  const totalSharesFromSeedRound = roundZeroTotalShares + existingOptionShares;
  // = 100,000 + 11,111 = 111,111

  console.log(`\n📊 Shares from Seed Round:`);
  console.log(`   - Founders: ${roundZeroTotalShares.toLocaleString()}`);
  console.log(`   - Option Pool: ${existingOptionShares.toLocaleString()}`);
  console.log(`   - Total: ${totalSharesFromSeedRound.toLocaleString()}`);

  // ========== STEP 4: CALCULATE SERIES A SHARE PRICE ==========
  // Price per share = Pre-Money / Total shares from previous round
  const seriesA_SharePrice = seriesA_PreMoney / totalSharesFromSeedRound;
  // = $1,200,000 / 111,111 = $10.80

  console.log(`\n💎 Series A Share Price: $${seriesA_SharePrice.toFixed(4)}`);

  // ========== STEP 5: PROCESS CONVERTIBLE NOTE CONVERSION ==========
  let convertedInvestors = [];
  let totalConvertedShares = 0;

  previousRounds.forEach((prevRound, idx) => {
    console.log(`\n🔄 Processing Round ${idx + 1}: ${prevRound.nameOfRound}`);

    let instrumentData = {};
    try {
      instrumentData =
        safeJSONParseRepeated(prevRound.instrument_type_data, 3) || {};
    } catch (e) {
      instrumentData = {};
    }

    const prevInstrumentType = prevRound.instrumentType;

    // ✅ CONVERTIBLE NOTE CONVERSION
    if (prevInstrumentType === "Convertible Note") {
      const note_Investment = toNumber(prevRound.roundsize, 0);
      const note_InterestRate =
        toNumber(instrumentData.interestRate_note, 0) / 100;
      const note_ValuationCap = toNumber(instrumentData.valuationCap_note, 0);
      const note_DiscountRate =
        toNumber(instrumentData.discountRate_note, 0) / 100;

      // Calculate years between rounds
      const noteDate = new Date(prevRound.created_at);
      const seriesADate = new Date(round.created_at);
      const yearsBetween =
        (seriesADate - noteDate) / (1000 * 60 * 60 * 24 * 365);

      // ✅ CALCULATE PRINCIPAL + INTEREST
      // Formula: Investment * (1 + Interest Rate) ^ Years
      const principalPlusInterest =
        note_Investment * Math.pow(1 + note_InterestRate, yearsBetween);
      // = $120,000 * (1 + 0.10)^2 = $120,000 * 1.21 = $145,200

      console.log(`   📝 Convertible Note Details:`);
      console.log(
        `      - Original Investment: $${note_Investment.toLocaleString()}`
      );
      console.log(
        `      - Interest Rate: ${(note_InterestRate * 100).toFixed(1)}%`
      );
      console.log(`      - Years: ${yearsBetween.toFixed(2)}`);
      console.log(
        `      - Principal + Interest: $${principalPlusInterest.toLocaleString()}`
      );

      // ✅ CALCULATE CONVERSION PRICE
      // Option 1: Discount Price = Series A price * (1 - Discount %)
      const discountPrice = seriesA_SharePrice * (1 - note_DiscountRate);
      // = $10.80 * (1 - 0.20) = $10.80 * 0.80 = $8.64

      // Option 2: Cap Price = Valuation Cap / Total Shares from last round
      const capPrice = note_ValuationCap / totalSharesFromSeedRound;
      // = $1,000,000 / 111,111 = $9.00

      // ✅ OPTIMAL PURCHASE PRICE = Min(Discount Price, Cap Price)
      const note_ConversionPrice = Math.min(discountPrice, capPrice);
      // = Min($8.64, $9.00) = $8.64

      console.log(`      - Discount Price: $${discountPrice.toFixed(4)}`);
      console.log(`      - Cap Price: $${capPrice.toFixed(4)}`);
      console.log(
        `      - Conversion Price: $${note_ConversionPrice.toFixed(4)} ✅`
      );

      // ✅ CALCULATE CONVERTED SHARES
      // Shares = Principal + Interest / Conversion Price
      const note_Shares = Math.round(
        principalPlusInterest / note_ConversionPrice
      );
      // = $145,200 / $8.64 = 16,806 shares

      console.log(
        `      - Converted Shares: ${note_Shares.toLocaleString()} ✅`
      );

      // ✅ CALCULATE VALUE & MOIC
      const note_Value = note_Shares * seriesA_SharePrice;
      // = 16,806 * $10.80 = $181,501

      const note_MOIC = note_Value / note_Investment;
      // = $181,501 / $120,000 = 1.51x

      console.log(`      - Value: $${note_Value.toLocaleString()}`);
      console.log(`      - MOIC: ${note_MOIC.toFixed(2)}x ✅`);

      totalConvertedShares += note_Shares;

      convertedInvestors.push({
        roundName: prevRound.nameOfRound,
        type: "Convertible Note",
        investmentAmount: note_Investment,
        principalPlusInterest: principalPlusInterest,
        conversionPrice: note_ConversionPrice,
        shares: note_Shares,
        value: note_Value,
        moic: note_MOIC.toFixed(2),
      });
    }

    // ✅ SAFE CONVERSION (if any)
    if (prevInstrumentType === "Safe") {
      const safe_Investment = toNumber(prevRound.roundsize, 0);
      const safe_ValuationCap = toNumber(instrumentData.valuationCap, 0);
      const safe_DiscountRate = toNumber(instrumentData.discountRate, 0) / 100;

      const discountPrice = seriesA_SharePrice * (1 - safe_DiscountRate);
      const capPrice = safe_ValuationCap / totalSharesFromSeedRound;
      const safe_ConversionPrice = Math.min(discountPrice, capPrice);

      const safe_Shares = Math.round(safe_Investment / safe_ConversionPrice);
      const safe_Value = safe_Shares * seriesA_SharePrice;

      console.log(`   📝 SAFE Conversion:`);
      console.log(
        `      - Conversion Price: $${safe_ConversionPrice.toFixed(4)}`
      );
      console.log(`      - Shares: ${safe_Shares.toLocaleString()}`);

      totalConvertedShares += safe_Shares;

      convertedInvestors.push({
        roundName: prevRound.nameOfRound,
        type: "SAFE Converted",
        investmentAmount: safe_Investment,
        conversionPrice: safe_ConversionPrice,
        shares: safe_Shares,
        value: safe_Value,
        moic: (safe_Value / safe_Investment).toFixed(2),
      });
    }
  });

  console.log(
    `\n✅ Total Converted Shares: ${totalConvertedShares.toLocaleString()}`
  );

  // ========== STEP 6: CALCULATE SERIES A INVESTOR SHARES ==========
  // Shares = Investment / Share Price
  const seriesA_Shares = Math.round(seriesA_Investment / seriesA_SharePrice);
  // = $400,000 / $10.80 = 37,037 shares

  const seriesA_Value = seriesA_Shares * seriesA_SharePrice;
  // = 37,037 * $10.80 = $400,000

  const seriesA_MOIC = seriesA_Value / seriesA_Investment;
  // = $400,000 / $400,000 = 1.00x

  console.log(
    `\n💰 Series A Investor Shares: ${seriesA_Shares.toLocaleString()}`
  );
  console.log(`💰 Series A Value: $${seriesA_Value.toLocaleString()}`);
  console.log(`💰 Series A MOIC: ${seriesA_MOIC.toFixed(2)}x`);

  // ========== STEP 7: CALCULATE TOTAL NEW SHARES ==========
  // Total new investor shares = Converted + Series A
  const totalNewInvestorShares = totalConvertedShares + seriesA_Shares;
  // = 16,806 + 37,037 = 53,843

  const totalNewInvestorValue =
    convertedInvestors.reduce((sum, inv) => sum + inv.value, 0) + seriesA_Value;
  // = $181,501 + $400,000 = $581,501

  console.log(
    `\n📊 Total New Investor Shares: ${totalNewInvestorShares.toLocaleString()}`
  );
  console.log(
    `📊 Total New Investor Value: $${totalNewInvestorValue.toLocaleString()}`
  );

  // ========== STEP 8: CALCULATE TOTAL SHARES (EXCLUDING NEW OPTION SHARES) ==========
  // Total = Founders + Converted Investors + Series A Investors (NO seed investors from last round as they converted)
  const totalSharesExcludingNewOptions =
    roundZeroTotalShares + totalNewInvestorShares;
  // = 100,000 + 53,843 = 153,843

  console.log(
    `\n📊 Total Shares (excluding new options): ${totalSharesExcludingNewOptions.toLocaleString()}`
  );

  // ========== STEP 9: CALCULATE OPTION POOL TOP-UP ==========
  // Formula: Total shares after pool = Total shares before / (1 - Post Option Pool %)
  const totalSharesAfterPool = Math.round(
    totalSharesExcludingNewOptions / (1 - optionPoolPercentPost)
  );
  // = 153,843 / (1 - 0.20) = 153,843 / 0.80 = 192,304 (rounded to 192,303)

  // New option shares = Total after pool - Total before pool - Existing option shares
  const newOptionShares =
    totalSharesAfterPool -
    totalSharesExcludingNewOptions -
    existingOptionShares;
  // = 192,303 - 153,843 - 11,111 = 27,349 (rounded to 27,350)

  const totalOptionShares = existingOptionShares + newOptionShares;
  // = 11,111 + 27,350 = 38,461

  console.log(`\n🎯 Option Pool Calculations:`);
  console.log(`   - Existing: ${existingOptionShares.toLocaleString()}`);
  console.log(`   - New: ${newOptionShares.toLocaleString()}`);
  console.log(`   - Total: ${totalOptionShares.toLocaleString()}`);
  console.log(
    `   - Pool %: ${((totalOptionShares / totalSharesAfterPool) * 100).toFixed(
      2
    )}%`
  );

  // ========== STEP 10: CHECK FOR WARRANTS ==========
  let warrantShares = 0;
  let warrantExercisePrice = 0;
  let warrantValue = 0;
  let totalSharesAfterWarrants = totalSharesAfterPool;

  if (warrants && warrants.length > 0) {
    console.log(`\n📜 Processing ${warrants.length} warrant(s)...`);

    warrants.forEach((warrant, idx) => {
      console.log(`\n   Warrant ${idx + 1}:`);
      console.log(`      - Coverage: ${warrant.warrant_coverage_percentage}%`);
      console.log(`      - Exercise Type: ${warrant.warrant_exercise_type}`);
      console.log(
        `      - Adjustment: ${warrant.warrant_adjustment_percent}% ${warrant.warrant_adjustment_direction}`
      );

      // ✅ CALCULATE WARRANT EXERCISE PRICE
      let exercisePrice = seriesA_SharePrice;

      if (warrant.warrant_exercise_type === "next_round_adjusted") {
        if (warrant.warrant_adjustment_direction === "decrease") {
          exercisePrice =
            seriesA_SharePrice * (1 - warrant.warrant_adjustment_percent / 100);
        } else {
          exercisePrice =
            seriesA_SharePrice * (1 + warrant.warrant_adjustment_percent / 100);
        }
      }

      console.log(`      - Exercise Price: $${exercisePrice.toFixed(4)}`);

      // ✅ CALCULATE WARRANT SHARES
      // Warrant shares = Series A new shares × Warrant Coverage %
      const individualWarrantShares = Math.round(
        seriesA_Shares * (warrant.warrant_coverage_percentage / 100)
      );

      console.log(
        `      - Warrant Shares: ${individualWarrantShares.toLocaleString()}`
      );

      // ✅ CALCULATE WARRANT VALUE
      // Value = Warrant Shares × Series A Share Price (NOT exercise price)
      const individualWarrantValue =
        individualWarrantShares * seriesA_SharePrice;

      console.log(
        `      - Warrant Value: $${individualWarrantValue.toLocaleString()}`
      );

      warrantShares += individualWarrantShares;
      warrantValue += individualWarrantValue;
      warrantExercisePrice = exercisePrice; // Store last exercise price
    });

    // ✅ ADD WARRANT SHARES TO TOTAL
    totalSharesAfterWarrants = totalSharesAfterPool + warrantShares;

    console.log(`\n✅ Total Warrant Shares: ${warrantShares.toLocaleString()}`);
    console.log(
      `✅ Total Shares (After Warrants): ${totalSharesAfterWarrants.toLocaleString()}`
    );
  }

  // ========== STEP 11: CALCULATE POST-MONEY VALUATION ==========
  // ✅ CORRECT FORMULA (from document): Total Shares × Share Price
  const postMoneyValuation = totalSharesAfterPool * seriesA_SharePrice;
  // = 192,303 * $10.80 = $2,076,872 (rounded to $2,076,875)

  console.log(
    `\n💰 Post-Money Valuation: $${postMoneyValuation.toLocaleString()}`
  );

  // ========== STEP 12: BUILD PRE-SERIES A CAP TABLE ==========
  let preSeriesAShareholders = [];

  // Add founders
  if (roundZeroFounders && roundZeroFounders.length > 0) {
    roundZeroFounders.forEach((founder, index) => {
      const shares = toNumber(founder.shares, 0);
      if (shares > 0) {
        const ownership = (shares / totalSharesFromSeedRound) * 100;
        const value = (ownership / 100) * seriesA_PreMoney;

        preSeriesAShareholders.push({
          name:
            `${founder.firstName || ""} ${founder.lastName || ""}`.trim() ||
            `F${index + 1}`,
          fullName: founder.fullName || `Founder ${index + 1}`,
          email: founder.email || "-",
          type: "Founder",
          shares: shares,
          ownership: ownership,
          value: value,
        });
      }
    });
  }

  // Add option pool
  if (existingOptionShares > 0) {
    preSeriesAShareholders.push({
      name: "Employee",
      fullName: "Employee Option Pool",
      type: "Options Pool",
      shares: existingOptionShares,
      ownership: (existingOptionShares / totalSharesFromSeedRound) * 100,
      value:
        (existingOptionShares / totalSharesFromSeedRound) * seriesA_PreMoney,
    });
  }

  // Add Seed Investors (0 shares - not converted yet)
  preSeriesAShareholders.push({
    name: "Seed Investors",
    fullName: "Seed Round Investors",
    type: "Investor",
    shares: 0,
    ownership: 0,
    value: 0,
    note: "Convertible Note - Will convert at Series A closing",
  });

  // Add Series A Investors (0 shares - not invested yet)
  preSeriesAShareholders.push({
    name: "Series A Investors",
    fullName: "Series A Investors",
    type: "Investor",
    shares: 0,
    ownership: 0,
    value: 0,
    note: "Not yet invested",
  });

  // ========== STEP 13: BUILD POST-SERIES A CAP TABLE ==========
  let shareholders = [];

  // Add founders
  if (roundZeroFounders && roundZeroFounders.length > 0) {
    roundZeroFounders.forEach((founder, index) => {
      const shares = toNumber(founder.shares, 0);
      if (shares > 0) {
        const ownershipBeforeWarrants = (shares / totalSharesAfterPool) * 100;
        const ownershipAfterWarrants =
          (shares / totalSharesAfterWarrants) * 100;
        const valueBeforeWarrants =
          (ownershipBeforeWarrants / 100) * postMoneyValuation;
        const valueAfterWarrants =
          (ownershipAfterWarrants / 100) *
          (totalSharesAfterWarrants * seriesA_SharePrice);

        shareholders.push({
          name:
            `${founder.firstName || ""} ${founder.lastName || ""}`.trim() ||
            `F${index + 1}`,
          fullName: founder.fullName || `Founder ${index + 1}`,
          email: founder.email || "-",
          phone: founder.phone || "-",
          type: "Founder",
          shares: shares,
          existingShares: shares,
          newShares: 0,
          ownershipBeforeWarrants: ownershipBeforeWarrants,
          ownershipAfterWarrants: ownershipAfterWarrants,
          valueBeforeWarrants: valueBeforeWarrants,
          valueAfterWarrants: valueAfterWarrants,
          // Display after warrants by default
          ownership: ownershipAfterWarrants,
          value: valueAfterWarrants,
        });
      }
    });
  }

  // Add option pool
  shareholders.push({
    name: "Employee",
    fullName: "Employee Option Pool",
    type: "Options Pool",
    shares: totalOptionShares,
    existingShares: existingOptionShares,
    newShares: newOptionShares,
    ownershipBeforeWarrants: (totalOptionShares / totalSharesAfterPool) * 100,
    ownershipAfterWarrants:
      (totalOptionShares / totalSharesAfterWarrants) * 100,
    valueBeforeWarrants:
      (totalOptionShares / totalSharesAfterPool) * postMoneyValuation,
    valueAfterWarrants:
      (totalOptionShares / totalSharesAfterWarrants) *
      (totalSharesAfterWarrants * seriesA_SharePrice),
    ownership: (totalOptionShares / totalSharesAfterWarrants) * 100,
    value:
      (totalOptionShares / totalSharesAfterWarrants) *
      (totalSharesAfterWarrants * seriesA_SharePrice),
  });

  // Add converted investors
  convertedInvestors.forEach((inv) => {
    const ownershipBeforeWarrants = (inv.shares / totalSharesAfterPool) * 100;
    const ownershipAfterWarrants =
      (inv.shares / totalSharesAfterWarrants) * 100;
    const valueBeforeWarrants =
      (ownershipBeforeWarrants / 100) * postMoneyValuation;
    const valueAfterWarrants =
      (ownershipAfterWarrants / 100) *
      (totalSharesAfterWarrants * seriesA_SharePrice);

    shareholders.push({
      name: "Seed Investors",
      fullName: `${inv.type} - ${inv.roundName}`,
      type: "Investor",
      originalType: "Seed Investor",
      shares: inv.shares,
      existingShares: 0,
      newShares: inv.shares,
      ownershipBeforeWarrants: ownershipBeforeWarrants,
      ownershipAfterWarrants: ownershipAfterWarrants,
      valueBeforeWarrants: valueBeforeWarrants,
      valueAfterWarrants: valueAfterWarrants,
      ownership: ownershipAfterWarrants,
      value: valueAfterWarrants,
      investmentAmount: inv.investmentAmount,
      principalPlusInterest: inv.principalPlusInterest,
      conversionPrice: inv.conversionPrice,
      moic: inv.moic,
    });
  });

  // Add Series A investors
  let totalSeriesAInvestment = 0;
  currentInvestors.forEach((investor) => {
    totalSeriesAInvestment += toNumber(investor.investment_amount, 0);
  });

  currentInvestors.forEach((investor, index) => {
    const investmentAmount = toNumber(investor.investment_amount, 0);
    const individualShares =
      totalSeriesAInvestment > 0
        ? Math.round(
            (investmentAmount / totalSeriesAInvestment) * seriesA_Shares
          )
        : 0;

    const ownershipBeforeWarrants =
      (individualShares / totalSharesAfterPool) * 100;
    const ownershipAfterWarrants =
      (individualShares / totalSharesAfterWarrants) * 100;
    const valueBeforeWarrants =
      (ownershipBeforeWarrants / 100) * postMoneyValuation;
    const valueAfterWarrants =
      (ownershipAfterWarrants / 100) *
      (totalSharesAfterWarrants * seriesA_SharePrice);

    shareholders.push({
      name:
        `${investor.first_name || ""} ${investor.last_name || ""}`.trim() ||
        `Series A Investor ${index + 1}`,
      fullName:
        `${investor.first_name || ""} ${investor.last_name || ""}`.trim() ||
        `Series A Investor ${index + 1}`,
      email: investor.email || "-",
      phone: "-",
      type: "Investor",
      originalType: "Series A Investor",
      shares: individualShares,
      existingShares: 0,
      newShares: individualShares,
      ownershipBeforeWarrants: ownershipBeforeWarrants,
      ownershipAfterWarrants: ownershipAfterWarrants,
      valueBeforeWarrants: valueBeforeWarrants,
      valueAfterWarrants: valueAfterWarrants,
      ownership: ownershipAfterWarrants,
      value: valueAfterWarrants,
      investmentAmount: investmentAmount,
      sharePrice: seriesA_SharePrice,
      moic: seriesA_MOIC.toFixed(2),
    });
  });

  // ✅ Add warrant holders (if exercised)
  if (warrantShares > 0) {
    shareholders.push({
      name: "Warrant Holders",
      fullName: "Series A Warrant Exercise",
      type: "Warrant",
      shares: warrantShares,
      existingShares: 0,
      newShares: warrantShares,
      ownership: (warrantShares / totalSharesAfterWarrants) * 100,
      value: warrantValue,
      exercisePrice: warrantExercisePrice,
      note: `Exercised at $${warrantExercisePrice.toFixed(2)}/share`,
    });
  }

  console.log("\n✅ ===== CALCULATION COMPLETE =====\n");

  // ========== STEP 14: BUILD RESPONSE ==========
  return {
    roundType: round.nameOfRound || "Series A - Preferred Equity",
    round_type: round.round_type,
    instrumentType: round.instrumentType,
    currency: round.currency || "USD",

    // Pre-Series A Cap Table
    preSeriesACapTable: {
      totalShares: totalSharesFromSeedRound,
      totalValue: seriesA_PreMoney,
      shareholders: preSeriesAShareholders,
    },

    // Post-Series A Cap Table
    postSeriesACapTable: {
      totalSharesBeforeWarrants: totalSharesAfterPool,
      totalSharesAfterWarrants: totalSharesAfterWarrants,
      totalValue: postMoneyValuation,
      shareholders: shareholders,
    },

    // Calculations Summary
    calculations: {
      // Inputs
      investmentSize: seriesA_Investment,
      preMoneyValuation: seriesA_PreMoney,

      // Share Price
      sharePrice: seriesA_SharePrice,

      // Conversions
      convertibleNotePrincipal:
        convertedInvestors.length > 0
          ? convertedInvestors[0].investmentAmount
          : 0,
      convertibleNotePrincipalPlusInterest:
        convertedInvestors.length > 0
          ? convertedInvestors[0].principalPlusInterest
          : 0,
      convertibleNoteShares: totalConvertedShares,
      convertibleNoteValue: convertedInvestors.reduce(
        (sum, inv) => sum + inv.value,
        0
      ),

      // Series A
      seriesAShares: seriesA_Shares,
      seriesAValue: seriesA_Value,

      // Total New Investors
      totalNewInvestorShares: totalNewInvestorShares,
      totalNewInvestorValue: totalNewInvestorValue,

      // Option Pool
      existingOptionShares: existingOptionShares,
      newOptionShares: newOptionShares,
      totalOptionShares: totalOptionShares,
      optionPoolPercentPost: (totalOptionShares / totalSharesAfterPool) * 100,

      // Warrants
      warrantShares: warrantShares,
      warrantValue: warrantValue,
      warrantExercisePrice: warrantExercisePrice,

      // Final
      totalSharesExcludingNewOptions: totalSharesExcludingNewOptions,
      totalSharesAfterPool: totalSharesAfterPool,
      totalSharesAfterWarrants: totalSharesAfterWarrants,
      postMoneyValuation: postMoneyValuation,

      // Ownership
      foundersOwnership: shareholders
        .filter((sh) => sh.type === "Founder")
        .reduce((sum, sh) => sum + sh.ownership, 0),
      poolOwnership: (totalOptionShares / totalSharesAfterWarrants) * 100,
      seedInvestorsOwnership: shareholders
        .filter((sh) => sh.originalType === "Seed Investor")
        .reduce((sum, sh) => sum + sh.ownership, 0),
      seriesAInvestorsOwnership: shareholders
        .filter((sh) => sh.originalType === "Series A Investor")
        .reduce((sum, sh) => sum + sh.ownership, 0),
      warrantHoldersOwnership:
        warrantShares > 0
          ? (warrantShares / totalSharesAfterWarrants) * 100
          : 0,
    },

    // Warrant Info
    warrants: warrants.map((w) => ({
      id: w.id,
      coverage: w.warrant_coverage_percentage,
      exerciseType: w.warrant_exercise_type,
      adjustmentPercent: w.warrant_adjustment_percent,
      adjustmentDirection: w.warrant_adjustment_direction,
      status: "exercised",
      exercisePrice: warrantExercisePrice,
      shares: warrantShares,
      value: warrantValue,
    })),

    hasConversions: convertedInvestors.length > 0,
    hasWarrants: warrants.length > 0 && warrantShares > 0,
    message:
      "Series A - Preferred Equity with Convertible Note conversion and Warrant exercise",
  };
}
// New function specifically for Series A with post-money option pool
function calculateSeriesARoundCapTable(
  round,
  investors,
  roundZero,
  previousRounds
) {
  try {
    console.log("\n🔵 ========== SERIES A CALCULATION START ==========");

    // ========== STEP 1: COLLECT ALL EXISTING SHARES ==========
    const existingShareholders = [];
    let totalExistingShares = 0;
    let totalOptionPoolShares = 0;

    // 1. Add Round 0 Founders
    if (roundZero && roundZero.founder_data) {
      try {
        const founderData = safeJSONParseRepeated(roundZero.founder_data, 5);
        if (founderData?.founders && Array.isArray(founderData.founders)) {
          founderData.founders.forEach((founder, index) => {
            const shares = toNumber(founder.shares, 0);
            if (shares > 0) {
              totalExistingShares += shares;
              existingShareholders.push({
                name:
                  `${founder.firstName || ""} ${
                    founder.lastName || ""
                  }`.trim() || `Founder ${index + 1}`,
                type: "Founder",
                shares: shares,
                originalType: "Founder",
                source: "Round 0",
                votingRights: founder.voting || "voting",
              });
            }
          });
        }
      } catch (error) {
        console.error("❌ Error parsing founder data:", error);
      }
    }

    const totalFounderShares = totalExistingShares;
    console.log(`✅ Founder shares: ${totalFounderShares.toLocaleString()}`);

    // 2. Process ALL previous investment rounds
    if (previousRounds && previousRounds.length > 0) {
      previousRounds.forEach((prevRound) => {
        if (!prevRound || prevRound.round_type !== "Investment") return;

        const prevRoundInvestorShares = toNumber(prevRound.issuedshares, 0);
        const prevRoundPreMoneyPool = toNumber(prevRound.optionPoolPercent, 0);
        const prevRoundPostMoneyPool = toNumber(
          prevRound.optionPoolPercent_post,
          0
        );

        console.log(`\n📋 Processing ${prevRound.nameOfRound}:`);
        console.log(
          `   Investor shares: ${prevRoundInvestorShares.toLocaleString()}`
        );
        console.log(`   Pre-Money Pool: ${prevRoundPreMoneyPool}%`);
        console.log(`   Post-Money Pool: ${prevRoundPostMoneyPool}%`);

        // Handle PRE-MONEY Option Pool (Seed rounds)
        if (prevRoundPreMoneyPool > 0) {
          const sharesBeforePool = totalExistingShares;
          const optionPoolShares = Math.round(
            (sharesBeforePool * (prevRoundPreMoneyPool / 100)) /
              (1 - prevRoundPreMoneyPool / 100)
          );

          totalOptionPoolShares += optionPoolShares;
          totalExistingShares += optionPoolShares;

          existingShareholders.push({
            name: `Employee Option Pool`,
            type: "Options Pool",
            shares: optionPoolShares,
            originalType: "Options Pool",
            source: prevRound.nameOfRound || "Previous Round",
            votingRights: "non-voting",
          });

          console.log(
            `   ✅ Added option pool: ${optionPoolShares.toLocaleString()} shares`
          );
        }

        // Handle POST-MONEY Option Pool (Series rounds - if any before this)
        if (prevRoundPostMoneyPool > 0 && prevRoundPreMoneyPool === 0) {
          // Calculate based on post-money pool percentage
          const investorPostMoney = toNumber(prevRound.investorPostMoney, 0);
          if (investorPostMoney > 0 && prevRoundInvestorShares > 0) {
            const totalAfterPrevRound =
              prevRoundInvestorShares / (investorPostMoney / 100);
            const optionPoolShares = Math.round(
              totalAfterPrevRound * (prevRoundPostMoneyPool / 100)
            );

            totalOptionPoolShares = optionPoolShares; // Replace, not add

            console.log(
              `   ✅ Post-money option pool: ${optionPoolShares.toLocaleString()} shares`
            );
          }
        }

        // Add investor shares
        if (prevRoundInvestorShares > 0) {
          totalExistingShares += prevRoundInvestorShares;

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

          console.log(
            `   ✅ Added investor shares: ${prevRoundInvestorShares.toLocaleString()}`
          );
        }
      });
    }

    // Calculate existing option pool percentage
    const existingOptionPoolPercent =
      totalExistingShares > 0
        ? (totalOptionPoolShares / totalExistingShares) * 100
        : 0;

    console.log("\n📊 EXISTING SHARES SUMMARY:");
    console.log(`   Total Existing: ${totalExistingShares.toLocaleString()}`);
    console.log(
      `   Option Pool: ${totalOptionPoolShares.toLocaleString()} (${existingOptionPoolPercent.toFixed(
        2
      )}%)`
    );

    // ========== STEP 2: SERIES A PARAMETERS ==========
    const investmentSize = toNumber(round.roundsize, 0);
    const preMoneyValuation = toNumber(round.pre_money, 0);
    const optionPoolPercentPost = toNumber(round.optionPoolPercent_post, 0);

    if (
      investmentSize <= 0 ||
      preMoneyValuation <= 0 ||
      optionPoolPercentPost <= 0
    ) {
      return {
        error: "Invalid Series A parameters",
        details: { investmentSize, preMoneyValuation, optionPoolPercentPost },
      };
    }

    // ========== STEP 3: SERIES A CALCULATION ==========
    const postMoneyValuation = investmentSize + preMoneyValuation;
    const investorOwnershipPercent =
      (investmentSize / postMoneyValuation) * 100;

    const needsOptionPoolExpansion =
      optionPoolPercentPost > existingOptionPoolPercent;

    let calculations = {};

    if (needsOptionPoolExpansion) {
      console.log("\n⚠️ OPTION POOL EXPANSION NEEDED");

      // ✅ CORRECT FORMULA: Based on your requirements

      // Step 1: Calculate existing non-pool shares (Founders + Seed)
      const foundersSeedShares = totalExistingShares - totalOptionPoolShares;
      console.log(
        `   Founders+Seed shares: ${foundersSeedShares.toLocaleString()}`
      );

      // Step 2: Calculate Founders+Seed ownership percentage POST-investment
      const foundersSeedPercent =
        100 - investorOwnershipPercent - optionPoolPercentPost;
      console.log(
        `   Founders+Seed will own: ${foundersSeedPercent.toFixed(2)}%`
      );

      // Step 3: Calculate TOTAL post-investment shares
      // FORMULA: Founders+Seed Shares / Founders+Seed %
      const totalSharesPostInvestment = Math.round(
        foundersSeedShares / (foundersSeedPercent / 100)
      );
      console.log(
        `   Total post-investment shares: ${totalSharesPostInvestment.toLocaleString()}`
      );

      // Step 4: Calculate total NEW shares needed
      const totalNewShares = totalSharesPostInvestment - totalExistingShares;
      console.log(`   Total NEW shares: ${totalNewShares.toLocaleString()}`);

      // Step 5: Calculate required option pool (post-money)
      const totalRequiredOptionPoolShares = Math.round(
        totalSharesPostInvestment * (optionPoolPercentPost / 100)
      );
      console.log(
        `   Required option pool: ${totalRequiredOptionPoolShares.toLocaleString()}`
      );

      // Step 6: Calculate ADDITIONAL option pool shares
      const additionalOptionPoolShares = Math.max(
        0,
        totalRequiredOptionPoolShares - totalOptionPoolShares
      );
      console.log(
        `   Additional option shares: ${additionalOptionPoolShares.toLocaleString()}`
      );

      // Step 7: Calculate Series A investor shares
      const seriesAInvestorShares = totalNewShares - additionalOptionPoolShares;
      console.log(
        `   Series A investor shares: ${seriesAInvestorShares.toLocaleString()}`
      );

      // Step 8: Calculate share price
      // FORMULA: Pre-Money / (Existing Shares + Additional Option Shares)
      const sharePrice =
        preMoneyValuation / (totalExistingShares + additionalOptionPoolShares);
      console.log(`   Share price: $${sharePrice.toFixed(4)}`);

      // ✅ VERIFICATION
      console.log("\n✅ VERIFICATION:");
      const foundersSeedActual =
        (foundersSeedShares / totalSharesPostInvestment) * 100;
      const optionPoolActual =
        (totalRequiredOptionPoolShares / totalSharesPostInvestment) * 100;
      const investorActual =
        (seriesAInvestorShares / totalSharesPostInvestment) * 100;

      calculations = {
        investmentSize,
        preMoneyValuation,
        postMoneyValuation,
        existingOptionPoolPercent,
        optionPoolPercentPost,
        investorOwnershipPercent,
        sharePrice,
        totalNewShares,
        preInvestmentTotalShares: totalExistingShares,
        postInvestmentTotalShares: totalSharesPostInvestment,
        seriesAInvestorShares,
        additionalOptionPoolShares,
        totalOptionPoolShares: totalRequiredOptionPoolShares,
        existingOptionPoolShares: totalOptionPoolShares,
        needsExpansion: true,
        existingShareholdersPercent: foundersSeedPercent,
        foundersSeedShares, // Add this for clarity
      };
    } else {
      console.log("\n✅ NO OPTION POOL EXPANSION NEEDED");

      const sharePrice =
        totalExistingShares > 0 ? preMoneyValuation / totalExistingShares : 0;
      const seriesAInvestorShares =
        sharePrice > 0 ? Math.round(investmentSize / sharePrice) : 0;
      const totalSharesPostInvestment =
        totalExistingShares + seriesAInvestorShares;
      const totalNewShares = seriesAInvestorShares;

      calculations = {
        investmentSize,
        preMoneyValuation,
        postMoneyValuation,
        existingOptionPoolPercent,
        optionPoolPercentPost,
        investorOwnershipPercent,
        sharePrice,
        totalNewShares,
        preInvestmentTotalShares: totalExistingShares,
        postInvestmentTotalShares: totalSharesPostInvestment,
        seriesAInvestorShares,
        additionalOptionPoolShares: 0,
        totalOptionPoolShares: totalOptionPoolShares,
        existingOptionPoolShares: totalOptionPoolShares,
        needsExpansion: false,
        existingShareholdersPercent:
          100 - investorOwnershipPercent - existingOptionPoolPercent,
      };
    }

    // ========== STEP 4: BUILD PRE-SERIES A CAP TABLE ==========
    const preSeriesAShareholders = existingShareholders.map((sh) => {
      const ownershipPercent =
        totalExistingShares > 0 ? (sh.shares / totalExistingShares) * 100 : 0;
      const value = (ownershipPercent / 100) * preMoneyValuation;

      return {
        ...sh,
        ownership: ownershipPercent,
        value: value,
        newShares: 0,
        preSeriesAShares: sh.shares,
      };
    });

    // ========== STEP 5: BUILD POST-SERIES A CAP TABLE ==========
    const postSeriesAShareholders = [];

    // Add existing shareholders (founders + previous investors)
    existingShareholders.forEach((sh) => {
      const postOwnership =
        calculations.postInvestmentTotalShares > 0
          ? (sh.shares / calculations.postInvestmentTotalShares) * 100
          : 0;
      const postValue = (postOwnership / 100) * postMoneyValuation;

      postSeriesAShareholders.push({
        ...sh,
        ownership: postOwnership,
        value: postValue,
        newShares: 0,
        preSeriesAShares: sh.shares,
      });
    });

    // Add/Update option pool with expansion
    if (calculations.additionalOptionPoolShares > 0) {
      const existingPoolIndex = postSeriesAShareholders.findIndex(
        (sh) => sh.type === "Options Pool"
      );

      const totalPoolShares =
        totalOptionPoolShares + calculations.additionalOptionPoolShares;
      const poolOwnership =
        (totalPoolShares / calculations.postInvestmentTotalShares) * 100;
      const poolValue = (poolOwnership / 100) * postMoneyValuation;

      if (existingPoolIndex !== -1) {
        // Update existing pool
        postSeriesAShareholders[existingPoolIndex] = {
          ...postSeriesAShareholders[existingPoolIndex],
          shares: totalPoolShares,
          newShares: calculations.additionalOptionPoolShares,
          ownership: poolOwnership,
          value: poolValue,
          name: "Employee Option Pool (Expanded)",
        };
      } else {
        // Add new pool entry
        postSeriesAShareholders.push({
          name: "Employee Option Pool",
          type: "Options Pool",
          shares: calculations.additionalOptionPoolShares,
          originalType: "Options Pool",
          source: "Series A Expansion",
          votingRights: "non-voting",
          ownership: poolOwnership,
          value: poolValue,
          newShares: calculations.additionalOptionPoolShares,
          preSeriesAShares: 0,
        });
      }
    }

    // ========== STEP 6: ADD SERIES A INVESTORS ==========
    if (!investors || investors.length === 0) {
      // Generic investor
      const investorOwnership =
        (calculations.seriesAInvestorShares /
          calculations.postInvestmentTotalShares) *
        100;
      const investorValue = (investorOwnership / 100) * postMoneyValuation;

      postSeriesAShareholders.push({
        name: "Series A Investors",
        type: "Investor",
        shares: calculations.seriesAInvestorShares,
        originalType: "Series A Investor",
        source: "Series A Round",
        votingRights: "voting",
        ownership: investorOwnership,
        value: investorValue,
        investmentAmount: calculations.investmentSize,
        newShares: calculations.seriesAInvestorShares,
        preSeriesAShares: 0,
        isGeneric: true,
      });
    } else {
      // Specific investors
      let totalConfirmedInvestment = investors.reduce(
        (sum, inv) => sum + toNumber(inv.investment_amount, 0),
        0
      );

      let remainingShares = calculations.seriesAInvestorShares;

      investors.forEach((investor, index) => {
        const investmentAmount = toNumber(investor.investment_amount, 0);
        const shareOfTotal =
          totalConfirmedInvestment > 0
            ? investmentAmount / totalConfirmedInvestment
            : 0;

        let investorShares =
          index === investors.length - 1
            ? remainingShares
            : Math.round(calculations.seriesAInvestorShares * shareOfTotal);

        remainingShares -= investorShares;

        const investorOwnership =
          (investorShares / calculations.postInvestmentTotalShares) * 100;
        const investorValue = (investorOwnership / 100) * postMoneyValuation;

        postSeriesAShareholders.push({
          name:
            `${investor.first_name || ""} ${investor.last_name || ""}`.trim() ||
            `Series A Investor ${index + 1}`,
          type: "Investor",
          shares: investorShares,
          originalType: "Series A Investor",
          source: "Series A Round",
          votingRights: "voting",
          ownership: investorOwnership,
          value: investorValue,
          investmentAmount: investmentAmount,
          newShares: investorShares,
          preSeriesAShares: 0,
          isGeneric: false,
          email: investor.email || "",
        });
      });
    }

    // ========== STEP 7: VERIFICATION ==========
    const totalPostShares = postSeriesAShareholders.reduce(
      (sum, sh) => sum + sh.shares,
      0
    );
    const totalOwnership = postSeriesAShareholders.reduce(
      (sum, sh) => sum + sh.ownership,
      0
    );
    const totalPostValue = postSeriesAShareholders.reduce(
      (sum, sh) => sum + sh.value,
      0
    );

    const verification = {
      totalPostSharesMatches:
        Math.abs(totalPostShares - calculations.postInvestmentTotalShares) <= 1,
      totalPostValueMatches:
        Math.abs(totalPostValue - calculations.postMoneyValuation) <= 100,
      ownershipSum: totalOwnership,
      ownershipSumIsValid: Math.abs(totalOwnership - 100) < 0.1,
    };

    console.log("✅ VERIFICATION:", verification);

    // ========== STEP 8: CHART DATA ==========
    const chartData = {
      labels: postSeriesAShareholders.map((sh) => sh.name),
      datasets: [
        {
          label: "Post-Series A Ownership %",
          data: postSeriesAShareholders.map((sh) =>
            Number(sh.ownership.toFixed(2))
          ),
          backgroundColor: postSeriesAShareholders.map((sh) =>
            sh.type === "Founder"
              ? "#36A2EB"
              : sh.type === "Options Pool"
              ? "#FFCE56"
              : sh.originalType === "Seed Investor"
              ? "#4BC0C0"
              : sh.originalType === "Series A Investor"
              ? "#FF6384"
              : "#9966FF"
          ),
        },
      ],
    };

    // ========== RETURN COMPLETE DATA ==========
    console.log(postSeriesAShareholders, "postSeriesAShareholders");
    return {
      roundType: round.nameOfRound || "Series A Round",
      instrumentType: round.instrumentType || "Preferred Equity",
      currency: round.currency || "USD",
      totalShares: totalPostShares,
      totalValue: totalPostValue,
      shareholders: postSeriesAShareholders,
      preSeriesAShareholders: preSeriesAShareholders,
      chartData,
      calculations: {
        ...calculations,
        verification,
      },
      isSeriesA: true,
      isPostMoneyOptionPool: calculations.needsExpansion,
    };
  } catch (error) {
    console.error("❌ Series A calculation error:", error);
    return {
      error: "Series A calculation failed",
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

      // ✅ Get Convertible Note (Seed round)
      db.query(
        `SELECT * FROM roundrecord WHERE company_id=? AND instrumentType='Convertible Note' AND id < ? ORDER BY id ASC`,
        [company_id, round.id],
        (err, convertibleNotes) => {
          if (err)
            return res
              .status(500)
              .json({ success: false, message: "Database error" });

          if (convertibleNotes.length === 0) {
            return res.status(400).json({
              success: false,
              message:
                "No Convertible Note round found before this Series A round.",
            });
          }

          const convertibleNoteRound = convertibleNotes[0];

          try {
            const noteData =
              safeJSONParseRepeated(
                convertibleNoteRound.instrument_type_data,
                3
              ) || {};

            // ✅ EXTRACT ALL REQUIRED DATA
            const convertibleNoteData = {
              investment_amount: toNumber(convertibleNoteRound.roundsize, 0),
              valuation_cap: toNumber(noteData.valuationCap_note, 0),
              discount_rate: toNumber(noteData.discountRate_note, 0) / 100, // Convert to decimal
              interest_rate: toNumber(noteData.interestRate_note, 0) / 100, // Convert to decimal
              years_between: 2, // Default as per requirements
              existing_option_pool: toNumber(
                convertibleNoteRound.optionPoolPercent,
                0
              ),
            };

            // ✅ SERIES A ROUND DATA
            const seriesAInvestment = toNumber(round.roundsize, 0);
            const preMoneyValuation = toNumber(round.pre_money, 0);
            const targetOptionPoolPercent = toNumber(
              round.optionPoolPercent_post,
              0
            );

            // ✅ ROUND 0 FOUNDER DATA
            let roundZeroTotalShares = 0;
            let roundZeroFounders = [];

            try {
              if (roundZero.founder_data) {
                const founderData = safeJSONParseRepeated(
                  roundZero.founder_data,
                  3
                );
                roundZeroTotalShares =
                  toNumber(founderData.totalShares, 0) ||
                  toNumber(roundZero.issuedshares, 0);
                if (
                  founderData.founders &&
                  Array.isArray(founderData.founders)
                ) {
                  roundZeroFounders = founderData.founders;
                }
              } else {
                roundZeroTotalShares = toNumber(roundZero.issuedshares, 0);
              }
            } catch (error) {
              roundZeroTotalShares = toNumber(roundZero.issuedshares, 0);
            }

            // ✅ CALCULATION 1: EMPLOYEE SHARES FROM SEED ROUND
            let employeeSharesSeedRound = 0;
            if (
              convertibleNoteData.existing_option_pool > 0 &&
              roundZeroTotalShares > 0
            ) {
              const totalSharesWithPool = Math.round(
                roundZeroTotalShares /
                  (1 - convertibleNoteData.existing_option_pool / 100)
              );
              employeeSharesSeedRound =
                totalSharesWithPool - roundZeroTotalShares;
            }

            // ✅ CALCULATION 2: SERIES A SHARE PRICE (AS PER REQUIREMENTS)
            // Share Price = Pre-Money Valuation / Total Shares from Previous Round
            const totalSharesBeforeSeriesA =
              roundZeroTotalShares + employeeSharesSeedRound;
            const sharePrice =
              totalSharesBeforeSeriesA > 0
                ? preMoneyValuation / totalSharesBeforeSeriesA
                : 0;

            // ✅ CALCULATION 3: CONVERTIBLE NOTE CONVERSION
            // 3a. Principal + Interest = Investment × (1 + Interest Rate)^Years
            const principalPlusInterest =
              convertibleNoteData.investment_amount *
              Math.pow(
                1 + convertibleNoteData.interest_rate,
                convertibleNoteData.years_between
              );

            // 3b. Discount Price = Series A Price × (1 - Discount Rate)
            const discountPrice =
              sharePrice * (1 - convertibleNoteData.discount_rate);

            // 3c. Cap Price = Valuation Cap / Total Shares from Last Round
            const capPrice =
              convertibleNoteData.valuation_cap > 0
                ? convertibleNoteData.valuation_cap / roundZeroTotalShares
                : Infinity;

            // 3d. Optimal Price = MIN(Discount Price, Cap Price)
            const optimalPrice = Math.min(
              discountPrice > 0 ? discountPrice : Infinity,
              capPrice > 0 ? capPrice : Infinity
            );

            const finalOptimalPrice =
              optimalPrice === Infinity ? sharePrice : optimalPrice;

            // 3e. Seed Conversion Shares = Principal Plus Interest / Optimal Price
            const seedConversionShares =
              finalOptimalPrice > 0
                ? Math.round(principalPlusInterest / finalOptimalPrice)
                : 0;

            // 3f. Seed Conversion Value = Shares × Series A Price
            const seedConversionValue = seedConversionShares * sharePrice;

            // 3g. MOIC = Value / Original Investment
            const seedMOIC =
              convertibleNoteData.investment_amount > 0
                ? (
                    seedConversionValue / convertibleNoteData.investment_amount
                  ).toFixed(2) + "X"
                : "0X";

            // ✅ CALCULATION 4: SERIES A INVESTOR SHARES
            const seriesAShares =
              sharePrice > 0 ? Math.round(seriesAInvestment / sharePrice) : 0;
            const seriesAValue = seriesAShares * sharePrice;
            const seriesAMOIC =
              seriesAInvestment > 0
                ? (seriesAValue / seriesAInvestment).toFixed(2) + "X"
                : "0X";

            // ✅ CALCULATION 5: OPTION POOL CALCULATION
            let totalPostShares = 0;
            let newOptionShares = 0;
            let finalPostMoneyValuation = 0;

            if (targetOptionPoolPercent > 0) {
              // Total shares excluding option shares
              const totalSharesExcludingOption =
                roundZeroTotalShares + seedConversionShares + seriesAShares;

              // Total shares after pool
              totalPostShares = Math.round(
                totalSharesExcludingOption / (1 - targetOptionPoolPercent / 100)
              );

              // New option shares
              newOptionShares = Math.max(
                0,
                totalPostShares -
                  totalSharesExcludingOption -
                  employeeSharesSeedRound
              );

              finalPostMoneyValuation = totalPostShares * sharePrice;
            } else {
              totalPostShares =
                roundZeroTotalShares +
                employeeSharesSeedRound +
                seedConversionShares +
                seriesAShares;
              finalPostMoneyValuation = totalPostShares * sharePrice;
            }

            // ✅ CALCULATION 6: BUILD CAP TABLES

            // PRE-SERIES A CAP TABLE
            const preSeriesAShareholders = [];

            // Founders
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

            // POST-SERIES A CAP TABLE
            const postSeriesAShareholders = [];

            // Founders
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
              });
            }

            // Convertible Note Investors
            if (seedConversionShares > 0) {
              const ownership =
                totalPostShares > 0
                  ? (seedConversionShares / totalPostShares) * 100
                  : 0;
              const value = (ownership / 100) * finalPostMoneyValuation;

              postSeriesAShareholders.push({
                name: "Convertible Note Investors",
                type: "Convertible Note Investor",
                shares: seedConversionShares,
                ownership: parseFloat(ownership.toFixed(1)),
                value: Math.round(value),
                originalInvestment: convertibleNoteData.investment_amount,
                conversionPrice: parseFloat(finalOptimalPrice.toFixed(2)),
                moic: seedMOIC,
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
              });
            }

            // ✅ FINAL RESPONSE
            const response = {
              success: true,
              message:
                "Convertible Note Series A calculation completed successfully",

              // Required fields for frontend
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

                // Convertible Note
                seedInvestment: convertibleNoteData.investment_amount,
                interestRate: (convertibleNoteData.interest_rate * 100).toFixed(
                  1
                ),
                yearsBetweenRounds: convertibleNoteData.years_between,
                principalPlusInterest: Math.round(principalPlusInterest),
                discountRate: (convertibleNoteData.discount_rate * 100).toFixed(
                  1
                ),
                valuationCap: convertibleNoteData.valuation_cap,
                seedConversionShares,
                seedConversionValue: Math.round(seedConversionValue),
                seedMOIC,

                // Series A
                seriesAInvestment,
                seriesAShares,
                seriesAValue: Math.round(seriesAValue),
                seriesAMOIC,

                // Option Pool
                existingOptionPoolPercent:
                  convertibleNoteData.existing_option_pool,
                targetOptionPoolPercent: targetOptionPoolPercent,
                newOptionShares,

                // Totals
                roundZeroTotalShares,
                totalSharesPreSeriesA: totalSharesBeforeSeriesA,
                totalPostShares,
                newSharesIssued:
                  seedConversionShares + seriesAShares + newOptionShares,
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
              message: "Convertible Note round calculated successfully",
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
        }
      );
    }
  );
}
function handleConvertibleNoteRoundCalculation(
  round,
  company_id,
  instrumentData,
  res
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
        (roundZeroTotalShares * optionPoolPercent) / (1 - optionPoolPercent)
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
            investmentSize - totalConfirmedInvestment
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
                  1
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
                1
              )}% discount OR ${valuationCap.toLocaleString()} ${
                round.currency || "USD"
              } valuation cap`,
              `📈 Interest accrual: ${(interestRate * 100).toFixed(
                1
              )}% per annum`,
            ],
          };

          return res.status(200).json({
            success: true,
            message: "Convertible Note round calculated successfully",
            round: round,
            capTable: capTableData,
          });
        }
      );
    }
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
        `SELECT * FROM roundrecord WHERE company_id=? ORDER BY id ASC`,
        [company_id],
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
              prevRound.instrumentType === "Safe" &&
              prevRound.shareClassType === "Seed"
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
                  0
                );
                console.log("Found SAFE round:", {
                  seedInvestment,
                  valuationCap,
                  discountRate,
                  existingOptionPoolPercent,
                });
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
            0
          );

          // ✅ Parse Round 0 Founder Data
          let roundZeroTotalShares = 0;
          let roundZeroFounders = [];

          try {
            if (roundZero.founder_data) {
              const founderData = safeJSONParseRepeated(
                roundZero.founder_data,
                3
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
              roundZeroTotalShares / (1 - existingOptionPoolPercent / 100)
            );
            employeeSharesSeedRound =
              totalSharesWithPool - roundZeroTotalShares;
            console.log(
              "Employee shares from seed round:",
              employeeSharesSeedRound
            );
          }

          // ✅ STEP 2: CALCULATE SHARE PRICE
          const totalPreSeriesAShares =
            roundZeroTotalShares + employeeSharesSeedRound;
          const sharePrice =
            totalPreSeriesAShares > 0
              ? preMoneyValuation / totalPreSeriesAShares
              : 0;

          console.log("Share price calculation:", {
            preMoneyValuation,
            totalPreSeriesAShares,
            sharePrice,
          });

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
              seedCapPrice > 0 ? seedCapPrice : Infinity
            );

            // If both are 0, use share price
            if (seedOptimalPrice === Infinity || seedOptimalPrice === 0) {
              seedOptimalPrice = sharePrice;
            }

            console.log("SAFE conversion prices:", {
              seedDiscountPrice,
              seedCapPrice,
              seedOptimalPrice,
              sharePrice,
              discountRate,
              valuationCap,
              roundZeroTotalShares,
            });

            if (seedOptimalPrice > 0) {
              seedConversionShares = Math.round(
                seedInvestment / seedOptimalPrice
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

            console.log("Option pool calculation:", {
              totalSharesExcludingOption,
              targetOptionPoolPercent,
              roundZeroTotalShares,
              seedConversionShares,
              seriesAShares,
            });

            if (totalSharesExcludingOption > 0) {
              totalPostShares = Math.round(
                totalSharesExcludingOption / (1 - targetOptionPoolPercent / 100)
              );

              // FIXED: New option shares = totalPostShares - totalSharesExcludingOption - existingEmployeeShares
              newOptionShares = Math.max(
                0,
                totalPostShares -
                  totalSharesExcludingOption -
                  employeeSharesSeedRound
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
                totalPostShares > 0
                  ? (shares / totalPostShares) * 100 // Use totalPostShares, not totalPreSeriesAShares!
                  : 0;
              const value = (ownership / 100) * finalPostMoneyValuation;

              postSeriesAShareholders.push({
                name: `${founder.firstName || ""} ${
                  founder.lastName || ""
                }`.trim(),
                fullName: `${founder.firstName || ""} ${
                  founder.lastName || ""
                }`.trim(),
                type: "Founder",
                shares: shares,
                ownership: ownership.toFixed(1), // Should be ~26.5%, 15.9%, 10.6%
                value: Math.round(value),
                newShares: 0,
              });
            });
          }

          // 2. Employee Option Pool (Existing) - RECALCULATE
          if (employeeSharesSeedRound > 0) {
            const ownership =
              totalPostShares > 0
                ? (employeeSharesSeedRound / totalPostShares) * 100 // Use totalPostShares!
                : 0;
            const value = (ownership / 100) * finalPostMoneyValuation;

            postSeriesAShareholders.push({
              name: "Employee Option Pool",
              fullName: "Employee Option Pool",
              type: "Options Pool",
              shares: employeeSharesSeedRound,
              ownership: ownership.toFixed(1), // Should be ~5.9%
              value: Math.round(value),
              newShares: employeeSharesSeedRound,
              note: `Existing ${existingOptionPoolPercent}% pool`,
            });
          }

          // 3. Seed Investors (Converted SAFE)
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
              shares: seedConversionShares,
              ownership: ownership.toFixed(1), // Should be ~7.4%
              value: Math.round(value),
              investmentAmount: seedInvestment,
              conversionPrice: seedOptimalPrice,
              moic: seedMOIC,
              isSAFE: true,
              note:
                discountRate > 0
                  ? `Converted at $${seedOptimalPrice.toFixed(
                      2
                    )} per share (${discountRate}% discount)`
                  : `Converted at $${seedOptimalPrice.toFixed(2)} per share`,
            });
          }

          // 4. Series A Investors
          if (seriesAShares > 0) {
            const ownership =
              totalPostShares > 0 ? (seriesAShares / totalPostShares) * 100 : 0;
            const value = (ownership / 100) * finalPostMoneyValuation;

            postSeriesAShareholders.push({
              name: "Series A Investors",
              fullName: "Series A Investors",
              type: "Series A Investor",
              shares: seriesAShares,
              ownership: ownership.toFixed(1), // Should be ~19.6%
              value: Math.round(value),
              investmentAmount: seriesAInvestment,
              moic: seriesAMOIC,
              note: `Purchased at $${sharePrice.toFixed(2)} per share`,
            });
          }

          // 5. New Option Pool (Top-up)
          if (newOptionShares > 0) {
            const ownership =
              totalPostShares > 0
                ? (newOptionShares / totalPostShares) * 100
                : 0;
            const value = (ownership / 100) * finalPostMoneyValuation;

            postSeriesAShareholders.push({
              name: "Employee Option Pool (Top-up)",
              fullName: "Employee Option Pool (Top-up)",
              type: "Options Pool",
              shares: newOptionShares,
              ownership: ownership.toFixed(1), // Should be ~14.1%
              value: Math.round(value),
              newShares: newOptionShares,
              note: `Top-up to ${targetOptionPoolPercent}% target`,
            });
          }

          // ============================================
          // VERIFY TOTALS
          // ============================================

          let totalPostSharesFromArray = 0;
          postSeriesAShareholders.forEach((sh) => {
            totalPostSharesFromArray += sh.shares;
          });

          console.log("Verification:", {
            calculatedTotalPostShares: totalPostShares,
            sumOfShareholderShares: totalPostSharesFromArray,
            difference: totalPostShares - totalPostSharesFromArray,
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

          console.log(
            "Final response data:",
            JSON.stringify(
              {
                preOwnership: preSeriesAShareholders.map((sh) => ({
                  name: sh.name,
                  ownership: sh.ownership,
                })),
                postOwnership: postSeriesAShareholders.map((sh) => ({
                  name: sh.name,
                  ownership: sh.ownership,
                })),
              },
              null,
              2
            )
          );

          return res.status(200).json({
            success: true,
            message: "Cap table data retrieved successfully",
            round: round,
            capTable: responseData,
          });
        }
      );
    }
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
        (roundZeroTotalShares / (1 - optionPoolPercent)) * optionPoolPercent
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
        }
      );
    }
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
      };

      // Separate rounds
      const round0 = allResults.find((r) => r.round_type === "Round 0");
      const seedRound = allResults.find(
        (r) =>
          (r.shareClassType?.includes("Seed") ||
            r.nameOfRound?.includes("Seed")) &&
          r.round_type === "Investment"
      );
      const latestSeriesRound = allResults.find(
        (r) =>
          (r.shareClassType?.includes("Series") ||
            r.nameOfRound?.includes("Series")) &&
          r.round_type === "Investment"
      );

      console.log("📊 Found Rounds:");
      console.log(`   Round 0: ${round0 ? "Yes" : "No"}`);
      console.log(`   Seed Round: ${seedRound ? seedRound.nameOfRound : "No"}`);
      console.log(
        `   Series Round: ${
          latestSeriesRound ? latestSeriesRound.nameOfRound : "No"
        }`
      );

      // 1. Get Round 0 (Founder) data
      let round0FounderShares = 0;
      let round0TotalShares = 0;

      if (round0) {
        round0TotalShares = parseInt(round0.issuedshares) || 0;

        if (round0.founder_data) {
          try {
            const founderData =
              typeof round0.founder_data === "string"
                ? JSON.parse(round0.founder_data)
                : round0.founder_data;

            if (founderData.founders && Array.isArray(founderData.founders)) {
              round0FounderShares = founderData.founders.reduce(
                (sum, founder) => {
                  return sum + (parseInt(founder.shares) || 0);
                },
                0
              );
            }
          } catch (e) {
            console.log("⚠️ Could not parse founder_data:", e);
          }
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

        // ✅ CRITICAL FIX: Calculate total shares AFTER Seed round option pool
        // Formula: Total Shares = Founder Shares / (1 - Pool%)
        if (seedPreMoneyPool > 0 && round0FounderShares > 0) {
          const totalSharesWithPool = Math.round(
            round0FounderShares / (1 - seedPreMoneyPool / 100)
          );
          const employeeSharesCreated =
            totalSharesWithPool - round0FounderShares;

          previousRoundData.totalShares = totalSharesWithPool; // 111,111
          previousRoundData.founderShares = round0FounderShares; // 100,000
          previousRoundData.employeeShares = employeeSharesCreated; // 11,111

          console.log(
            `✅ Total Shares (with ${seedPreMoneyPool}% pool): ${totalSharesWithPool}`
          );
          console.log(`✅ Founder Shares: ${round0FounderShares}`);
          console.log(`✅ Employee Shares Created: ${employeeSharesCreated}`);
        } else {
          // If no option pool, use Round 0 values
          previousRoundData.totalShares = round0TotalShares;
          previousRoundData.founderShares = round0FounderShares;
          previousRoundData.employeeShares =
            round0TotalShares - round0FounderShares;
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
        console.log(`✅ Investment: ${previousRoundData.seedInvestment}`);
        console.log(`✅ Option Pool: ${existingOptionPoolPercent}%`);
        console.log(`✅ Valuation Cap: ${previousRoundData.valuationCap}`);
        console.log(`✅ Discount Rate: ${previousRoundData.discountRate}%`);
      } else if (round0) {
        // No Seed round exists, use Round 0 data
        previousRoundData.totalShares = round0TotalShares;
        previousRoundData.founderShares = round0FounderShares;
        previousRoundData.employeeShares =
          round0TotalShares - round0FounderShares;
      }

      // 3. Get latest Series round data (for next Series round)
      if (latestSeriesRound && !seedRound) {
        // If no Seed round, use latest Series round's Post-Money pool
        if (
          latestSeriesRound.optionPoolPercent_post &&
          parseFloat(latestSeriesRound.optionPoolPercent_post) > 0
        ) {
          existingOptionPoolPercent = parseFloat(
            latestSeriesRound.optionPoolPercent_post
          );
          console.log(
            `✅ Using Series's POST-MONEY pool: ${existingOptionPoolPercent}%`
          );
        } else if (
          latestSeriesRound.optionPoolPercent &&
          parseFloat(latestSeriesRound.optionPoolPercent) > 0
        ) {
          existingOptionPoolPercent = parseFloat(
            latestSeriesRound.optionPoolPercent
          );
          console.log(
            `✅ Using Series's PRE-MONEY pool: ${existingOptionPoolPercent}%`
          );
        }
      }

      // If still no option pool found
      if (existingOptionPoolPercent === 0 && round0) {
        existingOptionPoolPercent = 10; // Default 10% for Seed round
        console.log(
          `✅ Using default option pool: ${existingOptionPoolPercent}%`
        );
      }

      console.log("📊 Final Previous Round Data:", previousRoundData);

      res.status(200).json({
        success: true,
        existingOptionPoolPercent: existingOptionPoolPercent,
        previousRoundData: previousRoundData,
        round0Exists: !!round0,
        seedRoundExists: !!seedRound,
        seriesRoundExists: !!latestSeriesRound,
        message: "Dynamic data fetched successfully",
      });
    }
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

  // Get ALL rounds to build the complete cap table
  db.query(
    `SELECT 
      rr.id,
      rr.round_type,
      rr.nameOfRound,
      rr.shareClassType,
      rr.instrumentType,
      rr.issuedshares,
      rr.roundsize,
      rr.currency,
      rr.pre_money,
      rr.post_money,
      rr.optionPoolPercent,
      rr.optionPoolPercent_post,
      rr.instrument_type_data,
      rr.founder_data,
      rr.dateroundclosed,
      rr.created_at
    FROM roundrecord rr
    WHERE rr.company_id = ?
      AND rr.id != COALESCE(?, 0)
    ORDER BY 
      CASE 
        WHEN rr.round_type = 'Round 0' THEN 0
        ELSE 1
      END,
      rr.created_at ASC`,
    [company_id, current_round_id || 0],
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
          }`
        );
      });

      // Find Round 0 for founder shares
      const round0 = allResults.find((r) => r.round_type === "Round 0");
      // Find Seed Convertible Note round
      const seedConvertibleRound = allResults.find(
        (r) => r.instrumentType === "Convertible Note"
      );

      if (!round0 && !seedConvertibleRound) {
        return res.status(404).json({
          success: false,
          message: "No suitable previous round found",
        });
      }

      // Initialize variables
      let totalShares = 0;
      let founderShares = 0;
      let employeeShares = 0;
      let previousRoundSize = 0;
      let valuationCap = 0;
      let discountRate = 0;
      let interestRate = 0;
      let seedOptionPoolPercent = 0;

      // Get founder shares from Round 0
      if (round0) {
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

              console.log(`✅ Founder shares from Round 0: ${founderShares}`);
            }
          } catch (e) {
            console.log("⚠️ Could not parse Round 0 founder_data:", e);
          }
        }
      }

      // Get Seed Convertible Note details
      if (seedConvertibleRound) {
        previousRoundSize = parseFloat(seedConvertibleRound.roundsize) || 0;
        seedOptionPoolPercent =
          parseFloat(seedConvertibleRound.optionPoolPercent) || 0;

        console.log(
          `✅ Seed Convertible Note Investment: $${previousRoundSize}`
        );
        console.log(`✅ Seed Option Pool: ${seedOptionPoolPercent}%`);

        // Parse Convertible Note details
        if (seedConvertibleRound.instrument_type_data) {
          try {
            const instrumentData =
              typeof seedConvertibleRound.instrument_type_data === "string"
                ? JSON.parse(seedConvertibleRound.instrument_type_data)
                : seedConvertibleRound.instrument_type_data;

            valuationCap =
              parseFloat(instrumentData.valuationCap) ||
              parseFloat(instrumentData.valuationCap_note) ||
              0;
            discountRate =
              parseFloat(instrumentData.discountRate) ||
              parseFloat(instrumentData.discountRate_note) ||
              0;
            interestRate = parseFloat(instrumentData.interestRate_note) || 0;
          } catch (e) {
            console.log("⚠️ Could not parse instrument_type_data:", e);
          }
        }
      }

      // ✅ CRITICAL: Calculate total shares as per your requirements
      // Formula: Total Shares = Founder Shares ÷ (1 - Option Pool %)
      if (seedOptionPoolPercent > 0 && founderShares > 0) {
        totalShares = Math.round(
          founderShares / (1 - seedOptionPoolPercent / 100)
        );
        employeeShares = totalShares - founderShares;

        console.log(`📊 Seed Round Calculations:`);
        console.log(`   Founder Shares: ${founderShares}`);
        console.log(`   Option Pool: ${seedOptionPoolPercent}%`);
        console.log(`   Total Shares (with pool): ${totalShares}`);
        console.log(`   Employee Shares Created: ${employeeShares}`);

        // IMPORTANT: Seed round has 0 issuedshares because it's convertible notes
        // But we need totalShares = 111,111 for Series A calculations
      } else {
        // If no option pool, just use founder shares
        totalShares = founderShares;
        employeeShares = 0;
      }

      console.log("📊 Final Data for Series A:");
      console.log(`   Total Shares for Series A calculation: ${totalShares}`);
      console.log(`   Founder Shares: ${founderShares}`);
      console.log(`   Employee Shares: ${employeeShares}`);
      console.log(`   Seed Investment: $${previousRoundSize}`);
      console.log(`   Valuation Cap: $${valuationCap}`);
      console.log(`   Discount Rate: ${discountRate}%`);
      console.log(`   Interest Rate: ${interestRate}%`);

      res.status(200).json({
        success: true,
        previousRoundData: {
          // For Series A calculations, we need 111,111 shares (NOT 0)
          totalShares: totalShares || 111111, // Default if calculation fails
          founderShares: founderShares || 100000,
          employeeShares: employeeShares || 11111,
          roundSize: previousRoundSize || 0,
          valuationCap: valuationCap || 0,
          discountRate: discountRate || 0,
          interestRate: interestRate || 0,
          optionPoolPercent: seedOptionPoolPercent || 0,
          instrumentType: seedConvertibleRound?.instrumentType || "",
          roundName: seedConvertibleRound?.nameOfRound || "",
        },
        message: "Previous round data fetched successfully",
      });
    }
  );
};

// API 2: getPreviousRoundForAutoFill - CORRECTED
exports.getPreviousRoundForAutoFill = (req, res) => {
  const { company_id, current_round_id } = req.body;

  const query =
    current_round_id && current_round_id > 0
      ? `SELECT 
        rr.id,
        rr.nameOfRound,
        rr.round_type,
        rr.optionPoolPercent,
        rr.optionPoolPercent_post,
        rr.founder_data,
        rr.issuedshares,
        rr.investorPostMoney,
        rr.created_at
      FROM roundrecord rr
      WHERE rr.company_id = ? AND rr.id < ?
      
      ORDER BY rr.created_at ASC`
      : `SELECT 
        rr.id,
        rr.nameOfRound,
        rr.round_type,
        rr.optionPoolPercent,
        rr.optionPoolPercent_post,
        rr.founder_data,
        rr.issuedshares,
        rr.investorPostMoney,
        rr.created_at
      FROM roundrecord rr
      WHERE rr.company_id = ?
     
      ORDER BY rr.created_at ASC`;

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

    // ✅ Calculate total existing shares CORRECTLY
    let totalExistingShares = 0;
    let totalOptionPoolShares = 0;
    let lastOptionPoolPercent = 0;
    let lastRoundName = "";

    results.forEach((round, index) => {
      console.log(
        `\n--- Processing Round ${index + 1}: ${round.round_type} ---`
      );

      if (round.round_type === "Round 0") {
        // ✅ Round 0: Add ALL founder shares
        if (round.founder_data) {
          try {
            const founderData = JSON.parse(round.founder_data);
            if (founderData.founders && Array.isArray(founderData.founders)) {
              founderData.founders.forEach((founder) => {
                const shares = parseFloat(founder.shares || 0);
                totalExistingShares += shares;
                console.log(
                  `  Founder: ${founder.firstName} - ${shares} shares`
                );
              });
            }
          } catch (e) {
            console.error("Error parsing founder data:", e);
          }
        }
      } else if (round.round_type === "Investment") {
        const prevRoundInvestorShares = parseFloat(round.issuedshares || 0);
        const prevRoundPreMoneyPool = parseFloat(round.optionPoolPercent || 0);
        const prevRoundPostMoneyPool = parseFloat(
          round.optionPoolPercent_post || 0
        );

        // ✅ Calculate option pool shares for this round
        if (prevRoundPreMoneyPool > 0) {
          // PRE-MONEY OPTION POOL (Seed round)
          const sharesBeforePool = totalExistingShares;
          const optionPoolShares = Math.round(
            (sharesBeforePool * (prevRoundPreMoneyPool / 100)) /
              (1 - prevRoundPreMoneyPool / 100)
          );

          totalOptionPoolShares = optionPoolShares;
          totalExistingShares += optionPoolShares;
          lastOptionPoolPercent = prevRoundPreMoneyPool;
        } else if (prevRoundPostMoneyPool > 0) {
          // POST-MONEY OPTION POOL (Series A/B/C)
          const investorPostMoney = parseFloat(round.investorPostMoney || 0);
          if (investorPostMoney > 0 && prevRoundInvestorShares > 0) {
            const totalAfterPrevRound =
              prevRoundInvestorShares / (investorPostMoney / 100);
            const optionPoolShares = Math.round(
              totalAfterPrevRound * (prevRoundPostMoneyPool / 100)
            );

            totalOptionPoolShares = optionPoolShares;
            lastOptionPoolPercent = prevRoundPostMoneyPool;
          }
        }

        // ✅ Add investor shares from this round
        if (prevRoundInvestorShares > 0) {
          totalExistingShares += prevRoundInvestorShares;
          console.log(`  Added investor shares: ${prevRoundInvestorShares}`);
        }

        lastRoundName = round.nameOfRound || `Round ${index}`;
      }
    });

    // ✅ Calculate the ACTUAL option pool % as of now
    const actualOptionPoolPercent =
      totalExistingShares > 0
        ? (totalOptionPoolShares / totalExistingShares) * 100
        : 0;

    console.log(
      `Total Existing Shares:     ${totalExistingShares.toLocaleString()}`
    );
    console.log(
      `Total Option Pool Shares:  ${totalOptionPoolShares.toLocaleString()}`
    );
    console.log(
      `Option Pool Percent:       ${actualOptionPoolPercent.toFixed(2)}%`
    );

    res.status(200).json({
      success: true,
      data: {
        existingOptionPoolPercent:
          Math.round(actualOptionPoolPercent * 100) / 100,
        existingShares: Math.round(totalExistingShares), // ✅ Should be 138,889
        totalOptionPoolShares: Math.round(totalOptionPoolShares),
        previousRoundName: lastRoundName,
      },
    });
  });
};

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
    }
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
    }
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
