const db = require("../../db");
const nodemailer = require("nodemailer");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const { format } = require("date-fns");
const fs = require("fs");
const path = require("path");

const pdfParse = require("pdf-parse");

require("dotenv").config();
//Email Detail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
//Email Detail
exports.getCompanyTotalShares = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    return res.status(400).json({ message: "company_id is required" });
  }

  const query = `
    SELECT 
      COALESCE(SUM(issuedshares), 0) AS total_company_shares,
      COALESCE(COUNT(*), 0) AS total_rounds,
      MAX(currency) AS currency
    FROM roundrecord
    WHERE company_id = ? AND roundStatus = ?;
  `;

  db.query(query, [company_id, "ACTIVE"], (err, results) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Database query error", error: err });
    }

    // results[0] will always exist, but values may be null/0
    const totalCompanyShares = results[0]?.total_company_shares || 0;
    const totalRounds = results[0]?.total_rounds || 0;
    const currency = results[0]?.currency || null;

    res.status(200).json({
      message: "Company total shares fetched successfully",
      results: {
        totalCompanyShares,
        totalRounds,
        currency,
      },
    });
  });
};

exports.getCompanystokes = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    return res
      .status(400)
      .json({ success: false, message: "company_id is required" });
  }

  // 1️⃣ Get all rounds for this company
  const roundsQuery = `
    SELECT id AS round_id, nameOfRound, issuedshares, roundsize
    FROM roundrecord
    WHERE company_id = ? AND roundStatus = ?
    ORDER BY id ASC
  `;

  db.query(roundsQuery, [company_id, "ACTIVE"], (err, rounds) => {
    if (err) {
      console.error("Error fetching rounds:", err);
      return res.status(500).json({ success: false, message: "Server Error" });
    }

    if (!rounds || rounds.length === 0) {
      return res.status(200).json({ success: true, results: [] });
    }

    // 2️⃣ Get all investor allocations for these rounds
    const roundIds = rounds.map((r) => r.round_id);
    const placeholders = roundIds.map(() => "?").join(",");
    const investorQuery = `
      SELECT irc.investor_id, irc.shares AS issued_shares, irc.roundrecord_id
      FROM investorrequest_company irc
      WHERE irc.roundrecord_id IN (${placeholders})
        AND irc.request_confirm = 'Yes'
    `;

    db.query(investorQuery, roundIds, (err2, investorData) => {
      if (err2) {
        console.error("Error fetching investor data:", err2);
        return res
          .status(500)
          .json({ success: false, message: "Server Error" });
      }

      // 3️⃣ Prepare response per round
      const response = rounds.map((round) => {
        const totalRoundShares = parseInt(round.issuedshares || 0);

        const investorsInRound = investorData.filter(
          (inv) => inv.roundrecord_id === round.round_id
        );

        const investors = investorsInRound.map((inv) => {
          const issued = parseInt(inv.issued_shares || 0);
          const stakePercent =
            totalRoundShares > 0 ? (issued / totalRoundShares) * 100 : 0;

          const roundSize = parseFloat(round.roundsize || 0);
          // Avoid divide by zero
          const postMoneyValuation =
            stakePercent > 0 ? (roundSize * 100) / stakePercent : 0;
          const preMoneyValuation = postMoneyValuation - roundSize;

          return {
            investor_id: inv.investor_id,
            issued_shares: issued,
            stake_percent: parseFloat(stakePercent.toFixed(2)),
            post_money_valuation: parseFloat(postMoneyValuation.toFixed(2)),
            pre_money_valuation: parseFloat(preMoneyValuation.toFixed(2)),
          };
        });

        return {
          round_id: round.round_id,
          round_name: round.nameOfRound,
          total_issued_shares: totalRoundShares,
          round_size: parseFloat(round.roundsize || 0),
          investors,
        };
      });

      res.json({ success: true, results: response });
    });
  });
};

exports.getCompanyopenround = (req, res) => {
  const company_id = req.body.company_id;

  // 1️⃣ Get latest open round
  db.query(
    `SELECT *
     FROM roundrecord
     WHERE company_id = ?
       AND LOWER(roundStatus) = LOWER(?)
       AND is_shared = ?
     ORDER BY id DESC LIMIT 1`,
    [company_id, "ACTIVE", "Yes"],
    (err, rows) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      if (rows.length === 0) {
        return res.status(200).json({
          message: "No open round found",
          success: true,
          roundInfo: {
            round_type: "",
            target_raise: "",
            raised_to_date: 0,
            expected_close: "",
            fundraising_progress: "0%",
            progresswidth: 0,
          },
        });
      }

      const round = rows[0];
      const roundId = round.id;
      const targetRaise = parseFloat(round.roundsize) || 0;

      // 2️⃣ Raised to Date = sum of investment_amount from investorrequest_company table
      db.query(
        `SELECT 
           SUM(CAST(irc.investment_amount AS DECIMAL(15,2))) as raisedToDate,
           COUNT(*) as totalInvestors
         FROM investorrequest_company irc
         WHERE irc.roundrecord_id = ? 
           AND irc.company_id = ?
           AND irc.request_confirm = ?`,
        [roundId, company_id, "Yes"],
        (err2, investResult) => {
          if (err2) {
            return res
              .status(500)
              .json({ message: "Error fetching investment data", error: err2 });
          }

          const raisedToDate = parseFloat(investResult[0]?.raisedToDate) || 0;
          const totalInvestors = parseInt(investResult[0]?.totalInvestors) || 0;

          // 3️⃣ Fundraising Progress
          const progress =
            targetRaise > 0
              ? ((raisedToDate / targetRaise) * 100).toFixed(2)
              : 0;

          const progresswidth =
            targetRaise > 0 ? (raisedToDate / targetRaise) * 100 : 0;

          // 4️⃣ Expected Close
          const expectedClose = round.dateroundclosed;

          // 5️⃣ Additional calculations
          const remainingAmount = targetRaise - raisedToDate;
          const progressStatus =
            progresswidth >= 100
              ? "Completed"
              : progresswidth >= 75
              ? "Nearly Complete"
              : progresswidth >= 50
              ? "In Progress"
              : "Starting";

          res.status(200).json({
            success: true,
            roundInfo: {
              round_id: roundId,
              round_type: round.nameOfRound + " " + round.shareClassType,
              target_raise: targetRaise,
              raised_to_date: raisedToDate,
              remaining_amount: remainingAmount > 0 ? remainingAmount : 0,
              total_investors: totalInvestors,
              expected_close: expectedClose,
              fundraising_progress: progress + "%",
              progresswidth: progresswidth,
              progress_status: progressStatus,
              currency: round.currency || "USD",
              // Additional round details
              round_details: {
                description: round.description,
                instrument_type: round.instrumentType,
                issued_shares: round.issuedshares,
                general_notes: round.generalnotes,
                created_at: round.created_at,
              },
            },
          });
        }
      );
    }
  );
};

// Alternative version with more detailed investment breakdown
exports.getCompanyopenroundDetailed = (req, res) => {
  const company_id = req.body.company_id;

  // 1️⃣ Get latest open round
  db.query(
    `SELECT *
     FROM roundrecord
     WHERE company_id = ?
       AND LOWER(roundStatus) = LOWER(?)
       AND is_shared = ?
     ORDER BY id DESC LIMIT 1`,
    [company_id, "ACTIVE", "Yes"],
    (err, rows) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      if (rows.length === 0) {
        return res.status(200).json({
          message: "No open round found",
          success: true,
          roundInfo: null,
        });
      }

      const round = rows[0];
      const roundId = round.id;
      const targetRaise = parseFloat(round.roundsize) || 0;

      // 2️⃣ Get detailed investment data
      db.query(
        `SELECT 
           irc.investment_amount,
           irc.shares,
           irc.created_at as investment_date,
           irc.request_confirm,
           COUNT(*) as total_requests,
           SUM(CASE WHEN irc.request_confirm = 'Yes' THEN CAST(irc.investment_amount AS DECIMAL(15,2)) ELSE 0 END) as confirmed_amount,
           SUM(CASE WHEN irc.request_confirm = 'No' THEN CAST(irc.investment_amount AS DECIMAL(15,2)) ELSE 0 END) as pending_amount,
           COUNT(CASE WHEN irc.request_confirm = 'Yes' THEN 1 END) as confirmed_investors,
           COUNT(CASE WHEN irc.request_confirm = 'No' THEN 1 END) as pending_investors
         FROM investorrequest_company irc
         WHERE irc.roundrecord_id = ? 
           AND irc.company_id = ?
         GROUP BY irc.roundrecord_id`,
        [roundId, company_id],
        (err2, investResult) => {
          if (err2) {
            return res
              .status(500)
              .json({ message: "Error fetching investment data", error: err2 });
          }

          const investmentData = investResult[0] || {};
          const raisedToDate = parseFloat(investmentData.confirmed_amount) || 0;
          const pendingAmount = parseFloat(investmentData.pending_amount) || 0;
          const confirmedInvestors =
            parseInt(investmentData.confirmed_investors) || 0;
          const pendingInvestors =
            parseInt(investmentData.pending_investors) || 0;

          // 3️⃣ Progress calculations
          const progress =
            targetRaise > 0
              ? ((raisedToDate / targetRaise) * 100).toFixed(2)
              : 0;
          const progresswidth =
            targetRaise > 0 ? (raisedToDate / targetRaise) * 100 : 0;
          const remainingAmount = targetRaise - raisedToDate;

          res.status(200).json({
            success: true,
            roundInfo: {
              round_id: roundId,
              round_type: round.nameOfRound + " " + round.shareClassType,
              target_raise: targetRaise,
              raised_to_date: raisedToDate,
              pending_amount: pendingAmount,
              remaining_amount: remainingAmount > 0 ? remainingAmount : 0,
              confirmed_investors: confirmedInvestors,
              pending_investors: pendingInvestors,
              total_requests: confirmedInvestors + pendingInvestors,
              expected_close: round.dateroundclosed,
              fundraising_progress: progress + "%",
              progresswidth: progresswidth,
              currency: round.currency || "USD",
              completion_percentage: parseFloat(progress),
              round_status: round.roundStatus,
              is_shared: round.is_shared,
            },
          });
        }
      );
    }
  );
};

exports.getCompanyopenroundUserLog = (req, res) => {
  const company_id = req.body.company_id;

  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT sharerecordround.*,roundrecord.nameOfRound,roundrecord.shareClassType, investor_information.first_name, investor_information.last_name
     FROM sharerecordround
     JOIN investor_information ON investor_information.id = sharerecordround.investor_id
     JOIN roundrecord ON roundrecord.id = sharerecordround.roundrecord_id
     WHERE sharerecordround.company_id = ? 
       AND sharerecordround.access_status IN (?, ?)
     ORDER BY sharerecordround.id DESC Limit 5`,
    [company_id, "Only View", "Download"],
    (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      return res.status(200).json(results);
    }
  );
};
exports.getDilutionForecast = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    return res.status(400).json({ error: "company_id is required" });
  }

  // Fetch all active rounds with investors
  const query = `
    SELECT 
      r.id AS round_id,
      r.nameOfRound,
      r.shareClassType,
      r.issuedshares,
      r.created_at,
      irc.investor_id,
      irc.shares AS investor_shares,
      ii.first_name,
      ii.last_name
    FROM roundrecord r
    LEFT JOIN investorrequest_company irc 
      ON r.id = irc.roundrecord_id AND irc.request_confirm = 'Yes'
    LEFT JOIN investor_information ii
      ON irc.investor_id = ii.id
    WHERE r.company_id = ? 
      AND r.roundStatus = 'ACTIVE'
    ORDER BY r.created_at ASC, r.id ASC
  `;

  db.query(query, [company_id], (err, rows) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ error: "Database query error", details: err });
    }

    if (!rows.length) {
      return res.status(200).json({ message: "No active rounds found" });
    }

    // Map rounds
    const roundsMap = {};
    rows.forEach((row) => {
      if (!roundsMap[row.round_id]) {
        roundsMap[row.round_id] = {
          name: row.nameOfRound || `Round ${row.round_id}`,
          issuedShares: parseFloat(row.issuedshares || 0),
          shareClass: row.shareClassType || "Common",
          investors: [],
        };
      }
      if (row.investor_id && row.investor_shares) {
        roundsMap[row.round_id].investors.push({
          id: row.investor_id,
          name: `${row.first_name} ${row.last_name}`,
          shares: parseFloat(row.investor_shares || 0),
        });
      }
    });

    const labels = [];
    const founderData = [];
    const investorDatasetsMap = {};
    const colorPalette = [
      "#1e40af",
      "#dc2626",
      "#059669",
      "#7c3aed",
      "#ea580c",
    ];

    Object.values(roundsMap).forEach((round, roundIndex) => {
      labels.push(round.name);

      const totalInvestorShares = round.investors.reduce(
        (sum, inv) => sum + inv.shares,
        0
      );
      const founderShares = round.issuedShares - totalInvestorShares;

      // Founder %
      const totalShares = round.issuedShares;
      founderData.push(((founderShares / totalShares) * 100).toFixed(2));

      // Investor %
      round.investors.forEach((inv, idx) => {
        const perc = ((inv.shares / totalShares) * 100).toFixed(2);
        if (!investorDatasetsMap[inv.name]) {
          investorDatasetsMap[inv.name] = {
            label: inv.name,
            data: new Array(labels.length - 1).fill(0), // fill previous rounds with 0
            backgroundColor: colorPalette[idx % colorPalette.length],
          };
        }
        investorDatasetsMap[inv.name].data.push(parseFloat(perc));
      });

      // Fill 0 for missing investors in previous rounds
      Object.values(investorDatasetsMap).forEach((dataset) => {
        while (dataset.data.length < labels.length) dataset.data.push(0);
      });
    });

    const datasets = [
      {
        label: "Founders",
        data: founderData.map((v) => parseFloat(v)),
        backgroundColor: "#081828",
      },
      ...Object.values(investorDatasetsMap),
    ];

    return res.status(200).json({
      labels,
      datasets,
      message: "Dilution forecast generated successfully",
    });
  });
};

// Helper function to assign colors to different share classes
function getColorForShareClass(shareClass) {
  const colors = {
    Equity: "#1e40af",
    Preferred: "#dc2626",
    Common: "#059669",
    Convertible: "#7c3aed",
    SAFE: "#ea580c",
  };
  return colors[shareClass] || "#6b7280";
}
exports.getShareholder = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    return res.status(400).json({ error: "company_id is required" });
  }

  // Get the latest active round
  const query = `
    SELECT r.id AS round_id, r.issuedshares
    FROM roundrecord r
    WHERE r.company_id = ? AND r.roundStatus = 'ACTIVE'
    ORDER BY r.id DESC
    LIMIT 1
  `;

  db.query(query, [company_id], (err, rounds) => {
    if (err) {
      return res.status(500).json({ error: "DB query error", details: err });
    }

    if (!rounds.length) {
      return res.status(200).json({
        shareholders: {
          labels: ["Company (Founders)"],
          data: [100],
          colors: ["#081828"],
        },
        metadata: {
          totalShares: 0,
          companyShares: 0,
          totalInvestorShares: 0,
        },
      });
    }

    const round = rounds[0];
    const issuedShares = parseFloat(round.issuedshares || 0);
    const investorShareMap = {};
    let totalInvestorShares = 0;

    // Fetch all investors with their names
    const investorQuery = `
      SELECT irc.investor_id, irc.shares, ii.first_name, ii.last_name
      FROM investorrequest_company irc
      JOIN investor_information ii
        ON irc.investor_id = ii.id
      WHERE irc.roundrecord_id = ? AND irc.request_confirm = 'Yes'
    `;

    db.query(investorQuery, [round.round_id], (err2, investors) => {
      if (err2) {
        return res
          .status(500)
          .json({ error: "Investor query error", details: err2 });
      }

      investors.forEach((inv) => {
        const shares = parseFloat(inv.shares || 0);
        const investorName = `${inv.first_name} ${inv.last_name}`;
        if (!investorShareMap[investorName]) investorShareMap[investorName] = 0;
        investorShareMap[investorName] += shares;
        totalInvestorShares += shares;
      });

      const companyShares = issuedShares - totalInvestorShares;

      // Prepare chart data
      const shareholderLabels = ["Company (Founders)"];
      const shareholderData = [companyShares];
      const shareholderColors = ["#081828"];
      const colorPalette = [
        "#1e40af",
        "#dc2626",
        "#059669",
        "#7c3aed",
        "#ea580c",
      ];
      let colorIndex = 0;

      Object.entries(investorShareMap).forEach(([investorName, shares]) => {
        shareholderLabels.push(investorName);
        shareholderData.push(shares);
        shareholderColors.push(colorPalette[colorIndex] || "#000000");
        colorIndex++;
      });

      // Convert to percentage
      const totalShares = issuedShares;
      const shareholderDataPercent = shareholderData.map((s) =>
        ((s / totalShares) * 100).toFixed(2)
      );

      return res.status(200).json({
        shareholders: {
          labels: shareholderLabels,
          data: shareholderDataPercent,
          colors: shareholderColors,
        },
        metadata: {
          totalShares,
          companyShares,
          totalInvestorShares,
        },
      });
    });
  });
};

exports.getTotalinvestor = (req, res) => {
  const company_id = req.body.company_id;

  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT * from company_investor where company_id  =?`,
    [company_id],
    (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      return res.status(200).json({
        results: results,
      });
    }
  );
};
exports.getTotalinvestorcontact = (req, res) => {
  const company_id = req.body.company_id;

  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT company_investor.* from company_investor JOIN investor_information ON investor_information.id = company_investor.investor_id where company_investor.company_id  =? And investor_information.is_register = ?`,
    [company_id, "Yes"],
    (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      return res.status(200).json({
        results: results,
      });
    }
  );
};
exports.getinvestorreportLogs = (req, res) => {
  const company_id = req.body.company_id;

  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT investor_information.first_name,investor_information.last_name,sharereport.*,investor_updates.document_name from  sharereport join investor_updates on investor_updates.id = sharereport.investor_updates_id join investor_information on investor_information.id = sharereport.investor_id where sharereport.company_id  =? And sharereport.report_type =? AND sharereport.date_view IS NOT NULL order by sharereport.date_view desc Limit 10`,
    [company_id, "Investor updates"],
    (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      return res.status(200).json({
        results: results,
      });
    }
  );
};

exports.getinvestorDatarromreportLogs = (req, res) => {
  const company_id = req.body.company_id;

  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT investor_information.first_name,investor_information.last_name,sharereport.*,investor_updates.document_name from  sharereport join investor_updates on investor_updates.id = sharereport.investor_updates_id join investor_information on investor_information.id = sharereport.investor_id where sharereport.company_id  =? And sharereport.report_type =? AND sharereport.date_view IS NOT NULL order by sharereport.date_view desc Limit 10`,
    [company_id, "Due Diligence Document"],
    (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      return res.status(200).json({
        results: results,
      });
    }
  );
};
exports.getrecentuploadFile = (req, res) => {
  const company_id = req.body.company_id;

  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT dataroomdocuments.*,dataroomsub_categories.name from dataroomdocuments JOIN dataroomsub_categories On dataroomsub_categories.id = dataroomdocuments.category_id where dataroomdocuments.company_id = ? order by dataroomdocuments.id desc limit 10`,
    [company_id, "Due Diligence Document"],
    (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      return res.status(200).json({
        results: results,
      });
    }
  );
};
exports.getSignatoryActivity = (req, res) => {
  const user_id = req.body.user_id;
  const companyId = req.body.companyId;
  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT * from company_signatories where user_id = ? And access_status = ? And company_id = ? order by accepted_at desc limit 10`,
    [user_id, "active", companyId],
    (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      return res.status(200).json({
        results: results,
      });
    }
  );
};
exports.getCompanyAccess = (req, res) => {
  var company_id = req.body.company_id;
  var user_id = req.body.user_id;
  db.query(
    `SELECT cs.*, c.company_name
     FROM users cs 
     JOIN company c ON cs.id = c.user_id 
     WHERE c.id = ? AND c.user_id = ?`,
    [company_id, user_id],
    async (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      if (results.length === 0) {
        return res.status(200).json({
          message: "Invalid Access",
          status: "2",
        });
      }

      res.status(200).json({
        message: "Login successful",

        status: "1",
        user: {
          id: results[0].id,
          email: results[0].email,
          role: "owner",
          companies: [
            {
              id: company_id,
              name: results[0].company_name,
            },
          ],
        },
      });
    }
  );
};
exports.getInvestorRequestCompanyInvest = (req, res) => {
  var company_id = req.body.company_id;

  db.query(
    `SELECT access_logs_investor.*,investor_information.first_name,investor_information.last_name from access_logs_investor join investor_information on investor_information.id = access_logs_investor.investor_id where access_logs_investor.company_id = ? order by access_logs_investor.id limit 10`,
    [company_id],
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
};
exports.getCompanyOptionPoolLastestValuation = (req, res) => {
  var company_id = req.body.company_id;

  if (!company_id) {
    return res.status(400).json({
      success: false,
      message: "Company ID is required",
    });
  }

  // 1. Get Latest Valuation from most recent round
  db.query(
    `
        SELECT 
            rr.roundsize,
            rr.issuedshares,
            rr.currency,
            rr.dateroundclosed,
            rr.nameOfRound,
            (CAST(rr.roundsize AS DECIMAL(15,2)) / CAST(rr.issuedshares AS DECIMAL(15,2))) AS price_per_share
        FROM roundrecord rr 
        WHERE rr.company_id = ? 
        AND rr.roundsize IS NOT NULL 
        AND rr.issuedshares IS NOT NULL
        AND rr.roundsize != ''
        AND rr.issuedshares != '' And rr.roundStatus = ?
        ORDER BY rr.dateroundclosed DESC, rr.id DESC 
        LIMIT 1
    `,
    [company_id, "ACTIVE"],
    (err, latestRound) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Database query error",
          error: err.message,
        });
      }

      // 2. Get Total Company Shares
      db.query(
        `
            SELECT 
                SUM(CAST(issuedshares AS DECIMAL(15,2))) as total_company_shares
            FROM roundrecord 
            WHERE company_id = ? 
            AND issuedshares IS NOT NULL 
            AND issuedshares != ''
        `,
        [company_id],
        (err, totalShares) => {
          if (err) {
            return res.status(500).json({
              success: false,
              message: "Database query error",
              error: err.message,
            });
          }

          // 3. Get Option Pool Information
          db.query(
            `
                SELECT 
                    SUM(CAST(issuedshares AS DECIMAL(15,2))) as option_pool_shares
                FROM roundrecord 
                WHERE company_id = ? 
                AND (
                    LOWER(shareClassType) LIKE '%option%' 
                    OR LOWER(shareClassType) LIKE '%employee%'
                    OR LOWER(nameOfRound) LIKE '%option%'
                    OR LOWER(nameOfRound) LIKE '%employee%'
                    OR LOWER(nameOfRound) LIKE '%esop%'
                )
            `,
            [company_id],
            (err, optionPoolShares) => {
              if (err) {
                return res.status(500).json({
                  success: false,
                  message: "Database query error",
                  error: err.message,
                });
              }

              // 4. Get Allocated Option Pool
              db.query(
                `
                    SELECT 
                        SUM(CAST(irc.shares AS DECIMAL(15,2))) as allocated_option_shares
                    FROM investorrequest_company irc
                    JOIN roundrecord rr ON irc.roundrecord_id = rr.id
                    WHERE irc.company_id = ?
                    AND (
                        LOWER(rr.shareClassType) LIKE '%option%' 
                        OR LOWER(rr.shareClassType) LIKE '%employee%'
                        OR LOWER(rr.nameOfRound) LIKE '%option%'
                        OR LOWER(rr.nameOfRound) LIKE '%employee%'
                        OR LOWER(rr.nameOfRound) LIKE '%esop%'
                    )
                `,
                [company_id],
                (err, allocatedOptions) => {
                  if (err) {
                    return res.status(500).json({
                      success: false,
                      message: "Database query error",
                      error: err.message,
                    });
                  }

                  // Calculate results
                  let latestValuation = null;
                  let pricePerShare = null;

                  if (
                    latestRound.length > 0 &&
                    latestRound[0].price_per_share
                  ) {
                    pricePerShare = parseFloat(latestRound[0].price_per_share);
                    const totalCompanyShares =
                      totalShares[0]?.total_company_shares || 0;

                    if (totalCompanyShares > 0 && pricePerShare > 0) {
                      latestValuation = totalCompanyShares * pricePerShare;
                    }
                  }

                  // Option Pool Calculations
                  const optionPoolTotalShares =
                    optionPoolShares[0]?.option_pool_shares || 0;
                  const allocatedOptionShares =
                    allocatedOptions[0]?.allocated_option_shares || 0;
                  const availableOptionShares =
                    optionPoolTotalShares - allocatedOptionShares;

                  const totalCompanyShares =
                    totalShares[0]?.total_company_shares || 0;
                  const optionPoolPercentage =
                    totalCompanyShares > 0
                      ? (
                          (optionPoolTotalShares / totalCompanyShares) *
                          100
                        ).toFixed(2)
                      : 0;

                  const allocatedPercentage =
                    totalCompanyShares > 0
                      ? (
                          (allocatedOptionShares / totalCompanyShares) *
                          100
                        ).toFixed(2)
                      : 0;

                  const availablePercentage =
                    totalCompanyShares > 0
                      ? (
                          (availableOptionShares / totalCompanyShares) *
                          100
                        ).toFixed(2)
                      : 0;

                  // Response
                  return res.status(200).json({
                    success: true,
                    data: {
                      latest_valuation: {
                        valuation_amount: latestValuation,
                        currency: latestRound[0]?.currency || "USD",
                        price_per_share: pricePerShare,
                        based_on_round: latestRound[0]?.nameOfRound || null,
                        round_date: latestRound[0]?.dateroundclosed || null,
                        total_company_shares: totalCompanyShares,
                      },
                      option_pool: {
                        total_option_pool_shares: optionPoolTotalShares,
                        total_option_pool_percentage:
                          parseFloat(optionPoolPercentage),
                        allocated_shares: allocatedOptionShares,
                        allocated_percentage: parseFloat(allocatedPercentage),
                        available_shares: availableOptionShares,
                        available_percentage: parseFloat(availablePercentage),
                      },
                      summary: {
                        company_id: company_id,
                        total_company_shares: totalCompanyShares,
                        latest_valuation: latestValuation,
                        option_pool_percentage:
                          parseFloat(optionPoolPercentage),
                      },
                    },
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
