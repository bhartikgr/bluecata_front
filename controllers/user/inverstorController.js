const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");
const { format } = require("date-fns");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const pdfParse = require("pdf-parse");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const Stripe = require("stripe");
const stripe = new Stripe(
  "sk_test_51RUJzWAx6rm2q3pyUl86ZMypACukdO7IsZ0AbsWOcJqg9xWGccwcQwbQvfCaxQniDCWzNg7z2p4rZS1u4mmDDyou00DM7rK8eY",
);
const { json } = require("stream/consumers");

require("dotenv").config();
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
//All Investor Quatarly Email Send

//All Investor Quatarly Email Send

exports.getInvestorlist = (req, res) => {
  const { company_id } = req.body;

  const query = `
      SELECT DISTINCT investor_information.*, 
       company_investor.investorType, 
       company_investor.investmentPreference,
       company_investor.id as company_investor_id 
      FROM investor_information 
      INNER JOIN company_investor ON company_investor.investor_id = investor_information.id 
      WHERE company_investor.company_id = ?  
        AND company_investor.joinstatus = 'Yes'
      ORDER BY investor_information.id DESC 
        `;

  db.query(query, [company_id], (err, results) => {
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

exports.getinvestorlistwithsearch = (req, res) => {
  const { company_id, search = "" } = req.body;

  let query = `
    SELECT DISTINCT 
  investor_information.*, 
  company_investor.investorType, 
  company_investor.investmentPreference,
  company_investor.id as company_investor_id,
  investorrequest_company.investment_amount,
  investorrequest_company.roundrecord_id,
  roundrecord.nameOfRound,
  roundrecord.roundsize,
  roundrecord.currency
FROM investor_information 
INNER JOIN company_investor 
  ON company_investor.investor_id = investor_information.id 
LEFT JOIN investorrequest_company 
  ON investorrequest_company.investor_id = investor_information.id
  AND investorrequest_company.company_id = company_investor.company_id
LEFT JOIN roundrecord 
  ON roundrecord.id = investorrequest_company.roundrecord_id
WHERE company_investor.company_id = ?
  AND company_investor.joinstatus = 'Yes'
GROUP BY 
  investor_information.id,
  investor_information.first_name,
  investor_information.last_name,
  investor_information.email,
  investor_information.phone,
  investor_information.company_name,
  investor_information.job_title,
  investor_information.type_of_investor,
  investor_information.profile_picture,
  investor_information.investor_type,
  investor_information.cheque_size,
  investor_information.geo_focus,
  investor_information.preferred_stages,
  investor_information.city,
  investor_information.state,
  investor_information.country,
  investor_information.full_address,
  investor_information.accredited_status,
  investor_information.bio_short,
  investor_information.linkedIn_profile,
  investor_information.industry_expertise,
  investor_information.stateCode,
  investor_information.countrycode,
  investor_information.created_at,
  investor_information.updated_at,
  company_investor.investorType,
  company_investor.investmentPreference,
  company_investor.id,
  investorrequest_company.investment_amount,
  investorrequest_company.roundrecord_id,
  roundrecord.nameOfRound,
  roundrecord.roundsize,
  roundrecord.currency
ORDER BY investor_information.id DESC
  `;

  const params = [company_id];

  // 🔍 ADVANCED SEARCH PARSING
  // Users can type: "John", "$10000", "Series A", "Angel", "10000-50000"
  if (search && search.trim() !== "") {
    const searchTerm = search.trim();

    // Check if search contains investment range (e.g., "10000-50000")
    const rangeMatch = searchTerm.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const minAmount = parseInt(rangeMatch[1]);
      const maxAmount = parseInt(rangeMatch[2]);
      query += ` AND investorrequest_company.investment_amount BETWEEN ? AND ?`;
      params.push(minAmount, maxAmount);
    }
    // Check if search is a number (single investment amount)
    else if (/^\d+$/.test(searchTerm)) {
      query += ` AND investorrequest_company.investment_amount >= ?`;
      params.push(parseInt(searchTerm));
    }
    // Check if search contains dollar sign
    else if (searchTerm.startsWith("$")) {
      const amount = parseInt(searchTerm.substring(1));
      if (!isNaN(amount)) {
        query += ` AND investorrequest_company.investment_amount >= ?`;
        params.push(amount);
      }
    }
    // General text search (name, email, round, investor type)
    else {
      query += ` AND (
        investor_information.first_name LIKE ? OR
        investor_information.last_name LIKE ? OR
        investor_information.email LIKE ? OR
        investor_information.screen_name LIKE ? OR
        investor_information.type_of_investor LIKE ? OR
        investor_information.capavate_interests LIKE ? OR
        company_investor.investorType LIKE ? OR
        company_investor.investmentPreference LIKE ? OR
        roundrecord.nameOfRound LIKE ? OR
        roundrecord.instrumentType LIKE ? OR
        CONCAT(roundrecord.roundsize, ' ', roundrecord.currency) LIKE ?
      )`;
      const searchPattern = `%${searchTerm}%`;
      params.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
      );
    }
  }

  // ✅ IMPORTANT: GROUP BY added to remove duplicates
  query += ` GROUP BY investor_information.id`;
  query += ` ORDER BY investor_information.id DESC`;

  db.query(query, params, (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      results,
    });
  });
};

exports.getInvestoreditlist = (req, res) => {
  const { company_id, id } = req.body;

  const query = `
    SELECT investor_information.*, company_investor.investorType, company_investor.investmentPreference FROM investor_information JOIN company_investor ON company_investor.investor_id = investor_information.id WHERE investor_information.company_id = ? ORDER BY investor_information.id DESC`;

  db.query(query, [company_id, id], (err, row) => {
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
exports.Addnewinvenstor = (req, res) => {
  const {
    created_by_id,
    created_by_role,
    company_id,
    id,
    email,
    first_name,
    last_name,
    screen_name,
    ip_address,
  } = req.body;

  // Function to fetch company name
  const getCompanyName = (callback) => {
    const companyQuery = `SELECT * FROM company WHERE id = ?`;
    db.query(companyQuery, [company_id], (err, companyResults) => {
      if (err) return callback(err);
      const companyName =
        companyResults.length > 0
          ? companyResults[0].company_name
          : "Your Company";
      callback(null, companyName);
    });
  };

  if (id) {
    const updateQuery = `
      UPDATE investor_information
      SET first_name = ?, last_name = ?, screen_name = ?
      WHERE id = ?
    `;

    db.query(
      updateQuery,
      [first_name, last_name, screen_name, id],
      (err, result) => {
        if (err) {
          return res.status(500).json({
            status: 0,
            message: "Database update error",
            error: err,
          });
        }

        res.status(200).json({
          status: 1,
          message: "Investor successfully updated",
          affectedRows: result.affectedRows,
        });
      },
    );
  } else {
    const checkQuery = `SELECT * FROM investor_information WHERE email = ?`;

    db.query(checkQuery, [email], (err, results) => {
      if (err)
        return res
          .status(500)
          .json({ status: 0, message: "Database query error", error: err });

      let investorId;

      getCompanyName((err, companyName) => {
        if (err) {
          return res.status(500).json({
            status: 0,
            message: "Failed to fetch company name",
            error: err,
          });
        }

        if (results.length > 0) {
          // Investor exists globally
          investorId = results[0].id;
          var invt_result = results[0];
          const token = results[0].unique_code;
          var is_register = results[0].is_register;
          if (is_register === "Yes") {
            var msg = "This investor is already linked to your company";
          } else {
            var msg = "This investor is already added to your company";
          }

          const checkCompanyLinkQuery = `SELECT * FROM company_investor WHERE company_id = ? AND investor_id = ?`;
          db.query(
            checkCompanyLinkQuery,
            [company_id, investorId],
            (err, linkResults) => {
              if (err)
                return res
                  .status(500)
                  .json({ status: 0, message: "DB error", error: err });

              if (linkResults.length > 0) {
                return res.status(200).json({
                  status: 2,
                  message: msg,
                  email: email,
                });
              } else {
                const date = new Date();
                const insertQueryre = `
                  INSERT INTO company_investor (created_by_id,created_by_role,company_id, investor_id, created_at)
                  VALUES (?, ?, ?, ?, ?)
                `;
                db.query(
                  insertQueryre,
                  [
                    created_by_id,
                    created_by_role,
                    company_id,
                    investorId,
                    date,
                  ],
                  (err, result) => {
                    if (err)
                      return res.status(500).json({
                        status: 0,
                        message: "DB insert error",
                        error: err,
                      });
                    if (invt_result.is_register === "Yes") {
                      var url = "https://capavate.com/investor/login";
                    } else {
                      var url = `https://capavate.com/investor/information/${token}`;
                    }

                    // Send invite email for existing investor
                    sendInvestorInviteEmail(
                      email,
                      first_name + " " + last_name,
                      companyName,
                      url,
                      true, // already registered
                    );

                    res.status(200).json({
                      status: 1,
                      message: "Investor successfully linked to your company",
                      insertedId: result.insertId,
                    });
                  },
                );
              }
            },
          );
        } else {
          // New investor
          const date = new Date();
          const token = crypto.randomBytes(16).toString("hex");
          const expired_at = new Date();
          expired_at.setDate(expired_at.getDate() + 30);
          const insertQuery = `
            INSERT INTO investor_information (created_by_id,created_by_role,company_id, first_name, last_name, screen_name, unique_code, email, created_at,expired_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
          db.query(
            insertQuery,
            [
              created_by_id,
              created_by_role,
              company_id,
              first_name,
              last_name,
              screen_name,
              token,
              email,
              date,
              expired_at,
            ],
            (err, result) => {
              if (err) {
                // Check if it's duplicate email error
                if (err.code === "ER_DUP_ENTRY") {
                  return res.status(200).json({
                    status: 2,
                    message: "This email already exists",
                    email: email,
                  });
                }
                return res
                  .status(500)
                  .json({ status: 0, message: "DB insert error", error: err });
              }

              investorId = result.insertId;
              const details = `Investor ${first_name} ${last_name} create`;
              logUserAction(
                created_by_id, // user_id
                company_id,
                "Investor Module", // module
                id ? "Update" : "Add", // action
                investorId, // entity_id
                "Investor", // entity_type
                JSON.stringify(req.body),
                ip_address, // ip_address
              );
              const insertQueryre = `
                INSERT INTO company_investor (created_by_id,created_by_role,company_id, investor_id, created_at)
                VALUES (?, ?, ?, ?, ?)
              `;
              db.query(
                insertQueryre,
                [created_by_id, created_by_role, company_id, investorId, date],
                (err, result) => {
                  if (err)
                    return res.status(500).json({
                      status: 0,
                      message: "DB insert error",
                      error: err,
                    });

                  // Send invite email for new investor
                  sendInvestorInviteEmail(
                    email,
                    first_name + " " + last_name,
                    companyName,
                    `https://capavate.com/investor/information/${token}`,
                    false, // not registered
                  );

                  res.status(200).json({
                    status: 1,
                    message:
                      "Investor successfully created and linked to your company",
                    insertedId: result.insertId,
                  });
                },
              );
            },
          );
        }
      });
    });
  }
};
exports.Addinvenstor = (req, res) => {
  // Check if it's a single record or multiple records
  const investors = Array.isArray(req.body) ? req.body : [req.body];

  if (investors.length === 0) {
    return res.status(400).json({
      status: 0,
      message: "No investors data provided",
    });
  }

  // Validate each investor
  const invalidInvestors = investors.filter(
    (inv) => !inv.company_id || !inv.email,
  );

  if (invalidInvestors.length > 0) {
    return res.status(400).json({
      status: 0,
      message: "company_id and email are required for all investors",
    });
  }

  // Process each investor
  const results = [];
  let processedCount = 0;

  investors.forEach((investor, index) => {
    const { company_id, email, first_name, last_name } = investor;

    const checkQuery = `SELECT * FROM company_add_investors WHERE company_id = ? AND email = ?`;

    db.query(checkQuery, [company_id, email], (err, results) => {
      if (err) {
        results.push({
          index,
          status: 0,
          message: "Database query error",
          error: err,
        });
        processedCount++;

        if (processedCount === investors.length) {
          return res.status(207).json({
            status: "partial",
            results: results,
          });
        }
        return;
      }

      // Check if investor already exists
      if (results.length > 0) {
        results.push({
          index,
          status: 0,
          message: `Investor with email ${email} already exists for this company`,
        });
        processedCount++;

        if (processedCount === investors.length) {
          return res.status(207).json({
            status: "partial",
            results: results,
          });
        }
        return;
      }

      // Insert new investor
      const insertQuery = `
        INSERT INTO company_add_investors 
        (company_id, email, first_name, last_name, created_at) 
        VALUES (?, ?, ?, ?, NOW())
      `;

      db.query(
        insertQuery,
        [company_id, email, first_name || null, last_name || null],
        (insertErr, insertResult) => {
          if (insertErr) {
            results.push({
              index,
              status: 0,
              message: "Failed to add investor",
              error: insertErr,
            });
          } else {
            results.push({
              index,
              status: 1,
              message: "Investor added successfully",
              data: {
                id: insertResult.insertId,
                company_id,
                email,
                first_name,
                last_name,
              },
            });
          }

          processedCount++;

          if (processedCount === investors.length) {
            const allSuccess = results.every((r) => r.status === 1);
            return res.status(allSuccess ? 201 : 207).json({
              status: allSuccess ? 1 : "partial",
              results: results,
              summary: {
                total: investors.length,
                success: results.filter((r) => r.status === 1).length,
                failed: results.filter((r) => r.status === 0).length,
              },
            });
          }
        },
      );
    });
  });
};

//Add Investor logs
const logUserAction = (
  userId,
  companyId,
  module,
  action,
  entityId,
  entityType,
  details,
  ipAddress,
) => {
  const selectQuery = `
    SELECT * FROM audit_logs 
    WHERE user_id = ? AND company_id = ? LIMIT 1
  `;

  db.query(selectQuery, [userId, companyId], (err, rows) => {
    if (err) {
      console.error("Log check error", err);
      return;
    }

    const insertQuery = `
        INSERT INTO audit_logs
          (user_id, company_id, module, action, entity_id, entity_type, details, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `;
    db.query(
      insertQuery,
      [
        userId,
        companyId,
        module,
        action,
        entityId,
        entityType,
        details,
        ipAddress,
      ],
      (err, result) => {
        if (err) console.error("Log insert error", err);
      },
    );
  });
};

//Add Investor logs
//Email
const sendInvestorInviteEmail = (
  email,
  firstName,
  companyName,
  link,
  isRegistered = false,
) => {
  const subject = isRegistered
    ? `You have been invited by ${companyName} - Capavate`
    : `Join Capavate - Invitation from ${companyName}`;

  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Investor Invitation</title>
  </head>
  <body>
    <div style="width:600px; margin:0 auto; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; font-family:Verdana, Geneva, sans-serif;">
      <table style="width:100%; border-collapse: collapse;">
        <tr>
          <td style="background:#efefef; padding:10px; text-align:center;">
            <img src="https://capavate.com/api/upload/images/logo.png" alt="logo" style="width:130px;" />
          </td>
        </tr>
        <tr>
          <td style="padding:20px;">
            <h2 style="font-size:16px; color:#111;">Hello ${firstName},</h2>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              ${
                isRegistered
                  ? `${companyName} has invited you to view and approve your investor information.`
                  : `${companyName} has invited you to join Capavate as an investor.`
              }
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:20px;">
              Click the button below to ${
                isRegistered ? "view and approve" : "register and start"
              }:
            </p>
            <div style="margin:20px 0;">
              <a href="${link}" style="display:inline-block; padding:12px 24px; background: #CC0000;
                        color: #fff; text-decoration:none; border-radius:6px;">
                ${isRegistered ? "View Your Investor Info" : "Register / Login"}
              </a>
            </div>
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

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) console.error("Error sending investor invite email:", err);
    else console.log("Investor invite email sent:", info.response);
  });
};

exports.deleteinvestor = (req, res) => {
  const { company_id, id } = req.body;

  const query1 = `DELETE FROM company_investor WHERE company_id = ? AND investor_id = ?`;
  const query2 = `DELETE FROM sharereport WHERE company_id = ? AND investor_id = ?`;
  const query3 = `DELETE FROM sharerecordround WHERE company_id = ? AND investor_id = ?`;
  const query4 = `DELETE FROM round_investors WHERE company_id = ? AND investor_id = ?`;

  db.query(query1, [company_id, id], (err, result1) => {
    if (err) {
      return res.status(500).json({
        message: "Error deleting from company_investor",
        error: err,
      });
    }

    db.query(query2, [company_id, id], (err, result2) => {
      if (err) {
        return res.status(500).json({
          message: "Error deleting from sharereport",
          error: err,
        });
      }

      db.query(query3, [company_id, id], (err, result3) => {
        if (err) {
          return res.status(500).json({
            message: "Error deleting from sharerecordround",
            error: err,
          });
        }

        db.query(query4, [company_id, id], (err, result3) => {
          if (err) {
            return res.status(500).json({
              message: "Error deleting from sharerecordround",
              error: err,
            });
          }

          res.status(200).json({
            message: "Investor and related records deleted successfully",
          });
        });
      });
    });
  });
};

exports.SendreportToinvestor = async (req, res) => {
  const {
    company_id,
    created_by_id,
    created_by_role,
    selectedRecords,
    records,
    ip_address,
    country_name,
  } = req.body;

  if (
    !company_id ||
    !selectedRecords ||
    !Array.isArray(selectedRecords) ||
    !Array.isArray(records)
  ) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const currentDate = new Date();
    const expiredAt = new Date();
    expiredAt.setDate(currentDate.getDate() + 30);

    // Get entrepreneur name
    const [userRows] = await db
      .promise()
      .query("SELECT * FROM company WHERE id = ? LIMIT 1", [company_id]);
    const entrepreneurName = `${userRows[0]?.company_name || ""} ${
      userRows[0]?.last_name || ""
    }`.trim();
    const displayName = entrepreneurName || "Entrepreneur";

    // Remove duplicate investor IDs
    const uniqueInvestorIds = [...new Set(selectedRecords)];

    // Fetch existing shared reports
    const [existingShares] = await db.promise().query(
      `SELECT investor_updates_id, investor_email FROM sharereport 
       WHERE investor_updates_id IN (?)`,
      [records.map((r) => r.id)],
    );

    const existingSet = new Set(
      existingShares.map((e) => `${e.investor_updates_id}_${e.investor_email}`),
    );

    // Prepare data to insert and email
    const toInsert = [];

    for (const report of records) {
      for (const investorId of uniqueInvestorIds) {
        // Get investor info
        const [investorRows] = await db
          .promise()
          .query(
            "SELECT email, first_name, last_name, is_register, unique_code FROM investor_information WHERE id = ?",
            [investorId],
          );

        if (investorRows.length === 0) continue;

        const { email, first_name, last_name, is_register, unique_code } =
          investorRows[0];
        const key = `${report.id}_${email}`;

        // If not registered → update expired_at
        if (is_register === "No") {
          await db
            .promise()
            .query(
              "UPDATE investor_information SET expired_at = ? WHERE id = ?",
              [expiredAt, investorId],
            );
        }

        if (!existingSet.has(key)) {
          toInsert.push({
            report,
            investorId,
            email,
            first_name,
            last_name,
            unique_code,
            is_register,
          });
          existingSet.add(key); // prevent duplicates in same batch
        }
      }
    }

    if (toInsert.length === 0) {
      // Build duplicates info
      const duplicates = [];
      for (const report of records) {
        for (const investorId of uniqueInvestorIds) {
          const [investorRows] = await db
            .promise()
            .query("SELECT * FROM investor_information WHERE id = ?", [
              investorId,
            ]);
          if (investorRows.length === 0) continue;

          const email = investorRows[0].email;
          const key = `${report.id}_${email}`;
          if (existingSet.has(key)) {
            duplicates.push({
              investor_email: email,
              record_name: report.document_name,
            });
          }
        }
      }

      return res.status(200).json({
        message:
          "All selected reports are already sent to the selected investors.",
        status: "2",
        duplicates,
      });
    }

    // Insert all records at once
    const insertPromises = toInsert.map(
      ({ report, investorId, email, unique_code }) =>
        db.promise().query(
          `INSERT INTO sharereport 
         (created_by_id, created_by_role, company_id, investor_updates_id, unique_code, investor_email, investor_id, sent_date, expired_at, report_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            created_by_id,
            created_by_role,
            company_id,
            report.id,
            unique_code,
            email,
            investorId,
            currentDate,
            expiredAt,
            report.type,
          ],
        ),
    );
    await Promise.all(insertPromises);

    // Update investor_updates table
    const sharedReportIds = [
      ...new Set(toInsert.map((item) => item.report.id)),
    ];
    if (sharedReportIds.length > 0) {
      const placeholders = sharedReportIds.map(() => "?").join(", ");
      const query = `UPDATE investor_updates SET is_shared = 'Yes' WHERE id IN (${placeholders})`;
      await db.promise().query(query, sharedReportIds);
    }
    try {
      const auditDetails = {
        user_id: created_by_id,
        company_id,
        created_by_role,
        module: "Investor Reports",
        action: "Share",
        entity_id: sharedReportIds.join(","), // multiple report IDs
        entity_type: "investor_updates",
        details: `Shared investor reports (${sharedReportIds.length}) with ${selectedRecords.length} investor(s).`,
        ip_address: ip_address,
        country_name: country_name,
      };

      await db.promise().query(
        `INSERT INTO audit_logs 
     (user_id, company_id,created_by_role, module, action, entity_id, entity_type, details, ip_address,country_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,?, NOW())`,
        [
          auditDetails.user_id,
          auditDetails.company_id,
          created_by_role,
          auditDetails.module,
          auditDetails.action,
          auditDetails.entity_id,
          auditDetails.entity_type,
          JSON.stringify(auditDetails.details),
          auditDetails.ip_address,
          auditDetails.country_name,
        ],
      );

      console.log("Audit log inserted successfully");
    } catch (auditErr) {
      console.error("Audit log insert failed:", auditErr);
    }

    // Send emails
    const emailPromises = toInsert.map(
      ({ report, email, first_name, last_name, unique_code }) => {
        const url =
          report.type === "Due Diligence Document"
            ? `https://capavate.com/investor/company/duediligence-reportlist/${company_id}`
            : `https://capavate.com/investor/company/reportlist/${company_id}`;

        const mailOptions = {
          from: '"Capavate" <scale@blueprintcatalyst.com>',
          to: email,
          subject: `New Report from ${displayName}`,
          html: `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>New Report</title>
          </head>
          <body>
            <div style="width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
              <table style="width:600px;margin:0 auto;border-collapse:collapse;font-family:Verdana,Geneva,sans-serif;">
                <tr>
                  <td style="background:#efefef;padding:10px 0;text-align:center;">
                    <img src="logo.png" alt="logo" style="width:130px;" />
                  </td>
                </tr>
                <tr>
                  <td>
                    <table>
                      <tr>
                        <td style="padding:20px;">
                          <h2 style="margin:0 0 15px 0;font-size:16px;color:#111;">Dear ${first_name} ${last_name},</h2>
                          <h3 style="margin:0 0 15px 0;font-size:16px;color:#111;">
                            ${displayName} has shared a new report with you:
                          </h3>
                          <p style="margin:0 0 15px 0;font-size:14px;color:#111;">
                            <b>Report Name:</b> ${report.document_name}
                          </p>
                          <p style="margin:0 0 15px 0;font-size:14px;color:#111;">
                            You can view the report by clicking the button below:
                          </p>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <div style="padding:0 20px 20px 20px;">
                            <a href="${url}" style="
                              display:inline-block;
                              padding:10px 30px;
                              background-color:#CC0000;
                              color:#fff;
                              text-decoration:none;
                              border-radius:10px;
                              font-weight:bold;
                              font-size:14px;
                            ">View Report</a>
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

        return transporter
          .sendMail(mailOptions)
          .then(() => console.log(`Email sent to ${email}`));
      },
    );

    await Promise.all(emailPromises);

    return res.status(200).json({
      message:
        "Reports shared, emails sent, and investor_updates updated successfully",
      status: "1",
    });
  } catch (error) {
    console.error("Error sending reports:", error);
    return res.status(500).json({ message: "Internal server error", error });
  }
};

exports.getInvestorlistCrm = (req, res) => {
  const { company_id } = req.body;

  const query = `SELECT ii.id AS investor_id, ci.investorType, ci.investmentPreference, ii.first_name, ii.last_name, ii.email, ii.phone,ii.is_register FROM company_investor ci JOIN investor_information ii ON ii.id = ci.investor_id JOIN sharereport sr ON sr.investor_id = ii.id JOIN investor_updates iu ON iu.id = sr.investor_updates_id AND iu.company_id = ci.company_id WHERE ci.company_id = ? AND iu.is_shared = 'Yes' AND sr.report_type = 'Investor updates' And ii.is_register = 'Yes' GROUP BY ii.id, ci.investorType, ci.investmentPreference, 
         ii.first_name, ii.last_name, ii.email, ii.phone, ii.is_register ORDER BY ii.id DESC;`;

  db.query(query, [company_id], (err, results) => {
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
exports.getInvestorlistCrmDuediligenceupdate = (req, res) => {
  const { company_id } = req.body;

  const query = `SELECT ii.id AS investor_id, ci.investorType, ci.investmentPreference, ii.first_name, ii.last_name, ii.email, ii.phone,ii.is_register FROM company_investor ci JOIN investor_information ii ON ii.id = ci.investor_id JOIN sharereport sr ON sr.investor_id = ii.id JOIN investor_updates iu ON iu.id = sr.investor_updates_id AND iu.company_id = ci.company_id WHERE ci.company_id = ? AND iu.is_shared = 'Yes' AND sr.report_type = 'Due Diligence Document' And ii.is_register = 'Yes' GROUP BY  ii.id, ci.investorType, ci.investmentPreference, ii.first_name, ii.last_name, ii.email, ii.phone, ii.is_register ORDER BY ii.id DESC;`;

  db.query(query, [company_id], (err, results) => {
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

exports.checkInvestor = (req, res) => {
  const { company_id, id, type } = req.body;

  const query = `
  SELECT ii.id AS investor_id,
         MAX(ii.unique_code) AS unique_code,
         MAX(ii.company_id) AS company_id,
         MAX(ii.created_by_id) AS created_by_id,
         MAX(ii.created_by_role) AS created_by_role,
         MAX(ii.first_name) AS first_name,
         MAX(ii.last_name) AS last_name,
         MAX(ii.email) AS email,
         MAX(ii.viewpassword) AS viewpassword,
         MAX(ii.password) AS password,
         MAX(ii.phone) AS phone,
         MAX(ii.city) AS city,
         MAX(ii.country) AS country,
         MAX(ii.type_of_investor) AS type_of_investor,
         MAX(ii.full_address) AS full_address,
         MAX(ii.country_tax) AS country_tax,
         MAX(ii.tax_id) AS tax_id,
         MAX(ii.kyc_document) AS kyc_document,
         MAX(ii.ip_address) AS ip_address,
         MAX(ii.is_register) AS is_register,
         MAX(ii.expired_at) AS expired_at,
         MAX(ii.created_at) AS created_at,
         MAX(ii.updated_at) AS updated_at,
         MAX(ii.accredited_status) AS accredited_status,
         MAX(ii.linkedIn_profile) AS linkedIn_profile,
         MAX(ii.industry_expertise) AS industry_expertise,
         MAX(ci.investorType) AS investorType,
         MAX(ci.investmentPreference) AS investmentPreference,
         MAX(c.company_name) AS company_name
  FROM company_investor ci
  JOIN investor_information ii ON ii.id = ci.investor_id
  JOIN sharereport sr ON sr.investor_id = ii.id
  JOIN investor_updates iu ON iu.id = sr.investor_updates_id AND iu.company_id = ci.company_id
  JOIN company c ON c.id = ci.company_id
  WHERE ci.company_id = ?
    AND iu.is_shared = 'Yes'
    AND ii.is_register = 'Yes'
    AND ii.id = ?
    AND iu.type = ?
  GROUP BY ii.id
  ORDER BY ii.id DESC
  LIMIT 0, 25;
`;

  db.query(query, [company_id, id, type], (err, row) => {
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

exports.getInvestorReportUpdate = (req, res) => {
  const { company_id, id } = req.body;

  const query = `SELECT sharereport.*,investor_updates.created_at as datereport,investor_updates.version,investor_updates.document_name from sharereport join investor_updates on investor_updates.id  = sharereport.investor_updates_id where sharereport.investor_id = ? And sharereport.company_id = ? AND investor_updates.type = 'Investor updates' order by sharereport.id desc`;

  db.query(query, [id, company_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    var pathname = "upload/docs/doc_" + company_id;
    const updatedResults = results.map((doc) => ({
      ...doc,
      downloadUrl: `https://capavate.com/api/${pathname}/investor_report/${doc.document_name}`,
    }));
    res.status(200).json({
      message: "",
      results: updatedResults,
    });
  });
};

exports.getInvestorlistCrmDuediligence = (req, res) => {
  const { user_id, id } = req.body;

  const query = `SELECT ii.id AS investor_id,ii.ip_address,ii.city,ii.country, ci.investorType, ci.investmentPreference, ii.first_name, ii.last_name, ii.email, ii.phone,ii.is_register FROM company_investor ci JOIN investor_information ii ON ii.id = ci.investor_id JOIN sharereport sr ON sr.investor_id = ii.id JOIN investor_updates iu ON iu.id = sr.investor_updates_id AND iu.user_id = ci.user_id WHERE ci.user_id = ? AND iu.is_shared = 'Yes' AND sr.report_type = 'Due Diligence Document' And ii.is_register = 'Yes' And ii.id =? GROUP BY ii.id ORDER BY ii.id DESC;`;

  db.query(query, [user_id, id], (err, row) => {
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

exports.getInvestorReportDuediligence = (req, res) => {
  const { company_id, id } = req.body;

  const query = `SELECT sharereport.*,investor_updates.created_at as datereport,investor_updates.version,investor_updates.document_name from sharereport join investor_updates on investor_updates.id  = sharereport.investor_updates_id where sharereport.investor_id = ? And sharereport.company_id = ? AND investor_updates.type = 'Due Diligence Document' order by sharereport.id desc`;

  db.query(query, [id, company_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    var pathname = "upload/docs/doc_" + company_id;
    const updatedResults = results.map((doc) => ({
      ...doc,
      downloadUrl: `https://capavate.com/api/${pathname}/investor_report/${doc.document_name}`,
    }));
    res.status(200).json({
      message: "",
      results: updatedResults,
    });
  });
};

exports.getinvestorReportsLock = (req, res) => {
  const company_id = req.body.company_id;

  const query = `
    SELECT investor_updates.*, company.company_name 
    FROM investor_updates 
    LEFT JOIN company ON company.id = investor_updates.company_id 
    WHERE investor_updates.company_id = ? And investor_updates.type =? And investor_updates.is_locked=?
    ORDER BY investor_updates.id DESC;
  `;

  db.query(query, [company_id, "Investor updates", "1"], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    var pathname = "upload/docs/doc_" + company_id;
    const updatedResults = results.map((doc) => ({
      ...doc,
      downloadUrl: `https://capavate.com/api/${pathname}/investor_report/${doc.document_name}`,
    }));

    res.status(200).json({
      results: updatedResults,
    });
  });
};
exports.getDuediligenceDataroomLock = (req, res) => {
  const company_id = req.body.company_id;

  const query = `
    SELECT investor_updates.*, company.company_name 
    FROM investor_updates 
    LEFT JOIN company ON company.id = investor_updates.company_id 
    WHERE investor_updates.company_id = ? And investor_updates.type =?
    ORDER BY investor_updates.id DESC;
  `;

  db.query(query, [company_id, "Due Diligence Document"], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    var pathname = "upload/docs/doc_" + company_id;
    const updatedResults = results.map((doc) => ({
      ...doc,
      downloadUrl: `https://capavate.com/api/${pathname}/investor_report/${doc.document_name}`,
    }));

    res.status(200).json({
      results: updatedResults,
    });
  });
};

exports.getInvestorCompany = async (req, res) => {
  var investor_id = req.body.investor_id;

  try {
    // Check if user already exists
    db.query(
      "SELECT company.* FROM company_investor JOIN company ON company.id = company_investor.company_id WHERE company_investor.investor_id = ? And company_investor.joinstatus = 'Yes' GROUP BY company.id ORDER BY MAX(company_investor.id) DESC",
      [investor_id],
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
exports.getInvitaionCompany = async (req, res) => {
  const { investor_id } = req.body;

  if (!investor_id) {
    return res.status(400).json({
      status: 0,
      message: "investor_id is required",
    });
  }

  try {
    const query = `
      SELECT 
        company.*,
        company_investor.id as company_investor_id,
        company_investor.joinstatus
      FROM company_investor 
      JOIN company ON company.id = company_investor.company_id 
      WHERE company_investor.investor_id = ? 
      ORDER BY company_investor.id DESC
    `;

    db.query(query, [investor_id], (err, results) => {
      if (err) {
        return res.status(500).json({
          status: 0,
          message: "Database query error",
          error: err,
        });
      }

      return res.status(200).json({
        status: 1,
        message: "Pending invitations fetched successfully",
        data: results,
        total: results.length,
      });
    });
  } catch (err) {
    return res.status(500).json({
      status: 0,
      message: "Server error",
      error: err.message,
    });
  }
};
exports.joinedcompany = async (req, res) => {
  const { company_investor_id, company_name, company_email, investor_email } =
    req.body;

  // Validate input
  if (!company_investor_id) {
    return res.status(400).json({
      status: 0,
      message: "company_investor_id is required",
    });
  }

  try {
    // First, get investor details and company details
    const getDetailsQuery = `
      SELECT 
        ci.id as company_investor_id,
        ci.company_id,
        ci.investor_id,
        ci.joinstatus,
        ii.id as investor_info_id,
        ii.first_name,
        ii.last_name,
        ii.email as investor_email,
        c.id as company_id,
        c.company_name,
        c.company_email
      FROM company_investor ci
      JOIN investor_information ii ON ii.id = ci.investor_id
      JOIN company c ON c.id = ci.company_id
      WHERE ci.id = ?
    `;

    db.query(getDetailsQuery, [company_investor_id], (err, details) => {
      if (err) {
        return res.status(500).json({
          status: 0,
          message: "Database query error",
          error: err,
        });
      }

      if (details.length === 0) {
        return res.status(404).json({
          status: 0,
          message: "Company investor record not found",
        });
      }

      const investorData = details[0];
      const investorName = `${investorData.first_name} ${investorData.last_name}`;
      const investorEmail = investorData.investor_email;
      const companyName = company_name || investorData.company_name;
      const companyEmailAddress = company_email || investorData.company_email;

      // Update query to set joinstatus to 'Yes'
      const updateQuery = `
        UPDATE company_investor 
        SET joinstatus = 'Yes', 
            joined_at = NOW() 
        WHERE id = ?
      `;

      db.query(updateQuery, [company_investor_id], (err, result) => {
        if (err) {
          return res.status(500).json({
            status: 0,
            message: "Database update error",
            error: err,
          });
        }

        // Check if any row was updated
        if (result.affectedRows === 0) {
          return res.status(404).json({
            status: 0,
            message: "Company investor record not found",
          });
        }

        // Send confirmation email to COMPANY (not investor)
        sendJoinedCompanyEmail(
          companyEmailAddress, // Company email
          companyName, // Company name
          investorName, // Investor name
          investorEmail, // Investor email
        );

        // Return success response
        return res.status(200).json({
          status: 1,
          message: "Successfully joined the company",
          data: {
            company_investor_id: company_investor_id,
            joinstatus: "Yes",
            updated_at: new Date(),
            investor_name: investorName,
            investor_email: investorEmail,
            company_name: companyName,
          },
        });
      });
    });
  } catch (err) {
    return res.status(500).json({
      status: 0,
      message: "Server error",
      error: err.message,
    });
  }
};
const sendJoinedCompanyEmail = (
  companyEmail,
  companyName,
  investorName,
  investorEmail,
) => {
  const subject = `New Investor Joined: ${investorName} has joined ${companyName}`;

  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>New Investor Joined Company</title>
  </head>
  <body>
    <div style="width:600px; margin:0 auto; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; font-family:Verdana, Geneva, sans-serif;">
      <table style="width:100%; border-collapse: collapse;">
         <tr>
          <td style="background:#efefef; padding:10px; text-align:center;">
            <img src="https://capavate.com/api/upload/images/logo.png" alt="logo" style="width:130px;" />
           </td>
         </tr>
         <tr>
          <td style="padding:20px;">
            <h2 style="font-size:16px; color:#111;">Hello ${companyName} Team,</h2>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              <strong>${investorName}</strong> has successfully joined your company on Capavate.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:20px;">
              The investor is now officially connected with your company and can access all investor-related information, documents, and updates.
            </p>
            <div style="margin:20px 0; padding:15px; background-color:#f9f9f9; border-left:4px solid #CC0000;">
              <p style="font-size:14px; color:#111; margin-bottom:5px;">
                <strong>Investor Details:</strong>
              </p>
              <p style="font-size:14px; color:#111; margin-bottom:5px;">
                Investor Name: ${investorName}<br/>
                Investor Email: ${investorEmail}
              </p>
            </div>
            <p style="font-size:14px; color:#111; margin-bottom:20px;">
              You can now:
            </p>
            <ul style="font-size:14px; color:#111; margin-bottom:20px;">
              <li>Share documents with this investor</li>
              <li>Send important updates and announcements</li>
              <li>Track investor engagement</li>
              <li>Communicate directly with the investor</li>
            </ul>
            <div style="margin:20px 0;">
              <a href="https://capavate.com/user/login" style="display:inline-block; padding:12px 24px; background: #CC0000;
                        color: #fff; text-decoration:none; border-radius:6px;">
                View Investor Dashboard
              </a>
            </div>
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
    to: companyEmail,
    subject,
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) console.error("Error sending joined company email:", err);
    else console.log("Joined company email sent to company:", info.response);
  });
};
exports.getInvestorReportslist = async (req, res) => {
  var investor_id = req.body.investor_id;
  var type = req.body.type;
  var company_id = req.body.company_id;

  try {
    // Check if user already exists
    db.query(
      `SELECT sharereport.*,investor_updates.version,investor_updates.document_name,investor_updates.type,investor_updates.created_at as shared_date from sharereport join investor_updates on investor_updates.id = sharereport.investor_updates_id where sharereport.investor_id = ? And investor_updates.type =? And sharereport.company_id = ? order by sharereport.id Desc`,
      [investor_id, type, company_id],
      async (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }
        var pathname = "upload/docs/doc_" + company_id;
        const updatedResults = results.map((doc) => ({
          ...doc,
          downloadUrl: `https://capavate.com/api/${pathname}/investor_report/${doc.document_name}`,
        }));

        res.status(200).json({
          message: "",
          results: updatedResults,
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

exports.InvestorReportslistDownload = (req, res) => {
  const investor_id = req.body.investor_id;
  const id = req.body.id;

  const company_id = req.body.company_id || null;
  const ip_address = req.body.ip_address; // capture client IP

  // 1. Check if report exists
  db.query(`SELECT * FROM sharereport WHERE id = ?`, [id], (err, results) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Database query error", error: err });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "Report not found" });
    }

    const report = results[0];
    const dateView = report.date_view;

    // 2. Fetch company_name (if company_id provided)
    const getCompanyName = (callback) => {
      if (!company_id) return callback(null, null);

      db.query(
        `SELECT company_name FROM company WHERE id = ?`,
        [company_id],
        (err, companyResult) => {
          if (err) return callback(err, null);
          if (companyResult.length === 0) return callback(null, null);
          return callback(null, companyResult[0].company_name);
        },
      );
    };

    // 3. If not viewed, update and insert log
    if (!dateView) {
      const updateQuery = `
        UPDATE sharereport
        SET date_view = ?, access_status = ?
        WHERE id = ?
      `;
      const date = new Date();

      db.query(updateQuery, [date, "Download", id], (err, result) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database update error", error: err });
        }

        // Now insert into access_logs_investor
        getCompanyName((err, company_name) => {
          if (err) {
            return res
              .status(500)
              .json({ message: "Company fetch error", error: err });
          }

          const insertLogQuery = `
            INSERT INTO access_logs_investor 
              (investor_id, user_id, company_id, company_name, action, module, description, ip_address, extra_data) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;

          const logData = [
            investor_id,
            investor_id,
            company_id,
            company_name,
            "Download", // action
            "Investor Reporting", // module
            `Investor downloaded report ID ${id}`,
            ip_address,
            JSON.stringify({ report_id: id }), // extra_data as JSON
          ];

          db.query(insertLogQuery, logData, (err2, logResult) => {
            if (err2) {
              return res
                .status(500)
                .json({ message: "Log insert error", error: err2 });
            }

            return res
              .status(200)
              .json({ message: "Report updated and log inserted" });
          });
        });
      });
    } else {
      return res.status(200).json({ message: "Report already viewed" });
    }
  });
};

exports.getreportsCapitalRound = (req, res) => {
  const company_id = req.body.company_id;

  const query = `SELECT ii.id AS investor_id, ci.investorType, ci.investmentPreference, ii.first_name, ii.last_name, ii.email, ii.phone,ii.is_register FROM company_investor ci JOIN investor_information ii ON ii.id = ci.investor_id JOIN sharerecordround sr ON sr.investor_id = ii.id  WHERE ci.company_id = ?  And ii.is_register = 'Yes' GROUP BY 
  ii.id, ci.investorType, ci.investmentPreference, 
  ii.first_name, ii.last_name, ii.email, ii.phone, ii.is_register
 ORDER BY ii.id DESC;`;

  db.query(query, [company_id], (err, results) => {
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

exports.checkInvestorRecordround = (req, res) => {
  const { company_id, id } = req.body;

  const query = `
   SELECT 
      ii.id AS investor_id, 
      ci.investorType, 
      ci.investmentPreference, 
      ii.*, 
      c.company_name,
      c.id as company_id
    FROM company_investor ci
    JOIN investor_information ii ON ii.id = ci.investor_id
    left JOIN sharerecordround sr ON sr.investor_id = ii.id
    JOIN company c ON c.id = ci.company_id
    WHERE ci.company_id = ?
      AND ii.id = ?
      AND ii.is_register = 'Yes'
    ORDER BY ii.id DESC
  `;

  db.query(query, [company_id, id], (err, rows) => {
    if (err) {
      console.error("Database query error:", err);
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    // Process results to add profile picture URL
    const processedResults = rows.map((row) => {
      // Create a copy of the row
      const processedRow = { ...row };

      // Add profile picture URL if profile_picture exists
      if (row.profile_picture) {
        processedRow.profile_picture_url = `https://capavate.com/api/upload/investor/inv_${row.id}/${row.profile_picture}`;
      } else {
        processedRow.profile_picture_url = null;
      }

      return processedRow;
    });

    res.status(200).json({
      message: "Success",
      results: processedResults,
    });
  });
};
exports.checkInvestorRecord = (req, res) => {
  const { company_id, id } = req.body;

  const query = `
    SELECT 
    ii.id AS investor_id, 
    ci.investorType, 
    ci.investmentPreference, 
    ii.*, 
    c.company_name
FROM company_investor ci
JOIN investor_information ii ON ii.id = ci.investor_id
JOIN company c ON c.id = ci.company_id
WHERE ci.company_id = ?
  AND ii.id = ?
  AND ii.is_register = 'Yes'
ORDER BY ii.id DESC;
;
  `;

  db.query(query, [company_id, id], (err, row) => {
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

exports.getInvestorReportCapitalRound = (req, res) => {
  const { company_id, investor_id } = req.body;

  if (!company_id || !investor_id) {
    return res
      .status(400)
      .json({ message: "company_id and investor_id required" });
  }

  const query = `
    SELECT 
      r.*,
      s.id AS sharerecord_id,
      s.subscription_status,
      s.signature_status,
      s.signature,
      s.sent_date,
      s.date_view,
      s.access_status,
      s.termsheet_status,
      irc.shares AS investor_shares,
      irc.id AS investor_request_id,
      irc.investment_amount AS investor_investment,
      irc.created_at AS invested_date
    FROM sharerecordround s
    JOIN roundrecord r ON r.id = s.roundrecord_id
    LEFT JOIN investorrequest_company irc 
      ON irc.roundrecord_id = r.id AND irc.investor_id = s.investor_id
    WHERE s.company_id = ? AND s.investor_id = ? And irc.request_confirm =?
    ORDER BY r.created_at ASC
  `;

  db.query(query, [company_id, investor_id, "Yes"], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Investor rounds fetched successfully",
      results,
    });
  });
};

exports.getrecordRoundList = (req, res) => {
  const { company_id } = req.body;

  const query = `SELECT * from roundrecord where company_id = ? order by id desc`;

  db.query(query, [company_id], (err, results) => {
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
exports.recordRoundLock = (req, res) => {
  const { company_id, lock_id } = req.body;

  const updateQuery = `
        UPDATE roundrecord SET is_locked = ? WHERE id = ? And company_id =?`;
  const date = new Date();

  // Correct parameter order: date_view, access_status, id
  db.query(updateQuery, ["Yes", lock_id, company_id], (err, result) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Database update error", error: err });
    }

    return res
      .status(200)
      .json({ message: "Record report locked successfully" });
  });
};

exports.InvestorAuthorizeConfimataion = (req, res) => {
  const { dataa, types } = req.body;

  const updateQuery = `
    UPDATE sharerecordround
    SET report_status = ?
    WHERE id = ? AND company_id = ?`;

  db.query(
    updateQuery,
    [types, dataa.sharerecord_id, dataa.company_id],
    (err, result) => {
      if (err)
        return res
          .status(500)
          .json({ message: "Database update error", error: err });
      if (result.affectedRows === 0)
        return res.status(404).json({ message: "No record found to update" });

      // Fetch investor info
      const selectInvestorQuery = `
      SELECT i.first_name, i.last_name, i.email,s.*
      FROM sharerecordround s
      JOIN investor_information i ON i.id = s.investor_id
      WHERE s.id = ?`;

      db.query(
        selectInvestorQuery,
        [dataa.sharerecord_id],
        (err, investorRows) => {
          if (err)
            return res
              .status(500)
              .json({ message: "Error fetching investor info", error: err });
          if (investorRows.length === 0)
            return res
              .status(404)
              .json({ message: "Investor not found for this sharerecord" });

          const investor = investorRows[0];

          // Fetch company info
          const selectCompanyQuery = `SELECT company_name FROM company WHERE id = ?`;
          db.query(
            selectCompanyQuery,
            [dataa.company_id],
            (err, companyRows) => {
              if (err)
                return res
                  .status(500)
                  .json({ message: "Error fetching company info", error: err });
              if (companyRows.length === 0)
                return res.status(404).json({ message: "Company not found" });

              const insertInvestmentQuery = `
            INSERT INTO company_shares_investment (company_id, investor_id, roundrecord_id, created_at)
            VALUES (?, ?, ?, NOW())`;
              db.query(
                insertInvestmentQuery,
                [dataa.company_id, investor.investor_id, dataa.id],
                (err, insertResult) => {
                  if (err)
                    return res.status(500).json({
                      message: "Error inserting into company_shares_investment",
                      error: err,
                    });

                  const company = companyRows[0];

                  // Build email HTML
                  const message = `
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                      <meta charset="UTF-8">
                      <meta name="viewport" content="width=device-width, initial-scale=1.0">
                      <title>Investor Signature Confirmation</title>
                    </head>
                    <body>
                      <div style="width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
                        <table style="width:600px;margin:0 auto;border-collapse:collapse;font-family:Verdana,Geneva,sans-serif;">
                          <tr>
                            <td style="background:#efefef;padding:10px 0;text-align:center;">
                              <div style="width:130px;margin:0 auto;">
                                <img src="logo.png" alt="logo" style="width:100%;">
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <td>
                              <table>
                                <tr>
                                  <td style="padding:20px;">
                                    <h2 style="margin:0 0 15px 0;font-size:16px;color:#111;">Dear ${
                                      investor.first_name
                                    } ${investor.last_name},</h2>
                                    <p style="font-size:14px;color:#111;margin:0 0 15px 0;">
                                      You have been requested to review and authorize the signature for the following investment report:
                                    </p>
                                    <p style="margin:0 0 15px 0;font-size:14px;color:#111;"><b>Report Name:</b> ${
                                      dataa.nameOfRound || "N/A"
                                    }</p>
                                    <p style="margin:0 0 15px 0;font-size:14px;color:#111;"><b>Share Class Type:</b> ${
                                      dataa.shareClassType || "N/A"
                                    }</p>
                                    <p style="font-size:14px;color:#111;margin:0 0 15px 0;">
                                      By signing, you confirm the amount of investment and the number of shares you intend to acquire. 
                                      Please note that this action is legally binding.
                                    </p>
                                    <p style="font-size:14px;color:#111;margin:0 0 15px 0;">
                                      The system will automatically reserve the shares for you (shares are not yet locked in). 
                                      The company will send wire/transfer instructions separately.
                                    </p>
                                    <p style="font-size:14px;color:#111;margin:0 0 15px 0;">
                                      Please review the documents carefully before signing.
                                    </p>
                                  </td>
                                </tr>
                                <tr>
                      <td>
                        <div style="padding:0 20px 20px 20px;">
                          <a href="https://capavate.com/investor/company/capital-round-list/${
                            dataa.user_id
                          }" 
                            style="background:#CC0000;color:#fff;text-decoration:none;font-size:14px;padding:10px 30px;border-radius:10px;display:inline-block;">
                            Review & Sign Report
                          </a>
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

                  sendEmailToInvestor(investor.email, company, types, message);
                  return res.status(200).json({
                    message: `Report status updated to ${types}, email sent`,
                  });
                },
              );
            },
          );
        },
      );
    },
  );
};

// helper function
function sendEmailToInvestor(to, company, status, message) {
  var subject = `Report Confirmation from ${company.company_name}`;
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

exports.InvestorrequestToCompany = (req, res) => {
  const {
    next_round_id,
    created_by_id,
    roundrecord_id,
    investor_id,
    company_id,
    company_name,
    shares,
    investment_amount,
    ip_address,
    investment_soft_confirmation,
    percentageprice,
    selectedWarrantsId, // 👈 Now it's an array of objects [{id, shares, coverage_percentage}]
    round_share_price,
  } = req.body;

  if (!investor_id) {
    return res.status(400).json({ message: "Investor ID is required" });
  }

  // 1️⃣ Insert into investorrequest_company
  const sqlInvestment = `
    INSERT INTO investorrequest_company
    (investment_soft_confirmation,next_round_id, investor_id, roundrecord_id, company_id, shares, investment_amount, created_at)
    VALUES (?,?, ?, ?, ?, ?, ?, NOW())
  `;

  const investmentValues = [
    investment_soft_confirmation,
    next_round_id || 0,
    investor_id,
    roundrecord_id || null,
    company_id || null,
    shares || null,
    investment_amount || null,
  ];

  db.query(sqlInvestment, investmentValues, (err, result) => {
    if (err) {
      console.error("DB Insert Error:", err);
      return res.status(500).json({ message: "Database error" });
    }

    const insertedId = result.insertId;

    // 🔴 STEP 2: GET INVESTOR DETAILS (first_name, last_name, email, phone)
    const getInvestorSql = `
      SELECT first_name, last_name, email, phone 
      FROM investor_information 
      WHERE id = ?
    `;

    db.query(getInvestorSql, [investor_id], (investorErr, investorResult) => {
      if (investorErr) {
        console.error("Error fetching investor details:", investorErr);
      }

      const investor = investorResult?.[0] || {};

      // 🔴 STEP 3: PROCESS SELECTED WARRANTS (with ID and Shares)
      if (selectedWarrantsId && selectedWarrantsId.length > 0) {
        // Extract just the IDs for fetching from warrants table
        const warrantIds = selectedWarrantsId.map((w) => w.id);
        const placeholders = warrantIds.map(() => "?").join(",");

        const getWarrantsSql = `
          SELECT * FROM warrants 
          WHERE id IN (${placeholders})
        `;

        db.query(getWarrantsSql, warrantIds, (warrantErr, warrantsData) => {
          if (warrantErr) {
            console.error("Error fetching warrants:", warrantErr);
          } else if (warrantsData && warrantsData.length > 0) {
            // 🔴 STEP 4: INSERT EACH WARRANT INTO investors_warrants with shares from frontend
            let insertedCount = 0;
            const totalWarrants = warrantsData.length;

            warrantsData.forEach((warrant) => {
              // Find the corresponding frontend data to get shares
              const frontendWarrant = selectedWarrantsId.find(
                (w) => w.id === warrant.id,
              );
              const warrantShares = frontendWarrant?.shares || 0;
              const warrantPercentage =
                frontendWarrant?.percentagepricevalue ||
                warrant.percentagepricevalue ||
                0;
              const insertInvestorWarrantSql = `
                INSERT INTO investors_warrants (
                 
                  investorrequest_company_id,
                  roundrecord_id,
                  company_id,
                  investor_id,
                  warrant_id,
                  first_name,
                  last_name,
                  email,
                  phone,
                  shares,
                  new_shares,
                  total_shares,
                  percentage_numeric,
                  percentage_formatted,
                  warrant_coverage_percentage,
                  warrant_adjustment_percent,
                  warrant_adjustment_direction,
                  exercised_in_round_id,
                  notes,
                  warrant_status,
                  created_at,
                  updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
              `;

              const values = [
                insertedId,
                warrant.roundrecord_id,
                warrant.company_id,
                investor_id,
                warrant.id,
                investor.first_name || "",
                investor.last_name || "",
                investor.email || "",
                investor.phone || "",
                warrantShares, // 👈 Use shares from frontend
                warrantShares, // new_shares same as shares
                warrantShares, // total_shares same as shares
                warrantPercentage, // percentage_numeric (will be calculated later)
                warrantPercentage, // percentage_formatted
                warrant.warrant_coverage_percentage,
                warrant.warrant_adjustment_percent || 0,
                warrant.warrant_adjustment_direction || "decrease",
                roundrecord_id,
                warrant.notes || null,
                "exercised",
              ];

              db.query(insertInvestorWarrantSql, values, (insertErr) => {
                if (insertErr) {
                  console.error(
                    `Error inserting warrant ID ${warrant.id}:`,
                    insertErr,
                  );
                } else {
                  insertedCount++;
                }

                // After all inserts are processed
                if (insertedCount === totalWarrants) {
                }
              });
            });
          }
        });
      } else {
        console.log("No warrants selected for this investment");
      }

      // 🔴 STEP 5: CREATE WARRANT ENTRY (FOR NEW WARRANTS IF ANY)
      const checkWarrantsAndCreateEntry = (investmentId) => {
        // Get round details to check instrument type
        const getRoundSql = `
          SELECT instrumentType, instrument_type_data 
          FROM roundrecord 
          WHERE id = ? AND company_id = ?
        `;

        db.query(
          getRoundSql,
          [roundrecord_id, company_id],
          (roundErr, roundResult) => {
            if (roundErr || !roundResult.length) {
              console.log("Could not fetch round details for warrants");
              return;
            }

            const round = roundResult[0];

            // Only process if instrumentType is "Preferred Equity"
            if (round.instrumentType !== "Preferred Equity") {
              console.log(
                `No warrants: Instrument type is ${round.instrumentType}`,
              );
              return;
            }

            try {
              const instrumentData = round.instrument_type_data
                ? JSON.parse(round.instrument_type_data)
                : {};

              const hasWarrants =
                instrumentData.hasWarrants_preferred === true ||
                instrumentData.hasWarrants_preferred === "true";

              if (!hasWarrants) {
                console.log("No warrants enabled for this round");
                return;
              }

              const investmentAmount = parseFloat(investment_amount || 0);
              if (investmentAmount <= 0) {
                console.log("Invalid investment amount for warrant");
                return;
              }

              const coveragePercentage = parseFloat(
                instrumentData.warrant_coverage_percentage || 0,
              );
              if (coveragePercentage <= 0) {
                console.log("Invalid warrant coverage percentage");
                return;
              }

              const coverageAmount =
                investmentAmount * (coveragePercentage / 100);

              // Create warrant entry
              const createWarrantSql = `
                INSERT INTO warrants (
                  roundrecord_id,
                  company_id,
                  investor_id,
                  warrant_coverage_percentage,
                  warrant_exercise_type,
                  warrant_adjustment_percent,
                  warrant_adjustment_direction,
                  warrant_coverage_amount,
                  warrant_status,
                  expiration_date,
                  issued_date,
                  created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
              `;

              const warrantValues = [
                roundrecord_id,
                company_id,
                investor_id,
                coveragePercentage,
                instrumentData.warrant_exercise_type || "next_round_adjusted",
                parseFloat(instrumentData.warrant_adjustment_percent || 0),
                instrumentData.warrant_adjustment_direction || "decrease",
                coverageAmount,
                "pending",
                instrumentData.expirationDate_preferred || null,
              ];

              db.query(
                createWarrantSql,
                warrantValues,
                (warrantErr, warrantResult) => {
                  if (warrantErr) {
                    console.error("Warrant creation error:", warrantErr);
                  } else {
                    console.log(
                      `✅ New warrant created for investor ${investor_id}`,
                    );

                    // Also insert into investors_warrants
                    const insertInvestorWarrantSql = `
                    INSERT INTO investors_warrants (
                      roundrecord_id, company_id, investor_id, warrant_id,
                      first_name, last_name, email, phone,
                      shares, new_shares, total_shares,
                      percentage_numeric, percentage_formatted,
                      warrant_coverage_percentage,
                      warrant_adjustment_percent, warrant_adjustment_direction,
                      calculated_exercise_price, calculated_warrant_shares,
                      warrant_coverage_amount, notes,
                      created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '0', '0.00%', ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                  `;

                    const iwValues = [
                      roundrecord_id,
                      company_id,
                      investor_id,
                      warrantResult.insertId,
                      investor.first_name || "",
                      investor.last_name || "",
                      investor.email || "",
                      investor.phone || "",
                      0, // shares initially 0 for new warrants
                      0,
                      0,
                      coveragePercentage,
                      parseFloat(
                        instrumentData.warrant_adjustment_percent || 0,
                      ),
                      instrumentData.warrant_adjustment_direction || "decrease",
                      null, // calculated_exercise_price
                      null, // calculated_warrant_shares
                      coverageAmount,
                      instrumentData.warrant_notes || null,
                    ];

                    db.query(insertInvestorWarrantSql, iwValues, (iwErr) => {
                      if (iwErr) {
                        console.error(
                          "Error inserting into investors_warrants:",
                          iwErr,
                        );
                      }
                    });
                  }
                },
              );
            } catch (parseError) {
              console.error("Error parsing instrument data:", parseError);
            }
          },
        );
      };

      // Call warrant creation function
      checkWarrantsAndCreateEntry(insertedId);
    });

    // 6️⃣ Insert log into access_logs_investor
    const sqlLog = `
      INSERT INTO access_logs_investor
      (investor_id, user_id, company_id, company_name, action, module, description, ip_address, extra_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    // Calculate total warrant shares for log
    const totalWarrantShares =
      selectedWarrantsId?.reduce((sum, w) => sum + (w.shares || 0), 0) || 0;

    const logValues = [
      investor_id,
      created_by_id || null,
      company_id || null,
      company_name || null,
      "INVESTMENT_REQUEST",
      "Capital Round",
      `Investor requested ${shares || 0} shares for ${investment_amount || 0}${
        selectedWarrantsId?.length
          ? ` with ${selectedWarrantsId.length} warrant(s) (${totalWarrantShares} shares)`
          : ""
      }`,
      ip_address || null,
      JSON.stringify({
        requestId: insertedId,
        warrants: selectedWarrantsId,
        totalWarrantShares,
      }),
    ];

    db.query(sqlLog, logValues, (err2) => {
      if (err2) {
        console.error("DB Log Error:", err2);
      }

      return res.status(200).json({
        success: true,
        message: "Investment request submitted successfully",
        insertedId,
        warrantsProcessed: selectedWarrantsId?.length || 0,
        totalWarrantShares,
      });
    });
  });
};

exports.getInvestorAllRoundRecord = (req, res) => {
  const { company_id, investor_id } = req.body;

  if (!company_id || !investor_id) {
    return res
      .status(400)
      .json({ message: "company_id and investor_id required" });
  }

  const allInvestorsQuery = `
    SELECT 
      irc.investor_id,
      irc.investment_amount,
      irc.shares,
      r.roundsize,
      r.currency,
      r.issuedshares
    FROM investorrequest_company irc
    JOIN roundrecord r ON r.id = irc.roundrecord_id
    WHERE irc.company_id = ? AND irc.request_confirm = 'Yes'
  `;

  db.query(allInvestorsQuery, [company_id], (err, allResults) => {
    if (err)
      return res.status(500).json({ message: "DB query error", error: err });

    if (!allResults.length) {
      return res.status(200).json({
        total_invested: 0,
        ownership_percent: 0,
        rank: 0,
        min_investment: 0,
        max_investment: 0,
        total_company_shares: 0,
        investor_shares: 0,
        currency: "",
      });
    }

    // Parse safely
    const parsedAll = allResults.map((r) => ({
      investor_id: r.investor_id,
      investment_amount: Number(r.investment_amount) || 0,
      shares: Number(r.shares) || 0,
      roundsize: Number(r.roundsize) || 0,
      issuedshares: Number(r.issuedshares) || 0,
      currency: r.currency || "",
    }));

    const currency =
      parsedAll.find((r) => r.currency && r.currency.trim() !== "")?.currency ||
      "";

    // Rank investors by total invested capital
    const investmentByInvestor = {};
    parsedAll.forEach((r) => {
      investmentByInvestor[r.investor_id] =
        (investmentByInvestor[r.investor_id] || 0) + r.investment_amount;
    });

    const sortedInvestors = Object.entries(investmentByInvestor).sort(
      (a, b) => b[1] - a[1],
    );

    const rank =
      sortedInvestors.findIndex(
        ([id]) => parseInt(id) === parseInt(investor_id),
      ) + 1 || 0;

    // This investor’s records
    const investorRecords = parsedAll.filter(
      (r) => r.investor_id === Number(investor_id),
    );

    const totalInvested = investorRecords.reduce(
      (sum, r) => sum + r.investment_amount,
      0,
    );
    const investorShares = investorRecords.reduce(
      (sum, r) => sum + r.shares,
      0,
    );

    // ✅ Correct ownership calculation
    // Use issuedshares from roundrecord (not sum of all rounds)
    const totalIssuedShares = investorRecords.reduce(
      (sum, r) => sum + r.issuedshares,
      0,
    );

    const ownershipPercent =
      totalIssuedShares > 0 ? (investorShares / totalIssuedShares) * 100 : 0;

    const investments = investorRecords.map((r) => r.investment_amount);
    const minInvestment = investments.length > 0 ? Math.min(...investments) : 0;
    const maxInvestment = investments.length > 0 ? Math.max(...investments) : 0;

    res.json({
      total_invested: totalInvested,
      ownership_percent: parseFloat(ownershipPercent.toFixed(2)),
      rank,
      min_investment: minInvestment,
      max_investment: maxInvestment,
      total_company_shares: totalIssuedShares, // only current round’s issued shares
      investor_shares: investorShares,
      currency,
    });
  });
};

exports.getInvestmentList = (req, res) => {
  const { company_id } = req.body;

  const updateQuery = `
        SELECT 
    investorrequest_company.*,
    investor_information.first_name,
    investor_information.last_name,
    investor_information.email,
    roundrecord.nameOfRound,
    roundrecord.shareClassType,
    roundrecord.roundsize,
    roundrecord.issuedshares,
    roundrecord.currency,
    roundrecord.id as round_id,
    COALESCE(company.company_name, 'N/A') AS company_name
FROM investorrequest_company 
LEFT JOIN roundrecord ON roundrecord.id = investorrequest_company.roundrecord_id 
LEFT JOIN investor_information ON investor_information.id = investorrequest_company.investor_id 
LEFT JOIN company ON company.id = investorrequest_company.company_id 
WHERE investorrequest_company.company_id = ? 
ORDER BY investorrequest_company.id DESC`;

  // Correct parameter order: date_view, access_status, id
  db.query(updateQuery, [company_id], (err, results) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Database update error", error: err });
    }

    return res.status(200).json({ message: "", results: results });
  });
};

exports.verifyInvestment = (req, res) => {
  const { verify_id } = req.body;

  if (!verify_id) {
    return res.status(400).json({ message: "verify_id is required" });
  }

  const selectQuery = `
    SELECT 
      irc.*, 
      ii.first_name, ii.last_name, ii.email, ii.phone,ii.id as inv_id,
      c.company_name,
      rr.shareClassType, rr.nameOfRound, rr.roundsize, rr.issuedshares, rr.currency,rr.instrumentType,
      rr.id as roundrecord_id,
      rr.post_money as post_money_valuation,
      rr.share_price
    FROM investorrequest_company irc
    JOIN investor_information ii ON ii.id = irc.investor_id
    JOIN company c ON c.id = ii.company_id
    JOIN roundrecord rr ON rr.id = irc.roundrecord_id
    WHERE irc.id = ?
  `;

  db.query(selectQuery, [verify_id], (err, results) => {
    if (err)
      return res.status(500).json({ message: "DB query error", error: err });
    if (!results.length)
      return res.status(404).json({ message: "Record not found" });

    const record = results[0];
    const fullname = `${record.first_name} ${record.last_name}`;

    // Get a connection for transaction
    db.getConnection((err, connection) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Connection error", error: err });
      }

      connection.beginTransaction(async (err) => {
        if (err) {
          connection.release();
          return res
            .status(500)
            .json({ message: "Transaction error", error: err });
        }

        try {
          // 1️⃣ Update request_confirm
          await new Promise((resolve, reject) => {
            connection.query(
              `UPDATE investorrequest_company SET request_confirm = 'Yes', confirm_investment_acknowlegment ='Yes' WHERE id = ?`,
              [verify_id],
              (err2) => {
                if (err2) reject(err2);
                else resolve();
              },
            );
          });

          // 2️⃣ Calculate shares based on investment amount
          const sharePrice = parseFloat(record.share_price) || 0;
          const investmentAmount = parseFloat(record.amount) || 0;
          const shares =
            sharePrice > 0 ? Math.round(investmentAmount / sharePrice) : 0;

          // 3️⃣ Insert into round_investors
          const insertResult = await new Promise((resolve, reject) => {
            const insertQuery = `
              INSERT INTO round_investors 
              (investor_id,value, new_shares, total_shares, round_id, round_type, company_id, cap_table_type, investor_type,
               first_name, last_name, email, phone,
               shares, investment_amount, share_price,
               is_pending, instrument_type, share_class_type,
               round_name, investor_details, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'post', 'current',
                      ?, ?, ?, ?,
                      ?, ?, ?,
                      0, ?, ?,
                      ?, ?, NOW())
            `;

            const investorDetails = JSON.stringify({
              firstName: record.first_name,
              lastName: record.last_name,
              email: record.email,
              phone: record.phone,
              investor_id: record.investor_id,
            });

            connection.query(
              insertQuery,
              [
                record.inv_id || null, // value
                record.investment_amount, // value
                record.shares, // new_shares
                record.shares, // total_shares
                record.roundrecord_id, // round_id
                "Investor", // round_type
                record.company_id, // company_id
                record.first_name, // first_name
                record.last_name, // last_name
                record.email, // email
                record.phone || "", // phone
                record.shares, // shares
                record.investment_amount, // investment_amount
                sharePrice, // share_price
                record.instrumentType || "", // instrument_type
                record.shareClassType || "", // share_class_type
                record.nameOfRound || "Investment Round", // round_name
                investorDetails, // investor_details
              ],
              (err3, result) => {
                if (err3) reject(err3);
                else resolve(result);
              },
            );
          });

          const roundInvestorId = insertResult.insertId;
          // 4️⃣ Update investors_warrants table with round_investors ID
          const warrantsData = await new Promise((resolve, reject) => {
            const getWarrantsQuery = `
              SELECT * FROM investors_warrants 
              WHERE investorrequest_company_id = ? 
                AND exercised_in_round_id = ?
                AND company_id = ?
                AND investor_id = ?
            `;

            connection.query(
              getWarrantsQuery,
              [
                verify_id,
                record.roundrecord_id,
                record.company_id,
                record.investor_id,
              ],
              (err4, results) => {
                if (err4) {
                  console.error("❌ Error fetching warrants:", err4);
                  reject(err4);
                } else {
                  resolve(results);
                }
              },
            );
          });

          // 🔴 STEP 5: INSERT EACH WARRANT INTO round_investors
          let warrantsInserted = 0;
          if (warrantsData && warrantsData.length > 0) {
            for (const warrant of warrantsData) {
              // Step 1: Check if record already exists in round_investors
              const checkExistingQuery = `
                  SELECT id FROM round_investors 
                  WHERE round_id = ? 
                    AND investor_type = 'warrant not exercised' 
                    AND cap_table_type = 'post' 
                    AND warrant_id = ? And company_id =?
                `;

              await new Promise((resolve, reject) => {
                connection.query(
                  checkExistingQuery,
                  [
                    record.roundrecord_id,
                    warrant.warrant_id,
                    record.company_id,
                  ],
                  (err6, existingRecords) => {
                    if (err6) {
                      console.error(
                        `❌ Error checking existing warrant record:`,
                        err6,
                      );
                      reject(err6);
                      return;
                    }

                    // Step 2: If record exists, delete it
                    if (existingRecords && existingRecords.length > 0) {
                      const deleteQuery = `
                        DELETE FROM round_investors 
                        WHERE round_id = ? 
                          AND investor_type = 'warrant not exercised' 
                          AND cap_table_type = 'post' 
                          AND warrant_id = ? And company_id = ?
                      `;

                      connection.query(
                        deleteQuery,
                        [
                          record.roundrecord_id,
                          warrant.warrant_id,
                          warrant.company_id,
                        ],
                        (err7, deleteResult) => {
                          if (err7) {
                            console.error(
                              `❌ Error deleting existing warrant record:`,
                              err7,
                            );
                            reject(err7);
                            return;
                          }
                          console.log(
                            `✅ Deleted ${deleteResult.affectedRows} existing warrant record(s) for warrant ID ${warrant.id}`,
                          );

                          // Step 3: Insert new record
                          insertWarrantRecord(
                            connection,
                            record,
                            warrant,
                            sharePrice,
                            resolve,
                            reject,
                          );
                        },
                      );
                    } else {
                      // No existing record, directly insert
                      insertWarrantRecord(
                        connection,
                        record,
                        warrant,
                        sharePrice,
                        resolve,
                        reject,
                      );
                    }
                  },
                );
              });
            }
          }

          // Helper function to insert warrant record

          await new Promise((resolve, reject) => {
            const updateWarrantsQuery = `
              UPDATE investors_warrants 
              SET round_investor_id = ? 
              WHERE exercised_in_round_id = ? 
                AND company_id = ? 
                AND investor_id = ?
            `;

            connection.query(
              updateWarrantsQuery,
              [
                roundInvestorId,
                record.roundrecord_id,
                record.company_id,
                record.investor_id,
              ],
              (err4, result) => {
                if (err4) {
                  console.error("❌ Error updating investors_warrants:", err4);
                  reject(err4);
                } else {
                  resolve(result);
                }
              },
            );
          });

          // 5️⃣ Commit transaction
          await new Promise((resolve, reject) => {
            connection.commit((err) => {
              if (err) reject(err);
              else resolve();
            });
          });

          // 6️⃣ Send verification email
          sendEmailToInvestment_Verify(
            record.email,
            fullname,
            record.company_name,
            record.shareClassType,
            record.nameOfRound,
            record.roundsize,
            record.issuedshares,
            record.currency,
            record.company_id,
            record.roundrecord_id,
          );

          return res.status(200).json({
            success: true,
            message: "Investment verified and added to cap table successfully",
            roundInvestorId,
          });
        } catch (error) {
          // Rollback on error
          connection.rollback(() => {
            connection.release();
            console.error("❌ Transaction error:", error);
            return res.status(500).json({
              success: false,
              message: "Transaction failed",
              error: error.message,
            });
          });
        } finally {
          connection.release();
        }
      });
    });
  });
};
function insertWarrantRecord(
  connection,
  record,
  warrant,
  sharePrice,
  resolve,
  reject,
) {
  const insertWarrantQuery = `
    INSERT INTO round_investors 
    (investor_id,value, new_shares, total_shares, round_id, round_type, company_id, cap_table_type, investor_type,
     first_name, last_name, email, phone,
     shares, investment_amount, share_price,
     is_pending, instrument_type, share_class_type,
     round_name, investor_details, created_at,
     warrant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'post', 'warrant',
            ?, ?, ?, ?,
            ?, 0, ?,
            0, ?, ?,
            ?, ?, NOW(),
            ?)
  `;

  // Create investor details for warrant
  const warrantInvestorDetails = JSON.stringify({
    firstName: warrant.first_name || record.first_name,
    lastName: warrant.last_name || record.last_name,
    email: warrant.email || record.email,
    phone: warrant.phone || record.phone,
    investor_id: record.investor_id,
    warrant_id: warrant.id,
    is_warrant: true,
    status: "not exercised",
  });

  connection.query(
    insertWarrantQuery,
    [
      // value (1)
      record.inv_id || null,
      warrant.shares * warrant.percentage_numeric,

      // new_shares (2)
      warrant.shares,

      // total_shares (3)
      warrant.shares,

      // round_id (4)
      record.roundrecord_id,

      // round_type (5)
      "Warrant Exercise",

      // company_id (6)
      record.company_id,

      // first_name (7)
      warrant.first_name || record.first_name,

      // last_name (8)
      warrant.last_name || record.last_name,

      // email (9)
      warrant.email || record.email,

      // phone (10)
      warrant.phone || record.phone,

      // shares (11)
      warrant.shares,

      // share_price (12)
      warrant.percentage_numeric,

      // instrument_type (13)
      record.instrumentType,

      // share_class_type (14)
      record.shareClassType,

      // round_name (15)
      record.nameOfRound || "Warrant Exercise Round",

      // investor_details (16)
      warrantInvestorDetails,

      // warrant_id (17)
      warrant.warrant_id,
    ],
    (err5, result) => {
      if (err5) {
        console.error(`❌ Error inserting warrant ID ${warrant.id}:`, err5);
        reject(err5);
      } else {
        console.log(
          `✅ Warrant ID ${warrant.id} inserted into round_investors with ID: ${result.insertId}`,
        );
        resolve(result);
      }
    },
  );
}
// Function to send verification email
function sendEmailToInvestment_Verify(
  email,
  firstName,
  companyName,
  shareClassType,
  nameOfRound,
  roundsize,
  issuedshares,
  currency,
  company_id,
  round_id,
) {
  const subject = `Your investment has been verified - ${companyName}`;

  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Investment Verified</title>
  </head>
  <body>
    <div style="width:600px; margin:0 auto; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; font-family:Verdana, Geneva, sans-serif;">
      <table style="width:100%; border-collapse: collapse;">
        <tr>
          <td style="background:#efefef; padding:10px; text-align:center;">
            <img src="https://capavate.com/api/upload/images/logo.png" alt="logo" style="width:130px;" />
          </td>
        </tr>
        <tr>
          <td style="padding:20px;">
            <h2 style="font-size:16px; color:#111;">Hello ${firstName},</h2>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              Your investment in ${companyName} has been verified successfully.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:20px;">
              <strong>Round: </strong> ${nameOfRound} - ${shareClassType} <br/>
              <strong>Round Size: </strong>${currency} ${roundsize} <br/>
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:20px;">
              <strong>View Details:</strong> 
              <a href="https://capavate.com/investor/company/capital-round-list/view/${company_id}/${round_id}" 
                target="_blank"
                style="color:#CC0000; text-decoration:underline;">
                Click here to view your investment
              </a>
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

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) console.error("Error sending investment verification email:", err);
    else console.log("Investment verification email sent:", info.response);
  });
}

// Node.js API Implementation
// Backend API - Fixed fetchInvestorData
exports.fetchInvestorData = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    return res.status(400).json({
      message: "Company ID is required",
      results: [],
    });
  }

  const fetchQuery = `
    SELECT 
      investorrequest_company.id,
      investorrequest_company.roundrecord_id,
      investorrequest_company.investor_id,
      investorrequest_company.company_id,
      investorrequest_company.investment_amount,
      investorrequest_company.request_confirm,
      investorrequest_company.created_at,
      investor_information.first_name,
      investor_information.last_name,
      investor_information.email,
      investor_information.phone,
      roundrecord.nameOfRound,
      roundrecord.shareClassType,
      roundrecord.shareclassother,
      roundrecord.instrumentType,
      roundrecord.instrument_type_data,
      roundrecord.roundsize,
      roundrecord.issuedshares,
      roundrecord.currency,
      roundrecord.dateroundclosed,
      roundrecord.roundStatus,
      roundrecord.description,
      roundrecord.created_at AS round_created_at,
      company.company_name
    FROM investorrequest_company
    LEFT JOIN roundrecord ON roundrecord.id = investorrequest_company.roundrecord_id
    LEFT JOIN investor_information ON investor_information.id = investorrequest_company.investor_id
    LEFT JOIN company ON company.id = investorrequest_company.company_id
    WHERE investorrequest_company.company_id = ? 
    ORDER BY roundrecord.created_at ASC, investorrequest_company.id ASC
  `;

  db.query(fetchQuery, [company_id], (err, results) => {
    if (err) {
      console.error("Database query error:", err);
      return res.status(500).json({
        message: "Database query error",
        error: err,
        results: [],
      });
    }

    if (!results.length) {
      return res.status(200).json({
        message: "No investment data found for this company",
        results: [],
        stats: {
          totalInvestment: 0,
          activeInvestments: 0,
          totalShares: 0,
          pendingRequests: 0,
          confirmedInvestments: 0,
          rejectedInvestments: 0,
        },
      });
    }

    // Group by round and calculate shares
    const roundsMap = {};
    const pendingConversions = { safes: [], convertibleNotes: [] };

    results.forEach((row) => {
      const roundId = row.roundrecord_id;

      // Initialize round if not exists
      if (!roundsMap[roundId]) {
        let instrumentData = {};
        try {
          if (row.instrument_type_data) {
            instrumentData = JSON.parse(row.instrument_type_data);
          }
        } catch (e) {
          console.error("Error parsing instrument_type_data:", e);
        }

        const shareClassName =
          row.shareClassType !== "OTHER"
            ? row.shareClassType
            : row.shareclassother || "Common";

        roundsMap[roundId] = {
          id: roundId,
          name: row.nameOfRound || shareClassName,
          issuedShares: parseFloat(row.issuedshares || 0),
          roundSize: parseFloat(row.roundsize || 0),
          instrumentType: row.instrumentType || "Common Stock",
          instrumentData,
          currency: row.currency || "USD",
          investors: [],
          created_at: row.round_created_at,
        };
      }

      // Add investor to round
      if (row.investor_id) {
        const investorName =
          `${row.first_name || ""} ${row.last_name || ""}`.trim() ||
          `Investor ${row.investor_id}`;

        const investmentAmount = parseFloat(row.investment_amount || 0);

        // Calculate shares based on round size and issued shares
        let shares = 0;
        if (
          investmentAmount > 0 &&
          roundsMap[roundId].roundSize > 0 &&
          roundsMap[roundId].issuedShares > 0
        ) {
          const pricePerShare =
            roundsMap[roundId].roundSize / roundsMap[roundId].issuedShares;
          if (pricePerShare > 0) {
            shares = investmentAmount / pricePerShare;
          }
        }

        roundsMap[roundId].investors.push({
          request_id: row.id,
          investor_id: row.investor_id,
          roundrecord_id: roundId,
          name: investorName,
          shares: shares,
          investmentAmount: investmentAmount,
          request_confirm: row.request_confirm,
          instrumentType: row.instrumentType,
          instrumentData: row.instrument_type_data
            ? JSON.parse(row.instrument_type_data)
            : {},
          email: row.email,
          phone: row.phone,
          currency: row.currency || "USD",
        });

        // Track SAFEs / Convertible Notes for conversion
        if (
          (row.instrumentType === "Safe" ||
            row.instrumentType === "Convertible Note") &&
          row.investment_amount
        ) {
          pendingConversions[
            row.instrumentType === "Safe" ? "safes" : "convertibleNotes"
          ].push({
            investorName,
            amount: parseFloat(row.investment_amount),
            instrumentData: row.instrument_type_data
              ? JSON.parse(row.instrument_type_data)
              : {},
            currency: row.currency || "USD",
          });
        }
      }
    });

    // Sort rounds by creation date
    const rounds = Object.values(roundsMap).sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at),
    );

    // Calculate cumulative shares and ownership
    let cumulativeTotalShares = 0;
    const stakeholderShares = {};
    const stakeholderInvestments = {};

    rounds.forEach((round) => {
      let additionalSharesFromConversions = 0;
      let totalInvestorSharesThisRound = 0;

      const pricePerShare =
        round.roundSize && round.issuedShares
          ? round.roundSize / round.issuedShares
          : 0;

      // Convert SAFE / Convertible Notes
      const convertInstruments = (instruments) => {
        instruments.forEach((inst) => {
          let conversionPrice = pricePerShare;
          const cap = parseFloat(inst.instrumentData.valuationCap || 0);
          const discount = parseFloat(inst.instrumentData.discountRate || 0);

          if (cap > 0 && cumulativeTotalShares > 0) {
            conversionPrice = Math.min(
              conversionPrice,
              cap / cumulativeTotalShares,
            );
          }
          if (discount > 0) {
            conversionPrice = Math.min(
              conversionPrice,
              pricePerShare * (1 - discount / 100),
            );
          }

          if (conversionPrice > 0) {
            const shares = inst.amount / conversionPrice;
            additionalSharesFromConversions += shares;
            stakeholderShares[inst.investorName] =
              (stakeholderShares[inst.investorName] || 0) + shares;
            stakeholderInvestments[inst.investorName] =
              (stakeholderInvestments[inst.investorName] || 0) + inst.amount;
          }
        });
        instruments.length = 0;
      };

      convertInstruments(pendingConversions.safes);
      convertInstruments(pendingConversions.convertibleNotes);

      // Add direct equity shares
      round.investors.forEach((inv) => {
        if (
          inv.instrumentType !== "Safe" &&
          inv.instrumentType !== "Convertible Note"
        ) {
          stakeholderShares[inv.name] =
            (stakeholderShares[inv.name] || 0) + inv.shares;
          stakeholderInvestments[inv.name] =
            (stakeholderInvestments[inv.name] || 0) + inv.investmentAmount;
          totalInvestorSharesThisRound += inv.shares;
        }
      });

      // Update cumulative shares
      cumulativeTotalShares +=
        round.issuedShares + additionalSharesFromConversions;

      // Calculate founder shares
      const founderSharesThisRound =
        round.issuedShares - totalInvestorSharesThisRound;
      stakeholderShares["Founders"] =
        (stakeholderShares["Founders"] || 0) + founderSharesThisRound;
    });

    // Build formatted results
    const formattedResults = [];

    results.forEach((row) => {
      if (row.investor_id && row.roundrecord_id) {
        const investorName =
          `${row.first_name || ""} ${row.last_name || ""}`.trim() ||
          `Investor ${row.investor_id}`;

        const investorShares = stakeholderShares[investorName] || 0;
        const ownershipPercentage =
          cumulativeTotalShares > 0
            ? parseFloat(
                (investorShares / cumulativeTotalShares) * 100,
              ).toFixed(2)
            : "0.00";

        formattedResults.push({
          id: row.id,
          investor_id: row.investor_id,
          roundrecord_id: row.roundrecord_id,
          investor_name: investorName,
          investor_email: row.email,
          investor_phone: row.phone,
          nameOfRound:
            row.nameOfRound ||
            (row.shareClassType !== "OTHER"
              ? row.shareClassType
              : row.shareclassother || "Common"),
          company_name: row.company_name,
          shareClassType: row.shareClassType,
          investment_amount: parseFloat(row.investment_amount || 0),
          shares: investorShares,
          issuedshares: parseFloat(row.issuedshares || 0),
          roundsize: parseFloat(row.roundsize || 0),
          currency: row.currency || "USD",
          instrumentType: row.instrumentType,
          request_confirm: row.request_confirm,
          roundStatus: row.roundStatus,
          ownershipPercentage: ownershipPercentage,
          totalSharesIncludingWarrants: cumulativeTotalShares,
        });
      }
    });

    // Calculate stats
    let stats = {
      totalInvestment: 0,
      activeInvestments: 0,
      totalShares: Math.round(cumulativeTotalShares),
      pendingRequests: 0,
      confirmedInvestments: 0,
      rejectedInvestments: 0,
    };

    formattedResults.forEach((inv) => {
      const amount = parseFloat(inv.investment_amount) || 0;

      if (inv.request_confirm === "Yes") {
        stats.totalInvestment += amount;
        stats.confirmedInvestments += 1;
        if (["Active", "Fundraising", "Open"].includes(inv.roundStatus)) {
          stats.activeInvestments += 1;
        }
      } else if (inv.request_confirm === "No") {
        stats.pendingRequests += 1;
      } else if (inv.request_confirm === "Rejected") {
        stats.rejectedInvestments += 1;
      }
    });

    return res.status(200).json({
      message: "Investment data fetched successfully",
      results: formattedResults,
      stats,
      totalRecords: formattedResults.length,
      metadata: {
        totalShares: Math.round(cumulativeTotalShares),
        founderShares: Math.round(stakeholderShares["Founders"] || 0),
        totalInvestorShares: Math.round(
          cumulativeTotalShares - (stakeholderShares["Founders"] || 0),
        ),
      },
    });
  });
};

// Additional API for getting portfolio summary by company
exports.getPortfolioSummary = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    return res.status(400).json({
      message: "Company ID is required",
      results: [],
    });
  }

  // Query to get portfolio breakdown by round
  const summaryQuery = `
    SELECT 
      rr.nameOfRound,
      rr.roundsize,
      rr.issuedshares,
      rr.roundStatus,
      COUNT(irc.id) as total_investors,
      COUNT(CASE WHEN irc.request_confirm = 'Yes' THEN 1 END) as confirmed_investors,
      COUNT(CASE WHEN irc.request_confirm = 'No' THEN 1 END) as pending_investors,
      SUM(CASE WHEN irc.request_confirm = 'Yes' THEN CAST(irc.investment_amount AS DECIMAL(15,2)) ELSE 0 END) as confirmed_amount,
      SUM(CASE WHEN irc.request_confirm = 'Yes' THEN CAST(irc.shares AS DECIMAL(15,2)) ELSE 0 END) as confirmed_shares,
      SUM(CASE WHEN irc.request_confirm = 'No' THEN CAST(irc.investment_amount AS DECIMAL(15,2)) ELSE 0 END) as pending_amount
    FROM roundrecord rr
    LEFT JOIN investorrequest_company irc ON rr.id = irc.roundrecord_id
    WHERE rr.company_id = ?
    GROUP BY rr.id, rr.nameOfRound, rr.roundsize, rr.issuedshares, rr.roundStatus
    ORDER BY rr.id DESC
  `;

  db.query(summaryQuery, [company_id], (err, results) => {
    if (err) {
      console.error("Database query error:", err);
      return res.status(500).json({
        message: "Database query error",
        error: err,
        results: [],
      });
    }

    return res.status(200).json({
      message: "Portfolio summary fetched successfully",
      results: results,
    });
  });
};

// API to update investment request status (approve/reject)
exports.updateInvestmentStatus = (req, res) => {
  const { request_id, status, updated_by_id } = req.body;

  if (!request_id || !status || !["Yes", "No", "Rejected"].includes(status)) {
    return res.status(400).json({
      message: "Valid request ID and status (Yes/No/Rejected) are required",
    });
  }

  const updateQuery = `
    UPDATE investorrequest_company 
    SET request_confirm = ?, 
        updated_at = NOW()
    WHERE id = ?
  `;

  db.query(updateQuery, [status, request_id], (err, result) => {
    if (err) {
      console.error("Database update error:", err);
      return res.status(500).json({
        message: "Database update error",
        error: err,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Investment request not found",
      });
    }

    return res.status(200).json({
      message: "Investment status updated successfully",
      affectedRows: result.affectedRows,
    });
  });
};

exports.getcheckInvestorStatus = (req, res) => {
  const { investor_id, company_id, roundrecord_id } = req.body;

  const updateQuery = `
    SELECT * from investorrequest_company where roundrecord_id = ? And investor_id = ? And  company_id = ?
  `;

  db.query(
    updateQuery,
    [roundrecord_id, investor_id, company_id],
    (err, row) => {
      if (err) {
        console.error("Database update error:", err);
        return res.status(500).json({
          message: "Database update error",
          error: err,
        });
      }

      return res.status(200).json({
        message: "",
        result: row,
      });
    },
  );
};

exports.getexistingShare = async (req, res) => {
  try {
    const { company_id, roundrecord_id } = req.body;

    if (!company_id) {
      return res.status(400).json({
        success: false,
        message: "Company ID is required",
      });
    }

    // Step 1: Get Round 0 data for base shares
    const roundZeroQuery = `
      SELECT issuedshares, founder_data, total_founder_shares 
      FROM roundrecord 
      WHERE company_id = ? AND round_type = 'Round 0'
    `;

    db.query(roundZeroQuery, [company_id], (err, roundZeroResults) => {
      if (err) {
        console.error("Database error fetching Round 0:", err);
        return res.status(500).json({
          success: false,
          message: "Database error",
          error: err,
        });
      }

      if (roundZeroResults.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Round 0 (Incorporation) data not found",
          existingShares: 0,
        });
      }

      const roundZero = roundZeroResults[0];
      let existingShares = 0;

      // Try to get shares from founder_data first
      if (roundZero.founder_data) {
        try {
          let founderData = roundZero.founder_data;

          // Handle JSON string parsing
          if (typeof founderData === "string") {
            founderData = JSON.parse(founderData);
          }

          if (founderData.totalShares) {
            existingShares = parseInt(founderData.totalShares);
          } else if (
            founderData.founders &&
            Array.isArray(founderData.founders)
          ) {
            // Calculate total from individual founders
            existingShares = founderData.founders.reduce((total, founder) => {
              return total + parseInt(founder.shares || 0);
            }, 0);
          }
        } catch (parseError) {
          console.error("Error parsing founder_data:", parseError);
        }
      }

      // Fallback to issuedshares field
      if (existingShares === 0 && roundZero.issuedshares) {
        existingShares = parseInt(roundZero.issuedshares);
      }

      // Final fallback to total_founder_shares
      if (existingShares === 0 && roundZero.total_founder_shares) {
        existingShares = parseInt(roundZero.total_founder_shares);
      }

      // Step 2: If specific round is provided, check if it's SAFE and adjust
      if (roundrecord_id) {
        const currentRoundQuery = `
          SELECT instrumentType, instrument_type_data, roundsize, optionPoolPercent 
          FROM roundrecord 
          WHERE id = ? AND company_id = ?
        `;

        db.query(
          currentRoundQuery,
          [roundrecord_id, company_id],
          (err, currentRoundResults) => {
            if (err) {
              console.error("Database error fetching current round:", err);
              return res.status(500).json({
                success: false,
                message: "Database error fetching current round",
                error: err,
              });
            }

            if (currentRoundResults.length > 0) {
              const currentRound = currentRoundResults[0];

              // If this is a SAFE round, existing shares remain the same
              // If this is an equity round, we need to add option pool shares
              if (currentRound.instrumentType !== "Safe") {
                const optionPoolPercent = parseFloat(
                  currentRound.optionPoolPercent || 0,
                );

                if (optionPoolPercent > 0) {
                  // Calculate option pool shares: existingShares / (1 - optionPool%) * optionPool%
                  const optionPoolShares = Math.round(
                    (existingShares * (optionPoolPercent / 100)) /
                      (1 - optionPoolPercent / 100),
                  );
                  existingShares += optionPoolShares;
                }
              }
            }

            return res.status(200).json({
              success: true,
              message: "Existing shares retrieved successfully",
              existingShares: existingShares,
              source: "Round 0 + Option Pool",
              breakdown: {
                roundZeroShares: existingShares,
                includesOptionPool:
                  currentRoundResults.length > 0 &&
                  currentRoundResults[0].instrumentType !== "Safe",
              },
            });
          },
        );
      } else {
        // No specific round provided, return Round 0 shares only
        return res.status(200).json({
          success: true,
          message: "Existing shares retrieved successfully",
          existingShares: existingShares,
          source: "Round 0 only",
          breakdown: {
            roundZeroShares: existingShares,
            includesOptionPool: false,
          },
        });
      }
    });
  } catch (error) {
    console.error("Error in getexistingShare:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.getAllocatedShares = async (req, res) => {
  const { roundrecord_id, company_id } = req.body;

  // Validate inputs
  if (!roundrecord_id || !company_id) {
    return res.status(400).json({
      success: false,
      message: "Missing required parameters",
    });
  }

  try {
    // 1. Get round details
    const roundQuery = `
      SELECT roundsize, issuedshares
      FROM roundrecord 
      WHERE id = ? AND company_id = ?
    `;

    // Use promise-based query
    const [roundResults] = await db
      .promise()
      .query(roundQuery, [roundrecord_id, company_id]);

    if (roundResults.length === 0) {
      return res.json({
        success: true,
        allocated_shares: 0,
        total_investment: 0,
        price_per_share: 0,
        message: "Round not found",
      });
    }

    const round = roundResults[0];
    const totalSharesInRound = parseFloat(round.issuedshares) || 0;
    const roundSize = parseFloat(round.roundsize) || 0;

    // Calculate price per share
    const pricePerShare =
      totalSharesInRound > 0 ? roundSize / totalSharesInRound : 0;

    // 2. Get total investment amount
    const investmentQuery = `
      SELECT investment_amount
      FROM investorrequest_company 
      WHERE roundrecord_id = ? 
        AND company_id = ?
        AND request_confirm IN ('No', 'Yes')
    `;

    const [investmentResults] = await db
      .promise()
      .query(investmentQuery, [roundrecord_id, company_id]);

    // Calculate sum manually
    let totalInvestment = 0;
    investmentResults.forEach((row) => {
      if (row.investment_amount) {
        const amount =
          parseFloat(row.investment_amount.toString().replace(/,/g, "")) || 0;
        totalInvestment += amount;
      }
    });

    // Calculate allocated shares
    const allocatedShares =
      pricePerShare > 0 ? totalInvestment / pricePerShare : 0;

    res.json({
      success: true,
      allocated_shares: allocatedShares,
      total_investment: totalInvestment,
      price_per_share: pricePerShare,
      round_details: {
        total_shares: totalSharesInRound,
        round_size: roundSize,
      },
      investors_count: investmentResults.length,
      message: `Found ${investmentResults.length} investors with $${totalInvestment} investment`,
    });
  } catch (error) {
    console.error("❌ Error in getAllocatedShares:", error);
    res.status(500).json({
      success: false,
      message: "Database error",
      error: error.message,
    });
  }
};
exports.getTotalInvestment = async (req, res) => {
  const { roundrecord_id, company_id } = req.body;

  if (!roundrecord_id || !company_id) {
    return res.status(400).json({
      success: false,
      message: "Missing roundrecord_id or company_id",
    });
  }

  try {
    // Simple query to get all investment amounts
    const query = `
      SELECT id, investment_amount, request_confirm
      FROM investorrequest_company 
      WHERE roundrecord_id = ? 
        AND company_id = ?
        AND request_confirm IN ('No', 'Yes')
    `;

    console.log("Running getTotalInvestment for:", {
      roundrecord_id,
      company_id,
    });

    // Use promise wrapper
    const [results] = await db
      .promise()
      .query(query, [roundrecord_id, company_id]);

    // Calculate sum manually
    let totalInvestment = 0;
    results.forEach((row) => {
      if (row.investment_amount) {
        // Remove commas and convert to number
        const amountStr = row.investment_amount.toString().replace(/,/g, "");
        const amount = parseFloat(amountStr) || 0;
        totalInvestment += amount;
      }
    });

    console.log(
      `Found ${results.length} records, total investment: $${totalInvestment}`,
    );

    res.json({
      success: true,
      total_investment: totalInvestment,
      total_investors: results.length,
      investors: results.map((r) => ({
        id: r.id,
        amount: r.investment_amount,
        status: r.request_confirm,
      })),
    });
  } catch (error) {
    console.error("❌ Error in getTotalInvestment:", error);

    // Fallback: Try with callback if promise fails
    try {
      db.query(query, [roundrecord_id, company_id], (error, results) => {
        if (error) {
          return res.status(500).json({
            success: false,
            message: "Database error",
            error: error.message,
          });
        }

        let totalInvestment = 0;
        results.forEach((row) => {
          if (row.investment_amount) {
            const amount = parseFloat(row.investment_amount) || 0;
            totalInvestment += amount;
          }
        });

        res.json({
          success: true,
          total_investment: totalInvestment,
          total_investors: results.length,
        });
      });
    } catch (fallbackError) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch investment data",
        total_investment: 0,
        total_investors: 0,
      });
    }
  }
};
exports.deleteround = async (req, res) => {
  const { id, company_id } = req.body;

  // Validate inputs
  if (!id || !company_id) {
    return res.status(400).json({
      success: false,
      message: "Missing required parameters",
    });
  }

  try {
    // First check if round exists
    const checkQuery =
      "SELECT id FROM roundrecord WHERE id = ? AND company_id = ?";
    const [checkResult] = await db
      .promise()
      .query(checkQuery, [id, company_id]);

    if (checkResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Round not found",
      });
    }

    // Delete from child tables first
    await db
      .promise()
      .query("DELETE FROM round_cap_table_items WHERE round_id = ?", [id]);
    await db
      .promise()
      .query("DELETE FROM round_conversions WHERE round_id = ?", [id]);
    await db
      .promise()
      .query("DELETE FROM round_founders WHERE round_id = ?", [id]);
    await db
      .promise()
      .query("DELETE FROM round_investors WHERE round_id = ?", [id]);
    await db
      .promise()
      .query("DELETE FROM round_option_pools WHERE round_id = ?", [id]);
    await db
      .promise()
      .query("DELETE FROM round_pending_instruments WHERE round_id = ?", [id]);

    // Finally delete from parent table
    const [deleteResult] = await db
      .promise()
      .query("DELETE FROM roundrecord WHERE id = ? AND company_id = ?", [
        id,
        company_id,
      ]);

    res.json({
      success: true,
      message: "Round deleted successfully",
      deleted_round_id: id,
    });
  } catch (error) {
    console.error("❌ Error in deleteround:", error);
    res.status(500).json({
      success: false,
      message: "Database error",
      error: error.message,
    });
  }
};

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // ✅ FIX: req.body.id milta hai sirf multer ke baad
    // destination mein req.body reliable nahi hota — static path use karo
    var id = req.body.id;
    const uploadPath = "upload/investor/inv_" + id;
    console.log(uploadPath);
    if (!fs.existsSync(uploadPath))
      fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname),
    );
  },
});
const upload = multer({ storage });
// ================================================================
// EXACT SAME PATTERN as CreateOrUpdateCapitalRound
// Destructure ANDAR callback ke — bahar nahi
// ================================================================

exports.investoreditprofile = (req, res) => {
  // ✅ STEP 1: uploadFields define karo
  const uploadFields = upload.fields([
    { name: "kyc_doc", maxCount: 1 },
    { name: "profile_picture", maxCount: 1 },
  ]);

  // ✅ STEP 2: callback ke andar sab kuch — req.body yahaan milega
  uploadFields(req, res, async (err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "File upload error",
        error: err.message,
      });
    }

    console.log("Body:", req.body);
    console.log("Files:", req.files);

    // ✅ STEP 3: ANDAR destructure karo — callback ke bahar nahi
    const {
      email,
      first_name,
      last_name,
      phone,
      city,
      country,
      linkedIn_profile,
      type_of_investor,
      bio_short,
      mailing_address,
      accredited_status,
      country_tax,
      tax_id,
      screen_name,
      job_title,
      company_name,
      company_country,
      company_website,
      industry_expertise,
      cheque_size,
      geo_focus,
      preferred_stages,
      hands_on,
      network_bio,
      ma_interests,
      notes,
    } = req.body;

    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Email is required" });
    }

    try {
      const fields = [];
      const values = [];

      const addField = (col, val) => {
        if (val !== undefined && val !== null) {
          fields.push(`${col} = ?`);
          values.push(val === "" ? null : val);
        }
      };

      addField("first_name", first_name);
      addField("last_name", last_name);
      addField("phone", phone);
      addField("city", city);
      addField("country", country);
      addField("linkedIn_profile", linkedIn_profile);
      addField("type_of_investor", type_of_investor);
      addField("bio_short", bio_short);
      addField("mailing_address", mailing_address);
      addField("accredited_status", accredited_status);
      addField("country_tax", country_tax);
      addField("tax_id", tax_id);

      // ✅ Files — req.files ab defined hai callback ke andar
      if (req.files?.["kyc_doc"]?.[0]) {
        addField("kyc_document", req.files["kyc_doc"][0].filename);
      }
      if (req.files?.["profile_picture"]?.[0]) {
        addField("profile_picture", req.files["profile_picture"][0].filename);
      }

      addField("screen_name", screen_name);
      addField("job_title", job_title);
      addField("company_name", company_name);
      addField("company_country", company_country);
      addField("company_website", company_website);
      addField("industry_expertise", industry_expertise);
      addField("cheque_size", cheque_size);
      addField("geo_focus", geo_focus);
      addField("preferred_stages", preferred_stages);
      addField("hands_on", hands_on);
      addField("network_bio", network_bio);
      addField("ma_interests", ma_interests);
      addField("notes", notes);

      fields.push("updated_at = NOW()");

      if (fields.length === 1) {
        return res
          .status(400)
          .json({ success: false, message: "No fields to update" });
      }

      values.push(email);
      const sql = `UPDATE investor_information SET ${fields.join(", ")} WHERE email = ?`;

      console.log("SQL:", sql);
      console.log("VALUES:", values);

      const [result] = await db.promise().query(sql, values);

      if (result.affectedRows === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Investor not found" });
      }

      return res
        .status(200)
        .json({ success: true, message: "Profile updated successfully" });
    } catch (dbErr) {
      console.error("investoreditprofile DB error:", dbErr);
      return res.status(500).json({
        success: false,
        message: "Server error",
        error: dbErr.message,
      });
    }
  }); // ← uploadFields callback end
};

exports.getinvestorData = (req, res) => {
  const { id } = req.body;

  const updateQuery = `
        select * from investor_information where id = ?`;

  // Correct parameter order: date_view, access_status, id
  db.query(updateQuery, [id], (err, results) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Database update error", error: err });
    }

    return res.status(200).json({ message: "", results: results });
  });
};

exports.getCapTableRules = async (req, res) => {
  const { investor_id, type } = req.body;

  if (!investor_id || !type) {
    return res.status(400).json({
      message: "Investor ID and type are required",
      results: [],
    });
  }

  const query = `SELECT * FROM captable_rule_investor_comapny WHERE investor_id = ? AND type = ?`;

  db.query(query, [investor_id, type], (err, result) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({
        message: "Database error",
        error: err,
        results: [],
      });
    }

    return res.status(200).json({
      message: "Success",
      results: result || [],
    });
  });
};

exports.saveCapTableRules = async (req, res) => {
  const {
    investor_id,
    type, // 'Investor' or 'Company'
    contact_listed = "No",
    portfolio_company = "No",
    contact_from = "No",
    capavate_member = "No",
    everyone = "No",
  } = req.body;

  if (!investor_id || !type) {
    return res.status(400).json({
      message: "Investor ID and type are required",
      results: [],
    });
  }

  const checkQuery = `SELECT id FROM captable_rule_investor_comapny WHERE investor_id = ? AND type = ?`;

  db.query(checkQuery, [investor_id, type], (err, existing) => {
    if (err) {
      console.error("Check error:", err);
      return res.status(500).json({
        message: "Database error",
        error: err,
        results: [],
      });
    }

    if (existing.length > 0) {
      // Update existing record
      const updateQuery = `
        UPDATE captable_rule_investor_comapny 
        SET contact_listed = ?, 
            portfolio_company = ?, 
            contact_from = ?, 
            capavate_member = ?, 
            everyone = ?
        WHERE investor_id = ? AND type = ?
      `;

      db.query(
        updateQuery,
        [
          contact_listed,
          portfolio_company,
          contact_from,
          capavate_member,
          everyone,
          investor_id,
          type,
        ],
        (err, result) => {
          if (err) {
            console.error("Update error:", err);
            return res.status(500).json({
              message: "Update error",
              error: err,
              results: [],
            });
          }
          return res.status(200).json({
            message: `${type} rules updated successfully`,
            results: [],
          });
        },
      );
    } else {
      // Insert new record
      const insertQuery = `
        INSERT INTO captable_rule_investor_comapny 
        (investor_id, type, contact_listed, portfolio_company, contact_from, capavate_member, everyone) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      db.query(
        insertQuery,
        [
          investor_id,
          type,
          contact_listed,
          portfolio_company,
          contact_from,
          capavate_member,
          everyone,
        ],
        (err, result) => {
          if (err) {
            console.error("Insert error:", err);
            return res.status(500).json({
              message: "Insert error",
              error: err,
              results: [],
            });
          }
          return res.status(200).json({
            message: `${type} rules saved successfully`,
            results: [],
          });
        },
      );
    }
  });
};

exports.getInvestorSharedRoundList = (req, res) => {
  const { company_id, round_id } = req.body;

  const query = `
  SELECT 
    sharerecordround.*,
    investor_information.first_name,
    investor_information.last_name,
    investor_information.email,
    investor_information.phone,
    investor_information.profile_picture,
    investor_information.type_of_investor,
    investor_information.company_name as investor_company_name,
    investor_information.screen_name,
    investor_information.job_title,
    investor_information.city,
    investor_information.country,
    investor_information.linkedIn_profile,
    investor_information.accredited_status,
    investor_information.bio_short,
    investor_information.is_register,
    investor_information.unique_code
  FROM sharerecordround 
  LEFT JOIN investor_information ON investor_information.id = sharerecordround.investor_id
  WHERE sharerecordround.company_id = ? 
  AND sharerecordround.roundrecord_id = ? 
  ORDER BY sharerecordround.id DESC
`;

  db.query(query, [company_id, round_id], (err, results) => {
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

exports.getRoundInvitaionAcknowlegment = (req, res) => {
  const { company_id } = req.body;

  const query = `SELECT * from investor_round_invite_acknowlegment where company_id = ?`;

  db.query(query, [company_id], (err, results) => {
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

exports.getInvestorOwnership = (req, res) => {
  const { company_id, investor_id } = req.body;

  if (!company_id || !investor_id) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: company_id and investor_id",
    });
  }

  // First, get all rounds where this investor has confirmed investments
  const getInvestorRoundsQuery = `
    SELECT 
      irc.*,
      rr.nameOfRound,
      rr.round_type,
      rr.roundStatus,
      rr.currency,
      rr.pre_money,
      rr.post_money,
      rr.share_price as round_share_price,
      rr.created_at as round_date,
      rr.total_shares_after,
      rr.issuedshares,
      rr.round_target_money
    FROM investorrequest_company irc
    LEFT JOIN roundrecord rr ON irc.roundrecord_id = rr.id
    WHERE irc.company_id = ? 
      AND irc.investor_id = ?
      AND irc.request_confirm = 'Yes'
    ORDER BY rr.created_at DESC
  `;

  db.query(
    getInvestorRoundsQuery,
    [company_id, investor_id],
    (err, investorRounds) => {
      if (err) {
        console.error("Error fetching investor rounds:", err);
        return res.status(500).json({
          success: false,
          message: err.message,
        });
      }

      if (!investorRounds || investorRounds.length === 0) {
        return res.status(404).json({
          success: false,
          message:
            "No confirmed investments found for this investor in this company",
        });
      }

      // Get all rounds for this company to calculate total shares
      const getAllRoundsQuery = `
      SELECT id, nameOfRound, round_type, roundStatus, currency, 
             pre_money, post_money, total_shares_after, created_at,
             issuedshares, roundsize
      FROM roundrecord 
      WHERE company_id = ? 
      ORDER BY created_at DESC
    `;

      db.query(getAllRoundsQuery, [company_id], (err, allRounds) => {
        if (err) {
          console.error("Error fetching all rounds:", err);
          return res.status(500).json({
            success: false,
            message: err.message,
          });
        }

        // Get latest round for total company shares
        const latestRound =
          allRounds && allRounds.length > 0 ? allRounds[0] : null;
        const totalCompanyShares = latestRound
          ? parseFloat(latestRound.total_shares_after) || 0
          : 0;
        const latestValuation = latestRound
          ? parseFloat(latestRound.post_money) || 0
          : 0;
        const currency = latestRound ? latestRound.currency : "USD";

        // Calculate investor ownership from each round
        let totalInvestorShares = 0;
        let totalInvestment = 0;
        let ownershipDetails = [];

        for (const round of investorRounds) {
          const roundId = round.roundrecord_id;
          const investorShares = parseFloat(round.shares) || 0;
          const investorInvestment = parseFloat(round.investment_amount) || 0;

          // Get total shares for this round from roundrecord
          const roundTotalShares = parseFloat(round.total_shares_after) || 0;

          // Calculate percentage for this round
          const roundPercentage =
            roundTotalShares > 0
              ? (investorShares / roundTotalShares) * 100
              : 0;

          totalInvestorShares += investorShares;
          totalInvestment += investorInvestment;

          ownershipDetails.push({
            round_id: roundId,
            round_name: round.nameOfRound,
            round_type: round.round_type,
            round_status: round.roundStatus,
            round_date: round.round_date,
            currency: round.currency || currency,
            shares: investorShares,
            shares_formatted: investorShares.toLocaleString(),
            investment: investorInvestment,
            investment_formatted: `${round.currency || currency} ${investorInvestment.toLocaleString()}`,
            round_total_shares: roundTotalShares,
            round_total_shares_formatted: roundTotalShares.toLocaleString(),
            ownership_percentage: roundPercentage,
            ownership_percentage_formatted: roundPercentage.toFixed(2) + "%",
            share_price:
              parseFloat(round.share_price) ||
              parseFloat(round.round_share_price) ||
              0,
            confirm_date: round.confirm_date,
          });
        }

        // Calculate overall ownership percentage based on latest round
        const overallOwnershipPercentage =
          totalCompanyShares > 0
            ? (totalInvestorShares / totalCompanyShares) * 100
            : 0;

        const estimatedCurrentValue =
          latestValuation > 0
            ? latestValuation * (overallOwnershipPercentage / 100)
            : totalInvestment;

        // Get investor details from first record
        const investorRecord = investorRounds[0];

        return res.status(200).json({
          success: true,
          investor: {
            id: investor_id,
            name: investorRecord.investor_name || `Investor ${investor_id}`,
            email: investorRecord.email || null,
            phone: investorRecord.phone || null,
          },
          company: {
            id: company_id,
            name: investorRecord.company_name || null,
            latest_round: latestRound
              ? {
                  round_id: latestRound.id,
                  round_name: latestRound.nameOfRound,
                  round_date: latestRound.created_at,
                  total_shares: totalCompanyShares,
                  valuation: latestValuation,
                  currency: currency,
                }
              : null,
          },
          summary: {
            total_shares_owned: totalInvestorShares,
            total_shares_formatted: totalInvestorShares.toLocaleString(),
            total_investment: totalInvestment,
            total_investment_formatted: `${currency} ${totalInvestment.toLocaleString()}`,
            overall_ownership_percentage: overallOwnershipPercentage,
            overall_ownership_percentage_formatted:
              overallOwnershipPercentage.toFixed(2) + "%",
            estimated_current_value: estimatedCurrentValue,
            estimated_current_value_formatted: `${currency} ${estimatedCurrentValue.toLocaleString()}`,
            total_company_shares: totalCompanyShares,
            latest_company_valuation: latestValuation,
            number_of_rounds_invested: ownershipDetails.length,
          },
          round_wise_ownership: ownershipDetails,
        });
      });
    },
  );
};

exports.getcompanyList = (req, res) => {
  const { investor_id } = req.body;

  const query = `
 SELECT DISTINCT 
  srr.company_id,
  c.company_name,
  MIN(srr.sent_date) as first_shared_date,
  MAX(srr.sent_date) as last_shared_date,
  COUNT(srr.id) as total_documents_shared,
  GROUP_CONCAT(DISTINCT srr.roundrecord_id) as round_ids,
  COUNT(DISTINCT srr.roundrecord_id) as total_rounds
FROM sharerecordround srr
LEFT JOIN company c ON srr.company_id = c.id
WHERE srr.investor_id = ?
GROUP BY srr.company_id, c.company_name
ORDER BY last_shared_date DESC;
`;

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
exports.getcompanyListForInvestor = (req, res) => {
  const { investor_id } = req.body;
  console.log(req.body);
  const query = `SELECT ci.investor_id, ci.company_id, c.company_name FROM company_investor ci INNER JOIN company c ON ci.company_id = c.id WHERE ci.investor_id = ?`;

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
exports.getInvestors = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    return res.status(400).json({
      status: 0,
      message: "company_id is required",
    });
  }

  const query = `
  SELECT 
    cai.*,
    ci.id as company_investor_id,
    ci.joinstatus,
    ci.created_at as linked_at,
    ci.joined_at,
    CASE 
      WHEN ci.id IS NOT NULL THEN 'linked'
      ELSE 'pending'
    END as investor_status
  FROM company_add_investors cai
  LEFT JOIN company_investor ci ON ci.company_add_investors_id = cai.id AND ci.company_id = cai.company_id
  WHERE cai.company_id = ?
  ORDER BY cai.created_at DESC
`;

  db.query(query, [company_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        status: 0,
        message: "Database query error",
        error: err,
      });
    }

    return res.status(200).json({
      status: 1,
      message: "Investors fetched successfully",
      data: results,
    });
  });
};

exports.sendInvitation = (req, res) => {
  const {
    created_by_id,
    created_by_role,
    company_id,
    ip_address,
    investor_ids,
    investors,
  } = req.body;

  // Validate required fields
  if (!investor_ids || !investors || investors.length === 0) {
    return res.status(400).json({
      status: 0,
      message: "investor_ids and investors array are required",
    });
  }

  // Function to fetch company name
  const getCompanyName = (callback) => {
    const companyQuery = `SELECT * FROM company WHERE id = ?`;
    db.query(companyQuery, [company_id], (err, companyResults) => {
      if (err) return callback(err);
      const companyName =
        companyResults.length > 0
          ? companyResults[0].company_name
          : "Your Company";
      callback(null, companyName);
    });
  };

  getCompanyName(async (err, companyName) => {
    if (err) {
      return res.status(500).json({
        status: 0,
        message: "Failed to fetch company name",
        error: err,
      });
    }

    const results = [];
    let processedCount = 0;

    // Process each investor
    investors.forEach((investor, index) => {
      const { email, first_name, last_name, id } = investor;

      // Check if investor exists globally
      const checkQuery = `SELECT * FROM investor_information WHERE email = ?`;

      db.query(checkQuery, [email], (err, existingInvestor) => {
        if (err) {
          results.push({
            index,
            status: 0,
            email,
            message: "Database query error",
            error: err,
          });
          processedCount++;

          if (processedCount === investors.length) {
            sendFinalResponse(results, investors.length);
          }
          return;
        }

        if (existingInvestor.length > 0) {
          // Investor exists globally
          const investorId = existingInvestor[0].id;
          const token = existingInvestor[0].unique_code;
          const is_register = existingInvestor[0].is_register;

          // Check if already linked to company
          const checkCompanyLinkQuery = `SELECT * FROM company_investor WHERE company_id = ? AND investor_id = ?`;

          db.query(
            checkCompanyLinkQuery,
            [company_id, investorId],
            (err, linkResults) => {
              if (err) {
                results.push({
                  index,
                  status: 0,
                  email,
                  message: "Database error",
                  error: err,
                });
                processedCount++;

                if (processedCount === investors.length) {
                  sendFinalResponse(results, investors.length);
                }
                return;
              }

              if (linkResults.length > 0) {
                // Already linked
                results.push({
                  index,
                  status: 2,
                  email,
                  message: "Investor already linked to this company",
                });
                processedCount++;

                if (processedCount === investors.length) {
                  sendFinalResponse(results, investors.length);
                }
                return;
              }

              // Link investor to company
              const date = new Date();
              const insertQuery = `
              INSERT INTO company_investor (company_add_investors_id,created_by_id, created_by_role, company_id, investor_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `;

              db.query(
                insertQuery,
                [
                  investor.id,
                  created_by_id,
                  created_by_role,
                  company_id,
                  investorId,
                  date,
                ],
                (err, result) => {
                  if (err) {
                    results.push({
                      index,
                      status: 0,
                      email,
                      message: "Failed to link investor",
                      error: err,
                    });
                  } else {
                    // Send email based on registration status
                    let url = "";
                    if (is_register === "Yes") {
                      url = "https://capavate.com/investor/login";
                    } else {
                      url = `https://capavate.com/investor/information/${token}`;
                    }

                    // Send invite email
                    sendInvestorInviteEmail(
                      email,
                      first_name + " " + last_name,
                      companyName,
                      url,
                      is_register === "Yes",
                    );

                    results.push({
                      index,
                      status: 1,
                      email,
                      message: "Investor successfully linked to company",
                      investor_id: investorId,
                    });
                  }
                  processedCount++;

                  if (processedCount === investors.length) {
                    sendFinalResponse(results, investors.length);
                  }
                },
              );
            },
          );
        } else {
          // New investor - create new record
          const date = new Date();
          const token = crypto.randomBytes(16).toString("hex");
          const expired_at = new Date();
          expired_at.setDate(expired_at.getDate() + 30);

          const insertQuery = `
            INSERT INTO investor_information (created_by_id, created_by_role, company_id, first_name, last_name, unique_code, email, created_at, expired_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;

          db.query(
            insertQuery,
            [
              created_by_id,
              created_by_role,
              company_id,
              first_name,
              last_name,
              token,
              email,
              date,
              expired_at,
            ],
            (err, result) => {
              if (err) {
                if (err.code === "ER_DUP_ENTRY") {
                  results.push({
                    index,
                    status: 2,
                    email,
                    message: "This email already exists",
                  });
                } else {
                  results.push({
                    index,
                    status: 0,
                    email,
                    message: "Failed to create investor",
                    error: err,
                  });
                }
                processedCount++;

                if (processedCount === investors.length) {
                  sendFinalResponse(results, investors.length);
                }
                return;
              }

              const investorId = result.insertId;

              // Link to company
              const insertCompanyQuery = `
                INSERT INTO company_investor (company_add_investors_id,created_by_id, created_by_role, company_id, investor_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
              `;

              db.query(
                insertCompanyQuery,
                [
                  investor.id,
                  created_by_id,
                  created_by_role,
                  company_id,
                  investorId,
                  date,
                ],
                (err, linkResult) => {
                  if (err) {
                    results.push({
                      index,
                      status: 0,
                      email,
                      message: "Failed to link investor to company",
                      error: err,
                    });
                  } else {
                    // Log user action
                    const details = `Investor ${first_name} ${last_name} created`;
                    logUserAction(
                      created_by_id,
                      company_id,
                      "Investor Module",
                      "Add",
                      investorId,
                      "Investor",
                      JSON.stringify(req.body),
                      ip_address,
                    );

                    // Send invite email
                    sendInvestorInviteEmail(
                      email,
                      first_name + " " + last_name,
                      companyName,
                      `https://capavate.com/investor/information/${token}`,
                      false,
                    );

                    results.push({
                      index,
                      status: 1,
                      email,
                      message: "Investor successfully created and linked",
                      investor_id: investorId,
                    });
                  }
                  processedCount++;

                  if (processedCount === investors.length) {
                    sendFinalResponse(results, investors.length);
                  }
                },
              );
            },
          );
        }
      });
    });

    // Function to send final response
    const sendFinalResponse = (results, total) => {
      const successCount = results.filter((r) => r.status === 1).length;
      const alreadyLinkedCount = results.filter((r) => r.status === 2).length;
      const failedCount = results.filter((r) => r.status === 0).length;
      console.log(successCount);
      console.log(total);
      if (successCount === total) {
        return res.status(200).json({
          status: 1,
          message: `${total} invitation(s) sent successfully!`,
          summary: {
            total,
            success: successCount,
            already_linked: alreadyLinkedCount,
            failed: failedCount,
          },
          results,
        });
      } else if (successCount > 0) {
        return res.status(200).json({
          status: 2,
          message: `${successCount} invitation(s) sent, ${failedCount} failed, ${alreadyLinkedCount} already linked`,
          summary: {
            total,
            success: successCount,
            already_linked: alreadyLinkedCount,
            failed: failedCount,
          },
          results,
        });
      } else {
        return res.status(200).json({
          status: 3,
          message: "Invitation already send",
          summary: {
            total,
            success: 0,
            already_linked: alreadyLinkedCount,
            failed: failedCount,
          },
          results,
        });
      }
    };
  });
};

exports.Capitalmotionviewed = (req, res) => {
  const { investor_id, round_id, company_id } = req.body; // Only the record id is needed for the update

  if (!investor_id) {
    return res.status(400).json({ message: "Investor ID is required" });
  }

  const query = `
    UPDATE sharerecordround
    SET access_status = 'Only View',activity_date=NOW(),
        date_view = NOW()
    WHERE investor_id = ? And roundrecord_id = ? And company_id = ? AND access_status = 'Not View'
  `;

  db.query(query, [investor_id, round_id, company_id], (err, results) => {
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

exports.comapnyclosedRound = (req, res) => {
  const { company_id, id } = req.body;
  console.log(req.body);
  // First check if Round 0 exists
  const checkRoundZeroQuery = `SELECT id FROM roundrecord WHERE company_id = ? AND id = ?`;

  db.query(checkRoundZeroQuery, [company_id, id], (err, roundZeroResult) => {
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
      const currentDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format
      const roundId = id; // Assuming round_id is in the table

      const updateQuery = `
      UPDATE roundrecord 
      SET roundStatus = 'CLOSED', 
          dateroundclosed = ?,
          updated_at = NOW()
      WHERE id = ?
    `;

      db.query(
        updateQuery,
        [currentDate, roundId],
        (updateErr, updateResults) => {
          if (updateErr) {
            return res.status(500).json({
              success: false,
              message: "Failed to update round status",
              error: updateErr,
            });
          }

          res.status(200).json({
            success: true,
            message: "Round closed successfully",
            results: roundZeroResult,
            updateResults: updateResults,
          });
        },
      );
    }
  });
};

exports.getCompetitiveCompany = (req, res) => {
  const { company_id } = req.body;

  // Validate company_id
  if (!company_id) {
    return res.status(400).json({
      status: 0,
      message: "company_id is required",
    });
  }

  // Query to get investors that are NOT linked in company_investor table
  const query = `SELECT * from company where id != ? order by id desc`;

  db.query(query, [company_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        status: 0,
        message: "Database query error",
        error: err,
      });
    }

    return res.status(200).json({
      status: 1,
      message: "Investors fetched successfully",
      results: results,
    });
  });
};
exports.getContactConnection = (req, res) => {
  const { investor_id } = req.body;

  if (!investor_id) {
    return res.status(400).json({
      status: 0,
      message: "investor_id is required",
    });
  }

  // Step 1: Get all rounds of current investor
  const getInvestorRoundsQuery = `
    SELECT DISTINCT roundrecord_id 
    FROM (
      SELECT roundrecord_id FROM sharerecordround WHERE investor_id = ?
      UNION
      SELECT roundrecord_id FROM investorrequest_company WHERE investor_id = ?
    ) AS all_rounds
  `;

  db.query(
    getInvestorRoundsQuery,
    [investor_id, investor_id],
    (err, roundResults) => {
      if (err) {
        console.error("Error fetching investor rounds:", err);
        return res.status(500).json({
          status: 0,
          message: "Database error",
          error: err.message,
        });
      }

      if (roundResults.length === 0) {
        return res.status(200).json({
          status: 1,
          message: "No rounds found for this investor",
          data: {
            current_investor: null,
            connections: [],
            total_connections: 0,
          },
        });
      }

      const roundrecordIds = roundResults.map((r) => r.roundrecord_id);

      // Step 2: Get all other investors from these rounds with company details from company table
      const getConnectionsQuery = `
        SELECT DISTINCT 
          ii.id as investor_id,
          ii.first_name,
          ii.last_name,
          CONCAT(ii.first_name, ' ', ii.last_name) as investor_name,
          ii.email,
          ii.phone,
          ii.job_title,
          ii.type_of_investor,
          ii.profile_picture,
          ii.investor_type,
          ii.cheque_size,
          ii.geo_focus,
          ii.preferred_stages,
          ii.city,
          ii.state,
          ii.country,
          ii.full_address,
          ii.accredited_status,
          -- Company details from company table
          c.id as company_id,
          c.company_name,
          c.company_logo,
          c.company_email,
          c.phone as company_phone,
          c.company_website,
          COUNT(DISTINCT all_investors.roundrecord_id) as common_rounds_count,
          GROUP_CONCAT(DISTINCT all_investors.roundrecord_id) as common_round_ids
        FROM (
          SELECT roundrecord_id, investor_id FROM sharerecordround WHERE roundrecord_id IN (?)
          UNION
          SELECT roundrecord_id, investor_id FROM investorrequest_company WHERE roundrecord_id IN (?)
        ) AS all_investors
        INNER JOIN investor_information ii ON all_investors.investor_id = ii.id
        LEFT JOIN company c ON ii.company_id = c.id
        WHERE all_investors.investor_id != ?
          AND all_investors.investor_id != 0
        GROUP BY ii.id, ii.first_name, ii.last_name, ii.email, ii.phone, 
                 ii.job_title, ii.type_of_investor, ii.profile_picture, 
                 ii.investor_type, ii.cheque_size, ii.geo_focus, 
                 ii.preferred_stages, ii.city, ii.state, ii.country, 
                 ii.full_address, ii.accredited_status,
                 c.id, c.company_name, c.company_logo, c.company_email, 
                 c.phone, c.company_website
        ORDER BY common_rounds_count DESC, ii.first_name ASC
      `;

      db.query(
        getConnectionsQuery,
        [roundrecordIds, roundrecordIds, investor_id],
        (err2, connectionResults) => {
          if (err2) {
            console.error("Error fetching connections:", err2);
            return res.status(500).json({
              status: 0,
              message: "Database error",
              error: err2.message,
            });
          }

          // Get current investor details with company information
          db.query(
            `SELECT 
              ii.id as investor_id, 
              ii.first_name, 
              ii.last_name,
              CONCAT(ii.first_name, ' ', ii.last_name) as investor_name,
              ii.email, 
              ii.phone, 
              ii.job_title,
              ii.type_of_investor,
              ii.investor_type,
              ii.profile_picture,
              ii.cheque_size,
              ii.geo_focus,
              ii.preferred_stages,
              ii.bio_short,
              ii.linkedIn_profile,
              ii.industry_expertise,
              ii.accredited_status,
              ii.city,
              ii.state,
              ii.country,
              ii.full_address,
              ii.stateCode,
              ii.countrycode,
              -- Company details from company table
              c.id as company_id,
              c.company_name,
              c.company_logo,
              c.company_email,
              c.phone as company_phone,
              c.company_website
            FROM investor_information ii
            LEFT JOIN company c ON ii.company_id = c.id
            WHERE ii.id = ?`,
            [investor_id],
            (err3, currentResult) => {
              if (err3) {
                console.error("Error fetching current investor:", err3);
                return res.status(500).json({
                  status: 0,
                  message: "Database error",
                  error: err3.message,
                });
              }

              const currentInvestor = currentResult[0];

              // Add computed location field
              if (currentInvestor) {
                const locationParts = [
                  currentInvestor.city,
                  currentInvestor.state,
                  currentInvestor.country,
                ].filter(Boolean);
                currentInvestor.location =
                  locationParts.length > 0
                    ? locationParts.join(", ")
                    : currentInvestor.full_address || "-";
              }

              // Add computed location for each connection
              connectionResults.forEach((conn) => {
                const locationParts = [
                  conn.city,
                  conn.state,
                  conn.country,
                ].filter(Boolean);
                conn.location =
                  locationParts.length > 0
                    ? locationParts.join(", ")
                    : conn.full_address || "-";
              });

              return res.status(200).json({
                status: 1,
                message: "Contact connections fetched successfully",
                data: {
                  current_investor: currentInvestor || null,
                  connections: connectionResults,
                  total_connections: connectionResults.length,
                  total_rounds_involved: roundrecordIds.length,
                },
              });
            },
          );
        },
      );
    },
  );
};
