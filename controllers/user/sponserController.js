const db = require("../../db");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const Stripe = require("stripe");
const stripe = new Stripe(
  "sk_test_51IGfuKAQc0Y9yYEo5Mg8S8VbRdNIcsLoVUXqLjV3Na9eHxGDY2P5C9Ww7faB3hihlMqYwiJ4TP8EQOW3vq1uJhc500j1Zynf0i"
);
require("dotenv").config();
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
exports.getSponsers = async (req, res) => {
  var status = req.body.status;

  const query = `SELECT * FROM sponsorshipproposal_export WHERE status =? order by id desc`;

  db.query(query, [status], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: ``,
      results: results,
    });
  });
};
exports.getEvents = async (req, res) => {
  var status = req.body.status;

  const query = `SELECT * FROM events WHERE status =? order by id desc`;

  db.query(query, [status], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: ``,
      results: results,
    });
  });
};
exports.localloadEvents = async (req, res) => {
  var id = req.body.id;

  const query = `SELECT * FROM events WHERE id =?`;

  db.query(query, [id], (err, row) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: ``,
      results: row[0],
    });
  });
};

exports.localloadProposal = async (req, res) => {
  var data = req.body;

  const query = `SELECT sponsorshipproposal_export.* from sponsorshipproposal_export WHERE sponsorshipproposal_export.id = ? ORDER BY sponsorshipproposal_export.id DESC;`;

  db.query(query, [data.id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: ``,
      results: results,
    });
  });
};
exports.register = async (req, res) => {
  const {
    roles,
    current_role,
    full_name,
    email,
    subscription_plan,
    subscription_status,
    payout_method,
    company_name,
    phone,
    website,
    location,
    industry,
    bio,
  } = req.body;

  const checkQuery = `SELECT id FROM register WHERE email = ?`;

  db.query(checkQuery, [email], async (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Database error", error: err });
    }

    if (results.length > 0) {
      return res
        .status(200)
        .json({ message: "Email already registered", status: 2 });
    }

    const date = new Date();

    // Step 1: Generate random password
    const plainPassword = crypto
      .randomBytes(6)
      .toString("base64")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 10);

    // Step 2: Hash the password
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    // Step 3: Insert into database
    const insertQuery = `
      INSERT INTO register (
        \`roles\`,
        \`current_role\`,
        \`full_name\`,
        \`email\`,
        \`subscription_plan\`,
        \`subscription_status\`,
        \`payout_method\`,
        \`company_name\`,
        \`phone\`,
        \`website\`,
        \`location\`,
        \`industry\`,
        \`bio\`,
        \`password\`,
        \`viewpassword\`,
        \`created_at\`
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      JSON.stringify(roles),
      current_role,
      full_name,
      email,
      subscription_plan,
      subscription_status,
      payout_method,
      company_name,
      phone,
      website,
      location,
      industry,
      bio,
      hashedPassword,
      plainPassword,
      date,
    ];

    db.query(insertQuery, values, (insertErr, result) => {
      if (insertErr) {
        return res
          .status(500)
          .json({ message: "Insert failed", error: insertErr });
      }

      const insertedId = result.insertId;

      const fetchQuery = `SELECT * FROM register WHERE id = ?`;
      db.query(fetchQuery, [insertedId], (fetchErr, rows) => {
        if (fetchErr) {
          return res
            .status(500)
            .json({ message: "Fetch after insert failed", error: fetchErr });
        }

        const registeredUser = rows[0];
        sendEmailLoginpassword(email, full_name || "User", plainPassword);
        return res.status(201).json({
          message: "Registered successfully",
          status: 1,
          user: registeredUser,
          viewPassword: plainPassword, // ⬅️ include plain password only here
        });
      });
    });
  });
};
//Password
function sendEmailLoginpassword(to, fullName, newPassword) {
  const subject = `Welcome to Communitysponsor.org - Your Login Details`;

  const body = `
Dear ${fullName},

Thank you for registering with **Communitysponsor.org**.

Your account has been successfully created. Below are your login credentials:

**Email:** ${to}  
**Password:** ${newPassword}

Please log in and change this password immediately to keep your account secure.

If you have any questions or need assistance, feel free to contact our support team.

We're excited to have you on board!

Regards,  
Communitysponsor.org Team
  `;

  const mailOptions = {
    from: "Communitysponsor.org",
    to,
    subject,
    text: body,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending email:", error);
    else console.log("Registration email sent:", info.response);
  });
}

exports.proposalData = async (req, res) => {
  const data = req.body;
  const {
    event_type,
    title,
    eventId,
    description,
    amount_requested,
    sponsorship_type,
    sponsorship_tiers,
    event_reach,
    event_platform_type,
    event_platform_link,
    audience_demographics,
    benefits,
    purchased_addons,
    email_blast_sent,
    analytics_enabled,
    is_featured,
    status,
    images,
    video_links,
    created_by,
    created_by_id,
  } = data;

  const created_at = new Date();

  const insertQuery = `
    INSERT INTO sponsorshipproposal_export (
    event_type,
      title,
      event_id,
      description,
      amount_requested,
      sponsorship_type,
      sponsorship_tiers,
      event_reach,
      event_platform_type,
      event_platform_link,
      audience_demographics,
      benefits,
      purchased_addons,
      email_blast_sent,
      analytics_enabled,
      is_featured,
      status,
      images,
      video_links,
      created_date,
      created_by,
      created_by_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    event_type,
    title,
    eventId,
    description,
    amount_requested,
    sponsorship_type,
    JSON.stringify(sponsorship_tiers),
    event_reach,
    event_platform_type,
    event_platform_link,
    audience_demographics,
    JSON.stringify(benefits),
    JSON.stringify(purchased_addons),
    email_blast_sent,
    analytics_enabled,
    is_featured,
    status,
    JSON.stringify(images),
    JSON.stringify(video_links),
    created_at,
    created_by,
    created_by_id,
  ];

  db.query(insertQuery, values, (err, result) => {
    if (err) {
      console.error("Insert Error:", err);
      return res.status(500).json({ message: "Insert failed", error: err });
    }

    return res.status(201).json({
      message: "Proposal inserted successfully",
      insertId: result.insertId,
    });
  });
};

exports.hostpurchase = async (req, res) => {
  const {
    user_id,
    proposal_id,
    purchase_type,
    item_description,
    item_details,
    amount,
    transaction_id,
    payment_method,
    status,
  } = req.body;

  const created_at = new Date();

  const insertQuery = `
    INSERT INTO hostpurchase (
      user_id,
      proposal_id,
      purchase_type,
      item_description,
      item_details,
      amount,
      transaction_id,
      payment_method,
      status,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    user_id,
    proposal_id,
    purchase_type,
    item_description,
    JSON.stringify(item_details),
    amount,
    transaction_id,
    payment_method,
    status,
    created_at,
  ];

  db.query(insertQuery, values, (err, result) => {
    if (err) {
      console.error("Insert Error:", err);
      return res.status(500).json({ message: "Insert failed", error: err });
    }

    return res.status(201).json({
      message: "Host purchase recorded successfully",
      insertId: result.insertId,
    });
  });
};

exports.getSponsorshipProposal = async (req, res) => {
  var data = req.body;

  const query = `SELECT sponsorshipproposal_export.* FROM sponsorshipproposal_export  WHERE sponsorshipproposal_export.created_by = ? ORDER BY sponsorshipproposal_export.id DESC;`;

  db.query(query, [data.created_by], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: ``,
      results: results,
    });
  });
};

exports.registerwithgoogle = async (req, res) => {
  const {
    roles,
    current_role,
    full_name,
    email,
    subscription_plan,
    subscription_status,
    payout_method,
    company_name,
    phone,
    website,
    location,
    industry,
    bio,
  } = req.body;

  const checkQuery = `SELECT * FROM register WHERE email = ?`;

  db.query(checkQuery, [email], async (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Database error", error: err });
    }

    if (results.length > 0) {
      if (current_role === results[0].current_role) {
        return res.status(200).json({
          message: "Registered successfully",
          status: 1,
          user: results[0],
          viewPassword: "", // ⬅️ include plain password only here
        });
      } else {
        return res.status(200).json({
          message: "This email already registered for other account type",
          status: 2,
          user: results[0],
          viewPassword: "", // ⬅️ include plain password only here
        });
      }
    } else {
      const date = new Date();

      // Step 1: Generate random password
      const plainPassword = crypto
        .randomBytes(6)
        .toString("base64")
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 10);

      // Step 2: Hash the password
      const hashedPassword = await bcrypt.hash(plainPassword, 10);

      // Step 3: Insert into database
      const insertQuery = `
      INSERT INTO register (
        \`roles\`,
        \`current_role\`,
        \`full_name\`,
        \`email\`,
        \`subscription_plan\`,
        \`subscription_status\`,
        \`payout_method\`,
        \`company_name\`,
        \`phone\`,
        \`website\`,
        \`location\`,
        \`industry\`,
        \`bio\`,
        \`password\`,
        \`viewpassword\`,
        \`created_at\`
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

      const values = [
        JSON.stringify(roles),
        current_role,
        full_name,
        email,
        subscription_plan,
        subscription_status,
        payout_method,
        company_name,
        phone,
        website,
        location,
        industry,
        bio,
        hashedPassword,
        plainPassword,
        date,
      ];

      db.query(insertQuery, values, (insertErr, result) => {
        if (insertErr) {
          return res
            .status(500)
            .json({ message: "Insert failed", error: insertErr });
        }

        const insertedId = result.insertId;

        const fetchQuery = `SELECT * FROM register WHERE id = ?`;
        db.query(fetchQuery, [insertedId], (fetchErr, rows) => {
          if (fetchErr) {
            return res
              .status(500)
              .json({ message: "Fetch after insert failed", error: fetchErr });
          }

          const registeredUser = rows[0];
          sendEmailLoginpassword(email, full_name || "User", password);
          return res.status(201).json({
            message: "Registered successfully",
            status: 1,
            user: registeredUser,
            viewPassword: plainPassword, // ⬅️ include plain password only here
          });
        });
      });
    }
  });
};
exports.loginwithgoogle = async (req, res) => {
  const {
    roles,
    current_role,
    full_name,
    email,
    subscription_plan,
    subscription_status,
    payout_method,
    company_name,
    phone,
    website,
    location,
    industry,
    bio,
  } = req.body;

  const checkQuery = `SELECT * FROM register WHERE email = ?`;

  db.query(checkQuery, [email], async (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Database error", error: err });
    }

    if (results.length > 0) {
      return res.status(200).json({
        message: "Login successfully",
        status: 1,
        user: results[0],
        viewPassword: "", // ⬅️ include plain password only here
      });
    } else {
      const date = new Date();

      // Step 1: Generate random password
      const plainPassword = crypto
        .randomBytes(6)
        .toString("base64")
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 10);

      // Step 2: Hash the password
      const hashedPassword = await bcrypt.hash(plainPassword, 10);

      // Step 3: Insert into database
      const insertQuery = `
      INSERT INTO register (
        \`roles\`,
        \`current_role\`,
        \`full_name\`,
        \`email\`,
        \`subscription_plan\`,
        \`subscription_status\`,
        \`payout_method\`,
        \`company_name\`,
        \`phone\`,
        \`website\`,
        \`location\`,
        \`industry\`,
        \`bio\`,
        \`password\`,
        \`viewpassword\`,
        \`created_at\`
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

      const values = [
        JSON.stringify(roles),
        current_role,
        full_name,
        email,
        subscription_plan,
        subscription_status,
        payout_method,
        company_name,
        phone,
        website,
        location,
        industry,
        bio,
        hashedPassword,
        plainPassword,
        date,
      ];

      db.query(insertQuery, values, (insertErr, result) => {
        if (insertErr) {
          return res
            .status(500)
            .json({ message: "Insert failed", error: insertErr });
        }

        const insertedId = result.insertId;

        const fetchQuery = `SELECT * FROM register WHERE id = ?`;
        db.query(fetchQuery, [insertedId], (fetchErr, rows) => {
          if (fetchErr) {
            return res
              .status(500)
              .json({ message: "Fetch after insert failed", error: fetchErr });
          }

          const registeredUser = rows[0];

          return res.status(201).json({
            message: "Registered successfully",
            status: 1,
            user: registeredUser,
            viewPassword: plainPassword, // ⬅️ include plain password only here
          });
        });
      });
    }
  });
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    // Check if user already exists
    db.query(
      "SELECT * FROM register WHERE email = ?",
      [email],
      async (err, rows) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        if (rows.length > 0) {
          const user = rows[0];
          console.log(user.password);
          // Check if password matches
          if (user.password === null) {
            res
              .status(200)
              .json({ status: "2", message: "Invalid email or password" });
          } else {
            const isPasswordValid = await bcrypt.compare(
              password,
              user.password
            );
            if (!isPasswordValid) {
              return res
                .status(200)
                .json({ status: "2", message: "Invalid email or password" });
            } else {
              res.status(200).json({
                message: "Login successfully",
                status: "1",
                user: rows[0],
              });
            }
          }
        } else {
          res
            .status(200)
            .json({ status: "2", message: "Invalid email or password" });
        }
      }
    );
  } catch (err) {
    res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};
exports.emailBlast = async (req, res) => {
  const {
    proposal_id,
    host_id,
    subject,
    custom_message,
    recipients_count,
    cost,
    payment_method,
    status,
    url,
    userdetail,
    proposaldetail,
  } = req.body;

  try {
    // Query for all users with role "business_sponsor"
    db.query(
      "SELECT * FROM register WHERE `current_role` = ?",
      ["business_sponsor"],
      async (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }
        console.log(proposaldetail);
        if (results.length > 0) {
          for (const user of results) {
            const to = user.email; // Adjust if your email field is named differently

            // Call your email function
            sendEmailBlast(
              to,
              proposaldetail,
              custom_message,
              userdetail,
              subject,
              url
            );
          }
          const insertQuery = `
  INSERT INTO proposal_email_blasts 
  (proposal_id, host_id, subject, custom_message, recipients_count, status, cost, payment_method) 
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

          const values = [
            proposal_id,
            host_id,
            subject,
            custom_message || null,
            results.length,
            status || "pending",
            cost || null,
            payment_method || null,
          ];

          db.query(insertQuery, values, (insertErr, insertResult) => {
            if (insertErr) {
              console.error("Insert failed:", insertErr);
            } else {
            }
          });
          res.status(200).json({ message: "Emails sent successfully" });
        } else {
          res
            .status(404)
            .json({ message: "No business sponsors found", error: err });
        }
      }
    );
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
const generateEmailBody = (proposal, customMessage, host, url) => {
  return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">New Sponsorship Opportunity</h1>
        </div>
        
        <div style="padding: 24px; background: white;">
          <h2 style="color: #1f2937; margin-bottom: 16px;">${proposal.title}</h2>
          
          ${
            customMessage
              ? `
            <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
              <p style="margin: 0; font-style: italic; color: #4b5563;">
                "${customMessage}"
              </p>
              <p style="margin: 8px 0 0 0; font-size: 14px; color: #6b7280;">
                - ${host.full_name}, ${host.company_name}
              </p>
            </div>
          `
              : ""
          }
          
          <div style="margin-bottom: 24px;">
            <h3 style="color: #374151; margin-bottom: 12px;">Event Details</h3>
            <p style="margin: 4px 0; color: #4b5563;"><strong>Event:</strong> ${proposal.title}</p>
            <p style="margin: 4px 0; color: #4b5563;"><strong>Description:</strong> ${proposal.description}</p>
            ${proposal.event_reach ? `<p style="margin: 4px 0; color: #4b5563;"><strong>Expected Reach:</strong> ${proposal.event_reach}</p>` : ""}
            ${proposal.audience_demographics ? `<p style="margin: 4px 0; color: #4b5563;"><strong>Audience:</strong> ${proposal.audience_demographics}</p>` : ""}
          </div>

          ${
            proposal.sponsorship_tiers &&
            JSON.parse(proposal.sponsorship_tiers).length > 0
              ? `
    <div style="margin-bottom: 24px;">
      <h3 style="color: #374151; margin-bottom: 12px;">Sponsorship Opportunities</h3>
      ${JSON.parse(proposal.sponsorship_tiers)
        .map(
          (tier) => `
          <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <h4 style="margin: 0; color: #1f2937;">${tier.name}</h4>
              <span style="font-size: 20px; font-weight: bold; color: #10b981;">$${Number(tier.amount).toLocaleString()}</span>
            </div>
            <p style="margin: 8px 0; color: #6b7280; font-size: 14px;">${tier.description}</p>
            <div style="margin-top: 8px;">
              ${tier.benefits
                .map(
                  (benefit) => `
                <span style="display: inline-block; background: #ecfdf5; color: #065f46; padding: 4px 8px; border-radius: 4px; font-size: 12px; margin: 2px 4px 2px 0;">
                  ✓ ${benefit}
                </span>
              `
                )
                .join("")}
            </div>
          </div>
        `
        )
        .join("")}
    </div>
  `
              : ""
          }


          <div style="text-align: center; margin: 32px 0;">
            <a href="${url}/proposal-details?id=${proposal.id}" 
               style="background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
              View Full Proposal
            </a>
          </div>
        </div>

        <div style="background: #f9fafb; padding: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">
          <p style="margin: 0 0 8px 0;"><strong>Contact Information:</strong></p>
          <p style="margin: 2px 0;">${host.full_name} - ${host.company_name}</p>
          <p style="margin: 2px 0;">Email: ${host.email}</p>
          ${host.phone ? `<p style="margin: 2px 0;">Phone: ${host.phone}</p>` : ""}
          
          <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0;">You're receiving this because you opted into sponsor updates on CommunitySponsor.org</p>
            <p style="margin: 4px 0 0 0;">
              <a href="#" style="color: #6b7280;">Unsubscribe from future sponsor emails</a>
            </p>
          </div>
        </div>
      </div>
    `;
};
function sendEmailBlast(to, proposal, customMessage, host, subject, url) {
  const mailOptions = {
    from: "Communitysponsor.org",
    to,
    subject: subject,
    html: generateEmailBody(proposal, customMessage, host, url),
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending email:", error);
    else console.log(`✅ Reminder email sent to ${to}`);
  });
}

exports.getsponsoruser = async (req, res) => {
  var current_role = req.body.current_role;

  const query = "SELECT * FROM register WHERE `current_role` =?";

  db.query(query, [current_role], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: ``,
      results: results,
    });
  });
};
exports.getallproposal = async (req, res) => {
  const query = "SELECT * FROM sponsorshipproposal_export order by id desc";

  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: ``,
      results: results,
    });
  });
};
exports.getproposalbrowser = async (req, res) => {
  const query =
    "SELECT * FROM sponsorshipproposal_export where status =? And is_funded =? order by created_date desc";

  db.query(query, ["active", 0], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: ``,
      results: results,
    });
  });
};
// Setup multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/proposals/"); // Folder to store uploaded files
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueName + ext);
  },
});

const upload = multer({ storage }).single("image"); // field name must match frontend
exports.uploadimageVideo = (req, res) => {
  upload(req, res, (err) => {
    if (err) {
      return res
        .status(500)
        .json({ error: "Upload failed", details: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileUrl = `https://communitysponsoradmin.com/backend/uploads/proposals/${req.file.filename}`;
    res.status(200).json({ file_url: fileUrl });
  });
};

//Get Browser Event
exports.getbrowserevents = async (req, res) => {
  const { eventIds } = req.body;

  if (!Array.isArray(eventIds) || eventIds.length === 0) {
    return res
      .status(200)
      .json({ message: "Invalid or empty eventIds", results: [] });
  }

  console.log("Received event IDs:", eventIds); // should log ['2', '1', '3']

  const placeholders = eventIds.map(() => "?").join(", ");
  const query = `
    SELECT * FROM events
    WHERE status = ? AND id IN (${placeholders})
    ORDER BY id DESC
  `;

  db.query(query, ["published", ...eventIds], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Events fetched",
      results,
    });
  });
};

exports.getsponsorSubscriptiondetail = async (req, res) => {
  const { user_id } = req.body;
  const query = `SELECT * FROM register WHERE id = ?`;

  db.query(query, [user_id], (err, row) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Events fetched",
      results: row,
    });
  });
};
exports.paymentCharge = async (req, res) => {
  const { amount, paymentMethodId } = req.body;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount, // in cents
      currency: "usd",
      payment_method: paymentMethodId,
      confirm: false, // frontend will confirm
    });

    res
      .status(200)
      .json({ status: "1", clientSecret: paymentIntent.client_secret });
  } catch (error) {
    res.status(500).json({ status: "2", message: error.message });
  }
};

exports.paymentSave = (req, res) => {
  const { payment_type, confirmResult, plan, user_id } = req.body;

  if (!confirmResult?.id || !plan || !user_id) {
    return res
      .status(400)
      .json({ status: "0", message: "Missing required data" });
  }

  // Calculate exp_date
  let expDate = new Date();
  if (plan === "basic") {
    expDate.setMonth(expDate.getMonth() + 1);
  } else if (plan === "annual" || plan === "pro") {
    expDate.setMonth(expDate.getMonth() + 12);
  } else {
    return res.status(400).json({ status: "0", message: "Invalid plan type" });
  }

  const formattedExpDate = expDate.toISOString().split("T")[0];

  const insertSql = `
    INSERT INTO sponsor_plan_subscription 
      (payment_type, user_id, pay_id, status, exp_date, created_at)
    VALUES (?, ?, ?, ?, ?, NOW())
  `;
  const insertValues = [
    payment_type,
    user_id,
    confirmResult.id,
    confirmResult.status,
    formattedExpDate,
  ];

  db.query(insertSql, insertValues, (err, result) => {
    if (err) {
      console.error("Insert error:", err);
      return res
        .status(500)
        .json({ status: "2", message: "Insert failed", error: err });
    }

    const updateSql = `
      UPDATE register 
      SET subscription_plan = ?,subscription_exp=?
      WHERE id = ?
    `;
    const updateValues = [plan, formattedExpDate, user_id];

    db.query(updateSql, updateValues, (err2, result2) => {
      if (err2) {
        console.error("Update error:", err2);
        return res
          .status(500)
          .json({ status: "2", message: "Update failed", error: err2 });
      }

      return res.status(200).json({
        status: "1",
        message: "Subscription saved and user updated",
      });
    });
  });
};

//Proposal Sponsor Payment
exports.sponsorPaymentCharge = async (req, res) => {
  const { amount, paymentMethodId } = req.body;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount, // in cents
      currency: "usd",
      payment_method: paymentMethodId,
      confirm: false, // frontend will confirm
    });

    res
      .status(200)
      .json({ status: "1", clientSecret: paymentIntent.client_secret });
  } catch (error) {
    res.status(500).json({ status: "2", message: error.message });
  }
};
exports.sponsorPaymentSave = (req, res) => {
  const { confirmResult, proposal_id, host_id, amount, user_id } = req.body;

  if (!confirmResult?.id || !user_id) {
    return res
      .status(400)
      .json({ status: "0", message: "Missing required data" });
  }

  // Calculate exp_date
  let expDate = new Date();

  const insertSql = `
    INSERT INTO sponsorship_payments 
      (proposal_id,host_id,sponsor_id, stripe_checkout_id, status, created_at,payment_method,currency,amount)
    VALUES (?, ?, ?, ?, ?, NOW(),?,?,?)
  `;
  const insertValues = [
    proposal_id,
    host_id,
    user_id,
    confirmResult.id,
    confirmResult.status,
    "stripe",
    "usd",
    amount,
  ];

  db.query(insertSql, insertValues, (err, result) => {
    if (err) {
      console.error("Insert error:", err);
      return res
        .status(500)
        .json({ status: "2", message: "Insert failed", error: err });
    }

    // Update is_funded in sponsorshipproposal_export table
    const updateSql = `
      UPDATE sponsorshipproposal_export
      SET is_funded = 1
      WHERE id = ?
    `;
    db.query(updateSql, [proposal_id], (updateErr, updateResult) => {
      if (updateErr) {
        console.error("Update error:", updateErr);
        return res
          .status(500)
          .json({ status: "3", message: "Update failed", error: updateErr });
      }

      return res.status(200).json({
        status: "1",
        message: "Subscription saved and proposal marked as funded",
      });
    });
  });
};
exports.sponsorPaymentSavePaypal = (req, res) => {
  const { confirmResult, proposal_id, host_id, amount, user_id } = req.body;

  if (!confirmResult?.id || !user_id) {
    return res
      .status(400)
      .json({ status: "0", message: "Missing required data" });
  }

  // Calculate exp_date
  let expDate = new Date();

  const insertSql = `
    INSERT INTO sponsorship_payments 
      (proposal_id,host_id,sponsor_id, paypal_order_id, status, created_at,payment_method,currency,amount)
    VALUES (?, ?, ?, ?, ?, NOW(),?,?,?)
  `;
  const insertValues = [
    proposal_id,
    host_id,
    user_id,
    confirmResult.id,
    confirmResult.status,
    "Paypal",
    "usd",
    amount,
  ];

  db.query(insertSql, insertValues, (err, result) => {
    if (err) {
      console.error("Insert error:", err);
      return res
        .status(500)
        .json({ status: "2", message: "Insert failed", error: err });
    }

    // Update is_funded in sponsorshipproposal_export table
    const updateSql = `
      UPDATE sponsorshipproposal_export
      SET is_funded = 1
      WHERE id = ?
    `;
    db.query(updateSql, [proposal_id], (updateErr, updateResult) => {
      if (updateErr) {
        console.error("Update error:", updateErr);
        return res
          .status(500)
          .json({ status: "3", message: "Update failed", error: updateErr });
      }

      return res.status(200).json({
        status: "1",
        message: "Subscription saved and proposal marked as funded",
      });
    });
  });
};
exports.updaterole = (req, res) => {
  let { roles, id } = req.body;

  if (!roles || !id) {
    return res
      .status(400)
      .json({ status: "0", message: "Missing roles or id" });
  }

  // Store roles as JSON string in DB
  const rolesJson = JSON.stringify(roles);

  const updateSql = `UPDATE register SET roles = ? WHERE id = ?`;
  db.query(updateSql, [rolesJson, id], (err, result) => {
    if (err) {
      console.error("Update error:", err);
      return res.status(500).json({ status: "0", message: "Update failed" });
    }
    res.status(200).json({ status: "1", message: "Roles updated" });
  });
};

exports.getallevents = async (req, res) => {
  const { user_id } = req.body;
  const query = `SELECT * FROM events WHERE host_id = ? AND marketplace_requests_enabled IS NULL`;

  db.query(query, [user_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Events fetched",
      results: results,
    });
  });
};

exports.paymentSaveStripe = (req, res) => {
  const {
    confirmResult,
    paytype,
    proposaldetail,
    amount,
    event_id,
    userdata,
    proposal_id,
    eventdetail,
    plan,
    user_id,
  } = req.body;

  if (!confirmResult?.id || !user_id) {
    return res
      .status(400)
      .json({ status: "0", message: "Missing required data" });
  }

  var unlock_count = "0";
  if (paytype === "Single Unlock") {
    unlock_count = "1";
  }
  if (paytype === "5 Unlocks") {
    unlock_count = "5";
  }
  if (paytype === "15 Unlocks") {
    unlock_count = "15";
  }
  var date = new Date();

  // Insert into payment_lockunlock_newrecord as before
  const insertSqln = `INSERT INTO payment_lockunlock_newrecord
      (sponsor_id, proposal_id, payment_type, pay_id, status, lock_type, amount, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`;
  const insertValuesn = [
    user_id,
    proposal_id,
    "Stripe",
    confirmResult.id,
    confirmResult.status,
    paytype,
    amount,
    date,
  ];

  db.query(insertSqln, insertValuesn, (err, result) => {
    if (err) {
      console.error("Insert error:", err);
      return res
        .status(500)
        .json({ status: "2", message: "Insert failed", error: err });
    }

    // Now check if record exists for this sponsor_id (user_id)
    const selectSql = `SELECT unlock_count, proposal_id FROM payment_lockunlock WHERE sponsor_id = ? LIMIT 1`;
    db.query(selectSql, [user_id], (err, rows) => {
      if (err) {
        console.error("Select error:", err);
        return res
          .status(500)
          .json({ status: "4", message: "Select failed", error: err });
      }

      // If record exists, update it
      if (rows.length > 0) {
        let row = rows[0];
        let existingProposals = [];
        try {
          existingProposals = JSON.parse(row.proposal_id);
          if (!Array.isArray(existingProposals)) {
            existingProposals = [];
          }
        } catch {
          existingProposals = [];
        }

        const pid = parseInt(proposal_id);
        const isProposalExist = existingProposals.includes(pid);

        // If proposal_id is NOT in the array, add it and add unlock_count
        if (!isProposalExist) {
          existingProposals.push(pid);

          // Add current unlock_count to existing unlock_count
          const updatedUnlockCount =
            parseInt(row.unlock_count) + parseInt(unlock_count);

          // Update with new unlock_count and appended proposal_id list
          const updateSql = `
      UPDATE payment_lockunlock 
      SET unlock_count = ?, proposal_id = ?, payment_type = ?, pay_id = ?, status = ?, lock_type = ?, amount = ?, created_at = NOW()
      WHERE sponsor_id = ?
    `;
          const updateValues = [
            updatedUnlockCount.toString(),
            JSON.stringify(existingProposals),
            "Stripe",
            confirmResult.id,
            confirmResult.status,
            paytype,
            amount,
            user_id,
          ];

          db.query(updateSql, updateValues, (err, updateResult) => {
            if (err) {
              console.error("Update error:", err);
              return res
                .status(500)
                .json({ status: "5", message: "Update failed", error: err });
            }

            res.status(200).json({
              message:
                "Record updated successfully with new proposal_id and unlock_count",
              results: "",
            });
          });
        } else {
          // proposal_id already exists, so update other fields except unlock_count and proposal_id
          const updateSql = `
      UPDATE payment_lockunlock 
      SET payment_type = ?, pay_id = ?, status = ?, lock_type = ?, amount = ?, created_at = NOW()
      WHERE sponsor_id = ?
    `;
          const updateValues = [
            "Stripe",
            confirmResult.id,
            confirmResult.status,
            paytype,
            amount,
            user_id,
          ];

          db.query(updateSql, updateValues, (err, updateResult) => {
            if (err) {
              console.error("Update error:", err);
              return res
                .status(500)
                .json({ status: "5", message: "Update failed", error: err });
            }

            res.status(200).json({
              message:
                "Record updated successfully without changing unlock_count (proposal_id exists)",
              results: "",
            });
          });
        }
      } else {
        // If no record exists, insert new with proposal_id as array string [proposal_id]
        const insertSql = `
          INSERT INTO payment_lockunlock
          (usage_count,unlock_count, sponsor_id, proposal_id, payment_type, pay_id, status, lock_type, amount, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;
        const insertValues = [
          "1",
          unlock_count,
          user_id,
          JSON.stringify([parseInt(proposal_id)]),
          "Stripe",
          confirmResult.id,
          confirmResult.status,
          paytype,
          amount,
          date,
        ];

        db.query(insertSql, insertValues, (err, insertResult) => {
          if (err) {
            console.error("Insert error:", err);
            return res
              .status(500)
              .json({ status: "6", message: "Insert failed", error: err });
          }
          sendEmailToHostForProposal(
            proposaldetail.created_by,
            proposaldetail.title,
            eventdetail?.title,
            userdata.full_name
          );
          res.status(200).json({
            message: "Record inserted successfully",
            results: "",
          });
        });
      }
    });
  });
};
//Email For Host
function sendEmailToHostForProposal(
  to,
  proposalTitle,
  eventTitle,
  sponsorName
) {
  const subject = `🎉 A sponsor has unlocked your event proposal!`;

  const body = `
Hello,

Great news! 🎉  
Sponsor **${sponsorName}** has just unlocked your proposal **"${proposalTitle}"** for the event **"${eventTitle}"** and can now contact you.

You can now connect and move forward with your event plans.

Best regards,  
Communitysponsor.org Team
  `;

  const mailOptions = {
    from: "Communitysponsor.org <avinayquicktech@gmail.com>",
    to,
    subject,
    text: body,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error sending email:", error);
    } else {
      console.log("Host notification email sent:", info.response);
    }
  });
}

exports.getlocksubscriptionDetail = async (req, res) => {
  const { user_id, id } = req.body;
  const query = `SELECT * FROM  payment_lockunlock WHERE sponsor_id = ? order by id desc`;

  db.query(query, [user_id], (err, row) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Events fetched",
      results: row,
    });
  });
};
exports.proposalcount = (req, res) => {
  const { user_id, id: id } = req.body;

  if (!user_id || !id) {
    return res.status(400).json({ message: "Missing user_id or proposal_id" });
  }

  // Select the latest record for this sponsor_id
  const selectSql = `SELECT id,usage_count, proposal_id FROM payment_lockunlock WHERE sponsor_id = ? ORDER BY id DESC LIMIT 1`;

  db.query(selectSql, [user_id], (err, rows) => {
    if (err) {
      return res.status(500).json({ message: "DB error", error: err });
    }

    if (rows.length === 0) {
      return res.status(404).json({ message: "No record found to update" });
    }

    var record = rows[0];
    let proposals = [];

    try {
      proposals = JSON.parse(record.proposal_id);
      if (!Array.isArray(proposals)) proposals = [];
    } catch {
      proposals = [];
    }

    const pid = parseInt(id);

    if (!proposals.includes(pid)) {
      proposals.push(pid);
      const currentUsage = Number(record.usage_count);
      const totalUsage = currentUsage + 1;
      const updateSql = `UPDATE payment_lockunlock SET proposal_id = ? , usage_count =? WHERE id = ?`;
      db.query(
        updateSql,
        [JSON.stringify(proposals), totalUsage, record.id],
        (updateErr) => {
          if (updateErr) {
            return res
              .status(500)
              .json({ message: "Update failed", error: updateErr });
          }

          return res.status(200).json({
            message: "proposal_id updated",
            updatedProposalIds: proposals,
          });
        }
      );
    } else {
      // proposal_id already exists, no update needed
      return res.status(200).json({
        message: "proposal_id already exists",
        existingProposalIds: proposals,
      });
    }
  });
};

exports.getUnlockproposal = async (req, res) => {
  const { user_id } = req.body;
  const query = `SELECT pln.id as pln_id,pln.sponsor_id, r.full_name, pln.readmessage, pln.lock_type, pln.amount, spe.id, spe.title, spe.created_by_id FROM sponsorshipproposal_export AS spe JOIN payment_lockunlock_newrecord AS pln ON pln.proposal_id = spe.id JOIN register AS r ON pln.sponsor_id = r.id WHERE spe.created_by_id = ? And pln.readmessage = ? ORDER BY pln.id DESC;`;

  db.query(query, [user_id, "No"], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Events fetched",
      results: results,
    });
  });
};
exports.UnlockproposalStatusUpdate = async (req, res) => {
  const { id } = req.body;
  const updateSql = `UPDATE payment_lockunlock_newrecord SET readmessage = ?  WHERE id = ?`;
  db.query(updateSql, ["Yes", id], (updateErr) => {
    if (updateErr) {
      return res
        .status(500)
        .json({ message: "Update failed", error: updateErr });
    }

    return res.status(200).json({
      message: "proposal_id updated",
    });
  });
};

exports.getproposalDetailEdit = async (req, res) => {
  const { user_id, id } = req.body;
  const query = `SELECT * from sponsorshipproposal_export where id = ? And created_by_id = ?`;

  db.query(query, [id, user_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Events fetched",
      results: results,
    });
  });
};

exports.proposalDataEdit = async (req, res) => {
  const data = req.body;
  const {
    id,
    event_type,
    title,
    eventId,
    description,
    amount_requested,
    sponsorship_type,
    sponsorship_tiers,
    event_reach,
    event_platform_type,
    event_platform_link,
    audience_demographics,
    benefits,
    purchased_addons,
    email_blast_sent,
    analytics_enabled,
    is_featured,
    status,
    images,
    video_links,
    created_by,
    created_by_id,
  } = data;

  const created_at = new Date();

  const updateQuery = `
  UPDATE sponsorshipproposal_export
  SET
    event_type = ?,
    title = ?,
    event_id = ?,
    description = ?,
    amount_requested = ?,
    sponsorship_type = ?,
    sponsorship_tiers = ?,
    event_reach = ?,
    event_platform_type = ?,
    event_platform_link = ?,
    audience_demographics = ?,
    benefits = ?,
    purchased_addons = ?,
    email_blast_sent = ?,
    analytics_enabled = ?,
    is_featured = ?,
    status = ?,
    images = ?,
    video_links = ?,
    created_date = ?,
    created_by = ?,
    created_by_id = ?
  WHERE id = ?
`;
  let videoLinksToStore;
  if (Array.isArray(video_links)) {
    videoLinksToStore = JSON.stringify(video_links);
  } else if (typeof video_links === "string") {
    videoLinksToStore = video_links;
  } else {
    videoLinksToStore = "[]";
  }
  let imagesToStore;
  if (Array.isArray(images)) {
    imagesToStore = JSON.stringify(images);
  } else if (typeof images === "string") {
    // already a JSON string from DB, use as is
    imagesToStore = images;
  } else {
    imagesToStore = "[]"; // fallback empty array
  }

  let benefitsStore;
  if (Array.isArray(benefits)) {
    benefitsStore = JSON.stringify(benefits);
  } else if (typeof benefits === "string") {
    // already a JSON string from DB, use as is
    benefitsStore = benefits;
  } else {
    benefitsStore = "[]"; // fallback empty array
  }

  let sponsorship_tiersStore;
  if (Array.isArray(sponsorship_tiers)) {
    sponsorship_tiersStore = JSON.stringify(benefits);
  } else if (typeof sponsorship_tiers === "string") {
    // already a JSON string from DB, use as is
    sponsorship_tiersStore = sponsorship_tiers;
  } else {
    sponsorship_tiersStore = "[]"; // fallback empty array
  }

  let purchased_addonsStore;
  if (Array.isArray(purchased_addons)) {
    purchased_addonsStore = JSON.stringify(purchased_addons);
  } else if (typeof purchased_addons === "string") {
    // already a JSON string from DB, use as is
    purchased_addonsStore = purchased_addons;
  } else {
    purchased_addonsStore = "[]"; // fallback empty array
  }

  const values = [
    event_type,
    title,
    eventId,
    description,
    amount_requested,
    sponsorship_type,
    sponsorship_tiersStore,
    event_reach,
    event_platform_type,
    event_platform_link,
    audience_demographics,
    benefitsStore,
    purchased_addonsStore,
    email_blast_sent,
    analytics_enabled,
    is_featured,
    status,
    imagesToStore,
    videoLinksToStore,
    created_at,
    created_by,
    created_by_id,
    id, // the id of the record to update
  ];
  db.query(updateQuery, values, (err, result) => {
    if (err) {
      console.error("Update Error:", err);
      return res.status(500).json({ message: "Update failed", error: err });
    }

    return res.status(200).json({
      message: "Proposal updated successfully",
      affectedRows: result.affectedRows,
    });
  });
};
