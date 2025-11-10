const bcrypt = require("bcryptjs");
const db = require("../../db");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const JWT_SECRET = process.env.JWT_SECRET;

exports.login = (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  db.query(
    "SELECT * FROM admin WHERE email = ?",
    [email],
    async (err, rows) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      if (rows.length === 0) {
        return res
          .status(200)
          .json({ status: "2", message: "Invalid email or password" });
      }

      const user = rows[0];
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res
          .status(200)
          .json({ status: "2", message: "Invalid email or password" });
      }

      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
        expiresIn: "1h",
      });

      res.status(200).json({
        message: "Login successfully",
        status: "1",
        user: {
          id: user.id,
          admintoken: token,
          email: user.email,
        },
        access_token: token,
      });
    }
  );
};
