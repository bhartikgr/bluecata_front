const db = require("../../db");
const express = require("express");
const http = require("http");
const nodemailer = require("nodemailer");
const app = express();
const server = http.createServer(app);

exports.getCoverageTimeSheet = (req, res) => {
  var data = req.body;
  db.query(
    "SELECT attendance.* from rosters join attendance on  attendance.roster_id = rosters.id where rosters.user_id=? And attendance.hours_status =?  And attendance.roster = ? And attendance.shift_type = ?",
    [data.user_id, "User", data.rostertype, "Add"],
    function (err, result, fields) {
      if (err) throw err;

      if (result != "") {
        var arr = createCoverageTimeSheetWeeklyRanges(result);
      } else {
        var arr = [];
      }
      res.json({ arr });
    }
  );
};
function createCoverageTimeSheetWeeklyRanges(dates) {
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

exports.getCoverageAttendance = (req, res) => {
  var data = req.body;
  db.query(
    "SELECT attendance.* from rosters join attendance on  attendance.roster_id = rosters.id where rosters.user_id=? And attendance.hours_status =?  And attendance.roster = ? And attendance.shift_type = ?",
    [data.user_id, "User", data.rostertype, "Add"],
    function (err, result, fields) {
      if (err) throw err;

      if (result != "") {
        var arr = createCoverageTimeSheetWeeklyRanges(result);
      } else {
        var arr = [];
      }
      res.json({ arr });
    }
  );
};
exports.getWeeklyDataTimesheet = (req, res) => {
  var data = req.body;
  db.query(
    "SELECT attendance.*,locations.location_name,clients.name from attendance join locations on locations.id = attendance.location_id join clients on clients.id = attendance.client_id where attendance.user_id =? And attendance.hours_status =? And attendance.date BETWEEN ? AND ? And attendance.roster_id = ? And attendance.shift_type = ?  order by attendance.date asc",
    [data.user_id, "User", data.start, data.end, data.rosterid, "Add"],
    function (err, results, fields) {
      if (err) throw err;
      const data = [];
      //console.log(results);
      results.forEach((row) => {
        var g = getdformate(row.date);

        const formattedDate = g;
        var currd = row.date;
        const dayIndex = currd.getUTCDay();

        // Array of human-readable day names
        const daysOfWeek = [
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ];

        // Get the day of the week as a human-readable string
        const dayName = daysOfWeek[dayIndex];
        row.nd = formattedDate;
        row.dd = dayName;
        data.push(row);
      });
      //console.log("sd");
      //console.log(data);
      res.json({ data });
    }
  );
};
function getdformate(dd) {
  const datee = new Date(dd);
  // Set the timezone to UTC
  datee.setUTCHours(0, 0, 0, 0);
  const year = datee.getUTCFullYear();
  const month = String(datee.getUTCMonth() + 1).padStart(2, "0");
  const day = String(datee.getUTCDate()).padStart(2, "0");

  const formattedDatse = `${day}/${month}/${year}`;
  return formattedDatse;
}
exports.employeAttendanceForm = (req, res) => {
  var data = req.body;

  const currentDate = new Date();
  const year = currentDate.getUTCFullYear();
  const month = String(currentDate.getUTCMonth() + 1).padStart(2, "0"); // January is 0, so we add 1
  const day = String(currentDate.getUTCDate()).padStart(2, "0");

  // Form the desired format: YYYY-MM-DD
  const formattedDate = `${year}-${month}-${day}`;
  var onformattedDate = `${day}/${month}/${year}`;

  db.query(
    "SELECT attendance.*, clients.name AS client_name, users.first_name, users.last_name FROM attendance JOIN clients ON clients.id = attendance.client_id JOIN users ON users.id = attendance.user_id WHERE attendance.user_id = ? AND attendance.hours_status = ? AND attendance.date BETWEEN ? AND ? And attendance.shift_type = ? And attendance.roster_id = ?",
    [data.user_id, "User", data.start, data.end, "Add", data.rosterid],
    async function (err, results, fields) {
      if (err) throw err;

      if (results.length > 0) {
        // Create an array to store promises
        const updatePromises = [];

        for (const row of results) {
          try {
            const updatedRow = await updateRow(row, data);
            updatePromises.push(updatedRow);
          } catch (updateErr) {
            console.error("Error updating row:", updateErr);
            // Handle error appropriately
          }
        }
        const uname = `${results[0].first_name} ${results[0].last_name}`;
        const clientname = results[0].client_name;
        const st = getdformate(data.start);
        const et = getdformate(data.end);

        const msg = `The timesheet has been signed with ${clientname}, including the start date ${st} and end date ${onformattedDate}, by the supervisor: ${data.super_viser}.`;

        let notifications = {
          user_id: results[0].user_id,
          message: msg,
          date: new Date(formattedDate),
        };
        db.query(
          "INSERT INTO notifications SET ?",
          notifications,
          function (error, results, fields) {
            if (error) throw error;
          }
        );
        db.query(
          "SELECT * from users where id =?",
          [data.user_id],
          function (err, results, fields) {
            if (err) throw err;
            console.log(results[0].email);
            sendEmailfornotificationSignature(results[0].email, msg, (info) => {
              res.send(info);
            });
          }
        );

        // Execute all update promises
        Promise.all(updatePromises)
          .then(() => {
            var status = "1";
            res.json({ status });
          })
          .catch((err) => {
            console.error("Error updating rows:", err);
            var status = "2"; // or any other appropriate error status
            res.json({ status });
          });
      } else {
        var status = "2";
        res.json({ status });
      }
    }
  );

  // Function to update a single row with a promise
  function updateRow(row, data) {
    return new Promise((resolve, reject) => {
      db.query(
        "UPDATE attendance SET super_viser=?,hours_status=?, admin_view_hours=?, signature_img=? WHERE id=?",
        [data.super_viser, "Client", row.hours, data.signature_img, row.id],
        function (err, result) {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        }
      );
    });
  }
};
async function sendEmailfornotificationSignature(too, notification, callback) {
  const transporter = nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    auth: {
      user: "no-reply@jlmining.online",
      pass: "Macbookm1!", // Make sure this is correct
    },
  });
  const mailOptions = {
    from: "no-reply@jlmining.online",
    to: too,
    subject: "Signature From jlmining.online",
    text: notification,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error:", error);
    } else {
      //console.log("Email sent:", info.response);
    }
  });
}
function generateUniqueCode(length = 10) {
  const characters = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return code;
}
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
