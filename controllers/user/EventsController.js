const db = require("../../db");
const { format } = require("date-fns");
const pdfParse = require("pdf-parse");
require("dotenv").config();

exports.createevent = async (req, res) => {
  const {
    title,
    description,
    location,
    start_date,
    start_time,
    end_date,
    end_time,
    event_platform_link,
    expected_attendance,
    target_audience,
    status,
    host_id,
  } = req.body;

  const created_at = new Date();

  const insertQuery = `
    INSERT INTO events (
      title,
      description,
      location,
      start_date,
      start_time,
      end_date,
      end_time,
      event_platform_link,
      expected_attendance,
      target_audience,
      status,
      host_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    title,
    description,
    location,
    start_date,
    start_time,
    end_date,
    end_time,
    event_platform_link,
    expected_attendance,
    target_audience,
    status,
    host_id,
    created_at,
  ];

  db.query(insertQuery, values, (err, result) => {
    if (err) {
      console.error("Insert Error:", err);
      return res.status(500).json({ message: "Insert failed", error: err });
    }

    return res.status(201).json({
      message: "Event inserted successfully",
      insertId: result.insertId,
    });
  });
};
