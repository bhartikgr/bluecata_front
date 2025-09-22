const db = require("../../db");
const express = require("express");
const http = require("http");

const app = express();
const server = http.createServer(app);

exports.getallnotifcation = (req, res) => {
  db.query(
    "SELECT notifications.*,users.first_name,users.middle_name,users.last_name FROM notifications join users on users.id = notifications.user_id order by notifications.id desc",
    function (err, results, fields) {
      if (err) throw err;
      // //console.log(row);
      const data = [];
      results.forEach((row) => {
        var g = formate(row.date);
        const formattedDate = g;
        row.nd = formattedDate;

        ////console.log(row);
        data.push(row);
      });
      res.json({ data });
    }
  );
};
function formate(dd) {
  const datee = new Date(dd);
  // Set the timezone to UTC
  datee.setUTCHours(0, 0, 0, 0);
  const year = datee.getUTCFullYear();
  const month = String(datee.getUTCMonth() + 1).padStart(2, "0");
  const day = String(datee.getUTCDate()).padStart(2, "0");

  const formattedDatse = `${day}/${month}/${year}`;
  return formattedDatse;
}

exports.updatenotifications = (req, res) => {
  const { id } = req.body; // assuming you send the ID as a route param

  // Update query
  const query = "UPDATE notifications SET markread = 'Yes' WHERE id = ?";

  db.query(query, [id], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Database error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.json({ message: "Notification marked as read" });
  });
};
exports.deleteNotifications = (req, res) => {
  const { id } = req.body; // if you're sending ID in body

  const query = "DELETE FROM notifications WHERE id = ?";

  db.query(query, [id], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Database error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.json({ message: "Notification deleted successfully" });
  });
};
