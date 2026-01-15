const db = require("../../db");
const nodemailer = require("nodemailer");
const OpenAI = require("openai");

require("dotenv").config();
const logoBase64 = process.env.LOGO_BASE64;
//Email Detail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
//Email Detail
exports.getUserCompany = (req, res) => {
  const user_id = req.body.user_id;

  const query = `
    SELECT 
      c.*, 
      COUNT(DISTINCT cs.id) AS total_signatories,
      COUNT(DISTINCT CASE WHEN rr.roundStatus = 'ACTIVE' THEN rr.id END) AS total_active_rounds
    FROM company c
    LEFT JOIN company_signatories cs ON cs.company_id = c.id
    LEFT JOIN roundrecord rr ON rr.company_id = c.id
    WHERE c.user_id = ?
    GROUP BY c.id
    ORDER BY c.id DESC
  `;

  db.query(query, [user_id], (err, results) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Database query error", error: err });
    }

    res.status(200).json({
      results: results,
    });
  });
};

exports.getUserSignatory = (req, res) => {
  const user_id = req.body.user_id;

  if (!user_id) {
    return res.status(400).json({ message: "user_id is required" });
  }

  const query = `
    SELECT 
      cs.id,
      cs.user_id,
      cs.first_name,
      cs.last_name,
      cs.unique_code,
      cs.company_id,
      cs.signatory_email,
      c.company_name
    FROM company_signatories cs
    JOIN (
      SELECT signatory_email, MAX(id) AS max_id
      FROM company_signatories
      WHERE user_id = ?
      GROUP BY signatory_email
    ) latest ON cs.id = latest.max_id
    JOIN company c ON c.id = cs.company_id
    ORDER BY cs.id DESC
  `;

  db.query(query, [user_id], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res
        .status(500)
        .json({ message: "Database query error", error: err });
    }

    return res.status(200).json({
      message: "User signatories fetched successfully",
      results: results,
    });
  });
};

exports.userDeleteSignatory = (req, res) => {
  const user_id = req.body.user_id;
  const email = req.body.email;

  if (!email || !user_id) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  // Delete signatory
  const deleteQuery =
    "DELETE FROM company_signatories WHERE signatory_email = ? AND user_id = ?";
  db.query(deleteQuery, [email, user_id], (deleteErr, deleteResult) => {
    if (deleteErr) {
      return res.status(500).json({
        message: "Error deleting signatory",
        error: deleteErr,
      });
    }

    if (deleteResult.affectedRows === 0) {
      return res
        .status(404)
        .json({ message: "Signatory not found or not authorized" });
    }

    res.status(200).json({ message: "Signatory deleted successfully" });
  });
};

exports.getcompanyAlldetail = (req, res) => {
  var user_id = req.body.user_id;
  db.query(
    "SELECT * from company where user_id = ? order by id desc",
    [user_id],
    async (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      res.status(200).json({
        results: results,
      });
    }
  );
};
exports.addSignatory = (req, res) => {
  const data = req.body;
  db.query(
    "SELECT * from company_signatories where company_id = ?",
    [data.company_id],
    async (err, results) => {
      if (results.length >= 2) {
        return res.status(200).json({
          results: "",
          message: "You can only add up to two new signatories.",
          status: "2",
        });
      } else {
        db.query(
          "SELECT * from company_signatories where signatory_email = ? And company_id = ? order by id desc",
          [data.email, data.company_id],
          async (err, results) => {
            if (err) {
              return res
                .status(500)
                .json({ message: "Database query error", error: err });
            }

            if (results.length > 0) {
              return res.status(200).json({
                results: "",
                message: "This signatory is already added",
                status: "2",
              });
            } else {
              // Fetch user details
              db.query(
                "SELECT * FROM company WHERE id = ?",
                [data.company_id],
                (userErr, userResult) => {
                  if (userErr || !userResult.length) {
                    return res
                      .status(500)
                      .json({ message: "User not found", error: userErr });
                  }

                  const usercompany_name = userResult[0].company_name;

                  // Fetch existing company colors to ensure uniqueness
                  db.query(
                    "SELECT company_color_code FROM company",
                    (colorErr, colorResults) => {
                      if (colorErr) {
                        return res.status(500).json({
                          message: "Error fetching existing colors",
                          error: colorErr,
                        });
                      }

                      const usedColors = colorResults.map(
                        (c) => c.company_color_code
                      );

                      // Generate a unique random color
                      let assignedColor;
                      let attempts = 0;
                      do {
                        assignedColor = generateRandomColor();
                        attempts++;
                        if (attempts > 50) break; // fallback after too many attempts
                      } while (usedColors.includes(assignedColor));

                      // Insert into company_signatories
                      const signatoryInsertQuery = `
                INSERT INTO company_signatories
                (company_id, unique_code, user_id, first_name, last_name, signatory_email, linked_in, signatory_phone, signature_role, access_status, invited_by, invited_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `;

                      const uniqueCode = generateUniqueCode();

                      db.query(
                        signatoryInsertQuery,
                        [
                          data.company_id,
                          uniqueCode,
                          data.user_id,
                          data.first_name || null,
                          data.last_name || null,
                          data.email || null,
                          data.linked_in || null,
                          data.phone || null,
                          data.signature_role || null,
                          "pending",
                          data.user_id,
                          new Date(),
                        ],
                        (signErr) => {
                          if (signErr) {
                            return res.status(500).json({
                              message: "Signatory insert error",
                              error: signErr,
                            });
                          }

                          const inviteLink = `https://capavate.com/signatory/accept/${uniqueCode}`;
                          sendEmailToSignatory(
                            data.email,
                            `${data.first_name} ${data.last_name}`,
                            inviteLink,
                            usercompany_name
                          );

                          // Return with assignedColor for reference
                          return res.status(200).json({
                            message: "Signatory added successfully",
                            company_color_code: assignedColor,
                            status: "1",
                          });
                        }
                      );
                    }
                  );
                }
              );
            }
          }
        );
      }
    }
  );
};

const generateUniqueCode = () => {
  const timestamp = Date.now();
  const randomNum = Math.floor(Math.random() * 1000); // Add randomness

  // Generate a random 3-letter string
  const randomLetters = Math.random()
    .toString(36)
    .substring(2, 5)
    .toUpperCase();

  return `${randomLetters}${timestamp}${randomNum}`;
};

function sendEmailToSignatory(to, fullName, inviteLink, company_name) {
  const subject = "You're Invited to Join the Company - Capavate";

  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Invitation</title>
  </head>
  <body>
    <div style="width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; font-family: Verdana, Geneva, sans-serif; overflow: hidden;">
      <table style="width:100%; border-collapse: collapse;">
        <tr>
          <td style="background:#efefef; padding:10px; text-align:center;">
            <img src="https://capavate.com/api/upload/images/logo.png" alt="logo" style="width:130px;" />
          </td>
        </tr>
        <tr>
          <td style="padding:20px;">
            <h2 style="font-size:16px; color:#111;">Dear ${fullName},</h2>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              You have been invited to join the company <strong>${company_name}</strong> on Capavate.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              Please click the button below to accept the invitation and complete your profile:
            </p>
            <p style="text-align:center; margin:20px 0;">
              <a href="${inviteLink}" style=" background: #CC0000;
                    color: #fff; padding:10px 20px; text-decoration:none; border-radius:5px; font-weight:bold;">
                Accept Invitation
              </a>
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              If you did not expect this email, please ignore it.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:0;">Regards,<br/>Capavate Team</p>
          </td>
        </tr>
      </table>
      <div style="text-align:center; font-size:12px; color:#999; padding:10px 0;">
        Capavate. Powered by Blueprint Catalyst Limited
      </div>
    </div>
  </body>
  </html>
  `;

  const mailOptions = {
    from: '"Capavate" <scale@blueprintcatalyst.com>',
    to,
    subject,
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending invitation email:", error);
    else console.log("Invitation email sent:", info.response);
  });
}

function generateRandomColor() {
  const letters = "0123456789ABCDEF";
  let color = "#";
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

exports.getUserdetails = (req, res) => {
  var user_id = req.body.user_id;
  db.query("SELECT * from users where id = ?", [user_id], async (err, row) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Database query error", error: err });
    }

    res.status(200).json({
      results: row,
    });
  });
};

exports.UserdataUpdate = (req, res) => {
  var data = req.body; // expecting data = { id, name, phone_number }

  // Validate required fields
  if (!data.id) {
    return res.status(400).json({ message: "User ID is required" });
  }

  // Build update query
  db.query(
    "UPDATE users SET first_name = ?, last_name=?, phone_number = ? WHERE id = ?",
    [data.first_name, data.last_name, data.phone_number, data.id],
    (err, result) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Optionally, fetch the updated user
      db.query("SELECT * FROM users WHERE id = ?", [data.id], (err, row) => {
        if (err) {
          return res.status(500).json({
            message: "Database query error while fetching updated user",
            error: err,
          });
        }

        res.status(200).json({
          message: "User updated successfully",
          results: row[0],
        });
      });
    }
  );
};

exports.getUserOwnerDetail = (req, res) => {
  var user_id = req.body.user_id;
  db.query("SELECT * from users where id = ?", [user_id], async (err, row) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Database query error", error: err });
    }

    res.status(200).json({
      results: row,
    });
  });
};
exports.SendMailToSignatory = (req, res) => {
  var corp = req.body.corp;

  db.query(
    "SELECT * from company_signatories where id = ?",
    [corp.signatory_id],
    async (err, row) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Database query error",
          error: err,
        });
      }

      if (row.length > 0) {
        var rowData = row[0];

        if (rowData.access_status === "pending") {
          var uniqueCode = rowData.unique_code;
          const inviteLink = `https://capavate.com/signatory/accept/${uniqueCode}`;

          try {
            await sendEmailToSignatory(
              rowData.signatory_email,
              `${rowData.first_name} ${rowData.last_name}`,
              inviteLink,
              corp.company_name
            );

            return res.status(200).json({
              success: true,
              message: "Invitation email sent successfully",
            });
          } catch (emailError) {
            return res.status(500).json({
              success: false,
              message: "Failed to send email",
              error: emailError,
            });
          }
        } else {
          return res.status(400).json({
            success: false,
            message: "Signatory access status is not pending",
          });
        }
      } else {
        return res.status(404).json({
          success: false,
          message: "Signatory not found",
        });
      }
    }
  );
};
function sendEmailToSignatory(to, fullName, inviteLink, company_name) {
  const subject = "You're Invited to Join the Company - Capavate";

  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Invitation</title>
  </head>
  <body>
    <div style="width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; font-family: Verdana, Geneva, sans-serif; overflow: hidden;">
      <table style="width:100%; border-collapse: collapse;">
        <tr>
          <td style="background:#efefef; padding:10px; text-align:center;">
            <img src="https://capavate.com/api/upload/images/logo.png" alt="logo" style="width:130px;" />
          </td>
        </tr>
        <tr>
          <td style="padding:20px;">
            <h2 style="font-size:16px; color:#111;">Dear ${fullName},</h2>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              You have been invited to join the company <strong>${company_name}</strong> on Capavate.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              Please click the button below to accept the invitation and complete your profile:
            </p>
            <p style="text-align:center; margin:20px 0;">
              <a href="${inviteLink}" style=" background: #CC0000;
                    color: #fff; padding:10px 20px; text-decoration:none; border-radius:5px; font-weight:bold;">
                Accept Invitation
              </a>
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              If you did not expect this email, please ignore it.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:0;">Regards,<br/>Capavate Team</p>
          </td>
        </tr>
      </table>
      <div style="text-align:center; font-size:12px; color:#999; padding:10px 0;">
        Capavate. Powered by Blueprint Catalyst Limited
      </div>
    </div>
  </body>
  </html>
  `;

  const mailOptions = {
    from: '"Capavate" <scale@blueprintcatalyst.com>',
    to,
    subject,
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending invitation email:", error);
    else console.log("Invitation email sent:", info.response);
  });
}

exports.updateEmail = (req, res) => {
  const { companyid, email } = req.body;
  console.log(req.body);
  if (!companyid || !email) {
    return res.status(400).json({ message: "Missing companyid or email" });
  }

  // Step 1: Check if email already exists in another record
  const checkEmailQuery =
    "SELECT * FROM company WHERE company_email = ? AND id != ?";
  db.query(checkEmailQuery, [email, companyid], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error while checking email",
        error: err,
      });
    }

    // Step 2: If email found in another record, reject
    if (results.length > 0) {
      return res.status(200).json({
        message: "Email already exists for another company",
        status: "2",
      });
    }

    // Step 3: Update email for this company
    const updateQuery = "UPDATE company SET company_email = ? WHERE id = ?";
    db.query(updateQuery, [email, companyid], (err2, updateResult) => {
      if (err2) {
        return res.status(500).json({
          message: "Error updating email",
          error: err2,
        });
      }

      res.status(200).json({
        message: "Email updated successfully",
        result: updateResult,
        status: "1",
      });
    });
  });
};
