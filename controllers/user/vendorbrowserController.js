const db = require("../../db");
const { format } = require("date-fns");
const pdfParse = require("pdf-parse");

require("dotenv").config();

exports.getVendorbrowser = async (req, res) => {
  const search = req.body.search || "";
  const category = req.body.category || "all";

  let query = `
    SELECT * FROM vendorprofile
    WHERE business_name LIKE ?
  `;
  let values = [`%${search}%`];

  if (category !== "all") {
    query += ` AND service_category = ?`;
    values.push(category);
  }

  db.query(query, values, (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Vendors fetched successfully",
      results: results,
    });
  });
};

exports.getVendorbrowserProfile = (req, res) => {
  const id = req.body.id;

  const query = `
    SELECT * FROM vendorprofile
    WHERE id =?
  `;

  db.query(query, [id], (err, row) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: ``,
      results: row,
    });
  });
};
exports.getbrowserEvents = async (req, res) => {
  const query = `SELECT * FROM events WHERE status =? And marketplace_requests_enabled =?`;

  db.query(query, ["published", "1"], (err, results) => {
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
exports.createeventTovendor = async (req, res) => {
  const data = req.body;

  const {
    hostdetail,
    event_name,
    event_date,
    event_time,
    location,
    description,
    services_needed,
    budget_range,
    expected_attendees,
    deadline,
    host_id,
    proposaldata,
  } = data;

  const created_at = new Date();

  const insertQuery = `
    INSERT INTO events (
    marketplace_requests_enabled,
      title,
      proposal_id,
      start_date,
      start_time,
      end_date,
      location,
      description,
      requested_services,
      expected_attendance,
      budget_range,
      vendor_offer_deadline,
      status,
      host_id,
      created_by_id,
      created_by,
      created_at
      
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    "1",
    event_name,
    proposaldata,
    event_date,
    event_time,
    new Date(deadline),
    location,
    description,
    JSON.stringify(services_needed),
    expected_attendees,
    budget_range,
    new Date(deadline),
    "published",
    host_id,
    hostdetail.id,
    hostdetail.email,
    created_at,
  ];

  db.query(insertQuery, values, (err, result) => {
    if (err) {
      console.error("Insert Error:", err);
      return res.status(500).json({ message: "Insert failed", error: err });
    }

    const eventId = result.insertId;
    return res.status(201).json({
      message: "Event and proposal updated successfully",
      insertId: eventId,
    });
    // Now update event_id in sponsorshipproposal_export table
    //   const updateQuery = `
    //   UPDATE sponsorshipproposal_export
    //   SET event_id = ?
    //   WHERE id = ?
    // `;

    //   db.query(
    //     updateQuery,
    //     [eventId, proposaldata],
    //     (updateErr, updateResult) => {
    //       if (updateErr) {
    //         console.error("Update Error:", updateErr);
    //         return res.status(500).json({
    //           message: "Event created, but failed to update proposal",
    //           error: updateErr,
    //         });
    //       }

    //       return res.status(201).json({
    //         message: "Event and proposal updated successfully",
    //         insertId: eventId,
    //       });
    //     }
    //   );
  });
};

exports.EventForVendors = async (req, res) => {
  var data = req.body;
  const query = `SELECT id,
      title,
      description,
      location,
      start_date AS event_date,
      start_time,
      end_date,
      marketplace_requests_enabled,requested_services as services_needed,expected_attendance,budget_range FROM events WHERE id =? And marketplace_requests_enabled =?`;

  db.query(query, [data.id, "1"], (err, row) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: ``,
      results: row,
    });
  });
};

exports.VendorProfileEntity = async (req, res) => {
  var data = req.body;
  const query = `SELECT * FROM vendorprofile WHERE user_id =?`;

  db.query(query, [data.user_id], (err, row) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: ``,
      results: row,
    });
  });
};
exports.VendorOffer = async (req, res) => {
  const data = req.body;
  const insertQuery = `
    INSERT INTO vendor_offers (
      event_id,
      vendor_profile_id,
      service_type,
      offered_price,
      service_description,
      includes,
      message_to_host,
      portfolio_items,
      availability_confirmed,
      valid_until,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    data.event_id,
    data.vendor_profile_id,
    data.service_type,
    data.offered_price,
    data.service_description,
    JSON.stringify(data.includes || []), // store array as JSON
    data.message_to_host || null,
    JSON.stringify(data.portfolio_items || []), // store array as JSON
    data.availability_confirmed ?? 1, // default to 1 if not provided
    data.valid_until ? new Date(data.valid_until) : null,
    "pending",
  ];

  db.query(insertQuery, values, (err, result) => {
    if (err) {
      console.error("Insert Error:", err);
      return res.status(500).json({
        message: "Insert failed",
        error: err,
      });
    }

    return res.status(201).json({
      message: "Vendor offer inserted successfully",
      insertId: result.insertId,
    });
  });
};
