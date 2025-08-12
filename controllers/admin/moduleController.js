const bcrypt = require("bcryptjs");
const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");

const { format } = require("date-fns");
require("dotenv").config();
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
exports.getmodulelist = (req, res) => {
  db.query("SELECT * FROM module ORDER BY id DESC", async (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Fetched successfully",
      status: "1",
      results: results, // <-- include the results here
    });
  });
};
exports.savemodule = (req, res) => {
  const name = req.body.name;
  const status = req.body.status;
  const description = req.body.description;

  const textt = req.body.textt;
  var id = req.body.id;
  // SQL query to insert video and max_limit into videomanagement table
  if (id) {
    const query =
      "UPDATE module SET textt=?,description=?, name = ?,status=? WHERE id = ?";

    db.query(query, [textt, description, name, status, id], (err, result) => {
      if (err) {
        console.error("Error updating data in database:", err.stack);
        return res.status(500).json({
          message: "Failed to update video details in database",
        });
      }

      res.status(200).json({
        message: "Module updated successfully",
        id: id,
      });
    });
  } else {
    const query =
      "INSERT INTO module (textt,description,name, status) VALUES (?, ?, ?, ?)";
    db.query(query, [textt, description, name, status], (err, result) => {
      if (err) {
        console.error("Error inserting data into database:", err.stack);
        return res
          .status(500)
          .json({ message: "Failed to insert video details into database" });
      }

      // Respond with success if insertion is successful
      res.status(200).json({
        message: "Module created successfully",
      });
    });
  }
};
exports.moduledelete = (req, res) => {
  const videoId = req.body.id; // ID to be deleted

  if (!videoId) {
    return res.status(400).json({ message: "No video ID provided." });
  }

  // MySQL query to delete the video
  const query = "DELETE FROM module WHERE id = ?";

  db.query(query, [videoId], (error, results) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    if (results.affectedRows > 0) {
      return res.status(200).json({ message: "Video deleted successfully." });
    } else {
      return res.status(404).json({ message: "Video not found." });
    }
  });
};
exports.getmodulerecord = (req, res) => {
  const videoId = req.body.id; // ID to be deleted

  if (!videoId) {
    return res.status(400).json({ message: "No video ID provided." });
  }

  // MySQL query to delete the video
  const query = "SELECT *  FROM module WHERE id = ?";

  db.query(query, [videoId], (error, row) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    return res
      .status(200)
      .json({ message: "Video deleted successfully.", results: row });
  });
};

exports.updatelimit = (req, res) => {
  const name = req.body.name;
  const status = req.body.status;
  const price = req.body.price;
  const description = req.body.description;
  const id = req.body.id;
  const annual_price = req.body.annual_price;
  const textt = req.body.textt;

  const query =
    "UPDATE module SET textt=?,annual_price=?,price=?,description=?, name = ?,status=? WHERE id = ?";

  db.query(
    query,
    [textt, annual_price, price, description, name, status, id],
    (err, result) => {
      if (err) {
        console.error("Error updating data in database:", err.stack);
        return res.status(500).json({
          message: "Failed to update video details in database",
        });
      }

      res.status(200).json({
        message: "Module updated successfully",
        id: id,
      });
    }
  );
};

exports.getallUsersMeetinglist = (req, res) => {
  // MySQL query to delete the video
  var user_id = req.body.user_id;
  const query =
    "SELECT zoommeeting_register.name, zoommeeting_register.email, zoommeeting.*, module.name AS module_name FROM zoommeeting_register LEFT JOIN zoommeeting ON zoommeeting.zoom_register_id = zoommeeting_register.id LEFT JOIN module ON module.id = zoommeeting.module_id WHERE zoom_register_id = ?;";

  db.query(query, [user_id], (error, row) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    return res
      .status(200)
      .json({ message: "Video deleted successfully.", results: row });
  });
};
function getFormattedDateTime(timeZone) {
  const date = new Date();

  const options = {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false, // 24-hour format
  };

  const formatter = new Intl.DateTimeFormat("en-CA", options);
  const parts = formatter.formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value || "";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

exports.getallUsersDetaillist = (req, res) => {
  const query = `
    SELECT zoommeeting.*, module.name AS module_name 
    FROM zoommeeting 
    JOIN module ON module.id = zoommeeting.module_id 
    ORDER BY zoommeeting.id DESC;
  `;

  db.query(query, (error, results) => {
    if (error) {
      console.error("Error getting meeting data:", error);
      return res.status(500).json({ message: "Error fetching meeting data." });
    }

    // Fix meeting_date format before sending to frontend
    const formattedResults = results.map((row) => ({
      ...row,
      meeting_date: row.meeting_date
        ? require("moment")(row.meeting_date).format("YYYY-MM-DD")
        : null,
    }));

    return res.status(200).json({
      message: "Meeting list fetched successfully",
      results: formattedResults,
    });
  });
};

exports.mettingDelete = (req, res) => {
  const id = req.body.id; // Meeting ID to delete

  if (!id) {
    return res.status(400).json({ message: "No meeting ID provided." });
  }

  // Step 1: Delete from zoommeeting
  const deleteZoomQuery = "DELETE FROM zoommeeting WHERE id = ?";
  db.query(deleteZoomQuery, [id], (error, results) => {
    if (error) {
      console.error("❌ Error deleting zoommeeting:", error);
      return res.status(500).json({ message: "Error deleting meeting." });
    }

    // Step 2: Delete from upcomingmoduleemail
    const deleteEmailQuery =
      "DELETE FROM upcomingmoduleemail WHERE zoommeeting_id = ?";
    db.query(deleteEmailQuery, [id], (error) => {
      if (error) {
        console.error("❌ Error deleting from upcomingmoduleemail:", error);
        return res
          .status(500)
          .json({ message: "Error deleting related email data." });
      }

      // Step 3: Update zoommeeting_register to remove the meeting ID
      const getRegisters =
        "SELECT id, registered_meeting_ids FROM zoommeeting_register";
      db.query(getRegisters, async (error, results) => {
        if (error) {
          console.error("❌ Error fetching zoommeeting_register:", error);
          return res
            .status(500)
            .json({ message: "Error updating register data." });
        }

        // Loop through each record and remove the meeting ID if it exists
        for (const row of results) {
          let ids = [];

          try {
            ids = JSON.parse(row.registered_meeting_ids || "[]");
          } catch (e) {
            continue;
          }

          if (ids.includes(id)) {
            const updatedIds = ids.filter((mid) => mid !== id);
            const updateQuery =
              "DELETE from zoommeeting_register  WHERE id = ?";
            db.query(updateQuery, [row.id], (err) => {
              if (err) {
                console.error("❌ Error updating registered_meeting_ids:", err);
              }
            });
          }
        }

        return res.status(200).json({
          message: "✅ Successfully deleted all related meeting data.",
        });
      });
    });
  });
};

exports.getallUserList = (req, res) => {
  const id = req.body.id; // ID to be deleted

  if (!id) {
    return res.status(400).json({ message: "No video ID provided." });
  }

  // MySQL query to delete the video
  const query = "SELECT *  FROM zoommeeting_register WHERE id = ?";

  db.query(query, [id], (error, results) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting." });
    }

    return res
      .status(200)
      .json({ message: "Successfully deleted", results: results });
  });
};
exports.getallcompnay = (req, res) => {
  // MySQL query to delete the video
  const query =
    "SELECT company.*, referralusage.discount_code FROM company LEFT JOIN referralusage ON referralusage.used_by_company_id = company.id ORDER BY company.id DESC;";

  db.query(query, (error, results) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting." });
    }

    return res
      .status(200)
      .json({ message: "Successfully deleted", results: results });
  });
};

exports.getallcatgeorylist = (req, res) => {
  // MySQL query to delete the video
  const query =
    "SELECT c.id, c.name, COUNT(s.id) AS subcategory_count FROM dataroomcategories c LEFT JOIN dataroomsub_categories s ON s.dataroom_id = c.id GROUP BY c.id, c.name ORDER BY c.id DESC;";

  db.query(query, (error, results) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    return res
      .status(200)
      .json({ message: "Video deleted successfully.", results: results });
  });
};

exports.dataroomcategorydelete = (req, res) => {
  const id = req.body.id; // ID to be deleted

  if (!id) {
    return res.status(400).json({ message: "No video ID provided." });
  }

  // MySQL query to delete the video

  const querycheck = "SELECT * from dataroomai_summary where category_id =?";

  db.query(querycheck, [id], (error, results) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }
    if (results.length > 0) {
      return res.status(200).json({
        message:
          "This category cannot be deleted because it is currently associated with a user",
      });
    } else {
      const query = "DELETE FROM dataroomcategories WHERE id = ?";

      db.query(query, [id], (error, results) => {
        if (error) {
          console.error("Error deleting video:", error);
          return res.status(500).json({ message: "Error deleting video." });
        }

        const querys =
          "DELETE FROM dataroomsub_categories WHERE dataroom_id = ?";

        db.query(querys, [id], (error, results) => {
          if (error) {
            console.error("Error deleting video:", error);
            return res.status(500).json({ message: "Error deleting video." });
          }

          return res.status(200).json({ message: "Deleted successfully." });
        });
      });
    }
  });
};

exports.getsubcategorylist = (req, res) => {
  // MySQL query to delete the video
  var id = req.body.id;
  const query =
    "SELECT * from dataroomsub_categories where dataroom_id =? order by id desc";

  db.query(query, [id], (error, results) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    return res
      .status(200)
      .json({ message: "Video deleted successfully.", results: results });
  });
};
exports.checkCatgeory = (req, res) => {
  // MySQL query to delete the video
  var id = req.body.id;
  const query = "SELECT * from dataroomcategories where id =?";

  db.query(query, [id], (error, results) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    return res
      .status(200)
      .json({ message: "Video deleted successfully.", results: results });
  });
};
exports.savedataroomtip = (req, res) => {
  var id = req.body.id;
  if (id) {
    const query =
      "UPDATE dataroomsub_categories SET name=?,tips=? WHERE id = ?";

    db.query(query, [req.body.name, req.body.texttip, id], (err, result) => {
      if (err) {
        console.error("Error updating data in database:", err.stack);
        return res.status(500).json({
          message: "Failed to update video details in database",
        });
      }

      res.status(200).json({
        message: "Sub catgeory updated successfully",
      });
    });
  } else {
    const query =
      "INSERT INTO dataroomsub_categories (dataroom_id,name,tips) VALUES (?, ?, ?)";

    db.query(
      query,
      [req.body.dataroomid, req.body.name, req.body.texttip],
      (err, result) => {
        if (err) {
          console.error("Error updating data in database:", err.stack);
          return res.status(500).json({
            message: "Failed to update video details in database",
          });
        }

        res.status(200).json({
          message: "Sub catgeory created successfully",
        });
      }
    );
  }
};
exports.dataroomPaymentadd = (req, res) => {
  const query = "SELECT * from subscriptiondataroom where id = 1";

  db.query(query, (error, results) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }
    if (results.length > 0) {
      const query =
        "UPDATE subscriptiondataroom SET investorAnnual_Fee=?,onetime_Fee=?,perInstance_Fee=?,academy_Fee=? WHERE id = 1";

      db.query(
        query,
        [
          req.body.investorAnnual_Fee,
          req.body.onetime_Fee,
          req.body.perInstance_Fee,
          req.body.academy_Fee,
        ],
        (err, result) => {
          if (err) {
            console.error("Error updating data in database:", err.stack);
            return res.status(500).json({
              message: "Failed to update video details in database",
            });
          }

          res.status(200).json({
            message: "Successfully updated",
          });
        }
      );
    } else {
      const query =
        "INSERT INTO subscriptiondataroom (investorAnnual_Fee,onetime_Fee,perInstance_Fee,academy_Fee) VALUES (?,?,?,?)";
      db.query(
        query,
        [
          req.body.investorAnnual_Fee,
          req.body.onetime_Fee,
          req.body.perInstance_Fee,
          req.body.academy_Fee,
        ],
        (err, result) => {
          if (err) {
            console.error("Error inserting data into database:", err.stack);
            return res.status(500).json({
              message: "Failed to insert video details into database",
            });
          }

          // Respond with success if insertion is successful
          res.status(200).json({
            message: "Successfully Saved ",
          });
        }
      );
    }
  });
};

exports.getDataroompayment = (req, res) => {
  const query = "SELECT * from subscriptiondataroom where id = 1";

  db.query(query, (error, row) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    res.status(200).json({
      message: "Successfully updated",
      row: row,
    });
  });
};
exports.userSubscriptionDataRoom = (req, res) => {
  var data = req.body;
  let formData = {
    user_id: data.user_id,
    price: data.user_id,
    created_at: "",
  };
  var date = new Date();
  const query =
    "INSERT INTO usersubscriptiondataroomone_time (user_id,price, created_at) VALUES (?,?,?)";
  db.query(query, [data.user_id, data.price, date], (err, result) => {
    if (err) {
      console.error("Error inserting data into database:", err.stack);
      return res
        .status(500)
        .json({ message: "Failed to insert video details into database" });
    }

    // Respond with success if insertion is successful
    res.status(200).json({
      message: "",
    });
  });
};
exports.getCheckOnetimePayment = (req, res) => {
  var data = req.body;
  const query =
    "SELECT * from  usersubscriptiondataroomone_time where user_id = ? order by id desc";

  db.query(query, [data.user_id], (error, row) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    res.status(200).json({
      message: "Successfully updated",
      row: row,
    });
  });
};
exports.getcompanypayment = (req, res) => {
  var id = req.body.id;
  const query = `
    SELECT *
    FROM usersubscriptiondataroomone_time  where user_id =?
    ORDER BY id DESC
  `;
  db.query(query, [id], (error, results) => {
    if (error) {
      console.error("Error fetching payment data:", error);
      return res.status(500).json({ message: "Error fetching data." });
    }

    res.status(200).json({
      message: "Successfully fetched data",
      results: results,
    });
  });
};
exports.getcompanypaymentAnnual = (req, res) => {
  var id = req.body.id;
  const query = `
    SELECT *
    FROM userinvestorreporting_subscription where user_id =?
    ORDER BY id DESC
  `;
  db.query(query, [id], (error, results) => {
    if (error) {
      console.error("Error fetching payment data:", error);
      return res.status(500).json({ message: "Error fetching data." });
    }

    res.status(200).json({
      message: "Successfully fetched data",
      results: results,
    });
  });
};
exports.getPerinstanceFee = (req, res) => {
  var id = req.body.usersubscriptiondataroomone_time_id;
  const query = `
    SELECT *
    FROM usersubscriptiondataroom_perinstance where usersubscriptiondataroomone_time_id = ? 
    ORDER BY id DESC
  `;
  db.query(query, [id], (error, results) => {
    if (error) {
      console.error("Error fetching payment data:", error);
      return res.status(500).json({ message: "Error fetching data." });
    }
    //console.log(results);
    res.status(200).json({
      message: "Successfully fetched data",
      results: results,
    });
  });
};

exports.addDataroomCategory = (req, res) => {
  const name = req.body.name;
  const id = req.body.id;
  const category_tips = req.body.category_tips;
  const document_tips = req.body.document_tips;
  const exits_tips = req.body.exits_tips;

  // SQL query to insert video and max_limit into videomanagement table
  if (id) {
    const query =
      "UPDATE dataroomcategories SET name=?,category_tips=?,document_tips=?,exits_tips=? WHERE id = ?";
    db.query(
      query,
      [name, category_tips, document_tips, exits_tips, id],
      (err, result) => {
        if (err) {
          console.error("Error inserting data into database:", err.stack);
          return res
            .status(500)
            .json({ message: "Failed to insert video details into database" });
        }

        // Respond with success if insertion is successful
        res.status(200).json({
          message: "Category updated successfully",
        });
      }
    );
  } else {
    const query =
      "INSERT INTO dataroomcategories (name,category_tips,document_tips,exits_tips) VALUES (?, ?, ?, ?)";
    db.query(
      query,
      [name, category_tips, document_tips, exits_tips],
      (err, result) => {
        if (err) {
          console.error("Error inserting data into database:", err.stack);
          return res
            .status(500)
            .json({ message: "Failed to insert video details into database" });
        }

        // Respond with success if insertion is successful
        res.status(200).json({
          message: "Category saved successfully",
        });
      }
    );
  }
};

exports.getcategoryData = (req, res) => {
  var id = req.body.id;
  const query = `
    SELECT *
    FROM dataroomcategories where id =?
  `;
  db.query(query, [id], (error, row) => {
    if (error) {
      console.error("Error fetching payment data:", error);
      return res.status(500).json({ message: "Error fetching data." });
    }

    res.status(200).json({
      message: "Successfully fetched data",
      results: row,
    });
  });
};

exports.deletesubcategory = (req, res) => {
  const id = req.body.id; // ID to be deleted

  if (!id) {
    return res.status(400).json({ message: "No video ID provided." });
  }

  // MySQL query to delete the video

  const querys = "DELETE FROM dataroomsub_categories WHERE id = ?";

  db.query(querys, [id], (error, results) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    return res.status(200).json({ message: "Deleted successfully." });
  });
};

exports.discountAddEdit = (req, res) => {
  var data = req.body;
  var expdate = new Date(data.exp_date);
  var date = new Date();

  // No conversion to comma string now — keep it as JSON
  const typeJson = JSON.stringify(data.type); // 👈 store array as JSON string

  if (data.id) {
    const query =
      "UPDATE discount_code SET type=?, usage_limit=?, percentage=?, exp_date=? WHERE id = ?";
    db.query(
      query,
      [typeJson, data.usage_limit, data.percentage, expdate, data.id],
      (err, result) => {
        if (err) {
          console.error("Error updating discount code:", err.stack);
          return res
            .status(500)
            .json({ message: "Failed to update discount code" });
        }

        res.status(200).json({ message: "Successfully updated" });
      }
    );
  } else {
    const query =
      "INSERT INTO discount_code (type, usage_limit, code, percentage, exp_date, created_at) VALUES (?, ?, ?, ?, ?, ?)";
    db.query(
      query,
      [typeJson, data.usage_limit, data.code, data.percentage, expdate, date],
      (err, result) => {
        if (err) {
          console.error("Error inserting discount code:", err.stack);
          return res
            .status(500)
            .json({ message: "Failed to insert discount code" });
        }

        res.status(200).json({ message: "Successfully created" });
      }
    );
  }
};

exports.getdiscountCode = (req, res) => {
  const query = `
    SELECT * from discount_code order by id desc`;
  db.query(query, (error, results) => {
    if (error) {
      console.error("Error fetching payment data:", error);
      return res.status(500).json({ message: "Error fetching data." });
    }

    res.status(200).json({
      message: "Successfully fetched data",
      results: results,
    });
  });
};

exports.deletediscountcode = (req, res) => {
  var id = req.body.id;
  const querys = "DELETE FROM discount_code WHERE id = ?";

  db.query(querys, [id], (error, results) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    return res.status(200).json({ message: "Deleted successfully." });
  });
};
exports.geteditCodeData = (req, res) => {
  var id = req.body.id;
  const querys = "SELECT * FROM discount_code WHERE id = ?";

  db.query(querys, [id], (error, row) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    return res.status(200).json({ message: "", results: row[0] });
  });
};
exports.deletecompany = (req, res) => {
  const id = req.body.id;

  db.getConnection((err, connection) => {
    if (err) {
      console.error("Connection error:", err);
      return res.status(500).json({ message: "Database connection error." });
    }

    connection.beginTransaction((err) => {
      if (err) {
        connection.release();
        return res.status(500).json({ message: "Transaction start failed." });
      }

      const deleteQueries = [
        "DELETE FROM dataroomai_response WHERE user_id = ?",
        "DELETE FROM dataroomai_summary WHERE user_id = ?",
        "DELETE FROM dataroomai_summary_files WHERE user_id = ?",
        "DELETE FROM dataroomai_summary_subcategory WHERE user_id = ?",
        "DELETE FROM dataroomdocuments WHERE user_id = ?",
        "DELETE FROM dataroom_generatedocument WHERE user_id = ?",
        "DELETE FROM investor_information WHERE user_id = ?",
        "DELETE FROM investor_updates WHERE user_id = ?",
        "DELETE FROM dataroomai_executive_summary WHERE user_id = ?",
        "DELETE FROM sharereport WHERE user_id = ?",
        "DELETE FROM referralusage WHERE used_by_company_id = ?",
        "DELETE FROM  zoommeeting_register WHERE user_id = ?",
        "DELETE FROM   subscription_lockfile WHERE user_id = ?",
        "DELETE FROM   shared_discount_code WHERE shared_id = ?",
        "DELETE FROM   upcomingmoduleemail WHERE user_id = ?",
        "DELETE FROM   used_referral_code WHERE user_id = ?",
        "DELETE FROM   userdocuments WHERE user_id = ?",
        "DELETE FROM    userinvestorreporting_subscription WHERE user_id = ?",
        "DELETE FROM    uservideolimit WHERE user_id = ?",

        "DELETE FROM company WHERE id = ?", // company.id is the main key
      ];

      const runQuery = (index) => {
        if (index >= deleteQueries.length) {
          return connection.commit((err) => {
            if (err) {
              return connection.rollback(() => {
                connection.release();
                res.status(500).json({ message: "Commit failed." });
              });
            }

            // ✅ After successful commit, delete folder
            const filePath = path.join(
              __dirname,
              "..",
              "..",
              "upload",
              "docs",
              `doc_${id}`
            );
            fs.rm(filePath, { recursive: true, force: true }, (err) => {
              if (err) {
                console.warn("Folder deletion failed or not found:", filePath);
              } else {
                console.log("Deleted folder:", filePath);
              }

              connection.release();
              res.status(200).json({ message: "Deleted successfully." });
            });
          });
        }

        connection.query(deleteQueries[index], [id], (err) => {
          if (err) {
            return connection.rollback(() => {
              connection.release();
              console.error("Error in deletion:", err);
              res.status(500).json({ message: "Deletion failed." });
            });
          }
          runQuery(index + 1);
        });
      };

      runQuery(0);
    });
  });
};

exports.checkmoduleData = (req, res) => {
  var id = req.body.id;
  db.query("SELECT * FROM module where id=?", [id], async (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      results: results, // <-- include the results here
    });
  });
};
//Create Zoom Meet
exports.createzoommeet = (req, res) => {
  const data = req.body;

  // Split datetime-local input into date and time parts
  const [date, time] = data.meeting_date.split("T"); // e.g., "2025-06-26T14:52"

  // ✅ Step 1: Calculate original meeting datetime with timezone
  const meetingDateTime = moment.tz(
    `${date} ${time}`,
    "YYYY-MM-DD HH:mm",
    data.timezone
  );

  // ✅ Step 2: Define time range (±29 minutes for 30-min window overlap check)
  const startTime = meetingDateTime
    .clone()
    .subtract(29, "minutes")
    .format("HH:mm");
  const endTime = meetingDateTime.clone().add(29, "minutes").format("HH:mm");

  // ✅ Step 3: Overlap check query
  let selectQuery = `
    SELECT * FROM zoommeeting 
    WHERE module_id = ?
      AND meeting_date = ?
      AND timezone = ?
      AND time BETWEEN ? AND ?`;
  let queryParams = [data.module_id, date, data.timezone, startTime, endTime];

  // ✅ Step 4: Exclude current meeting if editing
  if (data.id) {
    selectQuery += " AND id != ?";
    queryParams.push(data.id);
  }

  // ✅ Step 5: Run duplicate check
  db.query(selectQuery, queryParams, (err, results) => {
    if (err) {
      return res.status(500).json({ message: "DB error", error: err });
    }

    if (results.length > 0) {
      return res.status(200).json({
        message: "A meeting already exists within 30 minutes of this time.",
        status: "2",
      });
    }

    // ✅ Step 6: Token + expiry
    const code = generateUniqueCode();
    const tokenExpiry = format(new Date(date), "yyyy-MM-dd 23:00:00");

    const now = new Date();
    const expiryInSeconds = Math.floor((meetingDateTime.toDate() - now) / 1000);
    const token = jwt.sign({}, process.env.JWT_SECRET, {
      expiresIn: expiryInSeconds > 0 ? expiryInSeconds : 3600, // fallback 1hr
    });
    // Split datetime-local input like "2025-07-03T14:59"
    const [datew, timew] = data.meeting_date.split("T");

    const timezonee = data.timezone || "UTC";
    const localDateTimeStr = `${datew} ${timew}:00`; // "2025-07-03 14:59"
    // ✅ Step 7: Update
    if (data.id) {
      const updateQuery = `
        UPDATE zoommeeting 
        SET meeting_date_time=?,meeting_id=?, topic=?, access_token=?, ip_address=?, token_expiry=?, 
            module_id=?, meeting_date=?, time=?, timezone=?, zoom_link=?
        WHERE id = ?`;

      const updateParams = [
        localDateTimeStr,
        data.meeting_id,
        data.topic,
        token,
        data.ip_address,
        tokenExpiry,
        data.module_id,
        date,
        time,
        data.timezone,
        data.zoom_link,
        data.id,
      ];

      db.query(updateQuery, updateParams, (err, result) => {
        if (err) {
          console.error("Error updating meeting:", err.stack);
          return res.status(500).json({ message: "Failed to update meeting." });
        }

        return res.status(200).json({
          message: "Zoom meeting updated successfully.",
          status: "1",
        });
      });
    } else {
      // ✅ Step 8: Insert
      const insertQuery = `
        INSERT INTO zoommeeting 
        (meeting_date_time,meeting_id, topic, access_token, ip_address, unique_code, token_expiry, module_id, meeting_date, time, timezone, zoom_link, date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;

      const insertParams = [
        localDateTimeStr,
        data.meeting_id,
        data.topic,
        token,
        data.ip_address,
        code,
        tokenExpiry,
        data.module_id,
        date,
        time,
        data.timezone,
        data.zoom_link,
      ];

      db.query(insertQuery, insertParams, (insertErr, insertResult) => {
        if (insertErr) {
          return res
            .status(500)
            .json({ message: "Insert failed", error: insertErr });
        }

        return res.status(200).json({
          message: "Zoom meeting created successfully.",
          status: "1",
          results: insertResult,
        });
      });
    }
  });
};
function generateUniqueCode(length = 6) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

exports.getzoomdata = (req, res) => {
  var id = req.body.id;
  db.query(
    "SELECT * FROM zoommeeting where id=?",
    [id],
    async (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      res.status(200).json({
        results: results, // <-- include the results here
      });
    }
  );
};
exports.emailtemplate = (req, res) => {
  const { id, name, type, subject, body } = req.body;

  if (!name || !type || !subject || !body) {
    return res
      .status(400)
      .json({ success: false, status: 2, message: "All fields required" });
  }

  // Check if template with same type already exists (excluding current ID if editing)
  let duplicateCheckQuery = "SELECT * FROM email_templates WHERE type = ?";
  let duplicateCheckParams = [type];

  if (id) {
    duplicateCheckQuery += " AND id != ?";
    duplicateCheckParams.push(id);
  }

  db.query(duplicateCheckQuery, duplicateCheckParams, (err, results) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Database query error",
        error: err,
      });
    }

    if (results.length > 0) {
      return res.status(200).json({
        success: true,
        status: 2,
        message: "This template type already exists",
      });
    }

    // Proceed to insert or update based on presence of ID
    if (id) {
      // UPDATE
      const updateQuery = `
        UPDATE email_templates
        SET name = ?, type = ?, subject = ?, body = ?
        WHERE id = ?
      `;
      db.query(updateQuery, [name, type, subject, body, id], (err, result) => {
        if (err) {
          console.error("DB Update Error:", err);
          return res
            .status(500)
            .json({ success: false, message: "Database error" });
        }

        return res.status(200).json({
          success: true,
          status: 1,
          message: "Template updated successfully",
        });
      });
    } else {
      // INSERT
      const insertQuery = `
        INSERT INTO email_templates (name, type, subject, body)
        VALUES (?, ?, ?, ?)
      `;
      db.query(insertQuery, [name, type, subject, body], (err, result) => {
        if (err) {
          console.error("DB Insert Error:", err);
          return res
            .status(500)
            .json({ success: false, message: "Database error" });
        }

        return res.status(200).json({
          success: true,
          status: 1,
          message: "Template created successfully",
        });
      });
    }
  });
};

exports.getemailtemplate = (req, res) => {
  db.query(
    "SELECT * FROM email_templates order by id desc",
    async (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      res.status(200).json({
        results: results, // <-- include the results here
      });
    }
  );
};

exports.emailtemplateDelete = (req, res) => {
  const videoId = req.body.id; // ID to be deleted

  if (!videoId) {
    return res.status(400).json({ message: "No video ID provided." });
  }

  // MySQL query to delete the video
  const query = "DELETE FROM email_templates WHERE id = ?";

  db.query(query, [videoId], (error, results) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    if (results.affectedRows > 0) {
      return res
        .status(200)
        .json({ message: "Templated deleted successfully." });
    } else {
      return res.status(404).json({ message: "Templated not found." });
    }
  });
};

exports.getemailtemplateSingle = (req, res) => {
  var id = req.body.id;
  db.query(
    "SELECT * FROM email_templates where id = ?",
    [id],
    async (err, row) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      res.status(200).json({
        results: row, // <-- include the results here
      });
    }
  );
};

exports.getallUsersJoinedMeet = (req, res) => {
  const id = req.body.id;
  // console.log(id);
  const query = `
    SELECT 
      zr.id AS user_id,
      zr.ip_address,
      zr.name AS user_name,
      zr.created_at AS join_date,
      zr.email AS user_email,
      zr.timezone AS usertimezone,
      zm.id AS meeting_id,
      zm.topic,
      zm.zoom_link,
      zm.meeting_date,
      zm.time,
      zm.timezone,
      zm.meeting_date,
      m.name AS module_name
    FROM zoommeeting_register zr
    LEFT JOIN zoommeeting zm
      ON FIND_IN_SET(zm.id, REPLACE(REPLACE(REPLACE(zr.registered_meeting_ids, '[', ''), ']', ''), ' ', ''))
    LEFT JOIN module m
      ON zm.module_id = m.id where zm.id = ?
    ORDER BY zr.id DESC;
  `;

  db.query(query, [id], (error, results) => {
    if (error) {
      console.error("Error fetching joined meeting data:", error);
      return res
        .status(500)
        .json({ message: "Error fetching joined meeting data." });
    }

    // Format meeting_date
    const formattedResults = results.map((row) => ({
      ...row,
      meeting_date: row.meeting_date
        ? require("moment")(row.meeting_date).format("YYYY-MM-DD")
        : null,
    }));

    return res.status(200).json({
      message: "User meeting join list fetched successfully",
      results: formattedResults,
    });
  });
};

exports.getUseddiscountCode = (req, res) => {
  var code = req.body.code;
  const query = `
    SELECT 
    discount_code.*,
    used_referral_code.discounts AS used_discounts,
    used_referral_code.user_id,
    company.company_name,
    company.email
FROM discount_code
JOIN used_referral_code 
    ON used_referral_code.discount_code_id = discount_code.id
JOIN company 
    ON company.id = used_referral_code.user_id
WHERE discount_code.code = ?;
;
`;
  db.query(query, [code], (error, results) => {
    if (error) {
      console.error("Error fetching payment data:", error);
      return res.status(500).json({ message: "Error fetching data." });
    }

    res.status(200).json({
      message: "Successfully fetched data",
      results: results,
    });
  });
};
const sendsharedCode = ({
  to,
  isRegistered,
  discount_code,
  sharedBy,
  context = "admin_to_registered",
  allowedModules = [],
}) => {
  const moduleNameMap = {
    Dataroom_Plus_Investor_Report: "Dataroom Plus Investor Report",
    Academy: "Academy Modules",
    Dataroom: "Data Room",
    Due_Diligence: "Due Diligence Services",
    Subscription: "Subscriptions",
  };

  const readableModules = allowedModules
    .map((key) => moduleNameMap[key] || key)
    .join("\n- ");

  let subject = "";
  let body = "";

  switch (context) {
    case "admin_to_registered":
      subject = "Your Referral Code from BluePrint Catalyst";
      body = `Hello,

You have received a discount code: ${discount_code}

You can share this code with other companies to help them register and receive exclusive benefits on:
- ${readableModules}

✅ Feel free to post this code on your website, company portal, or forward it directly to others.

Start referring now and grow together!

Best regards,  
BluePrint Catalyst Team`;
      break;

    case "registered_to_new":
      subject = `${sharedBy} Has Invited You to BluePrint Catalyst`;
      body = `Hello,

${sharedBy} has invited you to join BluePrint Catalyst and shared a discount code with you: ${discount_code}

Register using the link below to activate your discount:  
http://localhost:3000/register?ref=${discount_code}

This gives you access to benefits across:
- ${readableModules}

Welcome aboard!

Best,  
BluePrint Catalyst Team`;
      break;

    case "registered_to_existing":
      subject = `You've Received a Discount Code via ${sharedBy}`;
      body = `Hello,

${sharedBy} has shared a discount code with you: ${discount_code}

Please log in to your BluePrint Catalyst account and apply this code to enjoy discounts on:
- ${readableModules}

Log in here: http://localhost:3000/login

Happy scaling!  
BluePrint Catalyst Team`;
      break;

    default:
      subject = "BluePrint Catalyst Discount Code";
      body = `Hello,

Here is your discount code: ${discount_code}

Register or log in using the link below to redeem it:  
http://localhost:3000/register?ref=${discount_code}

Best,  
BluePrint Catalyst Team`;
  }

  const mailOptions = {
    from: '"BluePrint Catalyst" <scale@blueprintcatalyst.com>',
    to,
    subject,
    text: body,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error sending email:", error);
    } else {
      console.log("Shared code email sent:", info.response);
    }
  });
};

exports.shareCodeCompany = async (req, res) => {
  try {
    const { shared_by, emails, discount_code } = req.body;

    if (
      !shared_by ||
      !emails ||
      !Array.isArray(emails) ||
      emails.length === 0 ||
      !discount_code
    ) {
      return res
        .status(400)
        .json({ message: "Missing or invalid required fields." });
    }

    const normalizedEmails = emails.map((e) => e.trim().toLowerCase());
    const uniqueEmails = new Set(normalizedEmails);
    if (uniqueEmails.size !== normalizedEmails.length) {
      return res
        .status(200)
        .json({ message: "Duplicate emails in input.", status: "2" });
    }

    // 🚫 Check if email already shared with this code
    const placeholders = normalizedEmails.map(() => "?").join(",");
    const [existingRows] = await db
      .promise()
      .query(
        `SELECT email FROM shared_discount_code WHERE discount_code = ? AND email IN (${placeholders})`,
        [discount_code, ...normalizedEmails]
      );

    if (existingRows.length > 0) {
      const existingEmails = existingRows.map((row) => row.email);
      return res.status(200).json({
        status: "2",
        message:
          "Some emails have already been shared with this discount code.",
        existing_emails: existingEmails,
      });
    }

    // ✅ Insert all fresh emails
    const currentDate = new Date();
    const valuesToInsert = normalizedEmails.map((email) => [
      shared_by,
      discount_code,
      email,
      currentDate,
    ]);

    await db
      .promise()
      .query(
        `INSERT INTO shared_discount_code (shared_by, discount_code, email, created_at) VALUES ?`,
        [valuesToInsert]
      );

    // ✅ Fetch which emails are registered in `company` table
    const [registeredCompanies] = await db
      .promise()
      .query(`SELECT email FROM company WHERE email IN (${placeholders})`, [
        ...normalizedEmails,
      ]);

    const registeredSet = new Set(
      registeredCompanies.map((row) => row.email.toLowerCase())
    );

    // ✅ Fetch `type` for this discount_code
    const [[codeInfo]] = await db
      .promise()
      .query(`SELECT type FROM discount_code WHERE code = ? LIMIT 1`, [
        discount_code,
      ]);

    let allowedModules = [];
    try {
      allowedModules = JSON.parse(codeInfo.type);
      if (!Array.isArray(allowedModules)) {
        allowedModules = codeInfo.type.split(",").map((x) => x.trim());
      }
    } catch {
      allowedModules = codeInfo.type.split(",").map((x) => x.trim());
    }

    // ✅ Send emails based on registration status
    normalizedEmails.forEach((email) => {
      const isRegistered = registeredSet.has(email);
      const context = isRegistered
        ? "registered_to_existing"
        : "registered_to_new";

      sendsharedCode({
        to: email,
        isRegistered,
        discount_code,
        sharedBy: "Admin",
        context,
        allowedModules, // ✅ New addition
      });
    });

    await db
      .promise()
      .query(`UPDATE discount_code SET shared = 'Yes' WHERE code = ?`, [
        discount_code,
      ]);

    res.status(200).json({
      message: "Code shared successfully and emails sent.",
      inserted: valuesToInsert.length,
      status: "1",
    });
  } catch (error) {
    console.error("shareCodeCompany error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.getallcompanises = (req, res) => {
  const query = `Select * from company order by id desc`;
  db.query(query, (error, results) => {
    if (error) {
      console.error("Error fetching payment data:", error);
      return res.status(500).json({ message: "Error fetching data." });
    }

    res.status(200).json({
      message: "Successfully fetched data",
      results: results,
    });
  });
};
exports.getallreferredCode = (req, res) => {
  var code = req.body.code;
  const query = `SELECT shared_discount_code.*, discount_code.percentage FROM shared_discount_code LEFT JOIN discount_code ON discount_code.code = shared_discount_code.discount_code where discount_code.code = ? ORDER BY shared_discount_code.id DESC`;
  db.query(query, [code], (error, results) => {
    if (error) {
      console.error("Error fetching payment data:", error);
      return res.status(500).json({ message: "Error fetching data." });
    }

    res.status(200).json({
      message: "Successfully fetched data",
      results: results,
    });
  });
};
exports.getreferredCode = (req, res) => {
  var code = req.body.code;
  const query = `SELECT shared_discount_code.*, discount_code.percentage, company.company_name FROM shared_discount_code LEFT JOIN discount_code ON discount_code.code = shared_discount_code.discount_code LEFT JOIN company ON company.id = shared_discount_code.shared_id WHERE discount_code.code = ? AND shared_discount_code.shared_by = ? ORDER BY shared_discount_code.id DESC`;
  db.query(query, [code, "Company"], (error, results) => {
    if (error) {
      console.error("Error fetching payment data:", error);
      return res.status(500).json({ message: "Error fetching data." });
    }

    res.status(200).json({
      message: "Successfully fetched data",
      results: results,
    });
  });
};

exports.getallreferredUsage = (req, res) => {
  var code = req.body.code;
  const query = `SELECT referralusage.*,company.company_country,company.email,company.company_name,discount_code.percentage FROM referralusage join company on company.id = referralusage.used_by_company_id join discount_code on discount_code.code = referralusage.discount_code where referralusage.discount_code = ? order by referralusage.id desc`;
  db.query(query, [code], (error, results) => {
    if (error) {
      console.error("Error fetching payment data:", error);
      return res.status(500).json({ message: "Error fetching data." });
    }

    res.status(200).json({
      message: "Successfully fetched data",
      results: results,
    });
  });
};
exports.gettrackingData = (req, res) => {
  var code = req.body.discount_code;

  const query = `
    SELECT
      ru.id,
      ru.discount_code,
      ru.referred_by,
      ru.referred_by_id,
      ru.used_by_company_id,
      ru.registered_on,
      ru.created_at,
      dc.percentage,
      dc.exp_date,
      reg_company.company_name AS registered_company_name,
      reg_company.id As company_id,
      CASE 
        WHEN ru.referred_by = 'Company' THEN ref_company.company_name
        WHEN ru.referred_by = 'Admin' THEN 'Admin'
        ELSE NULL
      END AS referred_by_company_name
    FROM referralusage ru
    LEFT JOIN discount_code AS dc ON dc.code = ru.discount_code
    LEFT JOIN company AS reg_company ON reg_company.id = ru.used_by_company_id
    LEFT JOIN company AS ref_company ON ref_company.id = ru.referred_by_id AND ru.referred_by = 'Company' where ru.discount_code =?
    ORDER BY ru.created_at DESC
  `;

  db.query(query, [code], (error, results) => {
    if (error) {
      console.error("Error fetching referral tracking data:", error);
      return res.status(500).json({ message: "Error fetching data." });
    }

    res.status(200).json({
      message: "Successfully fetched data",
      results: results,
    });
  });
};
exports.getcodelist = (req, res) => {
  const query = `
    SELECT * from shared_discount_code group by discount_code`;

  db.query(query, (error, results) => {
    if (error) {
      console.error("Error fetching referral tracking data:", error);
      return res.status(500).json({ message: "Error fetching data." });
    }

    res.status(200).json({
      message: "Successfully fetched data",
      results: results,
    });
  });
};
exports.getcompanyDetail = (req, res) => {
  var id = req.body.user_id;

  const query = `
    SELECT * from company where id = ?
  `;

  db.query(query, [id], (error, row) => {
    if (error) {
      console.error("Error fetching referral tracking data:", error);
      return res.status(500).json({ message: "Error fetching data." });
    }

    res.status(200).json({
      message: "Successfully fetched data",
      results: row,
    });
  });
};
exports.getreferralCompanyDetail = (req, res) => {
  var data = req.body;

  const query = `
    SELECT
      ru.id,
      ru.discount_code,
      ru.referred_by,
      ru.referred_by_id,
      ru.used_by_company_id,
      ru.registered_on,
      ru.created_at,
      dc.percentage,
      dc.exp_date,
      reg_company.company_name AS registered_company_name,
      reg_company.email AS registered_company_email,
      CASE 
        WHEN ru.referred_by = 'Company' THEN ref_company.company_name
        WHEN ru.referred_by = 'Admin' THEN 'Admin'
        ELSE NULL
      END AS referred_by_company_name
    FROM referralusage ru
    LEFT JOIN discount_code AS dc ON dc.code = ru.discount_code
    LEFT JOIN company AS reg_company ON reg_company.id = ru.used_by_company_id
    LEFT JOIN company AS ref_company ON ref_company.id = ru.referred_by_id AND ru.referred_by = 'Company'
    where ru.referred_by_id =?
    ORDER BY ru.created_at DESC
  `;

  db.query(query, [data.user_id], (error, results) => {
    if (error) {
      console.error("Error fetching referral tracking data:", error);
      return res.status(500).json({ message: "Error fetching data." });
    }

    res.status(200).json({
      message: "Successfully fetched data",
      results: results,
    });
  });
};
exports.gettrackingDatasingleDetail = (req, res) => {
  const { id, discount_code } = req.body;
  const query = `SELECT company.id, company.email AS company_email,shared_discount_code.id as shared_discount_code_id, shared_discount_code.shared_by, shared_discount_code.shared_id FROM company LEFT JOIN shared_discount_code ON shared_discount_code.email COLLATE utf8mb4_general_ci = company.email COLLATE utf8mb4_general_ci WHERE company.id = ? AND shared_discount_code.discount_code = ?`;

  db.query(query, [id, discount_code], (error, results) => {
    if (error) {
      console.error("Error fetching referral tracking data:", error);
      return res.status(500).json({ message: "Error fetching data." });
    }
    if (results.length === 0) {
      return res.status(200).json({
        message: "No result found",
      });
    }
    const sharedid = results[0];
    const sharedQuery = `
    SELECT 
  sdc.*, 
  c.id AS company_id,
  c.company_name,
  c.email AS company_email,
  -- Referred By Name Logic
  CASE 
    WHEN sdc.shared_by = 'Admin' OR sdc.shared_id = 0 THEN 'Admin'
    ELSE rc.company_name
  END AS referred_by_name
FROM shared_discount_code sdc
LEFT JOIN company c 
  ON c.email COLLATE utf8mb4_general_ci = sdc.email
LEFT JOIN company rc 
  ON rc.id = sdc.shared_id
WHERE sdc.id = ?;

  `;

    db.query(
      sharedQuery,
      [sharedid.shared_discount_code_id],
      (err, sharedResults) => {
        if (err) {
          return res.status(500).json({
            message: "Error fetching shared data",
            error: err,
          });
        }

        if (sharedResults.length === 0) {
          return res.status(200).json({
            message: "Shared code not found",
          });
        }

        const shared = sharedResults[0];
        const companyId = shared.company_id;
        const companyEmail = shared.company_email;

        const usageQuery = `
      SELECT 
        id AS usage_id,
        payment_type,
        discounts,
        created_at AS used_at,
        discount_code,
        payment_type,
        table_type,
        table_id
      FROM used_referral_code
      WHERE user_id = ? AND discount_code = ?
      ORDER BY created_at DESC
    `;

        db.query(
          usageQuery,
          [companyId, discount_code],
          (err, usageResults) => {
            if (err) {
              return res.status(500).json({
                message: "Error fetching usage data",
                error: err,
              });
            }

            // Inject company_email into each usage result
            const usageWithEmail = usageResults.map((row) => ({
              ...row,
              company_email: companyEmail,
            }));

            res.status(200).json({
              message: "Code tracking and usage data fetched successfully",
              shared: shared,
              usage: usageWithEmail,
            });
          }
        );
      }
    );
  });
};

exports.getfulldetailreferral = (req, res) => {
  const usage_id = req.body.usage_id;

  const getReferralQuery = `
  SELECT * FROM used_referral_code WHERE id = ?
`;

  db.query(getReferralQuery, [usage_id], (err, results) => {
    if (err) return res.status(500).json({ message: "Error", err });

    const referral = results[0];
    const { table_type, table_id } = referral;

    let joinQuery = "";
    switch (table_type) {
      case "usersubscriptiondataroomone_time":
        joinQuery = `SELECT urc.*, d1.* 
                   FROM used_referral_code urc
                   LEFT JOIN usersubscriptiondataroomone_time d1 
                   ON urc.table_id = d1.id
                   WHERE urc.id = ?`;
        break;

      case "userinvestorreporting_subscription":
        joinQuery = `SELECT urc.*, d2.* 
                   FROM used_referral_code urc
                   LEFT JOIN userinvestorreporting_subscription d2 
                   ON urc.table_id = d2.id
                   WHERE urc.id = ?`;
        break;

      case "usersubscriptiondata_academy":
        joinQuery = `SELECT urc.*, d3.* 
                   FROM used_referral_code urc
                   LEFT JOIN usersubscriptiondata_academy d3 
                   ON urc.table_id = d3.id
                   WHERE urc.id = ?`;
        break;

      default:
        return res.status(400).json({ message: "Invalid table_type" });
    }

    db.query(joinQuery, [usage_id], (err2, finalResult) => {
      if (err2) return res.status(500).json({ message: "Join error", err2 });

      res.status(200).json({
        message: "Success",
        result: finalResult[0],
      });
    });
  });
};
exports.getCompanyreferralpayment = (req, res) => {
  var data = req.body;

  const query = `
    SELECT * from used_referral_code where id =?`;

  db.query(query, [data.id], (error, results) => {
    if (error) {
      console.error("Error fetching referral tracking data:", error);
      return res.status(500).json({ message: "Error fetching data." });
    }

    res.status(200).json({
      message: "Successfully fetched data",
      results: results,
    });
  });
};
exports.getcompanysharedcode = (req, res) => {
  const { id } = req.body;

  const query = `
    SELECT 
  shared_discount_code.shared_id,
  shared_discount_code.discount_code,
  COUNT(*) AS total_shared_codes,
  MAX(discount_code.percentage) AS percentage,
  MAX(discount_code.usage_limit) AS usage_limit,
  MAX(discount_code.used_count) AS used_count,
  MAX(discount_code.exp_date) AS exp_date,
  MAX(company.company_name) AS company_name
FROM shared_discount_code
LEFT JOIN discount_code 
  ON discount_code.code = shared_discount_code.discount_code
LEFT JOIN company 
  ON company.id = shared_discount_code.shared_id
WHERE shared_discount_code.shared_id = ?
GROUP BY shared_discount_code.shared_id

`;

  db.query(query, [id], (error, results) => {
    if (error) {
      console.error("Error fetching referral tracking data:", error);
      return res.status(500).json({ message: "Error fetching data." });
    }

    res.status(200).json({
      message: "Successfully fetched data",
      results: results,
    });
  });
};

exports.createzoommeetSession = (req, res) => {
  const data = req.body;

  // Split datetime-local input into date and time parts
  const [date, time] = data.meeting_date.split("T"); // e.g., "2025-06-26T14:52"

  // ✅ Step 1: Calculate original meeting datetime with timezone
  const meetingDateTime = moment.tz(
    `${date} ${time}`,
    "YYYY-MM-DD HH:mm",
    data.timezone
  );

  // ✅ Step 2: Define time range (±29 minutes for 30-min window overlap check)
  const startTime = meetingDateTime
    .clone()
    .subtract(29, "minutes")
    .format("HH:mm");
  const endTime = meetingDateTime.clone().add(29, "minutes").format("HH:mm");

  // ✅ Step 3: Overlap check query
  let selectQuery = `
    SELECT * FROM broadcastesession 
    WHERE module_id = ?
      AND meeting_date = ?
      AND timezone = ?
      AND session = ?
      AND time BETWEEN ? AND ?`;
  let queryParams = [
    data.module_id,
    date,
    data.timezone,
    data.session,
    startTime,
    endTime,
  ];

  // ✅ Step 4: Exclude current meeting if editing
  if (data.id) {
    selectQuery += " AND id != ?";
    queryParams.push(data.id);
  }

  // ✅ Step 5: Run duplicate check
  db.query(selectQuery, queryParams, (err, results) => {
    if (err) {
      return res.status(500).json({ message: "DB error", error: err });
    }

    if (results.length > 0) {
      return res.status(200).json({
        message: "A meeting already exists within 30 minutes of this time.",
        status: "2",
      });
    }

    // ✅ Step 6: Token + expiry
    const code = generateUniqueCode();
    const tokenExpiry = format(new Date(date), "yyyy-MM-dd 23:00:00");

    const now = new Date();
    const expiryInSeconds = Math.floor((meetingDateTime.toDate() - now) / 1000);
    const token = jwt.sign({}, process.env.JWT_SECRET, {
      expiresIn: expiryInSeconds > 0 ? expiryInSeconds : 3600, // fallback 1hr
    });
    // Split datetime-local input like "2025-07-03T14:59"
    const [datew, timew] = data.meeting_date.split("T");

    const timezonee = data.timezone || "UTC";
    const localDateTimeStr = `${datew} ${timew}:00`; // "2025-07-03 14:59"
    // ✅ Step 7: Update

    if (data.id) {
      const updateQuery = `
        UPDATE broadcastesession 
        SET status=?,session=?,meeting_date_time=?, topic=?, access_token=?, ip_address=?, token_expiry=?, 
            module_id=?, meeting_date=?, time=?, timezone=?, meetingLink=?
        WHERE id = ?`;

      const updateParams = [
        data.status,
        data.session,
        localDateTimeStr,
        data.topic,
        token,
        data.ip_address,
        tokenExpiry,
        data.module_id,
        date,
        time,
        data.timezone,
        data.meetingLink,
        data.id,
      ];

      db.query(updateQuery, updateParams, (err, result) => {
        if (err) {
          console.error("Error updating meeting:", err.stack);
          return res.status(500).json({ message: "Failed to update meeting." });
        }

        return res.status(200).json({
          message: "Session updated successfully.",
          status: "1",
        });
      });
    } else {
      // ✅ Step 8: Insert
      const insertQuery = `
        INSERT INTO broadcastesession 
        (session,status,meeting_date_time, topic, access_token, ip_address, unique_code, token_expiry, module_id, meeting_date, time, timezone, meetingLink, date)
        VALUES (?, ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?, NOW())`;

      const insertParams = [
        data.session,
        data.status,
        localDateTimeStr,
        data.topic,
        token,
        data.ip_address,
        code,
        tokenExpiry,
        data.module_id,
        date,
        time,
        data.timezone,
        data.meetingLink,
      ];
      console.log(insertParams);
      db.query(insertQuery, insertParams, (insertErr, insertResult) => {
        if (insertErr) {
          return res
            .status(500)
            .json({ message: "Insert failed", error: insertErr });
        }

        return res.status(200).json({
          message: "Session created successfully.",
          status: "1",
          results: insertResult,
        });
      });
    }
  });
};

exports.getsessiondata = (req, res) => {
  var id = req.body.id;
  db.query(
    "SELECT * FROM broadcastesession where id=?",
    [id],
    async (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      res.status(200).json({
        results: results, // <-- include the results here
      });
    }
  );
};
exports.getboradCasteList = (req, res) => {
  var id = req.body.id;
  db.query(
    "SELECT * FROM broadcastesession order by id desc",
    [id],
    async (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }
      const formattedResults = results.map((row) => ({
        ...row,
        meeting_date: row.meeting_date
          ? require("moment")(row.meeting_date).format("YYYY-MM-DD")
          : null,
      }));
      res.status(200).json({
        results: formattedResults, // <-- include the results here
      });
    }
  );
};
exports.getallcompiness = (req, res) => {
  const { id } = req.body; // session id

  const sql = `
   SELECT 
    c.company_name,
    c.email,
    c.company_country,
    c.id, 
    sls.broadcastesession_id,
    CASE 
        WHEN sls.broadcastesession_id IS NOT NULL 
             AND sls.broadcastesession_id <> '' 
        THEN 'Yes' 
        ELSE 'No' 
    END AS is_shared,
    bs.module_id,
    bs.id bs_id,
    bs.meeting_date,
    bs.time
FROM company c
LEFT JOIN session_link_shared sls 
    ON FIND_IN_SET(c.id, sls.company_id)
LEFT JOIN broadcastesession bs
    ON bs.id = 1   -- Force join to the broadcast session you care about
ORDER BY c.id DESC;

  `;

  db.query(sql, [id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    res.status(200).json({ results });
  });
};

exports.sharedSessionLink = (req, res) => {
  const {
    company_id,
    module_name,
    meeting_topic,
    session_link,
    datetime,
    session_id,
  } = req.body;

  if (!Array.isArray(company_id) || company_id.length === 0) {
    return res.status(400).json({ message: "No company selected" });
  }

  // Step 1: Check for already linked companies for this session
  const checkSql = `
    SELECT c.company_name
    FROM company c
    INNER JOIN session_link_shared sls
      ON FIND_IN_SET(c.id, sls.company_id)
    WHERE sls.broadcastesession_id = ?
      AND c.id IN (?)
  `;

  db.query(checkSql, [session_id, company_id], (checkErr, checkResults) => {
    if (checkErr) {
      console.error("DB check error:", checkErr);
      return res.status(500).json({
        message: "Database check error",
        error: checkErr,
      });
    }

    if (checkResults.length > 0) {
      // Companies already linked → return status 2
      const names = checkResults.map((row) => row.company_name);
      return res.status(200).json({
        status: 2,
        message: `Some companies are already linked to this session: ${names.join(
          ", "
        )}`,
        alreadyLinked: names,
      });
    }

    // Step 2: No duplicates → insert new links
    const values = company_id.map((cid) => [
      session_id, // broadcastesession_id
      cid, // company_id
      datetime, // created_at
    ]);

    const insertSql = `
      INSERT INTO session_link_shared (broadcastesession_id, company_id, created_at)
      VALUES ?
    `;

    db.query(insertSql, [values], (err, result) => {
      if (err) {
        console.error("DB insert error:", err);
        return res.status(500).json({
          message: "Database insert error",
          error: err,
        });
      }
      const sessionQuery = `
  SELECT *
  FROM broadcastesession
  WHERE id = ?
`;

      db.query(sessionQuery, [session_id], (sessionErr, sessionResults) => {
        if (sessionErr) {
          console.error("Session fetch error:", sessionErr);
          return res.status(500).json({
            message: "Error fetching session details",
            error: sessionErr,
          });
        }

        if (sessionResults.length === 0) {
          return res.status(404).json({ message: "Session not found" });
        }

        const sessionData = sessionResults[0];
        const meetingDateTime = `${sessionData.meeting_date} ${sessionData.time}`; // or format as needed

        // Then use sessionData.session_link, sessionData.module_id, sessionData.meeting_topic for email

        // Example email fetch query (assuming company_id is available)
        const emailSql = `
    SELECT company_name, email
    FROM company
    WHERE id IN (?)
  `;

        db.query(emailSql, [company_id], (emailErr, emailResults) => {
          if (emailErr) {
            console.error("Email fetch error:", emailErr);
          } else {
            emailResults.forEach((row) => {
              sendSessionLink(
                row.email,
                row.company_name,
                module_name, // you should fetch module_name based on module_id before this or join in this query
                meeting_topic,
                meetingDateTime,
                sessionData.meetingLink,
                sessionData.meeting_date,
                sessionData.time
              );
            });
          }
        });
      });

      res.status(200).json({
        status: 1,
        message: "Session link(s) shared successfully",
        inserted: result.affectedRows,
      });
    });
  });
};
//Shared Session Link to Email
function sendSessionLink(
  to,
  companyName,
  moduleName,
  meetingTopic,
  eventTime,
  sessionLink,
  meetdate,
  time
) {
  const subject = `Your Upcoming Zoom Session: ${moduleName}`;

  // Replace placeholders in the HTML template
  const body = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Session Invitation</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f4f4f4;">
    <table
      align="center"
      border="0"
      cellpadding="0"
      cellspacing="0"
      width="600"
      style="border-collapse: collapse; background-color: #ffffff; border-radius: 8px; overflow: hidden; font-family: Arial, sans-serif;"
    >
      <tr>
        <td align="center" style="padding: 20px 30px 10px 30px;">
          <h2 style="color: #333333;">Hello ${companyName},</h2>
          <p style="font-size: 16px; color: #555555; line-height: 1.5;">
            You have been invited to access a <strong>live stream</strong> of our upcoming monthly investor meeting. 
            Each meeting features two broadcasts on the same day: a <strong>morning session</strong> and an <strong>afternoon session</strong>.
          </p>
          <p style="font-size: 15px; color: #777777; line-height: 1.5;">
            Once the schedule is confirmed, the appropriate session link (Zoom, Vroom, etc.) is distributed to all participants. 
            Below are your meeting details:
          </p>
        </td>
      </tr>
      <tr>
        <td align="left" style="padding: 10px 30px;">
          <p style="font-size: 16px; color: #333;">
            <strong>📝 Module Name:</strong> ${moduleName}<br />
            <strong>📝 Topic:</strong> ${meetingTopic}<br />
            <strong>📅 Date & Time:</strong> ${meetdate} ${time}<br />
            <strong>📅 Session:</strong> Morning<br />
            <strong>🔗 Session Link:</strong>
            <a
              href="${sessionLink}"
              style="color: #007bff; text-decoration: none;"
              target="_blank"
            >Join Meeting</a>
          </p>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding: 20px;">
          <a
            href="${sessionLink}"
            style="
              background-color: #007bff;
              color: white;
              padding: 12px 24px;
              text-decoration: none;
              border-radius: 6px;
              display: inline-block;
              font-size: 16px;
            "
            target="_blank"
          >Join Session Meeting</a>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding: 20px 30px; color: #888888; font-size: 14px;">
          — Company Team
        </td>
      </tr>
    </table>
  </body>
</html>
`;

  const mailOptions = {
    from: '"BluePrint Catalyst" <scale@blueprintcatalyst.com>',
    to,
    subject,
    html: body, // HTML version
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending email:", error);
    else console.log("Reminder email sent to", to);
  });
}
exports.deleteSessionLink = (req, res) => {
  const videoId = req.body.id; // ID to be deleted

  if (!videoId) {
    return res.status(400).json({ message: "No video ID provided." });
  }

  // MySQL query to delete the video
  const query = "DELETE FROM session_link_shared WHERE id = ?";

  db.query(query, [videoId], (error, results) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    if (results.affectedRows > 0) {
      return res.status(200).json({ message: "" });
    } else {
      return res.status(404).json({ message: "" });
    }
  });
};
exports.deleteSessionmeet = (req, res) => {
  const videoId = req.body.id;

  if (!videoId) {
    return res.status(400).json({ message: "No video ID provided." });
  }

  // 1. Delete from session_link_shared
  const deleteSessionLinkSql =
    "DELETE FROM session_link_shared WHERE broadcastesession_id = ?";

  // 2. Delete from broadcastesession
  const deleteBroadcastSql = "DELETE FROM broadcastesession WHERE id = ?";

  db.query(deleteSessionLinkSql, [videoId], (err1) => {
    if (err1) {
      console.error("Error deleting from session_link_shared:", err1);
      return res.status(500).json({ message: "Error deleting session links." });
    }

    db.query(deleteBroadcastSql, [videoId], (err2, results) => {
      if (err2) {
        console.error("Error deleting from broadcastesession:", err2);
        return res
          .status(500)
          .json({ message: "Error deleting broadcast session." });
      }

      if (results.affectedRows > 0) {
        return res
          .status(200)
          .json({ message: "Session deleted successfully." });
      } else {
        return res.status(404).json({ message: "Session not found." });
      }
    });
  });
};
