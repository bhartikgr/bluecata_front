const db = require("../../db");
const nodemailer = require("nodemailer");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const { format } = require("date-fns");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const crypto = require("crypto");
const pdfParse = require("pdf-parse");

require("dotenv").config();
const JWT_SECRET = process.env.JWT_SECRET;
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
exports.getBasicVsFullyDilutedOwnership = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    return res.status(400).json({ error: "company_id is required" });
  }

  const query = `
    SELECT 
      r.id AS round_id,
      r.issuedshares,
      r.shareClassType,
      r.shareclassother,
      r.instrumentType,
      r.instrument_type_data,
      r.created_at,
      irc.shares AS investor_shares,
      irc.investment_amount
    FROM roundrecord r
    LEFT JOIN investorrequest_company irc 
      ON r.id = irc.roundrecord_id AND irc.request_confirm = 'Yes'
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
      return res.status(200).json({
        labels: ["Basic Ownership", "Fully Diluted"],
        datasets: [
          { label: "Founders", data: [100, 100], backgroundColor: "#081828" },
        ],
      });
    }

    // Group by rounds
    const roundsMap = {};
    rows.forEach((row) => {
      if (!roundsMap[row.round_id]) {
        let instrumentData = {};
        try {
          if (row.instrument_type_data)
            instrumentData = JSON.parse(row.instrument_type_data);
        } catch (e) {
          instrumentData = {};
        }

        roundsMap[row.round_id] = {
          issuedShares: parseFloat(row.issuedshares || 0),
          instrumentType: row.instrumentType || "Common Stock",
          instrumentData: instrumentData,
          investors: [],
          created_at: row.created_at,
        };
      }

      if (row.investor_shares) {
        const label =
          row.shareClassType !== "OTHER"
            ? row.shareClassType
            : row.shareclassother || "Other";

        roundsMap[row.round_id].investors.push({
          label,
          shares: parseFloat(row.investor_shares || 0),
          investmentAmount: parseFloat(row.investment_amount || 0),
        });
      }
    });

    const rounds = Object.values(roundsMap).sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );

    // Calculate basic and fully diluted shares
    const basicShares = {};
    const fullyDilutedShares = {};
    let basicTotalShares = 0;
    let fullyDilutedTotalShares = 0;

    rounds.forEach((round) => {
      const roundIssued = round.issuedShares;
      basicTotalShares += roundIssued;
      fullyDilutedTotalShares += roundIssued;

      let totalInvestorShares = 0;

      // Investors by shareClassType / shareclassother
      round.investors.forEach((inv) => {
        totalInvestorShares += inv.shares;

        basicShares[inv.label] = (basicShares[inv.label] || 0) + inv.shares;
        fullyDilutedShares[inv.label] =
          (fullyDilutedShares[inv.label] || 0) + inv.shares;
      });

      // Founder shares
      const founderShares = roundIssued - totalInvestorShares;
      basicShares["Founders"] = (basicShares["Founders"] || 0) + founderShares;
      fullyDilutedShares["Founders"] =
        (fullyDilutedShares["Founders"] || 0) + founderShares;

      // Include warrants/options dynamically
      const warrants = parseFloat(round.instrumentData.warrantShares || 0);
      if (warrants > 0) {
        fullyDilutedShares["Option Pool"] =
          (fullyDilutedShares["Option Pool"] || 0) + warrants;
        fullyDilutedTotalShares += warrants;
      }
    });

    // Build datasets
    const stakeholders = new Set([
      ...Object.keys(basicShares),
      ...Object.keys(fullyDilutedShares),
    ]);
    const datasets = [];
    const colorPalette = [
      "#1e40af",
      "#dc2626",
      "#059669",
      "#7c3aed",
      "#ea580c",
      "#f59e0b",
      "#10b981",
      "#6366f1",
      "#ec4899",
      "#8b5cf6",
      "#081828",
    ];
    let colorIndex = 0;

    stakeholders.forEach((name) => {
      const basicPercent =
        basicTotalShares > 0
          ? (((basicShares[name] || 0) / basicTotalShares) * 100).toFixed(2)
          : 0;
      const fullyPercent =
        fullyDilutedTotalShares > 0
          ? (
              ((fullyDilutedShares[name] || 0) / fullyDilutedTotalShares) *
              100
            ).toFixed(2)
          : 0;

      datasets.push({
        label: name,
        data: [parseFloat(basicPercent), parseFloat(fullyPercent)],
        backgroundColor: colorPalette[colorIndex % colorPalette.length],
        borderColor: colorPalette[colorIndex % colorPalette.length],
        borderWidth: 1,
      });
      colorIndex++;
    });

    return res.status(200).json({
      labels: ["Basic Ownership", "Fully Diluted"],
      datasets,
      metadata: {
        basicTotalShares: Math.round(basicTotalShares),
        fullyDilutedTotalShares: Math.round(fullyDilutedTotalShares),
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

    const roundIds = rounds.map((r) => r.round_id);
    const placeholders = roundIds.map(() => "?").join(",");
    const investorQuery = `
      SELECT irc.investor_id, irc.shares AS issued_shares, irc.investment_amount, irc.roundrecord_id
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

      const response = rounds.map((round) => {
        const totalRoundShares = parseFloat(round.issuedshares || 0);
        const roundSize = parseFloat(round.roundsize || 0);

        const investorsInRound = investorData.filter(
          (inv) => inv.roundrecord_id === round.round_id
        );

        const pricePerShare =
          totalRoundShares > 0 ? roundSize / totalRoundShares : 0;

        const investors = investorsInRound.map((inv) => {
          let issuedShares = parseFloat(inv.issued_shares || 0);

          // Agar issued_shares 0 hai to investment_amount se calculate karo
          if (
            issuedShares === 0 &&
            inv.investment_amount > 0 &&
            pricePerShare > 0
          ) {
            issuedShares = inv.investment_amount / pricePerShare;
          }

          const stakePercent =
            totalRoundShares +
              investorsInRound.reduce(
                (sum, i) =>
                  sum +
                  (parseFloat(i.issued_shares || 0) === 0 &&
                  i.investment_amount > 0
                    ? i.investment_amount / pricePerShare
                    : parseFloat(i.issued_shares || 0)),
                0
              ) >
            0
              ? (issuedShares /
                  (totalRoundShares +
                    investorsInRound.reduce(
                      (sum, i) =>
                        sum +
                        (parseFloat(i.issued_shares || 0) === 0 &&
                        i.investment_amount > 0
                          ? i.investment_amount / pricePerShare
                          : parseFloat(i.issued_shares || 0)),
                      0
                    ))) *
                100
              : 0;

          const postMoneyValuation =
            stakePercent > 0 ? (roundSize * 100) / stakePercent : 0;
          const preMoneyValuation = postMoneyValuation - roundSize;

          return {
            investor_id: inv.investor_id,
            issued_shares: parseFloat(issuedShares.toFixed(2)),
            stake_percent: parseFloat(stakePercent.toFixed(2)),
            post_money_valuation: parseFloat(postMoneyValuation.toFixed(2)),
            pre_money_valuation: parseFloat(preMoneyValuation.toFixed(2)),
          };
        });

        // Founder shares = total issued - sum of investor shares
        const totalInvestorShares = investors.reduce(
          (sum, i) => sum + i.issued_shares,
          0
        );
        const founderShares = totalRoundShares - totalInvestorShares;
        const founderPercent =
          totalRoundShares > 0 ? (founderShares / totalRoundShares) * 100 : 0;

        return {
          round_id: round.round_id,
          round_name: round.nameOfRound,
          total_issued_shares: totalRoundShares,
          round_size: roundSize,
          founder_shares: parseFloat(founderShares.toFixed(2)),
          founder_percent: parseFloat(founderPercent.toFixed(2)),
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
      r.shareclassother,
      r.issuedshares,
      r.roundsize,
      r.instrumentType,
      r.instrument_type_data,
      r.created_at,
      irc.investor_id,
      irc.shares AS investor_shares,
      irc.investment_amount,
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
      return res.status(500).json({
        error: "Database query error",
        details: err,
      });
    }

    if (!rows.length) {
      return res.status(200).json({
        labels: [],
        datasets: [],
        message: "No active rounds found",
      });
    }

    // Group data by rounds
    const roundsMap = {};
    rows.forEach((row) => {
      if (!roundsMap[row.round_id]) {
        const shareClassName =
          row.shareClassType !== "OTHER"
            ? row.shareClassType
            : row.shareclassother || "Common";

        // Parse instrument data
        let instrumentData = {};
        try {
          if (row.instrument_type_data) {
            instrumentData = JSON.parse(row.instrument_type_data);
          }
        } catch (e) {
          console.error("Failed to parse instrument_type_data:", e);
          instrumentData = {};
        }

        roundsMap[row.round_id] = {
          id: row.round_id,
          name: shareClassName, // <-- Use shareClassType / shareclassother
          issuedShares: parseFloat(row.issuedshares || 0),
          roundSize: parseFloat(row.roundsize || 0),
          instrumentType: row.instrumentType || "Common Stock",
          instrumentData: instrumentData,
          investors: [],
          created_at: row.created_at,
        };
      }

      if (row.investor_id && row.investor_shares) {
        roundsMap[row.round_id].investors.push({
          id: row.investor_id,
          name:
            `${row.first_name || ""} ${row.last_name || ""}`.trim() ||
            `Investor ${row.investor_id}`,
          shares: parseFloat(row.investor_shares || 0),
          investmentAmount: parseFloat(row.investment_amount || 0),
        });
      }
    });

    const rounds = Object.values(roundsMap).sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );

    // Cumulative dilution calculation
    const labels = [];
    const colorPalette = [
      "#1e40af",
      "#dc2626",
      "#059669",
      "#7c3aed",
      "#ea580c",
      "#f59e0b",
      "#10b981",
      "#6366f1",
      "#ec4899",
      "#8b5cf6",
    ];

    let cumulativeTotalShares = 0;
    const stakeholderShares = {}; // name -> shares
    const founderData = [];
    const investorDatasetsMap = {};
    let colorIndex = 0;

    const pendingConversions = { safes: [], convertibleNotes: [] };
    const allStakeholders = new Set();
    allStakeholders.add("Founders");

    rounds.forEach((round, roundIndex) => {
      labels.push(round.name);

      let additionalSharesFromConversions = 0;
      let totalInvestorSharesThisRound = 0;

      // Price per share calculation
      let pricePerShare = 0;
      if (round.roundSize > 0 && round.issuedShares > 0) {
        pricePerShare = round.roundSize / round.issuedShares;
      } else if (
        round.instrumentData.common_stock_valuation &&
        cumulativeTotalShares > 0
      ) {
        pricePerShare =
          parseFloat(round.instrumentData.common_stock_valuation) /
          cumulativeTotalShares;
      } else if (
        round.instrumentData.preferred_valuation &&
        cumulativeTotalShares > 0
      ) {
        pricePerShare =
          parseFloat(round.instrumentData.preferred_valuation) /
          cumulativeTotalShares;
      }

      // Handle instrument types
      switch (round.instrumentType) {
        case "Safe":
          round.investors.forEach((inv) => {
            pendingConversions.safes.push({
              investorName: round.name, // <-- Use shareClassType as name
              amount: inv.investmentAmount,
              valuationCap: parseFloat(round.instrumentData.valuationCap || 0),
              discountRate: parseFloat(round.instrumentData.discountRate || 0),
              safeType: round.instrumentData.safeType || "POST_MONEY",
              roundId: round.id,
            });
          });
          break;

        case "Convertible Note":
          round.investors.forEach((inv) => {
            const principal = inv.investmentAmount;
            const interestRate =
              parseFloat(round.instrumentData.interestRate_note || 0) / 100;
            const totalAmount = principal + principal * interestRate;
            pendingConversions.convertibleNotes.push({
              investorName: round.name,
              principalPlusInterest: totalAmount,
              discountRate: parseFloat(
                round.instrumentData.discountRate_note || 0
              ),
              valuationCap: parseFloat(
                round.instrumentData.valuationCap_note || 0
              ),
              roundId: round.id,
            });
          });
          break;

        case "Common Stock":
        case "Preferred Equity":
        default:
          // Convert pending SAFEs
          if (pendingConversions.safes.length > 0 && pricePerShare > 0) {
            pendingConversions.safes.forEach((safe) => {
              let conversionPrice = pricePerShare;
              if (safe.valuationCap > 0 && cumulativeTotalShares > 0) {
                conversionPrice = Math.min(
                  conversionPrice,
                  safe.valuationCap / cumulativeTotalShares
                );
              }
              if (safe.discountRate > 0) {
                conversionPrice = Math.min(
                  conversionPrice,
                  pricePerShare * (1 - safe.discountRate / 100)
                );
              }
              if (conversionPrice > 0) {
                const sharesIssued = safe.amount / conversionPrice;
                additionalSharesFromConversions += sharesIssued;
                stakeholderShares[safe.investorName] =
                  (stakeholderShares[safe.investorName] || 0) + sharesIssued;
                allStakeholders.add(safe.investorName);
              }
            });
            pendingConversions.safes = [];
          }

          // Convert pending Notes
          if (
            pendingConversions.convertibleNotes.length > 0 &&
            pricePerShare > 0
          ) {
            pendingConversions.convertibleNotes.forEach((note) => {
              let conversionPrice = pricePerShare;
              if (note.valuationCap > 0 && cumulativeTotalShares > 0) {
                conversionPrice = Math.min(
                  conversionPrice,
                  note.valuationCap / cumulativeTotalShares
                );
              }
              if (note.discountRate > 0) {
                conversionPrice = Math.min(
                  conversionPrice,
                  pricePerShare * (1 - note.discountRate / 100)
                );
              }
              if (conversionPrice > 0) {
                const sharesIssued =
                  note.principalPlusInterest / conversionPrice;
                additionalSharesFromConversions += sharesIssued;
                stakeholderShares[note.investorName] =
                  (stakeholderShares[note.investorName] || 0) + sharesIssued;
                allStakeholders.add(note.investorName);
              }
            });
            pendingConversions.convertibleNotes = [];
          }

          // Add equity investors in this round
          round.investors.forEach((inv) => {
            totalInvestorSharesThisRound += inv.shares;
            stakeholderShares[round.name] =
              (stakeholderShares[round.name] || 0) + inv.shares;
            allStakeholders.add(round.name);
          });
          break;
      }

      cumulativeTotalShares +=
        round.issuedShares + additionalSharesFromConversions;

      const founderSharesThisRound =
        round.issuedShares - totalInvestorSharesThisRound;
      stakeholderShares["Founders"] =
        (stakeholderShares["Founders"] || 0) + founderSharesThisRound;

      // Initialize datasets for investors
      allStakeholders.forEach((stakeholder) => {
        if (stakeholder !== "Founders" && !investorDatasetsMap[stakeholder]) {
          investorDatasetsMap[stakeholder] = {
            label: stakeholder,
            data: [],
            backgroundColor: colorPalette[colorIndex % colorPalette.length],
          };
          colorIndex++;
          for (let i = 0; i < roundIndex; i++)
            investorDatasetsMap[stakeholder].data.push(0);
        }
      });

      // Calculate percentages
      if (cumulativeTotalShares > 0) {
        founderData.push(
          parseFloat(
            (
              (stakeholderShares["Founders"] / cumulativeTotalShares) *
              100
            ).toFixed(2)
          )
        );
        Object.keys(investorDatasetsMap).forEach((stakeholder) => {
          const percent = parseFloat(
            (
              (stakeholderShares[stakeholder] / cumulativeTotalShares) *
              100
            ).toFixed(2)
          );
          investorDatasetsMap[stakeholder].data.push(percent);
        });
      } else {
        founderData.push(0);
        Object.keys(investorDatasetsMap).forEach((stakeholder) =>
          investorDatasetsMap[stakeholder].data.push(0)
        );
      }
    });

    const datasets = [
      {
        label: "Founders",
        data: founderData,
        backgroundColor: "#081828",
        borderColor: "#081828",
        borderWidth: 1,
      },
      ...Object.values(investorDatasetsMap).map((ds) => ({
        ...ds,
        borderColor: ds.backgroundColor,
        borderWidth: 1,
      })),
    ];

    return res.status(200).json({
      labels,
      datasets,
      totalShares: Math.round(cumulativeTotalShares),
      pendingSafes: pendingConversions.safes.length,
      pendingNotes: pendingConversions.convertibleNotes.length,
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

  // Fetch ALL active rounds with their investors (cumulative approach)
  const query = `
    SELECT 
      r.id AS round_id,
      r.issuedshares,
      r.shareClassType,
      r.shareclassother,
      r.created_at,
      irc.investor_id,
      irc.shares AS investor_shares
    FROM roundrecord r
    LEFT JOIN investorrequest_company irc 
      ON r.id = irc.roundrecord_id AND irc.request_confirm = 'Yes'
    WHERE r.company_id = ? 
      AND r.roundStatus = 'ACTIVE'
    ORDER BY r.created_at ASC, r.id ASC
  `;

  db.query(query, [company_id], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        error: "Database query error",
        details: err,
      });
    }

    if (!rows.length) {
      return res.status(200).json({
        shareholders: {
          labels: ["Founders"],
          data: [100],
          colors: ["#081828"],
        },
        ownershipTable: [
          {
            stakeholder: "Founders",
            shares: 0,
            percentage: 100.0,
            securityType: "Common",
            color: "#081828",
          },
        ],
        metadata: {
          totalShares: 0,
          founderShares: 0,
          totalInvestorShares: 0,
        },
      });
    }

    let cumulativeTotalShares = 0;
    const stakeholderDetails = {}; // stakeholder_name -> { shares, securityType }

    const roundsMap = {};
    rows.forEach((row) => {
      if (!roundsMap[row.round_id]) {
        const securityType =
          row.shareClassType !== "OTHER"
            ? row.shareClassType
            : row.shareclassother || "Common";

        roundsMap[row.round_id] = {
          issuedShares: parseFloat(row.issuedshares || 0),
          securityType,
          investors: [],
        };
      }

      if (row.investor_shares) {
        const investorLabel =
          row.shareClassType !== "OTHER"
            ? row.shareClassType
            : row.shareclassother || "Other";

        roundsMap[row.round_id].investors.push({
          label: investorLabel,
          shares: parseFloat(row.investor_shares || 0),
        });
      }
    });

    const rounds = Object.values(roundsMap);

    rounds.forEach((round) => {
      cumulativeTotalShares += round.issuedShares;

      let totalInvestorSharesThisRound = 0;
      round.investors.forEach((inv) => {
        if (!stakeholderDetails[inv.label]) {
          stakeholderDetails[inv.label] = {
            shares: 0,
            securityType: round.securityType,
          };
        }
        stakeholderDetails[inv.label].shares += inv.shares;
        totalInvestorSharesThisRound += inv.shares;
      });

      const founderSharesThisRound =
        round.issuedShares - totalInvestorSharesThisRound;
      if (!stakeholderDetails["Founders"]) {
        stakeholderDetails["Founders"] = {
          shares: 0,
          securityType: "Common",
        };
      }
      stakeholderDetails["Founders"].shares += founderSharesThisRound;
    });

    const totalInvestorShares = Object.entries(stakeholderDetails)
      .filter(([name]) => name !== "Founders")
      .reduce((sum, [_, data]) => sum + data.shares, 0);

    const founderShares = stakeholderDetails["Founders"]?.shares || 0;

    const shareholderLabels = [];
    const shareholderData = [];
    const shareholderColors = [];
    const ownershipTable = [];

    const colorPalette = [
      "#1e40af",
      "#dc2626",
      "#059669",
      "#7c3aed",
      "#ea580c",
      "#f59e0b",
      "#10b981",
      "#6366f1",
      "#ec4899",
      "#8b5cf6",
    ];

    if (founderShares > 0) {
      const founderPercent = (
        (founderShares / cumulativeTotalShares) *
        100
      ).toFixed(2);
      shareholderLabels.push("Founders");
      shareholderData.push(parseFloat(founderPercent));
      shareholderColors.push("#081828");

      ownershipTable.push({
        stakeholder: "Founders",
        shares: Math.round(founderShares),
        percentage: parseFloat(founderPercent),
        securityType: "Common",
        color: "#081828",
      });
    }

    let colorIndex = 0;
    Object.entries(stakeholderDetails)
      .filter(([name]) => name !== "Founders")
      .sort((a, b) => b[1].shares - a[1].shares)
      .forEach(([name, data]) => {
        if (data.shares > 0) {
          const percent = ((data.shares / cumulativeTotalShares) * 100).toFixed(
            2
          );
          const color = colorPalette[colorIndex % colorPalette.length];

          shareholderLabels.push(name);
          shareholderData.push(parseFloat(percent));
          shareholderColors.push(color);

          ownershipTable.push({
            stakeholder: name,
            shares: Math.round(data.shares),
            percentage: parseFloat(percent),
            securityType: data.securityType,
            color,
          });

          colorIndex++;
        }
      });

    return res.status(200).json({
      shareholders: {
        labels: shareholderLabels,
        data: shareholderData,
        colors: shareholderColors,
      },
      ownershipTable,
      metadata: {
        totalShares: Math.round(cumulativeTotalShares),
        founderShares: Math.round(founderShares),
        totalInvestorShares: Math.round(totalInvestorShares),
      },
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
exports.getCompanyAccess = async (req, res) => {
  try {
    const { company_id, user_id } = req.body;

    if (!company_id || !user_id) {
      return res.status(400).json({
        message: "Company ID and User ID are required",
        status: "0",
      });
    }

    // 🔹 Step 1: Check if user exists
    const [userResults] = await db
      .promise()
      .query("SELECT * FROM users WHERE id = ?", [user_id]);

    if (userResults.length === 0) {
      return res.status(200).json({
        message: "Invalid User",
        status: "2",
      });
    }

    const user = userResults[0];

    // 🔹 Step 2: Check if company exists and belongs to this user
    const [companyResults] = await db
      .promise()
      .query(
        "SELECT id AS company_id, company_name FROM company WHERE id = ? AND user_id = ?",
        [company_id, user_id]
      );

    if (companyResults.length === 0) {
      return res.status(200).json({
        message: "Invalid Company or No Permission",
        status: "2",
      });
    }

    const company = companyResults[0];

    // 🔹 Step 3: Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, company_id: company.company_id },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    // 🔹 Step 4: Return response
    res.status(200).json({
      message: "Login successful",
      status: "1",
      token,
      user: {
        id: user.id,
        email: user.email,
        role: "owner",
        companies: [
          {
            id: company.company_id,
            name: company.company_name,
          },
        ],
      },
    });
  } catch (err) {
    console.error("Error in getCompanyAccess:", err);
    res.status(500).json({
      message: "Internal Server Error",
      status: "0",
      error: err.message,
    });
  }
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

exports.getCompanyName = async (req, res) => {
  try {
    const company_id = req.body.company_id;

    db.query(
      "SELECT * from company where id = ?",
      [company_id],
      async (err, row) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        return res.status(200).json({
          message: "",
          results: row,
        });
      }
    );
    // Hash the password
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};
