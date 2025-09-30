const bcrypt = require("bcryptjs");
const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");

require("dotenv").config();

exports.login = (req, res) => {
  const { email, password } = req.body;

  // Check if email and password are provided
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  // Query the database to get the user by email
  db.query(
    "SELECT * FROM admin WHERE email = ?",
    [email],
    async (err, rows) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      if (rows.length > 0) {
        const user = rows[0];

        // Check if password matches
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
          return res
            .status(404)
            .json({ status: "2", message: "Invalid email or password" });
        }

        // Handle user status
        res.status(200).json({
          message: "Login successfully",
          status: "1",
          user: {
            id: user.id,
            email: user.email,
          },
        });
      } else {
        res
          .status(404)
          .json({ status: "2", message: "Invalid email or password" });
      }
    }
  );
};

// Generate OTP (Example)
function generateOTP() {
  const otp = Math.floor(100000 + Math.random() * 900000); // Generates a 6-digit OTP
  return otp.toString();
}
