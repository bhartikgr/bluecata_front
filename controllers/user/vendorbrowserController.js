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

exports.VendorProfile = async (req, res) => {
  var data = req.body;
  const query = `SELECT * FROM vendor_leads WHERE vendor_profile_id =?`;

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
exports.ServiceListing = async (req, res) => {
  var data = req.body;
  const query = `SELECT * FROM services WHERE vendor_profile_id =?`;

  db.query(query, [data.vendor_profile_id], (err, row) => {
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
exports.Servicecreate = async (req, res) => {
  var data = req.body;

  const query = `
    INSERT INTO services 
      (title, description, price_range, tags, vendor_profile_id, service_type, pricing_model,created_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    query,
    [
      data.title,
      data.description,
      data.price_range,
      JSON.stringify(data.tags), // store array as JSON string
      data.vendor_profile_id,
      data.service_type,
      data.pricing_model,
      new Date(),
    ],
    (err, result) => {
      if (err) {
        return res.status(500).json({
          message: "Database insert error",
          error: err,
        });
      }

      res.status(201).json({
        message: "Service created successfully",
        insertedId: result.insertId,
      });
    }
  );
};

exports.ServiceListingDelete = async (req, res) => {
  const data = req.body;
  const query = `DELETE FROM services WHERE id = ?`;

  db.query(query, [data.id], (err, result) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Service not found",
      });
    }

    res.status(200).json({
      message: "Service deleted successfully",
      results: null,
    });
  });
};

exports.editingService = async (req, res) => {
  var data = req.body;

  const query = `
    UPDATE services
    SET title = ?, 
        description = ?, 
        price_range = ?, 
        tags = ?, 
        vendor_profile_id = ?, 
        service_type = ?, 
        pricing_model = ?
        
    WHERE id = ?
  `;

  db.query(
    query,
    [
      data.title,
      data.description,
      data.price_range,
      JSON.stringify(data.tags), // store as JSON string
      data.vendor_profile_id,
      data.service_type,
      data.pricing_model,

      data.id,
    ],
    (err, result) => {
      if (err) {
        return res.status(500).json({
          message: "Database update error",
          error: err,
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({
          message: "Service not found",
        });
      }

      res.status(200).json({
        message: "Service updated successfully",
      });
    }
  );
};

exports.VendorProfileGet = async (req, res) => {
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
exports.VendorProfileCreate = async (req, res) => {
  var data = req.body;
  const { userdata, social_links } = req.body;
  const query = `
    INSERT INTO vendorprofile 
      (facebook,instagram,twitter,linkedin,business_name, bio, service_area, video_link,  created_by, created_by_id,user_id,created_at,created_date,updated_date) 
    VALUES (?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    query,
    [
      social_links.facebook,
      social_links.instagram,
      social_links.twitter,
      social_links.linkedin,
      data.business_name,
      data.service_description,
      data.service_area,
      data.video_link, // store array as JSON string

      userdata.email,
      userdata.id,
      userdata.id,
      new Date(),
      new Date(),
      new Date(),
    ],
    (err, result) => {
      if (err) {
        return res.status(500).json({
          message: "Database insert error",
          error: err,
        });
      }
      const queryup = `
    UPDATE register
    SET phone = ?, 
    profile_image =?,
        website = ?, 
        social_links = ?
    WHERE id = ?
  `;

      db.query(
        queryup,
        [
          data.phone,
          data.profile_image,
          data.website,
          JSON.stringify(data.social_links), // store as JSON string
          userdata.id,
        ],
        (err, result) => {
          if (err) {
            return res.status(500).json({
              message: "Database update error",
              error: err,
            });
          }
        }
      );
      res.status(201).json({
        message: "Vendor profile created successfully",
        insertedId: result.insertId,
      });
    }
  );
};
exports.VendorProfileupdate = async (req, res) => {
  var data = req.body;
  const { userdata, social_links } = req.body;
  const query = `
    UPDATE vendorprofile
    SET facebook=?,instagram=?,twitter=?,linkedin=?,  logo_url = ?,
        business_name = ?, 
        profile_image_url = ?,
        bio = ?, 
        service_area = ?, 
        video_link = ?,
        updated_date = ?
    WHERE user_id = ?
  `;
  console.log(data);
  db.query(
    query,
    [
      social_links.facebook,
      social_links.instagram,
      social_links.twitter,
      social_links.linkedin,
      data.profile_image, // logo_url
      data.business_name, // business_name (was data.title)
      data.profile_image, // profile_image_url
      data.service_description, // bio (was data.bio)
      data.service_area, // service_area
      data.video_link, // video_link
      new Date(), // updated_date
      userdata.id, // user_id
    ],
    (err, result) => {
      if (err) {
        return res.status(500).json({
          message: "Database update error",
          error: err,
        });
      }
      console.log(result);
      const queryup = `
        UPDATE register
        SET phone = ?, 
            profile_image = ?,
            website = ?, 
            social_links = ?
        WHERE id = ?
      `;

      db.query(
        queryup,
        [
          data.phone,
          data.profile_image,
          data.website,
          JSON.stringify(data.social_links), // store as JSON string
          userdata.id,
        ],
        (err, result) => {
          if (err) {
            return res.status(500).json({
              message: "Database update error",
              error: err,
            });
          }
        }
      );

      res.status(200).json({
        message: "Service updated successfully",
      });
    }
  );
};

exports.VendorProfileUpdateImage = async (req, res) => {
  var data = req.body;
  const query = `
    UPDATE register
    SET profile_image = ?
    WHERE id = ?
  `;

  db.query(query, [data.logo_url, data.id], (err, result) => {
    if (err) {
      return res.status(500).json({
        message: "Database update error",
        error: err,
      });
    }
    res.status(200).json({
      message: "",
    });
  });
};
exports.VendorProfileUpdateGalleryImage = async (req, res) => {
  var data = req.body;

  const query = `
    UPDATE vendorprofile
    SET gallery_images = ?
    WHERE user_id = ?
  `;

  db.query(
    query,
    [JSON.stringify(data.gallery_images), data.id],
    (err, result) => {
      if (err) {
        return res.status(500).json({
          message: "Database update error",
          error: err,
        });
      }
      res.status(200).json({
        message: "",
      });
    }
  );
};

exports.VendorLeadsGet = async (req, res) => {
  var data = req.body;
  const query = `SELECT * FROM vendor_leads WHERE vendor_profile_id =?`;

  db.query(query, [data.vendor_profile_id], (err, results) => {
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
