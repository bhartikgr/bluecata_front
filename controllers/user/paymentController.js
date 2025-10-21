const crypto = require("crypto");
const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");
const axios = require("axios");
const { format } = require("date-fns");
const OpenAI = require("openai");
const Stripe = require("stripe");
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
const AIRWALLEX_BASE_URL = process.env.AIRWALLEX_BASE_URL;
exports.getAirwallexAccessToken = async (req, res) => {
  try {
    const response = await axios.request({
      url: `${AIRWALLEX_BASE_URL}/authentication/login`,
      method: "post",
      headers: {
        "x-client-id": process.env.AIRWALLEX_CLIENT_ID,
        "x-api-key": process.env.AIRWALLEX_API_KEY,
        "Content-Type": "application/json",
      },
    });

    const accessToken = response.data.access_token; // returned by Airwallex
    return res.status(200).json({ accessToken });
  } catch (err) {
    console.error("Airwallex auth error:", err.response?.data || err.message);
    return res.status(500).json({ error: err.response?.data || err.message });
  }
};
exports.access_token = async (req, res) => {
  try {
    const response = await axios.post(
      AIRWALLEX_BASE_URL + "/api/v1/authentication/login",
      {}, // Body can be empty
      {
        headers: {
          "x-client-id": process.env.AIRWALLEX_CLIENT_ID,
          "x-api-key": process.env.AIRWALLEX_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(200).json({ accessToken: response.data.token });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
};

exports.auth_code = async (req, res) => {
  try {
    const { accessToken } = req.body;
    // Generate code_verifier and code_challenge (RFC7636 / PKCE)

    const code_verifier = crypto.randomBytes(32).toString("hex");
    const code_challenge = crypto
      .createHash("sha256")
      .update(code_verifier)
      .digest("base64url"); // base64url encoding

    // Call Airwallex authorize endpoint
    const response = await axios.post(
      AIRWALLEX_BASE_URL + "/api/v1/authentication/authorize",
      {
        code_challenge,
        scope: [
          "w:awx_action:pa_edit", // ✅ Create PaymentIntent
          "r:awx_action:pa_view",
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(200).json({
      auth_code: response.data.authorization_code,
      code_verifier,
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
};
// ✅ CORRECTED: Accept token from frontend, don't fetch again
exports.create_payment_intent = async (req, res) => {
  try {
    const { amount = 100, currency = "INR", accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: "Access token is required" });
    }

    // Validate amount (must be in cents/smallest currency unit)
    const amountInCents = parseInt(amount);
    if (amountInCents < 1) {
      return res.status(400).json({ error: "Amount must be greater than 0" });
    }

    const paymentData = {
      request_id: `req_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`,
      amount: amountInCents,
      currency: currency.toUpperCase(),
      merchant_order_id: `order_${Date.now()}`,
      // Optional but recommended for demo
      metadata: {
        environment: "demo",
        created_at: new Date().toISOString(),
      },
    };

    console.log("Creating payment intent:", paymentData);

    const response = await axios.post(
      `${AIRWALLEX_BASE_URL}/api/v1/pa/payment_intents/create`,
      paymentData,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Payment intent created:", response.data.id);

    return res.status(200).json({
      success: true,
      paymentIntentId: response.data.id,
      clientSecret: response.data.client_secret,
      status: response.data.status,
    });
  } catch (err) {
    console.error(
      "❌ Payment Intent error:",
      err.response?.data || err.message
    );

    const errorCode = err.response?.data?.code;
    let hint = "Unknown error occurred";
    console.log(errorCode);
    if (errorCode === "configuration_error") {
      hint =
        "Your demo account is not configured. Please:\n" +
        "1. Login to https://demo.airwallex.com\n" +
        "2. Complete account setup\n" +
        "3. Enable Payment Acceptance in Settings\n" +
        "4. Verify your API credentials";
    } else if (errorCode === "invalid_request_error") {
      hint = "Check payment intent parameters (amount, currency)";
    } else if (err.response?.status === 401) {
      hint = "Access token expired or invalid. Request a new token.";
    }

    return res.status(err.response?.status || 500).json({
      error: err.response?.data || { message: err.message },
      hint: hint,
    });
  }
};
exports.create_redirect_payment_intent = async (req, res) => {
  try {
    const { amount = 100, currency = "USD", accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: "Access token is required" });
    }

    const paymentData = {
      request_id: `req_${Date.now()}`,
      amount: amount, // amount in major currency unit
      currency: currency,
      merchant_order_id: `order_${Date.now()}`,
      return_url: "https://yourwebsite.com/payment-success",
      cancel_url: "https://yourwebsite.com/payment-cancel",
      payment_method: {
        type: "card",
      },
    };

    console.log("Creating redirect payment intent:", paymentData);

    const response = await axios.post(
      `${AIRWALLEX_BASE_URL}/api/v1/pa/payment_intents/create`,
      paymentData,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const intent = response.data;

    // Now create a Payment Attempt (redirect link)
    const redirectResp = await axios.post(
      `${AIRWALLEX_BASE_URL}/api/v1/pa/payment_attempts/create`,
      {
        request_id: `attempt_${Date.now()}`,
        payment_intent_id: intent.id,
        // Airwallex hosted page
        payment_method: {
          type: "card_redirect",
        },
        // Optional: If you want to force redirect flow
        return_url: "https://yourwebsite.com/payment-success",
        cancel_url: "https://yourwebsite.com/payment-cancel",
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const hostedUrl = redirectResp.data.next_action.redirect_to_url;

    return res.status(200).json({
      success: true,
      paymentIntentId: intent.id,
      hostedUrl,
    });
  } catch (err) {
    console.error(
      "Payment Intent Redirect error:",
      err.response?.data || err.message
    );
    return res.status(500).json({ error: err.response?.data || err.message });
  }
};
