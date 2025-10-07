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
exports.getInvestorInfo = (req, res) => {
  const investor_id = req.body.investor_id;

  const query = `
    SELECT 
      investor_information.* 
    FROM investor_information
    WHERE investor_information.id = ?
  `;

  db.query(query, [investor_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Fetched successfully",
      status: "1",
      results: results[0], // array of investors for this company
    });
  });
};
exports.getcompnayInvestorReporting = (req, res) => {
  const company_id = req.body.company_id;

  const query = `
    SELECT 
      investor_updates.* 
    FROM investor_updates
    WHERE investor_updates.company_id = ? order by investor_updates.id desc
  `;

  db.query(query, [company_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      results: results, // array of investors for this company
    });
  });
};
exports.getCompanyReport = (req, res) => {
  const id = req.body.ReportId;

  // Query 1: Get report details with total shares count
  const reportQuery = `
    SELECT 
      iu.*,
      COUNT(sr.id) AS total_shares 
    FROM investor_updates AS iu 
    LEFT JOIN sharereport AS sr ON sr.investor_updates_id = iu.id 
    WHERE iu.id = ? 
    GROUP BY iu.id;
  `;

  // Query 2: Get all investors who have access to this report with their names
  const investorsQuery = `
    SELECT 
      sr.id,
      sr.investor_email,
      sr.investor_id,
      sr.sent_date,
      sr.expired_at,
      sr.date_view,
      sr.access_status,
      sr.unique_code,
      sr.investor_ip,
      ii.first_name,
      ii.last_name,
      ii.type_of_investor
    FROM sharereport AS sr
    LEFT JOIN investor_information AS ii ON sr.investor_id = ii.id
    WHERE sr.investor_updates_id = ?
    ORDER BY sr.sent_date DESC;
  `;

  // Execute both queries
  db.query(reportQuery, [id], (err, reportResults) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    // Get shared investors list
    db.query(investorsQuery, [id], (err, investorsResults) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Add download URL to report results
      const reportData = reportResults[0];
      if (reportData && reportData.document_name) {
        const company_id = reportData.company_id;
        const pathname = `upload/docs/doc_${company_id}`;
        reportData.downloadUrl = `https://blueprintcatalyst.com/api/${pathname}/investor_report/${reportData.document_name}`;
      }

      res.status(200).json({
        results: reportData, // report details with downloadUrl
        sharedInvestors: investorsResults, // list of investors with access
      });
    });
  });
};

exports.getCompnayRecordRound = (req, res) => {
  const company_id = req.body.company_id;

  const query = `
    SELECT 
      	roundrecord.* 
    FROM 	roundrecord
    WHERE 	roundrecord.company_id = ? order by 	roundrecord.id desc
  `;

  db.query(query, [company_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      results: results, // array of investors for this company
    });
  });
};
exports.getCompanyRecordRoundDetails = (req, res) => {
  const ReportId = req.body.ReportId;

  const query = `
    SELECT 
      roundrecord.*,
      CASE 
        WHEN COUNT(sharerecordround.id) > 0 THEN 'Yes' 
        ELSE 'No' 
      END as is_shared,
      COUNT(sharerecordround.id) as total_investors_shared,
      GROUP_CONCAT(
        JSON_OBJECT(
          'investor_id', sharerecordround.investor_id,
          'first_name', investor_information.first_name,
          'last_name', investor_information.last_name,
          'email', investor_information.email,
          'sent_date', sharerecordround.sent_date,
          'expired_at', sharerecordround.expired_at,
          'access_status', sharerecordround.access_status,
          'signature_status', sharerecordround.signature_status
        )
      ) as shared_investors_details
    FROM roundrecord
    LEFT JOIN sharerecordround 
      ON sharerecordround.roundrecord_id = roundrecord.id
    LEFT JOIN investor_information
      ON investor_information.id = sharerecordround.investor_id
    WHERE roundrecord.id = ?
    GROUP BY roundrecord.id
  `;

  db.query(query, [ReportId], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    // Parse the shared_investors_details if it exists
    if (results[0] && results[0].shared_investors_details) {
      try {
        results[0].shared_investors_details = JSON.parse(
          `[${results[0].shared_investors_details}]`
        );
      } catch (parseErr) {
        results[0].shared_investors_details = [];
      }
    }

    res.status(200).json({
      results: results[0],
    });
  });
};
