const db = require("../../db");
const nodemailer = require("nodemailer");

require("dotenv").config();
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
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

  // Check if record already exists for this event_id and vendor_profile_id
  const checkQuery = `
    SELECT id 
    FROM vendor_offers 
    WHERE event_id = ? AND vendor_profile_id = ?
  `;

  db.query(checkQuery, [data.event_id, data.vendor_profile_id], (err, rows) => {
    if (err) {
      console.error("Select Error:", err);
      return res.status(500).json({
        message: "Check failed",
        error: err,
      });
    }

    if (rows.length > 0) {
      // record exists → update instead
      const updateQuery = `
        UPDATE vendor_offers
        SET service_type = ?,
            offered_price = ?,
            service_description = ?,
            includes = ?,
            message_to_host = ?,
            portfolio_items = ?,
            availability_confirmed = ?,
            valid_until = ?,
            status = ?
        WHERE event_id = ? AND vendor_profile_id = ?
      `;

      const updateValues = [
        data.service_type,
        data.offered_price,
        data.service_description,
        JSON.stringify(data.includes || []),
        data.message_to_host || null,
        JSON.stringify(data.portfolio_items || []),
        data.availability_confirmed ?? 1,
        data.valid_until ? new Date(data.valid_until) : null,
        "pending",
        data.event_id,
        data.vendor_profile_id,
      ];

      db.query(updateQuery, updateValues, (err, result) => {
        if (err) {
          console.error("Update Error:", err);
          return res.status(500).json({
            message: "Update failed",
            error: err,
          });
        }

        return res.status(200).json({
          message: "Vendor offer updated successfully",
          affectedRows: result.affectedRows,
        });
      });
    } else {
      // no record found → insert new (your existing code)
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

      const insertValues = [
        data.event_id,
        data.vendor_profile_id,
        data.service_type,
        data.offered_price,
        data.service_description,
        JSON.stringify(data.includes || []),
        data.message_to_host || null,
        JSON.stringify(data.portfolio_items || []),
        data.availability_confirmed ?? 1,
        data.valid_until ? new Date(data.valid_until) : null,
        "pending",
      ];

      db.query(insertQuery, insertValues, (err, result) => {
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
    }
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

  const checkQuery = `SELECT id FROM vendorprofile WHERE user_id = ?`;

  db.query(checkQuery, [userdata.id], (err, result) => {
    if (err) {
      return res.status(500).json({
        message: "Database check error",
        error: err,
      });
    }

    if (result.length > 0) {
      // --- Row exists → UPDATE ---
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

      db.query(
        query,
        [
          social_links.facebook,
          social_links.instagram,
          social_links.twitter,
          social_links.linkedin,
          data.profile_image, // logo_url
          data.business_name, // business_name
          data.profile_image, // profile_image_url
          data.service_description, // bio
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
              JSON.stringify(data.social_links),
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
    } else {
      // --- Row does not exist → INSERT ---
      const insertQuery = `
        INSERT INTO vendorprofile 
        (facebook, instagram, twitter, linkedin, logo_url, business_name, profile_image_url, bio, service_area, video_link, updated_date, user_id) 
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `;

      db.query(
        insertQuery,
        [
          social_links.facebook,
          social_links.instagram,
          social_links.twitter,
          social_links.linkedin,
          data.profile_image, // logo_url
          data.business_name,
          data.profile_image,
          data.service_description,
          data.service_area,
          data.video_link,
          new Date(),
          userdata.id,
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
              JSON.stringify(data.social_links),
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
            message: "Service inserted successfully",
          });
        }
      );
    }
  });
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
  const query = `SELECT * FROM vendor_leads WHERE vendor_profile_id =? order by id desc limit 50`;

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
exports.VendorLeadsGetall = async (req, res) => {
  var data = req.body;
  const query = `SELECT * FROM vendor_leads WHERE vendor_profile_id =? order by id desc limit 50`;

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

exports.VendorProfileEntityList50 = async (req, res) => {
  var data = req.body;
  const query = `SELECT * FROM vendorprofile order by id limit 50`;

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
exports.getvendorRegisterdata = async (req, res) => {
  var data = req.body;
  const query = `SELECT * FROM register where id =?`;

  db.query(query, [data.id], (err, row) => {
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
exports.VendorProfileEntityUpdate = async (req, res) => {
  const { id, updates } = req.body;

  if (!id || !updates) {
    return res.status(400).json({ message: "id and updates are required" });
  }

  const fields = Object.keys(updates)
    .map((key) => `${key} = ?`)
    .join(", ");
  const values = Object.values(updates);

  const query = `
    UPDATE vendorprofile
    SET ${fields}
    WHERE id = ?
  `;

  db.query(query, [...values, id], (err, result) => {
    if (err) {
      return res.status(500).json({
        message: "Database update error",
        error: err,
      });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Vendor profile not found" });
    }
    res.status(200).json({
      message: "Vendor profile updated successfully",
    });
  });
};

exports.getUserDetail = (req, res) => {
  const id = req.body.id;

  const query = `
    SELECT * FROM register
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
exports.getServiceListing = (req, res) => {
  const id = req.body.vendor_profile_id;

  const query = `
    SELECT * FROM services
    WHERE vendor_profile_id =?
  `;

  db.query(query, [id], (err, results) => {
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

exports.VendorLeadCreate = (req, res) => {
  const {
    vendor_profile_id,
    client_name,
    client_email,
    client_phone,
    requested_service,
    event_date,
    event_location,
    budget_range,
    message,
    status,
    vendor_details,
    userdetail,
    data_detail,
  } = req.body;

  const insertQuery = `
    INSERT INTO vendor_leads (
      vendor_profile_id,
      client_name,
      client_email,
      client_phone,
      requested_service,
      event_date,
      event_location,
      budget_range,
      message,
      status,
      created_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    vendor_profile_id,
    client_name,
    client_email,
    client_phone,
    requested_service,
    event_date,
    event_location,
    budget_range,
    message,
    status || "new", // default new
    new Date(),
  ];

  db.query(insertQuery, values, (err, result) => {
    if (err) {
      console.error("Insert Error:", err);
      return res.status(500).json({ message: "Insert failed", error: err });
    }
    sendEmailToVendor(
      userdetail.email,
      userdetail,
      data_detail,
      vendor_details
    );
    return res.status(201).json({
      message: "Vendor lead created successfully",
      insertId: result.insertId,
    });
  });
};
//Send email
function sendEmailToVendor(to, user, data, vendor) {
  const subject = `New Lead from ${data.name} - ${vendor.business_name}`;

  const body = `
Hello ${user.full_name},

You have received a new lead through your CommunitySponsor vendor profile!

Client Details:
- Name: ${data.name}
- Email: ${data.email}
- Phone: ${data.phone || "Not provided"}

Event Details:
- Service Requested: ${data.service}
- Event Date: ${data.event_date || "Not specified"}
- Location: ${data.location || "Not specified"}
- Budget: ${data.budget || "Not specified"}

Message:
${data.message}

You can view and manage all your leads in your vendor dashboard.

Best regards,
CommunitySponsor Team
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
exports.VendorLeadUpdate = async (req, res) => {
  const { leadId, newStatus } = req.body;

  const query = `
    UPDATE  vendor_leads
    SET status=?
    WHERE id = ?
  `;

  db.query(query, [newStatus, leadId], (err, result) => {
    if (err) {
      return res.status(500).json({
        message: "Database update error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Updated successfully",
    });
  });
};

exports.VendorProfiledashboard = async (req, res) => {
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
