const db = require("../../db");
const express = require("express");
const http = require("http");

const app = express();
const server = http.createServer(app);

exports.getusergallery = (req, res) => {
  var user_id = req.body.user_id;
};

exports.getallclient = (req, res) => {
  const data = req.body;
  console.log(data);
  // Check if the role already exists in the `roles` table
  db.query(
    "SELECT DISTINCT clients.id, clients.name FROM attendance JOIN clients ON attendance.client_id = clients.id WHERE attendance.user_id = ?;",
    [data.user_id],
    function (err, results) {
      if (err) {
        // Handle database query errors
        console.error("Error during role check:", err);
        return res
          .status(500)
          .json({ status: "1", message: "Database error during role check" });
      }
      res.json({
        status: "1",
        results: results,
      });
    }
  );
};
