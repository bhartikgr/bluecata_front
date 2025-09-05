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
  var user_id = req.body.user_id;
  db.query(
    "SELECT * FROM company where id = ?",
    [user_id],
    async (err, row) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      res.status(200).json({
        message: "",
        results: row,
      });
    }
  );
};

exports.getCompanystokes = (req, res) => {
  const user_id = req.body.user_id;

  // 1️⃣ Get base company shares
  const companyQuery = "SELECT company_shares FROM company WHERE id = ?";
  db.query(companyQuery, [user_id], (err, companyShares) => {
    if (err) {
      console.error("Error fetching company shares:", err);
      return res.status(500).json({ success: false, message: "Server Error" });
    }

    const existingShares =
      companyShares.length > 0 ? parseInt(companyShares[0].company_shares) : 0;

    // 2️⃣ Get issued shares per investor + round info
    const investorQuery = `
      SELECT ci.investor_id, rr.issuedshares, rr.nameOfRound, rr.roundsize
      FROM company_shares_investment ci
      JOIN roundrecord rr ON ci.roundrecord_id = rr.id
      WHERE ci.user_id = ?
      ORDER BY rr.id ASC
    `;

    db.query(investorQuery, [user_id], (err, investorData) => {
      if (err) {
        console.error("Error fetching investor data:", err);
        return res
          .status(500)
          .json({ success: false, message: "Server Error" });
      }

      // 3️⃣ Calculate total issued shares per round
      const roundTotals = {};
      investorData.forEach((inv) => {
        const issued = parseInt(inv.issuedshares) || 0;
        if (!roundTotals[inv.nameOfRound]) roundTotals[inv.nameOfRound] = 0;
        roundTotals[inv.nameOfRound] += issued;
      });

      // 4️⃣ Map each investor with stake % and valuation
      const response = investorData.map((inv) => {
        const issued = parseInt(inv.issuedshares) || 0;

        // Post-Money Shares = existing + total issued in that round
        const postMoneyShares = existingShares + roundTotals[inv.nameOfRound];

        // Stake % of this investor in the round
        //const stakePercent = (issued / postMoneyShares) * 100;
        const stakePercent = 0;

        // Round size
        const roundSize = parseFloat(inv.roundsize) || 0;

        // Correct Valuation
        const investorDecimal = issued / postMoneyShares; // decimal %
        const postMoneyValuation =
          investorDecimal > 0 ? roundSize / investorDecimal : 0;
        const preMoneyValuation = postMoneyValuation - roundSize;

        return {
          round_name: inv.nameOfRound,
          investor_id: inv.investor_id,
          issued_shares: issued,
          post_money_shares: postMoneyShares,
          stake_percent: parseFloat(stakePercent.toFixed(2)),
          post_money_valuation: parseFloat(postMoneyValuation.toFixed(2)),
          pre_money_valuation: parseFloat(preMoneyValuation.toFixed(2)),
        };
      });

      res.json({ success: true, results: response });
    });
  });
};
exports.getCompanyopenround = (req, res) => {
  const user_id = req.body.user_id;

  // 1️⃣ Get latest open round
  db.query(
    `SELECT * 
     FROM roundrecord 
     WHERE user_id = ? 
       AND LOWER(dateroundclosed) = LOWER(?) 
       AND is_shared = ? 
     ORDER BY id DESC LIMIT 1`,
    [user_id, "round open", "Yes"],
    (err, rows) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }
      if (rows.length === 0) {
        return res.status(404).json({ message: "No open round found" });
      }

      const round = rows[0];
      const roundId = round.id;
      const targetRaise = parseFloat(round.roundsize) || 0;

      // 2️⃣ Raised to Date = sum of issuedshares of this round (via join)
      db.query(
        `SELECT SUM(rr.issuedshares) as raisedToDate
         FROM company_shares_investment ci
         JOIN roundrecord rr ON ci.roundrecord_id = rr.id
         WHERE ci.roundrecord_id = ? AND ci.user_id = ?`,
        [roundId, user_id],
        (err2, investResult) => {
          if (err2) {
            return res
              .status(500)
              .json({ message: "Error fetching investment data", error: err2 });
          }

          const raisedToDate = parseFloat(investResult[0].raisedToDate) || 0;

          // 3️⃣ Fundraising Progress
          const progress =
            targetRaise > 0
              ? ((raisedToDate / targetRaise) * 100).toFixed(2)
              : 0;

          const progresswidth =
            targetRaise > 0 ? (raisedToDate / targetRaise) * 100 : 0;

          // 4️⃣ Expected Close
          const expectedClose = round.dateroundclosed;

          res.status(200).json({
            success: true,
            roundInfo: {
              round_type: round.nameOfRound + " " + round.shareClassType, // e.g. "Series B"
              target_raise: targetRaise, // e.g. 8000000
              raised_to_date: 0, // e.g. 5200000
              expected_close: expectedClose, // e.g. "2023-12-15"
              fundraising_progress: progresswidth + "%", // e.g. "65%"
              progresswidth: progresswidth,
            },
          });
        }
      );
    }
  );
};

exports.getCompanyopenroundUserLog = (req, res) => {
  const user_id = req.body.user_id;

  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT sharerecordround.*,roundrecord.nameOfRound,roundrecord.shareClassType, investor_information.first_name, investor_information.last_name
     FROM sharerecordround
     JOIN investor_information ON investor_information.id = sharerecordround.investor_id
     JOIN roundrecord ON roundrecord.id = sharerecordround.roundrecord_id
     WHERE sharerecordround.user_id = ? 
       AND sharerecordround.access_status IN (?, ?)
     ORDER BY sharerecordround.id DESC`,
    [user_id, "Only View", "Download"],
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
  const { user_id } = req.body;

  db.query(
    `SELECT r.id AS round_id,
            r.nameOfRound,
            r.issuedshares,
            r.shareClassType,
            csi.investor_id
     FROM roundrecord r
     LEFT JOIN company_shares_investment csi 
     ON r.id = csi.roundrecord_id
     WHERE r.user_id = ?
     ORDER BY r.id ASC`,
    [user_id],
    (err, rounds) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ error: "Database query error", details: err });
      }

      if (!rounds.length) {
        return res.status(404).json({ message: "No rounds found" });
      }

      const labels = [];
      const datasetsMap = {};
      let totalSharesSoFar = 0;

      // Group investors by round_id
      const investorsByRound = {};
      for (const round of rounds) {
        if (!investorsByRound[round.round_id])
          investorsByRound[round.round_id] = [];
        if (round.investor_id)
          investorsByRound[round.round_id].push(round.investor_id);
      }

      // Process each round only once
      const processedRounds = {};
      for (const round of rounds) {
        if (processedRounds[round.round_id]) continue; // skip duplicates
        processedRounds[round.round_id] = true;

        const issuedShares = parseInt(round.issuedshares || "0");
        totalSharesSoFar += issuedShares;

        const label = round.shareClassType || "Round";
        if (!labels.includes(label)) labels.push(label);

        const investorsCount = investorsByRound[round.round_id].length;
        const totalStakeholders = 1 + investorsCount; // founder + all investors

        // Founder dataset
        if (!datasetsMap["Founders"]) {
          datasetsMap["Founders"] = {
            label: "Founders",
            data: [],
            backgroundColor: "#081828",
          };
        }
        const founderOwnership = (1 / totalStakeholders) * 100;
        datasetsMap["Founders"].data.push(founderOwnership);

        // Investor dataset
        if (investorsCount > 0) {
          if (!datasetsMap[label]) {
            datasetsMap[label] = {
              label: label,
              data: [],
              backgroundColor: "#092f4e",
            };
          }
          const investorOwnership = (1 / totalStakeholders) * 100;
          // Add same ownership for each investor? For chart we combine into one dataset per round
          datasetsMap[label].data.push(investorOwnership * investorsCount);
        }
      }

      const datasets = Object.values(datasetsMap);

      return res.status(200).json({ labels, datasets });
    }
  );
};
exports.getShareholder = (req, res) => {
  const { user_id, totalcompanyshare } = req.body;
  const totalCompanyShares = parseFloat(totalcompanyshare) || 0;

  db.query(
    `SELECT r.id AS round_id,
            r.nameOfRound,
            r.issuedshares,
            r.shareClassType,
            csi.investor_id
     FROM roundrecord r
     LEFT JOIN company_shares_investment csi
     ON r.id = csi.roundrecord_id
     WHERE r.user_id = ?
     ORDER BY r.id ASC`,
    [user_id],
    (err, rounds) => {
      if (err) return res.status(500).json({ error: err });
      if (!rounds.length)
        return res.status(404).json({ message: "No rounds found" });

      const shareholderLabels = [];
      const shareholderData = [];
      const shareholderColors = [];
      const colorPalette = [
        "#081828",
        "#092f4e",
        "#10395c",
        "#1a588d",
        "#2577bd",
        "#2a85d3",
        "#2a85d3",
      ];

      // Step 1: Group rounds by round_id
      const roundsById = {};
      for (const round of rounds) {
        if (!roundsById[round.round_id]) {
          roundsById[round.round_id] = {
            issuedShares: parseFloat(round.issuedshares || 0),
            shareClassType: round.shareClassType,
            investors: [],
          };
        }
        if (round.investor_id)
          roundsById[round.round_id].investors.push(round.investor_id);
      }

      // Step 2: Calculate total investor shares
      let totalInvestorShares = 0;
      for (const rId in roundsById) {
        const r = roundsById[rId];
        const investorCount = r.investors.length;
        if (investorCount > 0) {
          totalInvestorShares +=
            (r.issuedShares * investorCount) / (investorCount + 1);
        }
      }

      // Step 3: Founder shares = remaining
      const founderShares = totalCompanyShares - totalInvestorShares;
      shareholderLabels.push("Founders");
      shareholderData.push(
        ((founderShares / totalCompanyShares) * 100).toFixed(2)
      );
      shareholderColors.push(colorPalette[0]);

      // Step 4: Investor % per round
      let colorIndex = 1;
      for (const rId in roundsById) {
        const r = roundsById[rId];
        const investorCount = r.investors.length;
        if (investorCount > 0) {
          const investorShares =
            (r.issuedShares * investorCount) / (investorCount + 1);
          shareholderLabels.push(`${r.shareClassType} Investors`);
          shareholderData.push(
            ((investorShares / totalCompanyShares) * 100).toFixed(2)
          );
          shareholderColors.push(colorPalette[colorIndex++] || "#000000");
        }
      }

      // Step 5: Remaining shares for Option Pool & Employees
      const usedShares = founderShares + totalInvestorShares;
      const remainingShares = totalCompanyShares - usedShares;
      if (remainingShares > 0) {
        const optionPoolPercent = (
          ((remainingShares * 0.7) / totalCompanyShares) *
          100
        ).toFixed(2);
        const employeePercent = (
          ((remainingShares * 0.3) / totalCompanyShares) *
          100
        ).toFixed(2);

        shareholderLabels.push("Option Pool");
        shareholderData.push(optionPoolPercent);
        shareholderColors.push(colorPalette[colorIndex++] || "#000000");

        shareholderLabels.push("Employees");
        shareholderData.push(employeePercent);
        shareholderColors.push(colorPalette[colorIndex++] || "#000000");
      }

      return res.status(200).json({
        shareholders: {
          labels: shareholderLabels,
          data: shareholderData,
          colors: shareholderColors,
        },
      });
    }
  );
};

exports.getTotalinvestor = (req, res) => {
  const user_id = req.body.user_id;

  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT * from company_investor where user_id  =?`,
    [user_id],
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
  const user_id = req.body.user_id;

  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT company_investor.* from company_investor JOIN investor_information ON investor_information.id = company_investor.investor_id where company_investor.user_id  =? And investor_information.is_register = ?`,
    [user_id, "Yes"],
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
  const user_id = req.body.user_id;

  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT investor_information.first_name,investor_information.last_name,sharereport.*,investor_updates.document_name from  sharereport join investor_updates on investor_updates.id = sharereport.investor_updates_id join investor_information on investor_information.id = sharereport.investor_id where sharereport.user_id  =? And sharereport.report_type =? AND sharereport.date_view IS NOT NULL order by sharereport.date_view desc Limit 10`,
    [user_id, "Investor updates"],
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
  const user_id = req.body.user_id;

  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT investor_information.first_name,investor_information.last_name,sharereport.*,investor_updates.document_name from  sharereport join investor_updates on investor_updates.id = sharereport.investor_updates_id join investor_information on investor_information.id = sharereport.investor_id where sharereport.user_id  =? And sharereport.report_type =? AND sharereport.date_view IS NOT NULL order by sharereport.date_view desc Limit 10`,
    [user_id, "Due Diligence Document"],
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
  const user_id = req.body.user_id;

  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT dataroomdocuments.*,dataroomsub_categories.name from dataroomdocuments JOIN dataroomsub_categories On dataroomsub_categories.id = dataroomdocuments.category_id where dataroomdocuments.user_id = ? order by dataroomdocuments.id desc limit 10`,
    [user_id, "Due Diligence Document"],
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
