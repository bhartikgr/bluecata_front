const db = require("../../db");
const nodemailer = require("nodemailer");

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
exports.getSignatoryDetails = (req, res) => {
  const { signatory_id, company_id, user_id } = req.body;

  // Step 1: Verify if this user_id is a valid signatory and get email, company_name, access_status
  const verifySignatoryQuery = `
    SELECT cs.signatory_email, cs.access_status, c.company_name
    FROM company_signatories cs
    JOIN company c ON c.id = cs.company_id
    WHERE cs.id = ? AND cs.user_id = ?
  `;

  db.query(
    verifySignatoryQuery,
    [signatory_id, user_id],
    (err, signatoryResult) => {
      if (err)
        return res
          .status(500)
          .json({ error: "DB error while verifying signatory" });

      if (signatoryResult.length === 0) {
        return res
          .status(403)
          .json({ error: "User is not authorized for this signatory" });
      }

      const { signatory_email, access_status, company_name } =
        signatoryResult[0];

      // Step 2: Fetch all meetings for this signatory & company
      const allMeetingsQuery = `
      SELECT * 
      FROM roundrecord 
      WHERE created_by_role = ? AND created_by_id = ? AND company_id = ?
    `;

      const totalDataroomQuery = `
      SELECT COUNT(*) AS total_dataroom_reports 
      FROM investor_updates 
      WHERE created_by_role = 'signatory' AND created_by_id = ? 
      AND type = 'Due Diligence Document' AND company_id = ?
    `;

      const totalInvestorReportingQuery = `
      SELECT COUNT(*) AS total_investor_reporting 
      FROM investor_updates 
      WHERE created_by_role = 'signatory' AND created_by_id = ? 
      AND type = 'Investor updates' AND company_id = ?
    `;

      // ✅ New query: total shared reports
      const totalSharedReportsQuery = `
      SELECT COUNT(*) AS total_shared_reports
      FROM sharereport
      WHERE created_by_role = 'signatory' AND created_by_id = ? AND company_id = ?
    `;

      // Step 3: Execute all queries
      db.query(
        allMeetingsQuery,
        ["signatory", signatory_id, company_id],
        (err, allroundrecord) => {
          if (err)
            return res
              .status(500)
              .json({ error: "DB error while fetching meetings" });

          db.query(
            totalDataroomQuery,
            [signatory_id, company_id],
            (err, dataroomResult) => {
              if (err)
                return res
                  .status(500)
                  .json({ error: "DB error while fetching Dataroom reports" });

              const totalDataroomReports =
                dataroomResult[0]?.total_dataroom_reports || 0;

              db.query(
                totalInvestorReportingQuery,
                [signatory_id, company_id],
                (err, investorResult) => {
                  if (err)
                    return res.status(500).json({
                      error: "DB error while fetching Investor Reporting",
                    });

                  const totalInvestorReporting =
                    investorResult[0]?.total_investor_reporting || 0;

                  db.query(
                    totalSharedReportsQuery,
                    [signatory_id, company_id],
                    (err, sharedResult) => {
                      if (err)
                        return res.status(500).json({
                          error: "DB error while fetching Shared Reports",
                        });

                      const totalSharedReports =
                        sharedResult[0]?.total_shared_reports || 0;

                      // ✅ Final response
                      return res.status(200).json({
                        status: "success",
                        signatory_email,
                        access_status,
                        company_name,
                        total_allroundrecord: allroundrecord.length,
                        total_dataroom_reports: totalDataroomReports,
                        total_investor_reporting: totalInvestorReporting,
                        total_shared_reports: totalSharedReports,
                        allroundrecord,
                      });
                    },
                  );
                },
              );
            },
          );
        },
      );
    },
  );
};

exports.getSignatoryCompanyList = (req, res) => {
  const { user_id, signatory_email } = req.body;

  const query = `
    SELECT 
      c.id AS company_id,
      c.company_name,
      c.company_email,
      c.company_logo,
      c.company_color_code,
      c.phone,
      c.company_street_address,
      cs.id as signatory_id,
      cs.access_status
    FROM company_signatories cs
    JOIN company c ON c.id = cs.company_id
    WHERE cs.user_id = ? AND cs.signatory_email = ?
  `;

  db.query(query, [user_id, signatory_email], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    return res.status(200).json({
      message: "Company list fetched successfully",
      total_companies: results.length,
      companies: results,
    });
  });
};
exports.getInvestorreportList = (req, res) => {
  const { company_id, type, signatory_id } = req.body;

  const query = `
    SELECT * 
    FROM investor_updates 
    WHERE company_id = ? 
      AND created_by_id = ? 
      AND created_by_role = ? 
      AND type = ? 
    ORDER BY id DESC
  `;

  db.query(
    query,
    [company_id, signatory_id, "signatory", type],
    (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // ✅ Build file path and append download URL to each record
      const pathname = `upload/docs/doc_${company_id}`;
      const baseUrl = "https://capavate.com/api";

      const updatedResults = results.map((doc) => ({
        ...doc,
        downloadUrl: `${baseUrl}/${pathname}/investor_report/${doc.document_name}`,
      }));

      return res.status(200).json({
        message: "Investor report list fetched successfully",
        results: updatedResults,
      });
    },
  );
};
exports.getShareInvestorreport = (req, res) => {
  const { id } = req.body;

  const query = `
    SELECT sharereport.*,investor_information.email,investor_information.first_name,investor_information.last_name,investor_updates.document_name,investor_updates.version
    FROM sharereport 
    left join investor_information on investor_information.id = sharereport.investor_id
    join investor_updates on investor_updates.id = sharereport.investor_updates_id
    WHERE sharereport.investor_updates_id = ? 
    ORDER BY id DESC
  `;

  db.query(query, [id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    // ✅ Build file path and append download URL to each record

    return res.status(200).json({
      message: "Investor report list fetched successfully",
      results: results,
    });
  });
};
exports.getRecordRoundList = (req, res) => {
  const { company_id, signatory_id } = req.body;

  const query = `SELECT * from roundrecord where created_by_id = ? And company_id = ? order by id desc`;

  db.query(query, [signatory_id, company_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    return res.status(200).json({
      message: "",
      results: results,
    });
  });
};
exports.getShareRecordreport = (req, res) => {
  const { id } = req.body;

  const query = `
    SELECT  sharerecordround.*,investor_information.email,investor_information.first_name,investor_information.last_name,roundrecord.nameOfRound,roundrecord.shareClassType,roundrecord.instrumentType,roundrecord.roundsize,roundrecord.currency,roundrecord.issuedshares
    FROM  sharerecordround 
    left join investor_information on investor_information.id =  sharerecordround.investor_id
    join roundrecord on roundrecord.id =  sharerecordround.roundrecord_id
    WHERE  sharerecordround.roundrecord_id = ? 
    ORDER BY id DESC
  `;

  db.query(query, [id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    // ✅ Build file path and append download URL to each record

    return res.status(200).json({
      message: "Investor report list fetched successfully",
      results: results,
    });
  });
};
exports.getSigantoryInformation = (req, res) => {
  const { id, company_id } = req.body;

  const query = `
    SELECT 
      cs.*, 
      c.company_name,
      u.first_name AS invited_by_first_name,
      u.last_name AS invited_by_last_name
    FROM company_signatories cs
    JOIN company c ON cs.company_id = c.id
    LEFT JOIN users u ON cs.invited_by = u.id
    WHERE cs.id = ? AND cs.company_id = ?
  `;

  db.query(query, [id, company_id], (err, row) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    return res.status(200).json({
      message: "",
      results: row[0],
    });
  });
};
exports.getSignatoryActivity = (req, res) => {
  const { signatory_id, company_id } = req.body;

  const query = `SELECT * from audit_logs where company_id = ? And user_id = ? And created_by_role = ? order by id desc`;

  db.query(query, [company_id, signatory_id, "signatory"], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    return res.status(200).json({
      message: "",
      results: results,
    });
  });
};
exports.getCompanyRoundAccessLogs = (req, res) => {
  const { signatory_id, company_id } = req.body;

  const query = `
    SELECT *
    FROM access_logs_company_round
    WHERE company_id = ? AND user_id = ? And user_role = ?
    ORDER BY id DESC
  `;

  db.query(query, [company_id, signatory_id, "signatory"], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    return res.status(200).json({
      message: "",
      results,
    });
  });
};
exports.getCompanyInvestorList = (req, res) => {
  const { company_id } = req.body;

  const query = `
    SELECT 
      company_investor.*, 
      investor_information.*
    FROM company_investor
    JOIN investor_information 
      ON investor_information.id = company_investor.investor_id
    WHERE company_investor.company_id = ?
    ORDER BY company_investor.id DESC
  `;

  db.query(query, [company_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    // Process results to include KYC document URLs
    const processedResults = results.map((investor) => {
      let kycDocumentUrl = null;

      // If kyc_document exists and is not null/empty
      if (investor.kyc_document && investor.kyc_document.trim() !== "") {
        try {
          // Parse the kyc_document JSON array if it's stored as JSON string
          let kycDocuments = [];
          if (investor.kyc_document.startsWith("[")) {
            kycDocuments = JSON.parse(investor.kyc_document);
          } else {
            kycDocuments = [investor.kyc_document];
          }

          // Generate URLs for each document
          kycDocumentUrl = kycDocuments.map((doc) => {
            const pathname = `upload/docs/doc_${company_id}`;
            const baseUrl = `https://capavate.com/api/upload/investor/inv_${investor.id}`;
            return `${baseUrl}/${encodeURIComponent(doc)}`;
          });

          // If it's a single document, return as string instead of array
          if (kycDocumentUrl.length === 1) {
            kycDocumentUrl = kycDocumentUrl[0];
          }
        } catch (error) {
          console.error("Error processing KYC document:", error);
          kycDocumentUrl = null;
        }
      }

      // Return investor data with the processed KYC document URL
      return {
        ...investor,
        kyc_document_url: kycDocumentUrl,
        // Keep original kyc_document field for backward compatibility
        kyc_document: investor.kyc_document,
      };
    });

    return res.status(200).json({
      message: "",
      results: processedResults,
    });
  });
};
