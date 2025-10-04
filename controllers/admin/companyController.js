const bcrypt = require("bcryptjs");
const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");

const { format } = require("date-fns");
require("dotenv").config();
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
exports.getUserallcompnay = (req, res) => {
  const user_id = req.body.user_id;
  db.query(
    `SELECT 
       u.id AS user_id, 
       u.first_name, 
       u.last_name, 
       c.id AS company_id, 
       c.*,         -- all other columns from company
       COUNT(cs.id) AS total_signatory
     FROM users u
     LEFT JOIN company c ON c.user_id = u.id
     LEFT JOIN company_signatories cs ON cs.company_id = c.id
     WHERE u.id = ?
     GROUP BY c.id
     ORDER BY u.id DESC`,
    [user_id],
    async (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      res.status(200).json({
        message: "Fetched successfully",
        status: "1",
        results: results,
      });
    }
  );
};
exports.getUsercompnayInfo = (req, res) => {
  const company_id = req.body.company_id;

  const query = `
    SELECT 
      c.*, 
      u.first_name AS user_first_name, 
      u.last_name AS user_last_name
    FROM company c
    LEFT JOIN users u ON u.id = c.user_id
    WHERE c.id = ?
  `;

  db.query(query, [company_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        message: "Company not found",
        status: "0",
      });
    }

    res.status(200).json({
      message: "Fetched successfully",
      status: "1",
      results: results[0], // return single company object
    });
  });
};

exports.deletecompany = (req, res) => {
  const id = req.body.id;

  db.getConnection((err, connection) => {
    if (err) {
      console.error("Connection error:", err);
      return res.status(500).json({ message: "Database connection error." });
    }

    connection.beginTransaction((err) => {
      if (err) {
        connection.release();
        return res.status(500).json({ message: "Transaction start failed." });
      }

      const deleteQueries = [
        "DELETE FROM dataroomai_response WHERE company_id = ?",
        "DELETE FROM dataroomai_summary WHERE company_id = ?",
        // "DELETE FROM dataroomai_summary_files WHERE company_id = ?",
        "DELETE FROM dataroomai_summary_subcategory WHERE company_id = ?",
        "DELETE FROM dataroomdocuments WHERE company_id = ?",
        "DELETE FROM dataroom_generatedocument WHERE company_id = ?",
        "DELETE FROM investor_information WHERE company_id = ?",
        "DELETE FROM investor_updates WHERE company_id = ?",
        // "DELETE FROM dataroomai_executive_summary WHERE company_id = ?",
        "DELETE FROM sharereport WHERE company_id = ?",
        "DELETE FROM referralusage WHERE used_by_company_id = ?",
        // "DELETE FROM used_referral_code WHERE used_by_company_id = ?",
        // "DELETE FROM userdocuments WHERE used_by_company_id = ?",
        // "DELETE FROM userinvestorreporting_subscription WHERE used_by_company_id = ?",
        "DELETE FROM company_signatories WHERE company_id = ?", // company.id is the main key
        "DELETE FROM access_logs_company_round WHERE company_id = ?", // company.id is the main key
        "DELETE FROM access_logs_investor WHERE company_id = ?", // company.id is the main key
        "DELETE FROM company_investor WHERE company_id = ?",
        "DELETE FROM investor_information WHERE company_id = ?",
        "DELETE FROM authorized_signature WHERE company_id = ?",
        "DELETE FROM roundrecord WHERE company_id = ?",
        "DELETE FROM sharerecordround WHERE company_id = ?",
        "DELETE FROM company WHERE id = ?", // company.id is the main key
      ];

      const runQuery = (index) => {
        if (index >= deleteQueries.length) {
          return connection.commit((err) => {
            if (err) {
              return connection.rollback(() => {
                connection.release();
                res.status(500).json({ message: "Commit failed." });
              });
            }

            // ✅ After successful commit, delete folder
            const filePath = path.join(
              __dirname,
              "..",
              "..",
              "upload",
              "docs",
              `doc_${id}`
            );
            fs.rm(filePath, { recursive: true, force: true }, (err) => {
              if (err) {
                console.warn("Folder deletion failed or not found:", filePath);
              } else {
                console.log("Deleted folder:", filePath);
              }

              connection.release();
              res.status(200).json({ message: "Deleted successfully." });
            });
          });
        }

        connection.query(deleteQueries[index], [id], (err) => {
          if (err) {
            return connection.rollback(() => {
              connection.release();
              console.error("Error in deletion:", err);
              res.status(500).json({ message: "Deletion failed." });
            });
          }
          runQuery(index + 1);
        });
      };

      runQuery(0);
    });
  });
};

exports.getcompanyInvestor = (req, res) => {
  const company_id = req.body.company_id;

  const query = `
    SELECT 
      investor_information.*, 
      company_investor.company_id, 
      company_investor.investor_id
    FROM company_investor
    JOIN investor_information 
      ON investor_information.id = company_investor.investor_id
    WHERE company_investor.company_id = ?
  `;

  db.query(query, [company_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Fetched successfully",
      status: "1",
      results, // array of investors for this company
    });
  });
};
