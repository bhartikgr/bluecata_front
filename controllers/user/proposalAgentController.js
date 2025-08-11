const db = require("../../db");
const nodemailer = require("nodemailer");
require("dotenv").config();
//Email Detail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
exports.createproposalAgent = async (req, res) => {
  const data = req.body;

  const {
    inviteUrl,
    proposal_id,
    host_id,
    agent_email,
    role,
    commission_rate,
    status,
    invite_token,
    referral_code,
    proposal,
    userdata,
  } = data;

  const created_at = new Date();

  const insertQuery = `
    INSERT INTO proposal_agents (
      proposal_id,
      host_id,
      agent_email,
      role,
      commission_rate,
      status,
      invite_token,
      referral_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    proposal_id,
    host_id,
    agent_email,
    role,
    commission_rate,
    status,
    invite_token,
    referral_code,
  ];

  db.query(insertQuery, values, (err, result) => {
    if (err) {
      console.error("Insert Error:", err);
      return res.status(500).json({ message: "Insert failed", error: err });
    }
    sendProposalEmail(agent_email, proposal, userdata, inviteUrl);
    console.log(proposal.title);
    return res.status(201).json({
      message: "Proposal agent created successfully",
      insertId: result.insertId,
    });
  });
};

function sendProposalEmail(to, proposal, message, inviteUrl) {
  const mailOptions = {
    from: "Communitysponsor.org",
    to,
    subject: `You've been invited to collaborate on "${proposal.title}"`,
    html: `
          <p>Hi there,</p>
          <p>${message.full_name} (${message.company_name}) has invited you to collaborate on their sponsorship proposal, "${proposal.title}".</p>
          <p>To accept the invitation and get started, click the link below:</p>
          <p><a href="${inviteUrl}" style="background-color: #10b981; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Accept Invitation</a></p>
          <p>This link is unique to you and should not be shared.</p>
          <p>Thanks,<br/>The CommunitySponsor Team</p>
        `,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending email:", error);
    else console.log(`✅ Reminder email sent to ${to}`);
  });
}

exports.getProposalAgent = async (req, res) => {
  var data = req.body;

  const query = `SELECT * from proposal_agents where proposal_id = ?`;

  db.query(query, [data.proposal_id], (err, results) => {
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

exports.deleteAgent = async (req, res) => {
  const { agentId } = req.body;

  const query = `DELETE FROM proposal_agents WHERE id = ?`;

  db.query(query, [agentId], (err, result) => {
    if (err) {
      return res.status(500).json({
        message: "Failed to delete agent",
        error: err,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Agent not found or already deleted",
      });
    }

    res.status(200).json({
      message: "Agent deleted successfully",
      deletedId: agentId,
    });
  });
};
