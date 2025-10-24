const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");
const { format } = require("date-fns");
const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const mysql = require("mysql2/promise"); // 👈 only used in this API
const cron = require("node-cron");
const ExcelJS = require("exceljs");

const pdfParse = require("pdf-parse");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const Stripe = require("stripe");
const stripe = new Stripe(
  "sk_test_51RUJzWAx6rm2q3pyUl86ZMypACukdO7IsZ0AbsWOcJqg9xWGccwcQwbQvfCaxQniDCWzNg7z2p4rZS1u4mmDDyou00DM7rK8eY"
);
const upload = require("../../middlewares/uploadMiddleware");
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
   SELECT investor_information.*, company_investor.investorType, company_investor.investmentPreference,company_investor.id as company_investor_id FROM investor_information JOIN company_investor ON company_investor.investor_id = investor_information.id WHERE company_investor.company_id = ? ORDER BY investor_information.id DESC;`;

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
      SET first_name = ?, last_name = ?
      WHERE id = ?
    `;

    db.query(updateQuery, [first_name, last_name, id], (err, result) => {
      if (err) {
        return res.status(500).json({
          message: "Database update error",
          error: err,
        });
      }

      res.status(200).json({
        status: 1,
        message: "Investor successfully updated",
        affectedRows: result.affectedRows,
      });
    });
  } else {
    const checkQuery = `SELECT * FROM investor_information WHERE email = ?`;

    db.query(checkQuery, [email], (err, results) => {
      if (err)
        return res
          .status(500)
          .json({ message: "Database query error", error: err });

      let investorId;

      getCompanyName((err, companyName) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Failed to fetch company name", error: err });
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
            [company_id, id],
            (err, linkResults) => {
              if (err)
                return res
                  .status(500)
                  .json({ message: "DB error", error: err });

              if (linkResults.length > 0) {
                return res.status(200).json({
                  status: 2,
                  message: msg,
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
                      return res
                        .status(500)
                        .json({ message: "DB insert error", error: err });
                    if (invt_result.is_register === "Yes") {
                      var url = "https://blueprintcatalyst.com/investor/login";
                    } else {
                      var url = `https://blueprintcatalyst.com/investor/information/${token}`;
                    }

                    // Send invite email for existing investor
                    sendInvestorInviteEmail(
                      email,
                      first_name + " " + last_name,
                      companyName,
                      url,
                      true // already registered
                    );

                    res.status(200).json({
                      status: 1,
                      message: "Investor successfully linked to your company",
                      insertedId: result.insertId,
                    });
                  }
                );
              }
            }
          );
        } else {
          // New investor
          const date = new Date();
          const token = crypto.randomBytes(16).toString("hex");
          const expired_at = new Date();
          expired_at.setDate(expired_at.getDate() + 30);
          const insertQuery = `
            INSERT INTO investor_information (created_by_id,created_by_role,company_id, first_name, last_name, unique_code, email, created_at,expired_at)
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
              if (err)
                return res
                  .status(500)
                  .json({ message: "DB insert error", error: err });

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
                ip_address // ip_address
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
                    return res
                      .status(500)
                      .json({ message: "DB insert error", error: err });

                  // Send invite email for new investor
                  sendInvestorInviteEmail(
                    email,
                    first_name + " " + last_name,
                    companyName,
                    `https://blueprintcatalyst.com/investor/information/${token}`,
                    false // not registered
                  );

                  res.status(200).json({
                    status: 1,
                    message:
                      "Investor successfully created and linked to your company",
                    insertedId: result.insertId,
                  });
                }
              );
            }
          );
        }
      });
    });
  }
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
  ipAddress
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
      }
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
  isRegistered = false
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
            <img src="https://blueprintcatalyst.com/api/upload/images/logo.png" alt="logo" style="width:130px;" />
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
              <a href="${link}" style="display:inline-block; padding:12px 24px; background: #ff3c3e;
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

        res.status(200).json({
          message: "Investor and related records deleted successfully",
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
      [records.map((r) => r.id)]
    );

    const existingSet = new Set(
      existingShares.map((e) => `${e.investor_updates_id}_${e.investor_email}`)
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
            [investorId]
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
              [expiredAt, investorId]
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
          ]
        )
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
        ip_address: req.ip || req.headers["x-forwarded-for"] || "N/A",
      };

      await db.promise().query(
        `INSERT INTO audit_logs 
     (user_id, company_id,created_by_role, module, action, entity_id, entity_type, details, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
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
        ]
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
            ? `https://blueprintcatalyst.com/investor/company/duediligence-reportlist/${company_id}`
            : `https://blueprintcatalyst.com/investor/company/reportlist/${company_id}`;

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
                              background-color:#ff3c3e;
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
      }
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
    SELECT ii.id AS investor_id, ii.ip_address, ii.city, ii.country, ci.investorType, ci.investmentPreference, ii.*, c.company_name
    FROM company_investor ci
    JOIN investor_information ii ON ii.id = ci.investor_id
    JOIN sharereport sr ON sr.investor_id = ii.id
    JOIN investor_updates iu ON iu.id = sr.investor_updates_id AND iu.company_id = ci.company_id
    JOIN company c ON c.id = ci.company_id
    WHERE ci.company_id = ? AND iu.is_shared = 'Yes' AND ii.is_register = 'Yes' AND ii.id = ? And iu.type =?
    GROUP BY ii.id
    ORDER BY ii.id DESC;
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
      downloadUrl: `https://blueprintcatalyst.com/api/${pathname}/investor_report/${doc.document_name}`,
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
      downloadUrl: `https://blueprintcatalyst.com/api/${pathname}/investor_report/${doc.document_name}`,
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
      downloadUrl: `https://blueprintcatalyst.com/api/${pathname}/investor_report/${doc.document_name}`,
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
      downloadUrl: `https://blueprintcatalyst.com/api/${pathname}/investor_report/${doc.document_name}`,
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
      "SELECT company.* FROM company_investor JOIN company ON company.id = company_investor.company_id WHERE company_investor.investor_id = ? ORDER BY company_investor.id DESC",
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
      }
    );
  } catch (err) {
    res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
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
          downloadUrl: `https://blueprintcatalyst.com/api/${pathname}/investor_report/${doc.document_name}`,
        }));

        res.status(200).json({
          message: "",
          results: updatedResults,
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
        }
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
    c.company_name
FROM company_investor ci
JOIN investor_information ii ON ii.id = ci.investor_id
JOIN sharerecordround sr ON sr.investor_id = ii.id
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
      r.id AS round_id,
      r.nameOfRound,
      r.shareClassType,
      r.roundsize,
      r.issuedshares,
      r.currency,
      r.created_at,
      r.dateroundclosed,
      r.roundStatus,
      s.id AS sharerecord_id,
      s.subscription_status,
      s.signature_status,
      s.signature,
      s.sent_date,
      s.date_view,
      s.access_status,
      s.termsheet_status,
      irc.shares AS investor_shares,
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
                          <a href="https://blueprintcatalyst.com/investor/company/capital-round-list/${
                            dataa.user_id
                          }" 
                            style="background:#ff3c3e;color:#fff;text-decoration:none;font-size:14px;padding:10px 30px;border-radius:10px;display:inline-block;">
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
                }
              );
            }
          );
        }
      );
    }
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
  } = req.body;

  if (!investor_id) {
    return res.status(400).json({ message: "Investor ID is required" });
  }

  // 1️⃣ Insert into investorrequest_company
  const sqlInvestment = `
    INSERT INTO investorrequest_company
    (next_round_id,investor_id, roundrecord_id, company_id, shares, investment_amount, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NOW())
  `;

  const investmentValues = [
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

    // 2️⃣ Insert log into access_logs_investor
    const sqlLog = `
      INSERT INTO access_logs_investor
      (investor_id, user_id, company_id, company_name, action, module, description, ip_address, extra_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const logValues = [
      investor_id,
      created_by_id || null,
      company_id || null,
      company_name || null,
      "INVESTMENT_REQUEST", // action
      "Capital Round", // module
      `Investor requested ${shares} shares for ${investment_amount}`, // description
      ip_address || null,
      JSON.stringify({ requestId: insertedId }), // extra_data
    ];

    db.query(sqlLog, logValues, (err2) => {
      if (err2) {
        console.error("DB Log Error:", err2);
        // Log failed, but main request succeeded
        return res.status(200).json({
          message: "Investment request submitted, but logging failed",
          insertedId,
        });
      }

      return res.status(200).json({
        message: "Investment request submitted successfully",
        insertedId,
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
      (a, b) => b[1] - a[1]
    );

    const rank =
      sortedInvestors.findIndex(
        ([id]) => parseInt(id) === parseInt(investor_id)
      ) + 1 || 0;

    // This investor’s records
    const investorRecords = parsedAll.filter(
      (r) => r.investor_id === Number(investor_id)
    );

    const totalInvested = investorRecords.reduce(
      (sum, r) => sum + r.investment_amount,
      0
    );
    const investorShares = investorRecords.reduce(
      (sum, r) => sum + r.shares,
      0
    );

    // ✅ Correct ownership calculation
    // Use issuedshares from roundrecord (not sum of all rounds)
    const totalIssuedShares = investorRecords.reduce(
      (sum, r) => sum + r.issuedshares,
      0
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
        select investorrequest_company.*,investor_information.first_name,investor_information.last_name,investor_information.email,roundrecord.nameOfRound,roundrecord.shareClassType,roundrecord.roundsize,roundrecord.issuedshares,roundrecord.currency from investorrequest_company join roundrecord on roundrecord.id = investorrequest_company.roundrecord_id join investor_information on investor_information.id = investorrequest_company.investor_id where investorrequest_company.company_id = ? order by investorrequest_company.id desc`;

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
      ii.first_name, ii.last_name, ii.email, 
      c.company_name,
      rr.shareClassType, rr.nameOfRound, rr.roundsize, rr.issuedshares, rr.currency
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

    // 1️⃣ Update request_confirm
    const updateQuery = `UPDATE investorrequest_company SET request_confirm = 'Yes' WHERE id = ?`;
    db.query(updateQuery, [verify_id], (err2) => {
      if (err2)
        return res
          .status(500)
          .json({ message: "Database update error", error: err2 });

      // 2️⃣ Send verification email
      sendEmailToInvestment_Verify(
        record.email,
        fullname,
        record.company_name,
        record.shareClassType,
        record.nameOfRound,
        record.roundsize,
        record.issuedshares,
        record.currency
      );

      return res
        .status(200)
        .json({ message: "Investment verified and email sent successfully" });
    });
  });
};

// Function to send verification email
function sendEmailToInvestment_Verify(
  email,
  firstName,
  companyName,
  shareClassType,
  nameOfRound,
  roundsize,
  issuedshares,
  currency
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
            <img src="https://blueprintcatalyst.com/api/upload/images/logo.png" alt="logo" style="width:130px;" />
          </td>
        </tr>
        <tr>
          <td style="padding:20px;">
            <h2 style="font-size:16px; color:#111;">Hello ${firstName},</h2>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              Your investment in ${companyName} has been verified successfully.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:20px;">
              <strong>Round:</strong> ${nameOfRound} - ${shareClassType} <br/>
              <strong>Round Size:</strong>${currency} ${roundsize} <br/>
              <strong>Issued Shares:</strong> ${issuedshares}
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
      investorrequest_company.*,
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
    FROM roundrecord
    LEFT JOIN investorrequest_company ON roundrecord.id = investorrequest_company.roundrecord_id
    LEFT JOIN investor_information ON investor_information.id = investorrequest_company.investor_id
    LEFT JOIN company ON company.id = investorrequest_company.company_id
    WHERE investorrequest_company.company_id = ? AND roundrecord.roundStatus = ?
    ORDER BY roundrecord.created_at ASC, investorrequest_company.id ASC
  `;

  db.query(fetchQuery, [company_id, "ACTIVE"], (err, results) => {
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

    // --- Group rounds & investors ---
    const roundsMap = {};
    const pendingConversions = { safes: [], convertibleNotes: [] };
    const allStakeholders = new Set(["Founders"]);

    results.forEach((row) => {
      if (!roundsMap[row.roundrecord_id]) {
        let instrumentData = {};
        try {
          if (row.instrument_type_data)
            instrumentData = JSON.parse(row.instrument_type_data);
        } catch (e) {}

        const shareClassName =
          row.shareClassType !== "OTHER"
            ? row.shareClassType
            : row.shareclassother || "Common";

        roundsMap[row.roundrecord_id] = {
          id: row.roundrecord_id,
          name: row.nameOfRound || shareClassName,
          issuedShares: parseFloat(row.issuedshares || 0),
          roundSize: parseFloat(row.roundsize || 0),
          instrumentType: row.instrumentType || "Common Stock",
          instrumentData,
          investors: [],
          created_at: row.round_created_at,
        };
      }

      if (row.investor_id) {
        const investorName =
          `${row.first_name || ""} ${row.last_name || ""}`.trim() ||
          `Investor ${row.investor_id}`;

        roundsMap[row.roundrecord_id].investors.push({
          id: row.investor_id,
          name: investorName,
          shares: parseFloat(row.shares || 0),
          investmentAmount: parseFloat(row.investment_amount || 0),
          request_confirm: row.request_confirm,
          instrumentType: row.instrumentType,
          instrumentData: row.instrument_type_data
            ? JSON.parse(row.instrument_type_data)
            : {},
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
          });
        }

        allStakeholders.add(investorName);
      }
    });

    const rounds = Object.values(roundsMap).sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );

    let cumulativeTotalShares = 0;
    const stakeholderShares = {};

    rounds.forEach((round) => {
      let additionalSharesFromConversions = 0;
      let totalInvestorSharesThisRound = 0;

      const pricePerShare =
        round.roundSize && round.issuedShares
          ? round.roundSize / round.issuedShares
          : 0;

      // --- Convert SAFE / Convertible Notes properly ---
      const convertInstruments = (instruments) => {
        instruments.forEach((inst) => {
          let conversionPrice = pricePerShare;
          const cap = parseFloat(inst.instrumentData.valuationCap || 0);
          const discount = parseFloat(inst.instrumentData.discountRate || 0);

          if (cap > 0 && cumulativeTotalShares > 0) {
            conversionPrice = Math.min(
              conversionPrice,
              cap / cumulativeTotalShares
            );
          }
          if (discount > 0) {
            conversionPrice = Math.min(
              conversionPrice,
              pricePerShare * (1 - discount / 100)
            );
          }

          if (conversionPrice > 0) {
            const shares = inst.amount / conversionPrice;
            additionalSharesFromConversions += shares;
            stakeholderShares[inst.investorName] =
              (stakeholderShares[inst.investorName] || 0) + shares;
            allStakeholders.add(inst.investorName);
          }
        });
        instruments.length = 0; // clear after conversion
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
          totalInvestorSharesThisRound += inv.shares;
        }
      });

      // Update cumulative shares after round + conversions
      cumulativeTotalShares +=
        round.issuedShares + additionalSharesFromConversions;

      // Founder shares for this round
      const founderSharesThisRound =
        round.issuedShares - totalInvestorSharesThisRound;
      stakeholderShares["Founders"] =
        (stakeholderShares["Founders"] || 0) + founderSharesThisRound;
    });

    // --- Build formatted results for API response ---
    const colorPalette = [
      "#1e40af",
      "#dc2626",
      "#059669",
      "#7c3aed",
      "#ea580c",
      "#f59e0b",
      "#10b981",
      "#6366f1",
      "#ec4899",
      "#8b5cf6",
    ];
    let colorIndex = 0;

    const formattedResults = results.map((inv) => {
      const key = inv.investor_id
        ? `${inv.first_name} ${inv.last_name}`.trim()
        : "Founders";
      const ownershipPercentage = cumulativeTotalShares
        ? parseFloat(
            ((stakeholderShares[key] || 0) / cumulativeTotalShares) * 100
          ).toFixed(2)
        : 0;

      return {
        ...inv,
        investor_name: key,
        ownershipPercentage,
        totalSharesIncludingWarrants: cumulativeTotalShares,
        sharesAfterConversion: Math.round(stakeholderShares[key] || 0), // Add this to show post-conversion shares
      };
    });

    // --- Stats ---
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
        if (["Active", "Fundraising", "Open"].includes(inv.roundStatus))
          stats.activeInvestments += 1;
      } else if (inv.request_confirm === "No") stats.pendingRequests += 1;
      else if (inv.request_confirm === "Rejected")
        stats.rejectedInvestments += 1;
    });

    return res.status(200).json({
      message: "Investment data fetched successfully",
      results: formattedResults,
      stats,
      totalRecords: results.length,
      metadata: {
        totalShares: Math.round(cumulativeTotalShares),
        founderShares: Math.round(stakeholderShares["Founders"] || 0),
        totalInvestorShares: Math.round(
          cumulativeTotalShares - (stakeholderShares["Founders"] || 0)
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
    }
  );
};
