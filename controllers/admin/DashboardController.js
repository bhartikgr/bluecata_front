const db = require("../../db");
require("dotenv").config();

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
