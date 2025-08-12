const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");
const axios = require("axios");
const jwt = require("jsonwebtoken");
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

//All Investor Quatarly Email Send
exports.investorQuatarlyEmailSend = (req, res) => {
  // Get today's date minus 3 months
  const threeMonthsAgo = moment().subtract(3, "months").format("YYYY-MM-DD");

  // Fetch investors who have not updated in the last 3 months
  const query = `SELECT c.id, c.email, iu.last_update FROM company c LEFT JOIN ( SELECT user_id, MAX(created_at) AS last_update FROM investor_updates GROUP BY user_id ) iu ON c.id = iu.user_id WHERE iu.last_update IS NULL OR iu.last_update <= ?`;

  db.query(query, [threeMonthsAgo], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    results.forEach((investor) => {
      // Send email to each investor
      sendEmailForInvestorReminder(
        investor.email,
        "Reminder: Submit Your Quarterly Investor Update"
      );
    });

    res.status(200).json({
      message: "Quarterly reminder emails sent",
      count: results.length,
    });
  });
};

// Every day at 9 AM, check for quarterly reminders
cron.schedule("0 9 * * *", () => {
  investorQuatarlyEmailSend(); // call the function
});

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
function sendEmailForInvestorReminder(to, subject) {
  const body = `
Dear Founder,

This is a friendly reminder to submit your **Quarterly Investor Update**.

Regular updates help maintain trust and ensure investors are aligned with your company’s current progress, challenges, and strategic direction.

Please include:
- Your current revenue and key business KPIs
- Notable product improvements or team changes
- Any major wins, learnings, or setbacks this quarter
- A brief summary of what’s coming next or where support is needed

Consistent updates (every 3 months) help everyone stay in sync and are part of our shared commitment to transparency.

If you’ve already submitted your update, you can disregard this message.

Best regards,  
Investor Relations Team  
`;

  const mailOptions = {
    from: '"BluePrint Catalyst" <scale@blueprintcatalyst.com>',
    to,
    subject,
    text: body,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending email:", error);
    else console.log("Email sent:", info.response);
  });
}

//All Investor Quatarly Email Send

exports.getInvestorReport = (req, res) => {
  const { user_id } = req.body;

  const query = `
    SELECT iu.*
FROM investor_updates iu
WHERE iu.user_id = ?
  AND iu.is_locked = ?
  AND iu.id NOT IN (
    SELECT investor_updates_id FROM sharereport
  )
ORDER BY iu.id DESC;

  `;

  db.query(query, [user_id, 1], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    const pathname = `upload/docs/doc_${user_id}`;

    const updatedResults = results.map((doc) => {
      // Conditional downloadUrl based on type
      let downloadUrl = null;

      if (doc.document_name) {
        downloadUrl = `https://blueprintcatalyst.com/api/${pathname}/investor_report/${doc.document_name}`;
      }

      return {
        ...doc,
        downloadUrl,
      };
    });

    res.status(200).json({
      message: "Investor report data fetched",
      results: updatedResults,
    });
  });
};
exports.SendreportToinvestor = async (req, res) => {
  const { user_id, emails, records } = req.body;
  if (
    !user_id ||
    !emails ||
    !Array.isArray(emails) ||
    !Array.isArray(records)
  ) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const currentDate = new Date();
    const expiredAt = new Date();
    expiredAt.setDate(currentDate.getDate() + 30);

    // 🔍 Get entrepreneur name
    const [userRows] = await db
      .promise()
      .query("SELECT * FROM company WHERE id = ? LIMIT 1", [user_id]);
    const entrepreneurName =
      userRows[0]?.first_name + " " + userRows[0]?.last_name || "Entrepreneur";

    const duplicateReports = [];

    for (const report of records) {
      for (const email of emails) {
        const checkSql = `SELECT 1 FROM sharereport WHERE investor_updates_id = ? AND investor_email = ? LIMIT 1`;
        const [existing] = await db
          .promise()
          .query(checkSql, [report.id, email]);

        if (existing.length > 0) {
          duplicateReports.push({ email, document_name: report.document_name });
        }
      }
    }

    if (duplicateReports.length > 0) {
      const messageText = duplicateReports
        .map(
          (item) =>
            `Report "${item.document_name}" has already been sent to ${item.email}`
        )
        .join("\n");

      return res.status(200).json({
        message: messageText,
        status: "2",
      });
    }

    // ✅ No duplicates, insert and send email
    for (const report of records) {
      for (const email of emails) {
        const token = crypto.randomBytes(16).toString("hex");

        await db.promise().query(
          `INSERT INTO sharereport 
            (user_id, investor_updates_id, unique_code, investor_email, sent_date, expired_at, report_type)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            user_id,
            report.id,
            token,
            email,
            currentDate,
            expiredAt,
            report.type,
          ]
        );

        // 📧 Send Email
        const query = `SELECT * FROM investor_information WHERE email = ?`;

        db.query(query, [email], async (err, results) => {
          if (err) {
            return res.status(500).json({
              message: "Database query error",
              error: err,
            });
          }

          const url =
            results.length > 0
              ? `http://localhost:3000/investor/login`
              : `http://localhost:3000/investor/information/token=${token}`;

          const mailOptions = {
            from: '"BluePrint Catalyst" <scale@blueprintcatalyst.com>',
            to: email,
            subject: `New Report from ${entrepreneurName}`,
            html: `
      <p>Dear Investor,</p>
      <p>${entrepreneurName} has shared a new report with you: <strong>${
              report.document_name
            }</strong></p>
      <p>You can view the report by clicking the button below:</p>
      <p><a href="${url}" style="
        display: inline-block;
        padding: 10px 20px;
        background-color: #007bff;
        color: #ffffff;
        text-decoration: none;
        border-radius: 5px;
        font-weight: bold;
      ">Click Here</a></p>
      <p>This link will expire on <strong>${expiredAt.toDateString()}</strong>.</p>
      <p>Thank you,<br/>Startup Portal Team</p>
    `,
          };

          try {
            await transporter.sendMail(mailOptions);
            console.log("Email sent successfully");
            return res.status(200).json({ message: "Email sent successfully" });
          } catch (error) {
            console.error("Error sending email:", error);
            return res
              .status(500)
              .json({ message: "Email send failed", error });
          }
        });
      }
    }

    return res.status(200).json({
      message: "Reports shared and emails sent successfully",
      status: "1",
    });
  } catch (error) {
    console.error("Error sending reports:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getInvestorReportprevious = (req, res) => {
  const { user_id } = req.body;

  const query = `
    SELECT iu.*
FROM investor_updates iu
WHERE iu.user_id = ?
  AND iu.is_locked = ?
  AND iu.id IN (
    SELECT investor_updates_id FROM sharereport
  )
ORDER BY iu.id DESC;

  `;

  db.query(query, [user_id, 1], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    const pathname = `upload/docs/doc_${user_id}`;

    const updatedResults = results.map((doc) => {
      // Conditional downloadUrl based on type
      let downloadUrl = null;

      if (doc.document_name) {
        downloadUrl = `https://blueprintcatalyst.com/api/${pathname}/investor_report/${doc.document_name}`;
      }

      return {
        ...doc,
        downloadUrl,
      };
    });

    res.status(200).json({
      message: "Investor report data fetched",
      results: updatedResults,
    });
  });
};
exports.checkinvestorCode = (req, res) => {
  const { code } = req.body.code;
  const query = `
    SELECT * from sharereport where unique_code =? And expired_at >= CURRENT_DATE`;

  db.query(query, [code], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Investor report data fetched",
      results: results,
    });
  });
};
async function getPublicIP() {
  try {
    const res = await axios.get("https://api64.ipify.org?format=json");

    return res.data.ip;
  } catch (error) {
    return "";
  }
}
function generateStrongPassword(length = 12) {
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lowercase = "abcdefghijklmnopqrstuvwxyz";
  const numbers = "0123456789";
  const special = "!@#$%^&*()_+-=[]{}|;:,.<>?";
  const allChars = uppercase + lowercase + numbers + special;

  const passwordArray = [
    uppercase[
      Math.floor((crypto.randomBytes(1).readUInt8() / 256) * uppercase.length)
    ],
    lowercase[
      Math.floor((crypto.randomBytes(1).readUInt8() / 256) * lowercase.length)
    ],
    numbers[
      Math.floor((crypto.randomBytes(1).readUInt8() / 256) * numbers.length)
    ],
    special[
      Math.floor((crypto.randomBytes(1).readUInt8() / 256) * special.length)
    ],
  ];

  for (let i = passwordArray.length; i < length; i++) {
    const randomByte = crypto.randomBytes(1).readUInt8();
    passwordArray.push(
      allChars[Math.floor((randomByte / 256) * allChars.length)]
    );
  }

  for (let i = passwordArray.length - 1; i > 0; i--) {
    const randomByte = crypto.randomBytes(1).readUInt8();
    const j = Math.floor((randomByte / 256) * (i + 1));
    [passwordArray[i], passwordArray[j]] = [passwordArray[j], passwordArray[i]];
  }

  return passwordArray.join("");
}
exports.investorInformation = async (req, res) => {
  const data = req.body;
  const { code } = req.body.code;
  if (!code) {
    return res.status(400).json({
      message: "Code and email are required",
      status: "2",
    });
  }

  const query = `
    SELECT * FROM sharereport WHERE investor_email = ? AND unique_code = ?;
  `;

  try {
    const [results] = await db.promise().query(query, [data.email, code]);

    if (results.length === 0) {
      return res.status(200).json({
        message: "Investor email not matched",
        status: "2",
      });
    }
    const query2 = `SELECT * FROM investor_information WHERE unique_code = ? AND email = ?`;
    const [resultss] = await db.promise().query(query2, [code, data.email]);
    // ✅ Get dynamic IP
    var password = generateStrongPassword(8);
    var hashedPassword = await bcrypt.hash(password, 12);
    if (resultss.length > 0) {
      const ip = await getPublicIP();

      const updateQuery = `
        UPDATE investor_information
        SET  first_name = ?, last_name = ?, phone = ?, country = ?, city = ?, ip_address = ?, updated_at = ?
        WHERE unique_code = ? AND email = ?
      `;

      const updateData = [
        data.first_name,
        data.last_name,
        data.phone,
        data.country,
        data.city,
        ip,
        new Date(),
        code,
        data.email,
      ];

      await db.promise().query(updateQuery, updateData);
      const fullName = data.first_name + " " + data.last_name;
      sendEmailInvestorpassword(data.email, fullName || "Investor", password);
      return res.status(200).json({
        message: "Investor information updated successfully",
        status: "1",
      });
    } else {
      const ip = await getPublicIP();

      const insertQuery = `
      INSERT INTO investor_information 
      (password,viewpassword,user_id,unique_code, first_name, last_name, email, phone, country, city, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? ,?)
    `;

      const formdata = [
        hashedPassword,
        password,
        results[0].user_id,
        code,
        data.first_name,
        data.last_name,
        data.email,
        data.phone,
        data.country,
        data.city,
        ip,
        new Date(),
      ];

      const [insertResult] = await db.promise().query(insertQuery, formdata);

      const fullName = data.first_name + " " + data.last_name;
      sendEmailInvestorpassword(data.email, fullName || "Investor", password);
      return res.status(200).json({
        message:
          "Investor information inserted successfully, Please check your email get password",
        data: insertResult,
        status: "1",
      });
    }
  } catch (error) {
    console.error("Database error:", error);
    return res.status(500).json({
      message: "Internal server error",
      error,
    });
  }
};
function sendEmailInvestorpassword(to, fullName, newPassword) {
  const subject = `Your Blueprint Catalyst Account Has Been Created`;

  const body = `
Dear ${fullName},

Thank you for submitting your details to access documents from **Blueprint Catalyst Ltd**.

Your account has been successfully created. Below are your login credentials:

**Email:** ${to}  
**Password:** ${newPassword}

Please log in to the platform to view/download the documents.

🔐 For your security, we recommend changing your password immediately after login.

If you have any questions or require assistance, feel free to contact our support team.

We’re glad to have you on board.

Best regards,  
Blueprint Catalyst Ltd Team
`;

  const mailOptions = {
    from: '"Blueprint Catalyst" <scale@blueprintcatalyst.com>',
    to,
    subject,
    text: body,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending email:", error);
    else console.log("Account credentials email sent:", info.response);
  });
}

exports.investorInformationUpdate = async (req, res) => {
  const data = req.body;
  const { code } = req.body.code;

  if (!code) {
    return res.status(400).json({
      message: "Code and email are required",
      status: "2",
    });
  }

  try {
    const query2 = `SELECT * FROM investor_information WHERE unique_code = ? AND email = ?`;
    const [resultss] = await db.promise().query(query2, [code, data.email]);
    // ✅ Get dynamic IP
    if (resultss.length > 0) {
      const ip = await getPublicIP();

      const updateQuery = `
    UPDATE investor_information
    SET first_name = ?, last_name = ?, phone = ?, country = ?, city = ?, ip_address = ?, updated_at = ?
    WHERE unique_code = ? AND email = ?
  `;

      const updateData = [
        data.first_name,
        data.last_name,
        data.phone,
        data.country,
        data.city,
        ip,
        new Date(),
        code,
        data.email,
      ];

      await db.promise().query(updateQuery, updateData);

      return res.status(200).json({
        message: "Investor information updated successfully",
        status: "1",
      });
    } else {
      const ip = await getPublicIP();

      const insertQuery = `
      INSERT INTO investor_information 
      (unique_code, first_name, last_name, email, phone, country, city, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

      const formdata = [
        code,
        data.first_name,
        data.last_name,
        data.email,
        data.phone,
        data.country,
        data.city,
        ip,
        new Date(),
      ];

      const [insertResult] = await db.promise().query(insertQuery, formdata);

      return res.status(200).json({
        message: "Investor information inserted successfully",
        data: insertResult,
        status: "1",
      });
    }
  } catch (error) {
    console.error("Database error:", error);
    return res.status(500).json({
      message: "Internal server error",
      error,
    });
  }
};

exports.getreportForInvestor = (req, res) => {
  const { email } = req.body;
  const query = `
    SELECT sharereport.*, company.first_name, company.last_name ,company.company_name,  investor_updates.document_name,investor_updates.created_at as date_report FROM sharereport JOIN company ON company.id = sharereport.user_id LEFT JOIN investor_updates ON investor_updates.id = sharereport.investor_updates_id WHERE sharereport.investor_email = ? AND sharereport.expired_at >= CURRENT_DATE`;

  db.query(query, [email], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    if (results.length > 0) {
      var user_id = results[0].user_id;
      var pathname = "upload/docs/doc_" + user_id;
      const updatedResults = results.map((doc) => ({
        ...doc,
        downloadUrl: `https://blueprintcatalyst.com/api/${pathname}/investor_report/${doc.document_name}`,
      }));

      res.status(200).json({
        message: "Investor report data fetched",
        results: updatedResults,
      });
    }
  });
};
exports.viewReport = async (req, res) => {
  const { id } = req.body;

  try {
    const ip = await getPublicIP(); // Ensure this is a promise that returns IP
    console.log(ip);
    const query = `SELECT * FROM sharereport WHERE id = ?`;
    db.query(query, [id], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: "Report not found" });
      }

      const report = results[0];
      const shouldUpdate = !report.date_view || report.date_view === "null";

      if (shouldUpdate) {
        const dateNow = new Date();

        db.query(
          "UPDATE sharereport SET date_view = ?, investor_ip = ? WHERE id = ?",
          [dateNow, ip, id],
          (updateErr) => {
            if (updateErr) {
              return res.status(500).json({
                message: "Failed to update view data",
                error: updateErr,
              });
            }

            return res.status(200).json({
              message: "Investor report data fetched and updated",
            });
          }
        );
      } else {
        return res.status(200).json({
          message: "Investor report data fetched (already viewed)",
        });
      }
    });
  } catch (error) {
    return res.status(500).json({
      message: "Unexpected server error",
      error,
    });
  }
};

exports.getInvestorReportViewed = (req, res) => {
  const { user_id } = req.body;
  const query = `
    SELECT sharereport.*, investor_information.*, investor_updates.document_name,investor_updates.created_at as date_report FROM sharereport  JOIN investor_information ON investor_information.email = sharereport.investor_email LEFT JOIN investor_updates ON  investor_updates.id = sharereport.investor_updates_id WHERE sharereport.user_id = ?;`;

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

exports.exportInvestorExcel = async (req, res) => {
  const { user_id, update_id } = req.body; // update_id is expected to be an array

  if (!Array.isArray(update_id) || update_id.length === 0) {
    return res.status(400).json({ message: "Invalid update_id" });
  }

  const query = `
    SELECT sharereport.*, investor_information.*,investor_updates.document_name
    FROM sharereport
    LEFT JOIN investor_information 
      ON investor_information.email = sharereport.investor_email
    LEFT JOIN investor_updates ON  investor_updates.id = sharereport.investor_updates_id
    WHERE sharereport.user_id = ?
      AND sharereport.investor_updates_id IN (?);
  `;

  try {
    const [rows] = await db.promise().query(query, [user_id, update_id]);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Investor Report");

    worksheet.columns = [
      { header: "Investor Email", key: "investor_email", width: 30 },
      { header: "Report Type", key: "report_type", width: 30 },
      { header: "Document Name", key: "document_name", width: 30 },
      { header: "Sent Date", key: "sent_date", width: 15 },
      { header: "View Report", key: "date_view", width: 15 },
      { header: "IP Address", key: "investor_ip", width: 20 },
      { header: "First Name", key: "first_name", width: 20 },
      { header: "Last Name", key: "last_name", width: 20 },
      { header: "Phone", key: "phone", width: 20 },
      { header: "Country", key: "country", width: 20 },
      { header: "City", key: "city", width: 20 },
    ];

    rows.forEach((row) => {
      worksheet.addRow({
        investor_email: row.investor_email,
        report_type: row.report_type,
        document_name: row.document_name,
        sent_date: row.sent_date,
        date_view: row.date_view,
        investor_ip: row.investor_ip,
        first_name: row.first_name,
        last_name: row.last_name,
        phone: row.phone,
        country: row.country,
        city: row.city,
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=investor_report.xlsx"
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Excel export error:", error);
    res.status(500).json({ message: "Failed to export Excel", error });
  }
};

exports.getInvestorInfocheck = (req, res) => {
  const { email } = req.body;
  const query = `
    SELECT * from investor_information where email =?`;

  db.query(query, [email], (err, results) => {
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

exports.investorlogin = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Check if user already exists
    db.query(
      "SELECT * FROM investor_information WHERE email = ?",
      [email],
      async (err, rows) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        if (rows.length > 0) {
          const user = rows[0];

          // Check if password matches
          const isPasswordValid = await bcrypt.compare(password, user.password);
          if (!isPasswordValid) {
            return res
              .status(200)
              .json({ status: "2", message: "Invalid email or password" });
          } else {
            res.status(200).json({
              message: "Login successfully",
              status: "1",
              id: user.id,
              email: user.email,
              first_name: user.first_name,
              last_name: user.last_name,
              access_token: user.access_token,
            });
          }
        } else {
          res
            .status(200)
            .json({ status: "2", message: "Invalid email or password" });
        }
      }
    );
  } catch (err) {
    res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};
exports.getreportForInvestorCompany = async (req, res) => {
  const { email } = req.body;

  try {
    // Check if user already exists
    db.query(
      "SELECT c.* FROM sharereport s LEFT JOIN company c ON c.id = s.user_id WHERE s.investor_email = ? GROUP BY s.user_id",
      [email],
      async (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        res.status(200).json({
          message: "Login successfully",
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

exports.resetPasswordinvestor = async (req, res) => {
  try {
    const { email } = req.body;
    const query = "SELECT * FROM investor_information WHERE email = ?";

    db.query(query, [email], async (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      if (results.length > 0) {
        const pass = generateStrongPassword(8);
        const hashedPassword = await bcrypt.hash(pass, 12);

        const updateQuery =
          "UPDATE investor_information SET password = ?, viewpassword = ? WHERE email = ?";
        db.query(
          updateQuery,
          [hashedPassword, pass, email],
          async (updateErr) => {
            if (updateErr) {
              console.error("Error updating password:", updateErr);
              return res.status(500).json({
                message: "Password update failed",
                error: updateErr,
              });
            }

            // Send Email
            var fl = results[0].first_name + " " + results[0].last_name;
            sendEmailResetpassword(email, fl || "User", pass);

            // Return response
            return res.status(200).json({
              status: 1,
              message: "Password reset successfully and email sent",
            });
          }
        );
      } else {
        return res.status(200).json({
          status: 2,
          message: "Email not found",
        });
      }
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error,
    });
  }
};

// Email sending function
function sendEmailResetpassword(to, fullName, newPassword) {
  const subject = `Your Password Has Been Reset - Startup Portal`;

  const body = `
Dear ${fullName},

Your password has been successfully reset.

Here is your new login password: **${newPassword}**

We recommend that you log in and change this password immediately for your account's security.

If you did not request this password reset, please contact our support team immediately.

Regards,  
Startup Portal Team
  `;

  const mailOptions = {
    from: '"BluePrint Catalyst" <scale@blueprintcatalyst.com>',
    to,
    subject,
    text: body,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending email:", error);
    else console.log("Password reset email sent:", info.response);
  });
}
