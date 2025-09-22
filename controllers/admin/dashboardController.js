const bcrypt = require("bcryptjs");
const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");

require("dotenv").config();

exports.getTotalUsers = (req, res) => {
  db.query(
    "SELECT * FROM zoommeeting_register z1 WHERE z1.id = ( SELECT MAX(z2.id) FROM zoommeeting_register z2 WHERE z2.email = z1.email ) ORDER BY z1.id DESC;",
    async (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      res.status(200).json({
        results: results, // <-- include the results here
      });
    }
  );
};
exports.getTotalUsersDashboard = (req, res) => {
  db.query(
    "SELECT * FROM company order by id desc Limit 10",
    async (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }
      console.log(results);
      res.status(200).json({
        results: results, // <-- include the results here
      });
    }
  );
};
exports.getTotalCompany = (req, res) => {
  db.query("SELECT * FROM company", async (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      results: results, // <-- include the results here
    });
  });
};
exports.getTotalmodule = (req, res) => {
  db.query("SELECT * FROM module", async (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      results: results, // <-- include the results here
    });
  });
};

exports.getTotalactivemeeting = (req, res) => {
  const query = `
    SELECT zoommeeting.*, module.name AS module_name 
    FROM zoommeeting 
    JOIN module ON module.id = zoommeeting.module_id 
    ORDER BY zoommeeting.id DESC;
  `;

  db.query(query, (error, results) => {
    if (error) {
      console.error("Error getting meeting data:", error);
      return res.status(500).json({ message: "Error fetching meeting data." });
    }

    // Fix meeting_date format before sending to frontend
    const formattedResults = results.map((row) => ({
      ...row,
      meeting_date: row.meeting_date
        ? require("moment")(row.meeting_date).format("YYYY-MM-DD")
        : null,
    }));

    return res.status(200).json({
      message: "Meeting list fetched successfully",
      results: formattedResults,
    });
  });
};
