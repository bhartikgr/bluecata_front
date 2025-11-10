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
exports.CreateOrUpdateCapitalRound = (req, res) => {
  const uploadFields = upload.fields([
    { name: "termsheetFile", maxCount: 10 },
    { name: "subscriptiondocument", maxCount: 10 },
  ]);

  uploadFields(req, res, async (err) => {
    if (err) {
      return res.status(500).json({ message: "File upload error", error: err });
    }

    // Parse JSON fields and handle empty values
    const {
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
    } = req.body;
    console.log(req.body);
    // Use ClientIP if ip_address is empty
    const clientIp = ip_address || ClientIP;

    // Extract uploaded files - Handle no files case
    const newTermsheetFiles =
      req.files && req.files["termsheetFile"]
        ? req.files["termsheetFile"].map((f) => f.filename)
        : [];

    const newSubscriptionDocs =
      req.files && req.files["subscriptiondocument"]
        ? req.files["subscriptiondocument"].map((f) => f.filename)
        : [];

    // Parse JSON fields - Handle parsing safely
    let parsedInstrumentData = {};
    try {
      parsedInstrumentData = instrument_type_data
        ? JSON.parse(instrument_type_data)
        : {};
    } catch (e) {
      console.error("Error parsing instrument_type_data:", e);
      parsedInstrumentData = {};
    }

    // ---------------- UPDATE CASE ----------------
    if (id && id !== "undefined" && id !== null && id !== "") {
      let processedDateRoundClosed = dateroundclosed;
      if (Array.isArray(dateroundclosed)) {
        // Take the first non-empty value from the array
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
            company_id = ?, roundStatus = ?, instrument_type_data = ?, created_by_id = ?, created_by_role = ?, 
            dateroundclosed = ?, nameOfRound = ?, shareClassType = ?, shareclassother = ?, description = ?, 
            instrumentType = ?, customInstrument = ?, roundsize = ?, currency = ?, issuedshares = ?, rights = ?, 
            liquidationpreferences = ?, liquidation = ?, liquidationOther = ?, convertible = ?, convertibleType = ?, 
            voting = ?, generalnotes = ?, updated_by_id = ?, updated_by_role = ?, round_type = ?, founder_data = ?, 
            total_founder_shares = ?, founder_count = ?`;

          const values = [
            company_id,
            roundStatus || "",
            JSON.stringify(parsedInstrumentData),
            created_by_id,
            created_by_role,
            processedDateRoundClosed, // FIX: Use processed date instead of raw
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

          // Handle file updates
          let finalTermsheetFiles = newTermsheetFiles;
          let finalSubscriptionDocs = newSubscriptionDocs;

          // If no new files but existing files, keep existing
          if (newTermsheetFiles.length === 0 && existingTermsheetFiles) {
            try {
              finalTermsheetFiles = JSON.parse(existingTermsheetFiles);
            } catch (e) {
              finalTermsheetFiles = [];
            }
          }

          if (newSubscriptionDocs.length === 0 && existingSubscriptionDocs) {
            try {
              finalSubscriptionDocs = JSON.parse(existingSubscriptionDocs);
            } catch (e) {
              finalSubscriptionDocs = [];
            }
          }

          sql += `, termsheetFile = ?, subscriptiondocument = ?`;
          values.push(JSON.stringify(finalTermsheetFiles));
          values.push(JSON.stringify(finalSubscriptionDocs));

          sql += " WHERE id = ?";
          values.push(id);

          console.log("Update SQL:", sql);
          console.log("Update values:", values);

          db.query(sql, values, (err) => {
            if (err) {
              console.error("Update error:", err);
              return res.status(500).json({ message: "DB update error", err });
            }

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

            res
              .status(200)
              .json({ message: "Record updated successfully", id });
          });
        }
      );
    } else {
      // ---------------- INSERT CASE ----------------
      // CORRECTED: Counted columns properly - your table has exactly these 34 columns (not 35)
      const sql = `INSERT INTO roundrecord (company_id,created_by_id,created_by_role,updated_by_id,updated_by_role,round_type, nameOfRound, shareClassType, shareclassother,description,instrumentType,instrument_type_data,customInstrument,roundsize,currency,issuedshares, rights, liquidationpreferences,liquidation,liquidationOther,convertible, convertibleType, voting, termsheetFile, subscriptiondocument, 
   generalnotes, dateroundclosed, roundStatus, is_shared, is_locked, 
   created_at, founder_data, total_founder_shares, founder_count)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      // Parse numeric values
      const parsedFounderCount = founder_count ? parseInt(founder_count) : null;
      const parsedTotalFounderShares = total_founder_shares
        ? parseInt(total_founder_shares)
        : null;

      // FIX: Handle dateroundclosed array issue
      let processedDateRoundClosed = dateroundclosed;
      if (Array.isArray(dateroundclosed)) {
        // Take the first non-empty value from the array
        processedDateRoundClosed =
          dateroundclosed.find((date) => date && date.trim() !== "") || null;
      }

      const values = [
        // Basic required fields (in exact order of your table structure)
        company_id,
        created_by_id,
        created_by_role,
        0, // updated_by_id (NOT NULL, default 0)
        null, // updated_by_role (NULL)

        // Round info
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

        // File fields
        JSON.stringify(newTermsheetFiles),
        JSON.stringify(newSubscriptionDocs),

        // Additional fields - FIXED: Use processedDateRoundClosed instead of raw array
        generalnotes || "",
        processedDateRoundClosed, // FIX: This was causing the array issue
        roundStatus || "",
        "No", // is_shared (NOT NULL, default 'No')
        "No", // is_locked (NOT NULL, default 'No')

        // Timestamp
        new Date(),

        // Round 0 specific fields
        JSON.stringify(founder_data) || null,
        parsedTotalFounderShares,
        parsedFounderCount,
      ];

      // Debug: Log the exact placeholder count
      const placeholderCount = (sql.match(/\?/g) || []).length;

      db.query(sql, values, (err, result) => {
        if (err) {
          console.error("Database insert error:", err);
          console.error("Error details:", err.sqlMessage);
          return res
            .status(500)
            .json({ message: "DB insert error: " + err.sqlMessage, err });
        }

        insertAccessLog({
          userId: created_by_id,
          userRole: created_by_role,
          companyId: company_id,
          action: "CREATE",
          targetTable: "roundrecord",
          targetId: result.insertId,
          description: `Created round record: ${nameOfRound}`,
          ip: clientIp,
        });

        insertAuditLog({
          userId: created_by_id,
          companyId: company_id,
          module: "capital_round",
          action: "CREATE",
          entityId: result.insertId,
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

        res.status(200).json({
          message: "Record created successfully",
          id: result.insertId,
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

  const query = `SELECT * from roundrecord where company_id = ? And is_locked = ?  order by id desc`;

  db.query(query, [company_id, "Yes"], (err, results) => {
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
            if (
              typeof rawData === "string" &&
              rawData.startsWith('"') &&
              rawData.endsWith('"')
            ) {
              rawData = rawData.slice(1, -1).replace(/\\"/g, '"');
            }
            processedRecord.founder_data = JSON.parse(rawData);
          } catch (err) {
            console.error("Error parsing founder_data:", err);
            processedRecord.founder_data = null;
          }
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

      // Step 3: For investment rounds, get investors
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

          // Step 4: Get Round 0 data for calculations
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

  try {
    // Use safe JSON parser instead of direct JSON.parse
    const founderData = safeJSONParse(round.founder_data);

    console.log("🔍 DEBUG - Parsed Founder Data:", founderData);

    // Check if we have valid data
    if (!founderData || Object.keys(founderData).length === 0) {
      throw new Error("Empty or invalid founder data");
    }

    const founders = founderData.founders || [];
    const pricePerShare = parseFloat(founderData.pricePerShare) || 0.01;

    console.log("🔍 DEBUG - Founders array:", founders);

    shareholders = founders.map((founder, index) => {
      const shares = parseInt(founder.shares) || 0;
      const value = shares * pricePerShare;

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
        ownership: 0, // Will calculate after total
        value: value,
        round_type: round.round_type,
        shareType: founder.shareType || "common",
        votingRights: founder.voting || "voting",
      };
    });

    // Calculate totals
    totalShares = shareholders.reduce((sum, s) => sum + s.shares, 0);
    totalValue = shareholders.reduce((sum, s) => sum + s.value, 0);

    // Calculate ownership percentages
    shareholders.forEach((sh) => {
      sh.ownership = totalShares > 0 ? (sh.shares / totalShares) * 100 : 0;
    });
  } catch (error) {
    console.error("❌ Error parsing Round 0 data:", error);
    console.error("❌ Error stack:", error.stack);

    // Return detailed error for debugging
    return {
      error: "Invalid Round 0 data structure: " + error.message,
      debug: {
        rawFounderData: round.founder_data,
        dataType: typeof round.founder_data,
        dataLength: round.founder_data ? round.founder_data.length : 0,
        sample: round.founder_data
          ? round.founder_data.substring(0, 200)
          : "null",
      },
    };
  }

  // Chart Data
  const chartData = {
    labels: shareholders.map((sh) =>
      sh.firstName || sh.lastName
        ? `${sh.firstName} ${sh.lastName}`.trim()
        : `Founder ${shareholders.indexOf(sh) + 1}`
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
    shareClass: round.shareClassType || "Common Shares",
    currency: round.currency || "USD",
    totalShares,
    totalValue,
    shareholders,
    chartData,
    calculations: {
      totalSharesIssued: totalShares,
      sharePrice: parseFloat(round.pricePerShare) || 0.01,
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

      // Step 3: For investment rounds, get investors
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

          // Step 4: Get Round 0 data for calculations
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

// 🔹 Investment Round Cap Table Calculation (Round 1, Seed, etc.)
function calculateInvestmentRoundCapTable(round, investors, roundZero) {
  // Parse Round 0 founder data
  let roundZeroFounders = [];
  let roundZeroTotalShares = 0;

  try {
    const founderData = JSON.parse(roundZero.founder_data || "{}");
    roundZeroFounders = founderData.founders || [];
    roundZeroTotalShares =
      founderData.totalShares || parseInt(roundZero.issuedshares) || 0;
  } catch (error) {
    console.error("Error parsing Round 0 data:", error);
    roundZeroTotalShares = parseInt(roundZero.issuedshares) || 0;
  }

  // Parse investment round parameters
  const investmentSize = parseFloat(round.roundsize) || 0;
  const preMoneyValuation = parseFloat(round.preMoneyValuation) || 0;
  const optionPoolPercent = parseFloat(round.optionPoolPercent) || 0;
  const liquidationMultiple = parseFloat(round.liquidationMultiple) || 1.0;

  // Validate required inputs for investment rounds
  if (investmentSize <= 0 || preMoneyValuation <= 0) {
    return {
      roundType: round.nameOfRound || "Investment Round",
      shareClass: round.shareClassType || "Preferred Shares",
      currency: round.currency || "USD",
      totalShares: 0,
      totalValue: 0,
      shareholders: [],
      chartData: { labels: [], datasets: [] },
      calculations: {},
      round_type: round.round_type,
      error:
        "Missing required investment parameters: Investment Size and Pre-Money Valuation",
    };
  }

  // ===== CLIENT REQUIREMENTS CALCULATIONS =====

  // 1. Post-Money Valuation
  const postMoneyValuation = investmentSize + preMoneyValuation;

  // 2. Investor Post-Money Ownership %
  const investorOwnershipPercent = (investmentSize / postMoneyValuation) * 100;

  // 3. Employee Option Pool Shares (from client formula)
  const optionPoolShares =
    optionPoolPercent > 0
      ? Math.round(
          (roundZeroTotalShares / (1 - optionPoolPercent / 100)) *
            (optionPoolPercent / 100)
        )
      : 0;

  // 4. Pre-Seed Total Shares (Round 0 + Option Pool)
  const preSeedTotalShares = roundZeroTotalShares + optionPoolShares;

  // 5. Round 1 Share Price
  const sharePrice = preMoneyValuation / preSeedTotalShares;

  // 6. New Shares Issued in Round 1
  const newShares = Math.round(investmentSize / sharePrice);

  // 7. Post-Investment Total Shares
  const postInvestmentTotalShares = preSeedTotalShares + newShares;

  // Build shareholders array
  let shareholders = [];

  // 1. Founders from Round 0 (pre-seed)
  if (roundZeroFounders.length > 0) {
    roundZeroFounders.forEach((founder, index) => {
      const shares = parseInt(founder.shares) || 0;

      // Pre-Seed Ownership % (before investment)
      const preSeedOwnership =
        preSeedTotalShares > 0 ? (shares / preSeedTotalShares) * 100 : 0;

      // Post-Seed Ownership % (after investment)
      const postSeedOwnership =
        postInvestmentTotalShares > 0
          ? (shares / postInvestmentTotalShares) * 100
          : 0;

      // Value calculation
      const value = shares * sharePrice;

      shareholders.push({
        name: `Founder ${index + 1}`,
        email: "-",
        type: "Founder",
        round: "Round 0",
        shares: shares,
        ownership: postSeedOwnership, // Post-investment ownership
        preInvestmentOwnership: preSeedOwnership, // Pre-investment ownership
        value: value,
        shareType: founder.shareType || "common",
        votingRights: founder.voting || "voting",
      });
    });
  } else {
    // Fallback if no founder data
    const preSeedOwnership =
      preSeedTotalShares > 0
        ? (roundZeroTotalShares / preSeedTotalShares) * 100
        : 0;
    const postSeedOwnership =
      postInvestmentTotalShares > 0
        ? (roundZeroTotalShares / postInvestmentTotalShares) * 100
        : 0;

    shareholders.push({
      name: "Founders Total",
      email: "-",
      type: "Founder",
      round: "Round 0",
      shares: roundZeroTotalShares,
      ownership: postSeedOwnership,
      preInvestmentOwnership: preSeedOwnership,
      value: roundZeroTotalShares * sharePrice,
    });
  }

  // 2. Option Pool (Employee Pool)
  if (optionPoolShares > 0) {
    const optionPoolOwnership =
      postInvestmentTotalShares > 0
        ? (optionPoolShares / postInvestmentTotalShares) * 100
        : 0;
    const preOptionPoolOwnership =
      preSeedTotalShares > 0
        ? (optionPoolShares / preSeedTotalShares) * 100
        : 0;

    shareholders.push({
      name: "Employee Option Pool",
      email: "-",
      type: "Options Pool",
      round: "Pre-Seed",
      shares: optionPoolShares,
      ownership: optionPoolOwnership,
      preInvestmentOwnership: preOptionPoolOwnership,
      value: optionPoolShares * sharePrice,
    });
  }

  // 3. New Investors in this round
  let totalInvestorShares = 0;
  if (investors.length > 0) {
    investors.forEach((investor, index) => {
      // Distribute new shares among investors (pro-rata based on investment amount)
      const investmentAmount = parseFloat(investor.investment_amount) || 0;
      const investorShareRatio =
        investmentSize > 0 ? investmentAmount / investmentSize : 0;
      const investorShares = Math.round(newShares * investorShareRatio);
      totalInvestorShares += investorShares;

      const investorOwnership =
        postInvestmentTotalShares > 0
          ? (investorShares / postInvestmentTotalShares) * 100
          : 0;

      shareholders.push({
        name:
          `${investor.first_name} ${investor.last_name}`.trim() ||
          `Investor ${index + 1}`,
        email: investor.email || "-",
        type: "Investor",
        round: round.nameOfRound || "Current Round",
        shares: investorShares,
        ownership: investorOwnership,
        preInvestmentOwnership: 0, // New investors didn't exist before
        value: investorShares * sharePrice,
        investmentAmount: investmentAmount,
      });
    });

    // Handle any rounding differences in investor shares
    if (totalInvestorShares !== newShares && investors.length > 0) {
      const difference = newShares - totalInvestorShares;
      if (difference !== 0) {
        const lastInvestorIndex = shareholders.length - 1;
        shareholders[lastInvestorIndex].shares += difference;
        shareholders[lastInvestorIndex].ownership =
          postInvestmentTotalShares > 0
            ? (shareholders[lastInvestorIndex].shares /
                postInvestmentTotalShares) *
              100
            : 0;
        shareholders[lastInvestorIndex].value =
          shareholders[lastInvestorIndex].shares * sharePrice;
      }
    }
  } else {
    // If no specific investors, create a generic investor entry
    const investorOwnership =
      postInvestmentTotalShares > 0
        ? (newShares / postInvestmentTotalShares) * 100
        : 0;

    shareholders.push({
      name: "Round Investors",
      email: "-",
      type: "Investor",
      round: round.nameOfRound || "Current Round",
      shares: newShares,
      ownership: investorOwnership,
      preInvestmentOwnership: 0,
      value: newShares * sharePrice,
      investmentAmount: investmentSize,
    });
  }

  // Calculate totals
  const totalShares = shareholders.reduce((sum, s) => sum + s.shares, 0);
  const totalValue = shareholders.reduce((sum, s) => sum + s.value, 0);

  // Chart Data
  const chartData = {
    labels: shareholders.map((s) => s.name),
    datasets: [
      {
        label: "Post-Investment Ownership %",
        data: shareholders.map((s) => parseFloat(s.ownership.toFixed(2))),
        backgroundColor: shareholders.map((s, idx) =>
          s.type === "Founder"
            ? "hsl(120,70%,50%)"
            : s.type === "Options Pool"
            ? "hsl(40,70%,50%)"
            : s.type === "Investor"
            ? "hsl(220,70%,50%)"
            : `hsl(${(idx * 60) % 360},70%,50%)`
        ),
      },
    ],
  };

  return {
    roundType: round.nameOfRound || "Investment Round",
    round_type: round.round_type,
    shareClass: round.shareClassType || "Preferred Shares",
    currency: round.currency || "USD",
    totalShares,
    totalValue,
    shareholders,
    chartData,
    calculations: {
      // Platform Inputs
      investmentSize: investmentSize,
      preMoneyValuation: preMoneyValuation,
      optionPoolPercent: optionPoolPercent,
      liquidationMultiple: liquidationMultiple,

      // Platform Outputs (Client Requirements)
      postMoneyValuation: postMoneyValuation,
      investorOwnershipPercent: investorOwnershipPercent,
      sharePrice: sharePrice,
      newShares: newShares,
      postInvestmentTotalShares: postInvestmentTotalShares,

      // Pre-Seed Calculations
      preSeedTotalShares: preSeedTotalShares,
      optionPoolShares: optionPoolShares,
      roundZeroTotalShares: roundZeroTotalShares,

      // Additional metrics
      investmentPerShare: investmentSize / newShares || 0,
      fullyDilutedValuation: postMoneyValuation,

      // For display purposes
      totalFullyDilutedShares: postInvestmentTotalShares,
    },
    isRoundZero: false,
  };
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
