const db = require("../../db");
const express = require("express");
const http = require("http");
const nodemailer = require("nodemailer");
const app = express();

const server = http.createServer(app);
function generateUniqueCode(length = 10) {
  const characters = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return code;
}
exports.sendtimeSheet = (req, res) => {
  const data = req.body;
  var code = generateUniqueCode(6);
  let senddata = {
    unique_code: code,
    start_date: data.start_date,
    end_date: data.end_date,
    user_id: data.user_id,
    roster_id: data.roster_id,
    client_id: data.client_id,
    location_id: data.location_id,
    email: data.email,
    message: data.message,
  };
  var url = "https://jlmining.online/supervisor/signature/" + code;
  db.query(
    "INSERT INTO uniquetimesheet SET ?",
    senddata,
    function (error, results, fields) {
      if (error) throw error;

      db.query(
        "SELECT * FROM users WHERE id = ?",
        [data.user_id],
        function (err, result) {
          const userEmail = result[0].email;
          const Userdata = result[0];
          sendEmailToUser(userEmail, url, code);

          sendEmailShareTimesheet(
            Userdata,
            data.email,
            url,
            data.message,
            (info) => {
              res.send(info);
            }
          );
        }
      );
    }
  );
};
exports.sendtimeSheetForUserEnd = (req, res) => {
  const data = req.body;
  var code = generateUniqueCode(6);
  let senddata = {
    unique_code: code,
    start_date: data.start_date,
    end_date: data.end_date,
    user_id: data.user_id,
    roster_id: data.roster_id,
    client_id: data.client_id,
    location_id: data.location_id,
    email: data.email,
    name: data.name,
    status: "Inactive",
    message: data.message,
  };

  db.query(
    "INSERT INTO uniquetimesheet SET ?",
    senddata,
    function (error, results, fields) {
      if (error) throw error;

      db.query(
        "SELECT email FROM users WHERE id = ?",
        [data.user_id],
        function (err, result) {
          const userEmail = result[0].email;
          //sendEmailToUser(userEmail, url, code);
        }
      );
    }
  );
};

async function sendEmailShareTimesheet(
  Userdata,
  to,
  timesheetLink,
  msg,
  callback
) {
  const transporter = nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    auth: {
      user: "no-reply@jlmining.online",
      pass: "Macbookm1!", // Replace with environment variable
    },
  });

  const mailOptions = {
    from: '"JL Mining" <no-reply@jlmining.online>',
    to: to,
    subject: "JL Mining Timesheet Signature Request",
    html: `
      <div style="font-family: Arial, sans-serif; font-size: 15px; color: #333;">
        <p>Dear Supervisor,</p>

        <p><strong>Message from user: ${
          Userdata?.step2_title || Userdata?.first_name || Userdata?.last_name
            ? `${Userdata.step2_title || ""} ${Userdata.first_name || ""} ${
                Userdata.last_name || ""
              }`.trim()
            : ""
        }</strong></p>
        <blockquote style="margin: 10px 0; padding: 10px; background: #f9f9f9; border-left: 5px solid #ccc;">
          ${msg}
        </blockquote>

        <p>You have been requested to review and sign a timesheet from <strong>JL Mining</strong>.</p>
        <p>Please click the link below to access the timesheet:</p>

       

        <p>If the button above doesn't work, copy and paste this URL into your browser:</p>
        <p><a href="${timesheetLink}">${timesheetLink}</a></p>
        <p>
          <a href="${timesheetLink}" style="display:inline-block; padding:10px 20px; background-color:#0066cc; color:#fff; text-decoration:none; border-radius:5px;">
            Click Here
          </a>
        </p>
        <p>Best regards,<br/>JL Mining Team</p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Timesheet email sent:", info.response);
    if (callback) callback(null, info);
  } catch (error) {
    console.error("Error sending timesheet email:", error);
    if (callback) callback(error);
  }
}
async function sendEmailToUser(to, timesheetLink, code) {
  const transporter = nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    auth: {
      user: "no-reply@jlmining.online",
      pass: "Macbookm1!",
    },
  });

  const mailOptions = {
    from: `"JL Mining" <no-reply@jlmining.online>`,
    to: to,
    subject: "Your Timesheet Has Been Submitted",
    html: `
      <p>Hello,</p>
      <p>Your timesheet has been successfully submitted and sent for signature.</p>
     
      <p>You can track or review it here: <a href="${timesheetLink}">${timesheetLink}</a></p>
      <p>Thanks for using JL Mining.</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("User confirmation email sent:", info.response);
  } catch (error) {
    console.error("Error sending user confirmation email:", error);
  }
}

exports.checkcode = (req, res) => {
  const data = req.body;
  db.query(
    "SELECT * FROM uniquetimesheet WHERE unique_code = ?",
    [data.code],
    function (err, result) {
      res.json({ result });
    }
  );
};

exports.gettimesheetData = (req, res) => {
  const data = req.body;

  db.query(
    "SELECT uniquetimesheet.*, users.step2_title,users.first_name,users.last_name FROM uniquetimesheet LEFT JOIN users ON uniquetimesheet.user_id = users.id WHERE uniquetimesheet.unique_code = ? And uniquetimesheet.status =?",
    [data.code, "Active"],
    function (err, result) {
      res.json({ result });
    }
  );
};
function createWeeklyRanges(dates) {
  const groups = dates.reduce((groups, dateObj) => {
    const date = new Date(dateObj.date);
    const week = getUTCISOWeek(date);
    groups[week] = groups[week] || [];
    groups[week].push(dateObj);
    return groups;
  }, {});

  const output = Object.entries(groups).map(([week, dates]) => {
    return {
      start: getdays(dates[0].date),
      end: getdays(dates[dates.length - 1].date),
      user_id: dates[0].user_id,
      roster_id: dates[0].roster_id,
      client_id: dates[0].client_id,
      location_id: dates[0].location_id,
      attend_id: dates[0].id,
    };
  });

  return output;
}
function getUTCISOWeek(date) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}
function getdays(forma) {
  const currentDate = new Date(forma);

  const formattedDate = currentDate.toISOString().split("T")[0];
  return formattedDate;
}

exports.updatesign = async (req, res) => {
  const { rows, signature_img, super_viser, code } = req.body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "No data to update" });
  }

  try {
    // Update attendance rows
    const user_Id = [];
    const updatePromises = rows.map((row) => {
      const sql = `
        UPDATE attendance 
        SET signature_img = ?,admin_view_hours=?, super_viser = ?, hours_status = ?
        WHERE id = ?
      `;
      user_Id.push(row.id);
      const params = [signature_img, row.hours, super_viser, "Client", row.id];

      return new Promise((resolve, reject) => {
        db.query(sql, params, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    });

    if (user_Id.length > 0) {
      const placeholders = user_Id.map(() => "?").join(", ");
      const userQuery = `SELECT * FROM attendance WHERE id IN (${placeholders})`;

      db.query(userQuery, user_Id, async (err, userResult) => {
        if (err || userResult.length === 0) {
        }

        userResult.forEach((row) => {
          var d = new Date(row.date);
          const insertNotification = `
        INSERT INTO timesheet_notification (user_id, date)
        VALUES (?,?)`;

          db.query(insertNotification, [row.user_id, d], (err, result) => {
            if (err) {
              console.error("Notification insert error:", err);
            }
          });
        });
      });
    }

    await Promise.all(updatePromises);

    // Get user email based on user_id (assumes all rows have same user)
    const userId = rows[0].user_id;
    const userQuery = "SELECT email FROM users WHERE id = ?";
    db.query(userQuery, [userId], async (err, userResult) => {
      if (err || userResult.length === 0) {
        console.error("User email not found.");
        return res.status(500).json({ error: "Failed to fetch user email" });
      }

      const userEmail = userResult[0].email;

      // Sort dates and format
      const sortedRows = rows.sort(
        (a, b) => new Date(a.date) - new Date(b.date)
      );
      const startDate = formatDate(sortedRows[0].date);
      const endDate = formatDate(sortedRows[sortedRows.length - 1].date);

      // Send confirmation email
      await sendEmailToUserSignature(
        userEmail,
        startDate,
        endDate,
        super_viser
      );
      const insertNotification = `
      INSERT INTO notifications (user_id, message, date)
      VALUES (?, ?, NOW())`;
      const adminId = 1; // Replace with actual admin user_id

      const message = `Timesheet from ${startDate} to ${endDate} has been signed by ${super_viser}.`;

      db.query(insertNotification, [userId, message], (err, result) => {
        if (err) {
          console.error("Notification insert error:", err);
        }
      });
      db.query(
        "UPDATE uniquetimesheet SET status =?,name=? where unique_code=?",
        ["Inactive", super_viser, code],
        function (err, result) {
          if (err) throw err;
        }
      );
      // Final response
      res.json({ message: "Updated and email sent successfully" });
    });
  } catch (error) {
    console.error("Update or Email Error:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
};
exports.resetnotification = async (req, res) => {
  const { dataa } = req.body;

  if (!Array.isArray(dataa) || dataa.length === 0) {
    return res.status(400).json({ error: "No data to update" });
  }

  try {
    const deletePromises = [];

    dataa.forEach((row) => {
      if (Array.isArray(row.notifications) && row.notifications.length > 0) {
        row.notifications.forEach((notif) => {
          console.log(notif);
          if (Array.isArray(notif.notifications_ids)) {
            notif.notifications_ids.forEach((id) => {
              deletePromises.push(
                new Promise((resolve, reject) => {
                  db.query(
                    "DELETE FROM timesheet_notification WHERE id = ?",
                    [id],
                    (err, result) => {
                      if (err) return reject(err);
                      resolve(result);
                    }
                  );
                })
              );
            });
          }
        });
      }
    });

    await Promise.all(deletePromises);
    res.json({ message: "Notifications reset successfully" });
  } catch (error) {
    console.error("Deletion Error:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
};

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toISOString().split("T")[0];
}
async function sendEmailToUserSignature(
  to,
  startDate,
  endDate,
  supervisorName
) {
  const transporter = nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    auth: {
      user: "no-reply@jlmining.online",
      pass: "Macbookm1!",
    },
  });

  const mailOptions = {
    from: `"JL Mining" <no-reply@jlmining.online>`,
    to: to,
    subject: "Timesheet Signature Completed - JL Mining",
    html: `
      <p>Hi,</p>
      <p>Your timesheet covering the period from <strong>${startDate}</strong> to <strong>${endDate}</strong> has been signed and successfully submitted.</p>
      <p><strong>Supervisor:</strong> ${supervisorName}</p>
      <p>Thank you for your submission.<br>JL Mining Team</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Timesheet confirmation email sent to user:", info.response);
  } catch (error) {
    console.error("Error sending confirmation email:", error);
  }
}

exports.bookmeet = async (req, res) => {
  const {
    full_name,
    email,
    guests,
    notes,
    goals,
    started,
    datemetting,
    timeset,
    timeZone,
  } = req.body;

  try {
    // Build guest email list string for display in template
    const guestEmails = guests
      .map(
        (g) => `Guest <a href="mailto:${g}" style="color: #3366cc;">${g}</a>`
      )
      .join("<br>");

    // Send to main user and guests
    const allRecipients = [email, ...guests];

    for (const recipient of allRecipients) {
      await sendEmailToUserMeet(
        datemetting,
        timeset,
        timeZone,
        recipient,
        full_name,
        started,
        notes,
        goals,
        guestEmails
      );
    }

    res.json({ message: "Meeting booked and emails sent." });
  } catch (error) {
    console.error("Booking or Email Error:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
};

async function sendEmailToUserMeet(
  datemetting,
  timeset,
  timeZone,
  to,
  organizerName,
  startDate,
  notes,
  goals,
  guestListHTML
) {
  const transporter = nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    auth: {
      user: "no-reply@jlmining.online",
      pass: "Macbookm1!",
    },
  });

  const mailOptions = {
    from: `"JL Mining" <no-reply@jlmining.online>`,
    to: to,
    subject: `Off Menu Introduction between Christian O'Brien and ${organizerName}`,
    html: `
      <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; padding: 30px; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://img.icons8.com/color/96/000000/ok--v1.png" alt="Success Icon" style="width: 60px;">
          <h2 style="color: #222;">Your event has been scheduled</h2>
          <p style="color: #555;">We sent an email to everyone with this information.</p>
        </div>

        <hr style="border: 1px solid #e0e0e0; margin: 20px 0;">

        <table style="width: 100%; font-size: 14px; line-height: 22px;">
          <tr>
            <td style="font-weight: bold; padding: 8px 0;">What</td>
            <td style="padding: 8px 0;">Off Menu Introduction between Christian O'Brien and ${organizerName}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; padding: 8px 0;">When</td>
            <td style="padding: 8px 0;">${startDate}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; padding: 8px 0;">Who</td>
            <td style="padding: 8px 0;">
              ${organizerName} - Organizer <br>
              ${guestListHTML}
            </td>
          </tr>
          <tr>
            <td style="font-weight: bold; padding: 8px 0;">Where</td>
            <td style="padding: 8px 0;">
              ${datemetting} | ${timeset} ${timeZone}
            </td>
          </tr>
          <tr>
            <td style="font-weight: bold; padding: 8px 0;">Description</td>
            <td style="padding: 8px 0;">${goals}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; padding: 8px 0;">Additional Notes</td>
            <td style="padding: 8px 0;">${notes}</td>
          </tr>
        </table>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Meeting confirmation email sent to:", to, info.response);
  } catch (error) {
    console.error("Error sending confirmation email to", to, ":", error);
  }
}

exports.usertimesheetFolderYears = async (req, res) => {
  const data = req.body;
  db.query(
    "SELECT DISTINCT YEAR(attendance.date) AS year FROM rosters JOIN attendance ON attendance.roster_id = rosters.id WHERE rosters.user_id=? AND attendance.hours != ?",
    [data.user_id, "null"],
    function (error, results) {
      if (error) throw error;
      const years = results.map((row) => row.year);

      res.json({ years });
    }
  );
};
exports.usergetMonthbaseData = async (req, res) => {
  const data = req.body;

  db.query(
    `SELECT attendance.date, attendance.user_id, attendance.client_id,
            attendance.location_id, attendance.roster_id, attendance.hours,
            attendance.hours_status, attendance.admin_view_hours
     FROM rosters 
     JOIN attendance ON attendance.roster_id = rosters.id 
     WHERE rosters.user_id = ? 
       AND attendance.hours != ? 
       AND YEAR(attendance.date) = ?`,
    [data.user_id, "null", data.year],
    function (error, results) {
      if (error) throw error;

      const monthNames = [
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

      const groupedByMonthName = {};

      results.forEach((row) => {
        const dateObj = new Date(row.date);
        const monthName = monthNames[dateObj.getMonth()]; // e.g., "May"

        if (!groupedByMonthName[monthName]) {
          groupedByMonthName[monthName] = [];
        }

        groupedByMonthName[monthName].push(row);
      });

      res.json({ monthGroups: groupedByMonthName });
    }
  );
};
exports.usergetWeekbaseData = async (req, res) => {
  const { year, month, user_id } = req.body;
  const monthMap = {
    January: "01",
    February: "02",
    March: "03",
    April: "04",
    May: "05",
    June: "06",
    July: "07",
    August: "08",
    September: "09",
    October: "10",
    November: "11",
    December: "12",
  };

  const monthNum = monthMap[month]; // month is "May"
  const datemonth = `${year}-${monthNum}`; // Ensure 2-digit month
  const query = `
    SELECT 
      attendance.date, attendance.user_id, attendance.client_id,
      attendance.location_id, attendance.roster_id, attendance.hours,
      attendance.hours_status, attendance.admin_view_hours
    FROM rosters 
    JOIN attendance ON attendance.roster_id = rosters.id 
    WHERE rosters.user_id = ? 
      AND attendance.hours IS NOT NULL 
      AND attendance.date LIKE ?
  `;

  db.query(query, [user_id, `${datemonth}%`], function (error, results) {
    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
    const arr =
      results && results.length > 0 ? createWeeklyRanges(results) : [];
    res.json({ arr });
  });
};

function createWeeklyRanges(dates) {
  const groups = dates.reduce((groups, dateObj) => {
    const date = new Date(dateObj.date);
    const week = getUTCISOWeek(date);
    groups[week] = groups[week] || [];
    groups[week].push(dateObj);
    return groups;
  }, {});

  const output = Object.entries(groups).map(([week, dates]) => {
    return {
      start: getdays(dates[0].date),
      end: getdays(dates[dates.length - 1].date),
      user_id: dates[0].user_id,
      roster_id: dates[0].roster_id,
      client_id: dates[0].client_id,
      location_id: dates[0].location_id,
    };
  });

  return output;
}
