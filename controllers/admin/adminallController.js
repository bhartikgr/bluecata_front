const bcrypt = require("bcryptjs");
const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");

require("dotenv").config();

exports.totalDocs = (req, res) => {
  const id = req.body.user_id; // ID to be deleted

  if (!id) {
    return res.status(400).json({ message: "No user id provided." });
  }

  // MySQL query to delete the video
  const query = "SELECT *  FROM dataroomdocuments WHERE user_id = ?";

  db.query(query, [id], (error, results) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    return res
      .status(200)
      .json({ message: "Video deleted successfully.", results: results });
  });
};
exports.checkUsersData = (req, res) => {
  const id = req.body.user_id; // ID to be deleted

  if (!id) {
    return res.status(400).json({ message: "No user id provided." });
  }

  // MySQL query to delete the video
  const query = "SELECT *  FROM company WHERE id = ?";

  db.query(query, [id], (error, row) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    return res
      .status(200)
      .json({ message: "Video deleted successfully.", results: row });
  });
};
exports.investorReports = (req, res) => {
  const id = req.body.user_id; // ID to be deleted

  if (!id) {
    return res.status(400).json({ message: "No user id provided." });
  }

  // MySQL query to delete the video
  const query = "SELECT * FROM investor_updates WHERE user_id = ?";

  db.query(query, [id], (error, row) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    return res
      .status(200)
      .json({ message: "Video deleted successfully.", results: row });
  });
};
exports.sharedReports = (req, res) => {
  const id = req.body.user_id; // ID to be deleted

  if (!id) {
    return res.status(400).json({ message: "No user id provided." });
  }

  // MySQL query to delete the video
  const query = "SELECT * FROM sharereport WHERE user_id = ?";

  db.query(query, [id], (error, row) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    return res
      .status(200)
      .json({ message: "Video deleted successfully.", results: row });
  });
};
exports.investordocLatestVersion = (req, res) => {
  const { user_id } = req.body;

  const query = `
    SELECT iu.*, 'investor_update' AS type
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
        downloadUrl = `https://blueprintcatalyst.com/${pathname}/investor_report/${doc.document_name}`;
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
exports.investordocprevVersion = (req, res) => {
  const { user_id } = req.body;

  const query = `
    SELECT iu.*, 'investor_update' AS type
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
        downloadUrl = `https://blueprintcatalyst.com/${pathname}/investor_report/${doc.document_name}`;
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
exports.viewinvestorDetail = (req, res) => {
  const { user_id, id } = req.body;
  console.log(req.body);
  const query = `SELECT sharereport.*, investor_information.*, investor_updates.document_name FROM sharereport LEFT JOIN investor_information ON investor_information.email = sharereport.investor_email LEFT JOIN investor_updates ON  investor_updates.id = sharereport.investor_updates_id WHERE sharereport.user_id = ? And sharereport.investor_updates_id =? `;

  db.query(query, [user_id, id], (err, results) => {
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
        downloadUrl: `https://blueprintcatalyst.com/${pathname}/investor_report/${doc.document_name}`,
      }));

      res.status(200).json({
        message: "Investor report data fetched",
        results: updatedResults,
      });
    }
  });
};
exports.viewinvestordetailInthis = (req, res) => {
  const { user_id } = req.body;
  const query = `SELECT sharereport.*, investor_information.*, investor_updates.document_name FROM sharereport LEFT JOIN investor_information ON investor_information.email = sharereport.investor_email LEFT JOIN investor_updates ON  investor_updates.id = sharereport.investor_updates_id WHERE sharereport.user_id = ? And sharereport.date_view IS NOT NULL`;

  db.query(query, [user_id], (err, results) => {
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
        downloadUrl: `https://blueprintcatalyst.com/${pathname}/investor_report/${doc.document_name}`,
      }));

      res.status(200).json({
        message: "Investor report data fetched",
        results: updatedResults,
      });
    }
  });
};

exports.getSharereportGrouped = (req, res) => {
  const { id } = req.body;

  const query = `
    SELECT
  MAX(sharereport.id) AS sharereport_id,
  CASE
    WHEN COUNT(sharereport.id) > 0 THEN 'Yes'
    ELSE 'No'
  END AS is_shareded,
  MAX(sharereport.date_view) AS dateview,
  investor_updates.*,
  investor_updates.user_id AS userid,
  investor_updates.created_at AS dateofreport,
  MAX(investor_information.id) AS investor_info_id,
  MAX(investor_information.unique_code) AS uniquecode,
  MAX(investor_information.first_name) AS first_name,
  MAX(investor_information.last_name) AS last_name,
  MAX(investor_information.email) AS email,
  MAX(investor_information.phone) AS mobile,
  MAX(investor_information.city) AS city,
  MAX(investor_information.country) AS country,
  MAX(investor_information.ip_address) AS ip_address,
  MAX(company.company_name) AS companyname
FROM investor_updates
LEFT JOIN sharereport ON investor_updates.id = sharereport.investor_updates_id
LEFT JOIN investor_information ON investor_information.email = sharereport.investor_email
LEFT JOIN company ON company.id = investor_updates.user_id
WHERE investor_updates.id = ?
GROUP BY investor_updates.id
LIMIT 0, 25;
;
  `;

  db.query(query, [id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    if (!results.length) {
      return res.status(200).json({
        message: "No data found",
        data: [],
      });
    }
    console.log(results);
    // Group result
    if (results.length > 0) {
      const pathname = `upload/docs/doc_${results[0].userid}`;

      const updatedResults = results.map((doc) => {
        let downloadUrl = null;
        if (doc.document_name) {
          downloadUrl = `https://blueprintcatalyst.com/${pathname}/investor_report/${doc.document_name}`;
        }
        return {
          ...doc,
          downloadUrl,
        };
      });
      const grouped = {
        investor_updates_id: results[0].investor_updates_id,
        document_name: results[0].document_name,
        company_name: results[0].companyname,
        is_shared: results[0].is_shared,
        download: updatedResults[0].downloadUrl,
        date_of_report: results[0].dateofreport,
        is_shareded: results[0].is_shareded,
        inverstordetail: results
          .filter((row) => row.uniquecode !== null) // 👈 only rows with unique_code
          .map((row) => ({
            first_name: row.first_name,
            last_name: row.last_name,
            email: row.email,
            unique_code: row.uniquecode,
            sent_date: row.sent_date,
            mobile: row.mobile,
            country: row.country,
            cityy: row.city,
            expired_at: row.expired_at,
            report_type: row.report_type,
            dateview: row.dateview,
            ip_address: row.ip_address,
          })),
      };
      res.status(200).json({
        message: "Sharereport data grouped successfully",
        data: [grouped],
      });
    }
  });
};

exports.getallInvestorReportViewed = (req, res) => {
  const { type } = req.body;
  const query = `    SELECT
      iu.*,
      CASE
        WHEN COUNT(sr.id) > 0 THEN 'Yes'
        ELSE 'No'
      END AS is_shared
    FROM
      investor_updates iu
    LEFT JOIN
      sharereport sr
      ON sr.investor_updates_id = iu.id
    WHERE
      iu.type = ?
    GROUP BY
      iu.id
    ORDER BY
      iu.id DESC;
  `;

  db.query(query, [type], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "All investor reports fetched successfully",
      results,
    });
  });
};
