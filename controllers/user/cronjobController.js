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
const puppeteer = require("puppeteer");

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
//Email Detail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

//All User subscription related
exports.getAllActiveSubscriptions = async () => {
  try {
    db.query(
      `SELECT 
        u.id AS user_id, u.email, u.company_name,
        (
          SELECT MAX(end_date)
          FROM usersubscriptiondataroomone_time
          WHERE user_id = u.id
        ) AS dataroom_end,
        (
          SELECT MAX(end_date)
          FROM userinvestorreporting_subscription
          WHERE user_id = u.id
        ) AS report_end
      FROM company u`,
      async (err, results) => {
        if (err) {
          console.error("DB query failed:", err);
          return;
        }

        const today = new Date();

        for (let row of results) {
          const userId = row.user_id;
          const dataroomEnd = row.dataroom_end
            ? new Date(row.dataroom_end)
            : null;
          const reportEnd = row.report_end ? new Date(row.report_end) : null;
          let latestEnd =
            dataroomEnd && reportEnd
              ? dataroomEnd > reportEnd
                ? dataroomEnd
                : reportEnd
              : dataroomEnd || reportEnd;

          if (
            (!dataroomEnd || dataroomEnd < today) &&
            (!reportEnd || reportEnd < today)
          ) {
            const diffDays = Math.floor(
              (today - latestEnd) / (1000 * 60 * 60 * 24)
            );

            if (diffDays === 42) {
              sendReminder(
                row.email,
                row.company_name,
                "Your data room will be deleted in 2 weeks."
              );
            } else if (diffDays === 49) {
              sendReminder(
                row.email,
                row.company_name,
                "Your data room will be deleted in 1 week."
              );
            } else if (diffDays === 55) {
              sendReminder(
                row.email,
                row.company_name,
                "Your data room will be deleted tomorrow."
              );
            } else if (diffDays >= 56) {
              //console.log(`Deleting files for user ${userId}`);
              // deleteUserFiles(userId);
            }
          }
        }
      }
    );
  } catch (error) {
    console.error("Internal Server Error", error);
  }
};
function sendReminder(to, companyName, message) {
  const subject = `Reminder: Data Room Deletion Notice for ${companyName}`;

  const body = `
    Dear ${companyName},

    This is a friendly reminder that your Data Room subscription has expired.

    ${message}

    If you wish to keep your files and continue allowing investor access, please renew your subscription before the deletion date.

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
    else console.log("Reminder email sent:", info.response);
  });
}

// Run daily at 8:00 AM
cron.schedule("0 8 * * *", async () => {
  //  console.log("Running daily cron job for data room subscription check");
  //  await exports.getAllActiveSubscriptions();
});

cron.schedule("*/1 * * * *", async () => {
  try {
    // console.log("cron");
    const [meetings] = await db.promise().query(`
      SELECT 
    zr.*, 
    zm.id AS zoom_meeting_id, 
    zm.timezone, 
    zm.meeting_date, 
    zm.time, 
    zm.topic, 
    zm.zoom_link, 
    zm.unique_code,
    m.name AS module_name,
    m.id AS module_id,
    corp.email As corp_email
  FROM zoommeeting_register zr
  LEFT JOIN zoommeeting zm 
    ON FIND_IN_SET(
      zm.id, 
      REPLACE(REPLACE(REPLACE(zr.registered_meeting_ids, '[', ''), ']', ''), ' ', '')
    )
  LEFT JOIN module m 
    ON zm.module_id = m.id
  LEFT JOIN company corp 
    ON zr.user_id = corp.id

    `);

    const [templateResults] = await db
      .promise()
      .query(`SELECT * FROM email_templates`);
    const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = moment().tz(userTimeZone);

    const reminderTypes = {
      reminder_48hr: { hours: 48, dbField: "reminder_48_sent" },
      reminder_24hr: { hours: 24, dbField: "reminder_24_sent" },
      reminder_1hr: { hours: 1, dbField: "reminder_1_sent" },
    };

    for (const [templateType, { hours, dbField }] of Object.entries(
      reminderTypes
    )) {
      const template = templateResults.find((t) => t.type === templateType);

      if (!template) continue;

      for (const meeting of meetings) {
        if (!meeting.meeting_date || !meeting.time) continue;
        if (meeting[dbField] === 1) continue; // already sent

        const [hour, minute] = meeting.time.split(":").map(Number);
        const dateFormatted = moment(meeting.meeting_date).format("YYYY-MM-DD");
        const fullDateTimeStr = `${dateFormatted} ${meeting.time}:00`;
        const meetingTimeInOrigin = moment
          .tz(fullDateTimeStr, "YYYY-MM-DD", meeting.timezone)
          .set({ hour, minute, second: 0 });
        const meetingTimeInLocal = meetingTimeInOrigin.clone().tz(userTimeZone);
        const reminderTime = meetingTimeInLocal
          .clone()
          .subtract(hours, "hours");

        const diffMinutes = Math.abs(now.diff(reminderTime, "minutes"));
        if (diffMinutes <= 10) {
          const zoomLink =
            "https://capavate.com/moduleone/" + meeting.module_id;

          const replacements = {
            module_name: meeting.module_name,
            user_name: meeting.name || "User",
            meeting_topic: meeting.topic || "Zoom Meeting",
            event_time: meetingTimeInLocal.format(
              "dddd, MMMM Do YYYY [at] hh:mm A"
            ),
            zoom_link: zoomLink,
          };
          //console.log(replacements);
          const htmlBody = fillTemplate(template.body, replacements);
          const emailSubject = fillTemplate(template.subject, replacements);

          sendReminderZoom(
            meeting.corp_email,
            "Company",
            htmlBody,
            emailSubject
          );

          await db
            .promise()
            .query(
              `UPDATE zoommeeting_register SET ${dbField} = 1 WHERE id = ?`,
              [meeting.id]
            );
        }
      }
    }
  } catch (error) {}
});

cron.schedule("*/15 * * * *", async () => {
  upcomingModule();
});
async function upcomingModule() {
  try {
    // 1. Get all future meetings with module name
    const [futureMeetings] = await db.promise().query(`
      SELECT zoommeeting.*, module.name AS module_name,module.id AS module_id 
      FROM zoommeeting 
      LEFT JOIN module ON module.id = zoommeeting.module_id
      ORDER BY zoommeeting.id DESC
    `);

    const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = moment();

    for (const meeting of futureMeetings) {
      // Format meeting time
      const [hour, minute] = meeting.time.split(":").map(Number);
      const dateFormatted = moment(meeting.meeting_date).format("YYYY-MM-DD");
      const fullDateTimeStr = `${dateFormatted} ${meeting.time}:00`;

      const meetingTimeInOrigin = moment
        .tz(fullDateTimeStr, "YYYY-MM-DD", meeting.timezone)
        .set({ hour, minute, second: 0 });

      const meetingTimeInLocal = meetingTimeInOrigin.clone().tz(userTimeZone);

      // Proceed only if meeting is in future
      if (meetingTimeInLocal.isAfter(now)) {
        const meetingId = meeting.id;

        // 2. Get all companies
        const [companies] = await db.promise().query(`
          SELECT id, company_name, email FROM company
        `);

        // 3. Get all meeting registrations
        const [registrations] = await db.promise().query(`
          SELECT user_id, registered_meeting_ids FROM zoommeeting_register
        `);

        // 4. Collect user_ids who registered for this meeting
        const registeredUserIds = registrations
          .filter((reg) => {
            try {
              const ids = JSON.parse(reg.registered_meeting_ids || "[]");
              return ids.includes(meetingId);
            } catch {
              return false;
            }
          })
          .map((r) => r.user_id);

        // 5. Filter companies who did NOT register for this meeting
        const notRegisteredCompanies = companies.filter(
          (company) => !registeredUserIds.includes(company.id)
        );

        // 6. Send emails only if not already sent
        for (const company of notRegisteredCompanies) {
          const dt = meetingTimeInLocal.format(
            "dddd, MMMM Do YYYY [at] hh:mm A"
          );

          const [alreadySent] = await db
            .promise()
            .query(
              `SELECT id FROM upcomingmoduleemail WHERE user_id = ? AND zoommeeting_id = ?`,
              [company.id, meetingId]
            );

          if (alreadySent.length === 0) {
            // Insert record and send email
            const currentTime = new Date();
            await db
              .promise()
              .query(
                `INSERT INTO upcomingmoduleemail (user_id, zoommeeting_id, created_at) VALUES (?, ?, ?)`,
                [company.id, meetingId, currentTime]
              );

            sendUpcomingModuleZoom(
              company.email,
              company.company_name,
              meeting,
              dt
            );
          } else {
          }
        }
      }
    }
  } catch (error) {
    console.error("❌ Error in upcomingModule:", error);
  }
}

function sendUpcomingModuleZoom(to, companyName, meeting, dateFormatted) {
  const subject = `🔔 Reminder: Upcoming Module - ${meeting.topic}`;

  const registerUrl = `https://capavate.com/moduleone/${meeting.module_id}`; // Update this URL

  const message = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #333;">
      <p>Dear ${companyName},</p>
      <p>You have an upcoming session, but you haven't registered yet:</p>
      <ul>
        <li><strong>Module:</strong> ${meeting.module_name}</li>
        <li><strong>Topic:</strong> ${meeting.topic}</li>
        <li><strong>Date & Time:</strong> ${dateFormatted}</li>
      </ul>
      <p>Please register as soon as possible to not miss the session.</p>

      <p style="text-align: center; margin-top: 20px;">
        <a href="${registerUrl}" 
           style="background-color: #007BFF; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">
          🔗 Register Now
        </a>
      </p>

      <p style="margin-top: 30px;">Regards,<br/>BluePrint Catalyst Team</p>
    </div>
  `;

  const mailOptions = {
    from: '"BluePrint Catalyst" <scale@blueprintcatalyst.com>',
    to,
    subject,
    html: message,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("❌ Error sending email:", error);
    else console.log(`✅ Email sent to ${to}`);
  });
}

function fillTemplate(templateString, replacements) {
  return templateString.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return replacements[key] || "";
  });
}
function sendReminderZoom(to, companyName, message, subject) {
  const mailOptions = {
    from: '"BluePrint Catalyst" <scale@blueprintcatalyst.com>',
    to,
    subject,
    html: message,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending email:", error);
    else console.log(`✅ Reminder email sent to ${to}`);
  });
}
//Cron Job Zoom Meeting
//Cron Job for Discount
function updateExpiredDiscountCodes() {
  const query = `
    UPDATE discount_code 
    SET status = 'Inactive'
    WHERE exp_date < NOW() AND status != 'Inactive'
  `;

  db.query(query, (error, results) => {
    if (error) {
      console.error("Error updating expired discount codes:", error);
    } else {
      console.log(`✅ Expired discount codes updated: ${results.affectedRows}`);
    }
  });
}

// Schedule cron job: runs every day at midnight
cron.schedule("0 0 * * *", () => {
  console.log("⏳ Running cron job to check expired discount codes...");
  updateExpiredDiscountCodes();
});

//Round Rate Convert For Investor
function extractCurrencyCode(currencyString) {
  // currencyString example: "USD $" → return "USD"
  return currencyString.split(" ")[0].trim();
}

async function getBOCRate(currencyRaw, date) {
  const currency = extractCurrencyCode(currencyRaw); // "USD $" → "USD"

  // If currency is CAD → return 1 immediately
  if (currency === "CAD") {
    return 1;
  }

  const currencyPair = `FX${currency}CAD`; // FXUSDCAD, FXEURCAD, etc

  const url = `https://www.bankofcanada.ca/valet/observations/${currencyPair}?start_date=${date}&end_date=${date}`;

  const res = await axios.get(url);

  if (!res.data.observations || res.data.observations.length === 0) {
    throw new Error("Rate not found for this date");
  }

  return parseFloat(res.data.observations[0][currencyPair].v);
}

// 2. Main Function → Convert all foreign rounds
function formatDateToBOC(dateStr) {
  // input: "12/10/2025" (MM/DD/YYYY)
  // output: "2025-12-10" (YYYY-MM-DD)

  const [month, day, year] = dateStr.split("/");
  return `${year}-${day.padStart(2, "0")}-${month.padStart(2, "0")}`;
}

function convertCurrencyForRounds() {
  const fetchQuery = `
    SELECT id, roundsize, currency, dateroundclosed
    FROM roundrecord
    WHERE currency IS NOT NULL
      AND currency != 'CAD'
      AND roundsize IS NOT NULL
      AND dateroundclosed IS NOT NULL
      AND dateroundclosed != '';
  `;

  db.query(fetchQuery, async (error, rows) => {
    if (error) {
      console.error("❌ Error fetching rounds:", error);
      return;
    }

    if (rows.length === 0) {
      console.log("ℹ No foreign currency rounds found.");
      return;
    }

    console.log(`🔍 Found ${rows.length} rounds needing conversion...`);

    for (const row of rows) {
      try {
        const roundId = row.id;
        const amount = parseFloat(row.roundsize);
        const currency = row.currency.toUpperCase();
        const date = formatDateToBOC(row.dateroundclosed);

        // Check if this round/date already has a conversion
        const checkQuery = `
          SELECT id FROM round_currency_conversion
          WHERE round_id = ? AND conversion_date = ?
        `;

        const existingRows = await new Promise((resolve, reject) => {
          db.query(checkQuery, [roundId, date], (err, results) => {
            if (err) reject(err);
            else resolve(results);
          });
        });

        if (existingRows.length > 0) {
          console.log(
            `⚠ Round ${roundId} already converted for ${date}, skipping.`
          );
          continue; // Skip this round
        }

        // Fetch BOC exchange rate
        const rate = await getBOCRate(currency, date);

        // Convert
        const amountCad = (amount * rate).toFixed(2);

        // Insert conversion
        const insertQuery = `
          INSERT INTO round_currency_conversion 
          (round_id, currency, amount, exchange_rate, amount_cad, conversion_date)
          VALUES (?, ?, ?, ?, ?, ?)
        `;

        await new Promise((resolve, reject) => {
          db.query(
            insertQuery,
            [roundId, currency, amount, rate, amountCad, date],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });

        console.log(
          `✅ Round ${roundId}: ${amount} ${currency} → ${amountCad} CAD saved.`
        );
      } catch (err) {
        console.error(`❌ Conversion failed for round ${row.id}:`, err.message);
      }
    }
  });
}

// 3. Cron Job (Runs every midnight)
cron.schedule("0 0 * * *", () => {
  convertCurrencyForRounds();
});
//Round Rate Convert For Investor
