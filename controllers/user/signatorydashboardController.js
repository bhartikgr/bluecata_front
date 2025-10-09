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
                    return res
                      .status(500)
                      .json({
                        error: "DB error while fetching Investor Reporting",
                      });

                  const totalInvestorReporting =
                    investorResult[0]?.total_investor_reporting || 0;

                  db.query(
                    totalSharedReportsQuery,
                    [signatory_id, company_id],
                    (err, sharedResult) => {
                      if (err)
                        return res
                          .status(500)
                          .json({
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
                    }
                  );
                }
              );
            }
          );
        }
      );
    }
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
