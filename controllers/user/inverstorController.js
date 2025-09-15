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
  const { user_id } = req.body;

  const query = `
   SELECT investor_information.*, company_investor.investorType, company_investor.investmentPreference FROM investor_information JOIN company_investor ON company_investor.investor_id = investor_information.id WHERE investor_information.user_id = ? ORDER BY investor_information.id DESC;`;

  db.query(query, [user_id], (err, results) => {
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
  const { user_id, id } = req.body;

  const query = `
    SELECT investor_information.*, company_investor.investorType, company_investor.investmentPreference FROM investor_information JOIN company_investor ON company_investor.investor_id = investor_information.id WHERE investor_information.user_id = ? ORDER BY investor_information.id DESC`;

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
exports.Addnewinvenstor = (req, res) => {
  const { user_id, id, email, first_name, last_name } = req.body;

  // Function to fetch company name
  const getCompanyName = (callback) => {
    const companyQuery = `SELECT * FROM company WHERE id = ?`;
    db.query(companyQuery, [user_id], (err, companyResults) => {
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
      WHERE investor_id = ?
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
    const checkQuery = `SELECT * FROM investor_information WHERE email = ? And is_register = ?`;

    db.query(checkQuery, [email, "Yes"], (err, results) => {
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
          const token = results[0].unique_code;

          const checkCompanyLinkQuery = `SELECT * FROM company_investor WHERE user_id = ? AND investor_id = ?`;
          db.query(
            checkCompanyLinkQuery,
            [user_id, investorId],
            (err, linkResults) => {
              if (err)
                return res
                  .status(500)
                  .json({ message: "DB error", error: err });

              if (linkResults.length > 0) {
                return res.status(200).json({
                  status: 2,
                  message: "This investor is already linked to your company",
                });
              } else {
                const date = new Date();
                const insertQueryre = `
                  INSERT INTO company_investor (user_id, investor_id, created_at)
                  VALUES (?, ?, ?)
                `;
                db.query(
                  insertQueryre,
                  [user_id, investorId, date],
                  (err, result) => {
                    if (err)
                      return res
                        .status(500)
                        .json({ message: "DB insert error", error: err });

                    // Send invite email for existing investor
                    sendInvestorInviteEmail(
                      email,
                      first_name,
                      companyName,
                      "https://blueprintcatalyst.com/investor/login",
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
            INSERT INTO investor_information (user_id, first_name, last_name, unique_code, email, created_at,expired_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `;
          db.query(
            insertQuery,
            [user_id, first_name, last_name, token, email, date, expired_at],
            (err, result) => {
              if (err)
                return res
                  .status(500)
                  .json({ message: "DB insert error", error: err });

              investorId = result.insertId;

              const insertQueryre = `
                INSERT INTO company_investor (user_id, investor_id, created_at)
                VALUES (?, ?, ?)
              `;
              db.query(
                insertQueryre,
                [user_id, investorId, date],
                (err, result) => {
                  if (err)
                    return res
                      .status(500)
                      .json({ message: "DB insert error", error: err });

                  // Send invite email for new investor
                  sendInvestorInviteEmail(
                    email,
                    first_name,
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
            <p style="font-size:14px; color:#111; margin-bottom:0;">Regards,<br/>Blueprint Catalyst Ltd Team</p>
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
  const { user_id, id } = req.body;

  const query = `
    DELETE from investor_information where user_id = ? And id = ?`;

  db.query(query, [user_id, id], (err, row) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "",
      results: "Deleted successfully",
    });
  });
};
exports.SendreportToinvestor = async (req, res) => {
  const { user_id, selectedRecords, records } = req.body;

  if (
    !user_id ||
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
      .query("SELECT * FROM company WHERE id = ? LIMIT 1", [user_id]);
    const entrepreneurName = `${userRows[0]?.first_name || ""} ${
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
            "SELECT email, is_register, unique_code FROM investor_information WHERE id = ?",
            [investorId]
          );

        if (investorRows.length === 0) continue;

        const { email, is_register, unique_code } = investorRows[0];
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
            .query("SELECT email FROM investor_information WHERE id = ?", [
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
        duplicates, // send back duplicates
      });
    }

    // Insert all records at once
    const insertPromises = toInsert.map(
      ({ report, investorId, email, unique_code }) =>
        db.promise().query(
          `INSERT INTO sharereport 
         (user_id, investor_updates_id, unique_code, investor_email, investor_id, sent_date, expired_at, report_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            user_id,
            report.id,
            unique_code, // 👈 use investor's unique_code
            email,
            investorId,
            currentDate,
            expiredAt,
            report.type,
          ]
        )
    );

    await Promise.all(insertPromises);

    // --- UPDATE investor_updates table to set is_shared = 'Yes' ---
    const sharedReportIds = [
      ...new Set(toInsert.map((item) => item.report.id)),
    ];

    if (sharedReportIds.length > 0) {
      await db.promise().query(
        `UPDATE investor_updates 
         SET is_shared = 'Yes' 
         WHERE id IN (?)`,
        [sharedReportIds]
      );
    }

    // Send emails
    const emailPromises = toInsert.map(
      ({ report, email, unique_code, is_register }) => {
        if (req.body.records[0].type === "Due Diligence Document") {
          var url =
            "https://blueprintcatalyst.com/investor/company/duediligence-reportlist/" +
            user_id;
        } else {
          var url =
            "https://blueprintcatalyst.com/investor/company/reportlist/" +
            user_id;
        }

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
                        <h2 style="margin:0 0 15px 0;font-size:16px;color:#111;">Dear Investor,</h2>
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
  const { user_id } = req.body;

  const query = `SELECT ii.id AS investor_id, ci.investorType, ci.investmentPreference, ii.first_name, ii.last_name, ii.email, ii.phone,ii.is_register FROM company_investor ci JOIN investor_information ii ON ii.id = ci.investor_id JOIN sharereport sr ON sr.investor_id = ii.id JOIN investor_updates iu ON iu.id = sr.investor_updates_id AND iu.user_id = ci.user_id WHERE ci.user_id = ? AND iu.is_shared = 'Yes' AND sr.report_type = 'Investor updates' And ii.is_register = 'Yes' GROUP BY ii.id, ci.investorType, ci.investmentPreference, 
         ii.first_name, ii.last_name, ii.email, ii.phone, ii.is_register ORDER BY ii.id DESC;`;

  db.query(query, [user_id], (err, results) => {
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
  const { user_id } = req.body;

  const query = `SELECT ii.id AS investor_id, ci.investorType, ci.investmentPreference, ii.first_name, ii.last_name, ii.email, ii.phone,ii.is_register FROM company_investor ci JOIN investor_information ii ON ii.id = ci.investor_id JOIN sharereport sr ON sr.investor_id = ii.id JOIN investor_updates iu ON iu.id = sr.investor_updates_id AND iu.user_id = ci.user_id WHERE ci.user_id = ? AND iu.is_shared = 'Yes' AND sr.report_type = 'Due Diligence Document' And ii.is_register = 'Yes' GROUP BY  ii.id, ci.investorType, ci.investmentPreference, ii.first_name, ii.last_name, ii.email, ii.phone, ii.is_register ORDER BY ii.id DESC;`;

  db.query(query, [user_id], (err, results) => {
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
  const { user_id, id, type } = req.body;

  const query = `
    SELECT ii.id AS investor_id, ii.ip_address, ii.city, ii.country, ci.investorType, ci.investmentPreference, ii.*, c.company_name
    FROM company_investor ci
    JOIN investor_information ii ON ii.id = ci.investor_id
    JOIN sharereport sr ON sr.investor_id = ii.id
    JOIN investor_updates iu ON iu.id = sr.investor_updates_id AND iu.user_id = ci.user_id
    JOIN company c ON c.id = ci.user_id
    WHERE ci.user_id = ? AND iu.is_shared = 'Yes' AND ii.is_register = 'Yes' AND ii.id = ? And iu.type =?
    GROUP BY ii.id
    ORDER BY ii.id DESC;
  `;

  db.query(query, [user_id, id, type], (err, row) => {
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
  const { user_id, id } = req.body;

  const query = `SELECT sharereport.*,investor_updates.created_at as datereport,investor_updates.version,investor_updates.document_name from sharereport join investor_updates on investor_updates.id  = sharereport.investor_updates_id where sharereport.investor_id = ? And sharereport.user_id = ? AND investor_updates.type = 'Investor updates' order by sharereport.id desc`;

  db.query(query, [id, user_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    var pathname = "upload/docs/doc_" + user_id;
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
  const { user_id, id } = req.body;

  const query = `SELECT sharereport.*,investor_updates.created_at as datereport,investor_updates.version,investor_updates.document_name from sharereport join investor_updates on investor_updates.id  = sharereport.investor_updates_id where sharereport.investor_id = ? And sharereport.user_id = ? AND investor_updates.type = 'Due Diligence Document' order by sharereport.id desc`;

  db.query(query, [id, user_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    var pathname = "upload/docs/doc_" + user_id;
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
  const user_id = req.body.user_id;

  const query = `
    SELECT investor_updates.*, company.company_name 
    FROM investor_updates 
    LEFT JOIN company ON company.id = investor_updates.user_id 
    WHERE investor_updates.user_id = ? And investor_updates.type =? And investor_updates.is_locked=?
    ORDER BY investor_updates.id DESC;
  `;

  db.query(query, [user_id, "Investor updates", "1"], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    var pathname = "upload/docs/doc_" + user_id;
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
  const user_id = req.body.user_id;

  const query = `
    SELECT investor_updates.*, company.company_name 
    FROM investor_updates 
    LEFT JOIN company ON company.id = investor_updates.user_id 
    WHERE investor_updates.user_id = ? And investor_updates.type =?
    ORDER BY investor_updates.id DESC;
  `;

  db.query(query, [user_id, "Due Diligence Document"], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    var pathname = "upload/docs/doc_" + user_id;
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
  var user_id = req.body.user_id;

  try {
    // Check if user already exists
    db.query(
      "SELECT company.* FROM company_investor JOIN company ON company.id = company_investor.user_id WHERE company_investor.investor_id = ? ORDER BY company_investor.id DESC",
      [user_id],
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
  var user_id = req.body.user_id;
  var type = req.body.type;
  var company_id = req.body.company_id;
  try {
    // Check if user already exists
    db.query(
      `SELECT sharereport.*,investor_updates.version,investor_updates.document_name,investor_updates.type,investor_updates.created_at as shared_date from sharereport join investor_updates on investor_updates.id = sharereport.investor_updates_id where sharereport.investor_id = ? And investor_updates.type =? And sharereport.user_id = ? order by sharereport.id Desc`,
      [user_id, type, company_id],
      async (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }
        var pathname = "upload/docs/doc_" + user_id;
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
  const user_id = req.body.user_id;
  const id = req.body.id;
  console.log(req.body);
  // Check if report exists
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

    if (!dateView) {
      // Update date_view and access_status
      const updateQuery = `
        UPDATE sharereport
        SET date_view = ?, access_status = ?
        WHERE id = ?
      `;
      const date = new Date();

      // Correct parameter order: date_view, access_status, id
      db.query(updateQuery, [date, "Download", id], (err, result) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database update error", error: err });
        }

        return res.status(200).json({ message: "Report updated successfully" });
      });
    } else {
      return res.status(200).json({ message: "Report already viewed" });
    }
  });
};
exports.getreportsCapitalRound = (req, res) => {
  const user_id = req.body.user_id;

  const query = `SELECT ii.id AS investor_id, ci.investorType, ci.investmentPreference, ii.first_name, ii.last_name, ii.email, ii.phone,ii.is_register FROM company_investor ci JOIN investor_information ii ON ii.id = ci.investor_id JOIN sharerecordround sr ON sr.investor_id = ii.id  WHERE ci.user_id = ?  And ii.is_register = 'Yes' GROUP BY 
  ii.id, ci.investorType, ci.investmentPreference, 
  ii.first_name, ii.last_name, ii.email, ii.phone, ii.is_register
 ORDER BY ii.id DESC;`;

  db.query(query, [user_id], (err, results) => {
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
  const { user_id, id } = req.body;

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
JOIN company c ON c.id = ci.user_id
WHERE ci.user_id = ?
  AND ii.id = ?
  AND ii.is_register = 'Yes'
ORDER BY ii.id DESC;
;
  `;

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

exports.getInvestorReportCapitalRound = (req, res) => {
  const { company_id, id } = req.body;

  const query = `SELECT roundrecord.*,sharerecordround.report_status,sharerecordround.id as sharerecord_id,sharerecordround.subscription_status,sharerecordround.signature_status,sharerecordround.signature,sharerecordround.sent_date,sharerecordround.date_view,sharerecordround.access_status,sharerecordround.termsheet_status,sharerecordround.subscription_status from sharerecordround join roundrecord on roundrecord.id = sharerecordround.roundrecord_id where sharerecordround.user_id =? And sharerecordround.investor_id =?`;

  db.query(query, [company_id, id], (err, results) => {
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
exports.getrecordRoundList = (req, res) => {
  const { user_id } = req.body;

  const query = `SELECT * from roundrecord where user_id = ? order by id desc`;

  db.query(query, [user_id], (err, results) => {
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
  const { user_id, lock_id } = req.body;

  const updateQuery = `
        UPDATE roundrecord SET is_locked = ? WHERE id = ? And user_id =?`;
  const date = new Date();

  // Correct parameter order: date_view, access_status, id
  db.query(updateQuery, ["Yes", lock_id, user_id], (err, result) => {
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
    WHERE id = ? AND user_id = ?`;

  db.query(
    updateQuery,
    [types, dataa.sharerecord_id, dataa.user_id],
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
          db.query(selectCompanyQuery, [dataa.user_id], (err, companyRows) => {
            if (err)
              return res
                .status(500)
                .json({ message: "Error fetching company info", error: err });
            if (companyRows.length === 0)
              return res.status(404).json({ message: "Company not found" });

            const insertInvestmentQuery = `
            INSERT INTO company_shares_investment (user_id, investor_id, roundrecord_id, created_at)
            VALUES (?, ?, ?, NOW())`;
            db.query(
              insertInvestmentQuery,
              [dataa.user_id, investor.investor_id, dataa.id],
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
          });
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
