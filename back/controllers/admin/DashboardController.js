const db = require("../../db");
const nodemailer = require('nodemailer');
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const axios = require("axios");

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_API = "https://api-m.sandbox.paypal.com"; // switch to live when ready



const transporter = nodemailer.createTransport({
  service: 'gmail', // or your SMTP provider
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  }
});



// Helper: Generate PayPal access token
async function generateAccessToken() {
  const auth = Buffer.from(PAYPAL_CLIENT_ID + ":" + PAYPAL_SECRET).toString("base64");
  const response = await axios.post(
    PAYPAL_API + "/v1/oauth2/token",
    "grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );
  return response.data.access_token;
}

// Create PayPal order and save to host_payments
 exports.createpaypalorder = async (req, res) => {
  try {
    const { amount, hostId, proposalId, paymentMethod } = req.body;

    const accessToken = await generateAccessToken();

    // Get host email
    const hostQuery = `SELECT email FROM register WHERE id = ? LIMIT 1`;
    db.query(hostQuery, [hostId], async (err, hostResults) => {
      if (err) return res.status(500).json({ success: false, message: "Database error fetching host", error: err });
      if (!hostResults.length || !hostResults[0].email) return res.status(400).json({ success: false, message: "Host PayPal email not found" });

      const hostEmail = hostResults[0].email;

      // Create PayPal order
      const order = await axios.post(
        `${PAYPAL_API}/v2/checkout/orders`,
        {
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: proposalId,
              amount: { currency_code: "USD", value: amount.toFixed(2) },
              payee: { email_address: hostEmail },
            },
          ],
          application_context: {
            brand_name: "YourApp",
            landing_page: "LOGIN",
            user_action: "PAY_NOW",
            return_url: "https://communitysponsoradmin.com/admindashboard/",
            cancel_url: "https://communitysponsoradmin.com/admindashboard/",
          },
        },
        { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
      );

      const approvalUrl = order.data.links.find(link => link.rel === "approve")?.href;
      if (!approvalUrl) return res.status(400).json({ success: false, message: "No approval URL from PayPal" });

      // Only return order info; do not insert yet
      res.json({ success: true, approvalUrl, orderId: order.data.id });
    });
  } catch (error) {
    console.error("PayPal create order error:", error.response?.data || error.message);
    res.status(500).json({ success: false, message: "Failed to create PayPal order" });
  }
};


 exports.capturePaypalOrder = async (req, res) => {
  try {
    const { orderId, hostId, proposalId, amount, paymentMethod } = req.body;

    const accessToken = await generateAccessToken();

    const capture = await axios.post(
      `${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`,
      {},
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );

    if (capture.data.status === "COMPLETED") {
      // Insert payment record only if capture is successful
      const query = `
        INSERT INTO host_payments
          (host_id, event_id, payment_type, amount, payment_method, transaction_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      const values = [hostId, proposalId, "transfer", amount, "paypal", orderId, "succeeded"];

      db.query(query, values, (err, result) => {
        if (err) return res.status(500).json({ success: false, message: "Database insert error", error: err });

        res.json({ success: true, capture, paymentRecordId: result.insertId });
      });
    } else {
      res.status(400).json({ success: false, message: "Payment not completed", capture });
    }
  } catch (err) {
    console.error("PayPal capture error:", err.response?.data || err.message);
    res.status(500).json({ success: false, message: "Failed to capture PayPal order" });
  }
};



//  paypal Integration End 


exports.getusers = async (req, res) => {
  const query = `
    SELECT * 
    FROM register
    WHERE full_name <> 'admin'
    ORDER BY id DESC
    LIMIT 100
  `;

  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Users fetched",
      results,
    });
  });
};


exports.getsponpays = async (req, res) => {
  const query = `
   SELECT sp.*, r.stripe_account_id, r.full_name, r.email
FROM sponsorship_payments sp
JOIN register r ON sp.sponsor_id = r.id
ORDER BY sp.id ASC
LIMIT 100;
  `;

  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Sponser Fetched",
      results,
    });
  });
};


exports.gethostpayments = async (req, res) => {
  const query = `
   SELECT hp.*, r.stripe_account_id, r.full_name, r.email
FROM host_payments hp
JOIN register r ON hp.host_id = r.id
ORDER BY hp.host_id  ASC
LIMIT 100;
  `;

  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Sponser Fetched",
      results,
    });
  });
};



 
exports.paytohost = async (req, res) => {

  const { amount, hostId, proposalId, paymentType, paymentMethod } = req.body;

  const query = `SELECT stripe_account_id, email FROM register WHERE id = ?;`;
  db.query(query, [hostId], async (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ success: false, message: "Database query failed." });
    }

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: "Host not found." });
    }

    const hostAccountId = results[0].stripe_account_id;
    const hostEmail = results[0].email;
    if (!hostAccountId) {
      return res.status(400).json({ success: false, message: "Host account ID not available." });
    }

  try {

    const transfer = await stripe.transfers.create({
      amount: Math.round(amount * 100),
      currency: "usd",
      destination: hostAccountId,
    });

    const query = `
      INSERT INTO host_payments
        (host_id, event_id, payment_type, amount, payment_method, transaction_id, status)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
    `;

    await db.execute(query, [
      hostId,
      proposalId,
      paymentType,
      amount,
      paymentMethod,
      transfer.id,
      'succeeded'
    ]);

   
    const updateQuery = `
      UPDATE sponsorship_payments
      SET paytohoststatus = 'yes'
      WHERE proposal_id = ?
    `;
    await db.execute(updateQuery, [proposalId]);
 
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: hostEmail,
        subject: 'Payment Received',
        text: `Hello,
We are pleased to inform you that a payment of $${amount} has been successfully transferred to your account.
Transaction ID: ${transfer.id}

Thank you for partnering with us.
Best regards`
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error("Email sending error:", error);
          // Optionally you can still send the response even if email fails
        } else {
          console.log("Email sent: " + info.response);
        }
      });

      // Respond to API call
      res.json({ success: true, transfer });
 
  } catch (error) {
    console.error("Stripe transfer error:", error);
    res.status(500).json({ success: false, message: error.message });
  }

});
}


exports.getinvoices = async (req, res) => {
  const { user_id } = req.body; // get user_id from request body

  if (!user_id) {
    return res.status(400).json({
      message: "user_id is required",
    });
  }

  const query = `
 SELECT 
    hp.*, 
    sp.title,
    spay.id AS spay_id,
    spay.proposal_id,
    spay.sponsor_id,
    spay.host_id AS spay_host_id,
    spay.selectedtiers,
    r.id, r.full_name, r.email 
FROM host_payments hp
LEFT JOIN sponsorshipproposal_export sp
    ON hp.event_id = sp.id
LEFT JOIN sponsorship_payments spay
    ON hp.event_id = spay.proposal_id
   AND hp.host_id = spay.host_id
LEFT JOIN register r
    ON spay.sponsor_id = r.id   
WHERE hp.host_id = ?
ORDER BY hp.host_id DESC
LIMIT 100;
  `;
 
  db.query(query, [user_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Invoices fetched",
      results,
    });
  });
};