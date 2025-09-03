const db = require("../../db");
const express = require("express");
const http = require("http");

const app = express();
const server = http.createServer(app);

exports.checkusercoverage = (req, res) => {
  var data = req.body;
  var nd = new Date();
  var cj = getdays(nd);
  var s = "Incomplete";

  db.query(
    "SELECT rosters.*,locations.location_name as lname,clients.name as client_name, Count(attendance.id) as count,attendance.id as attend_id FROM `rosters` left join attendance on attendance.roster_id = rosters.id left join clients on clients.id = rosters.client_id left join locations on locations.client_id = rosters.client_id where rosters.user_id = ? And rosters.status=? And rosters.duration_date >= ?  And hours_status = ?;",
    [data.user_id, s, cj, "User"],
    function (err, row, fields) {
      if (err) throw err;

      res.json({ results: row });
    }
  );
};
function getdays(forma) {
  const currentDate = new Date(forma);

  const formattedDate = currentDate.toISOString().split("T")[0];
  return formattedDate;
}
