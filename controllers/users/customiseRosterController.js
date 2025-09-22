const db = require("../../db");
const express = require("express");
const http = require("http");

const app = express();
const server = http.createServer(app);
const util = require("util");

// Assuming `db` is your MySQL connection
const queryAsync = util.promisify(db.query).bind(db);

exports.getallclient = (req, res) => {
  db.query(
    "SELECT * from clients order by id desc",
    function (err, results, fields) {
      if (err) throw err;

      res.json({ results: results });
    }
  );
};
exports.getAllminesite = (req, res) => {
  const { id } = req.body;
  db.query(
    "SELECT * from locations where client_id = ?",
    [id],
    function (err, results, fields) {
      if (err) throw err;

      res.json({ results: results });
    }
  );
};
exports.createCustomiseRoster = (req, res) => {
  var data = req.body;
  const query = `
    SELECT * 
    FROM rosters 
    WHERE user_id = ? 
      AND type = ? 
      AND month_end_date >= NOW()`;

  db.query(query, [data.user_id, data.roster_type], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database query error" });
    }
    if (results.length > 0) {
      res.json({
        status: "2",
        message: "This roster has already been created",
      });
    } else {
      var ndate = new Date();
      const formattedDate = ndate.toISOString().split("T")[0];

      let number_day_start, number_day_end; // declare once

      if (data.roster_type === "2/2") {
        number_day_start = 14;
        number_day_end = 14;
      } else if (data.roster_type === "8/6") {
        number_day_start = 8;
        number_day_end = 6;
      } else if (data.roster_type === "3/1") {
        number_day_start = 21;
        number_day_end = 7;
      } else if (data.roster_type === "2/1") {
        number_day_start = 14;
        number_day_end = 7;
      } else if (data.roster_type === "15/13") {
        number_day_start = 15;
        number_day_end = 13;
      } else if (data.roster_type === "7/7") {
        number_day_start = 7;
        number_day_end = 7;
      } else if (data.roster_type === "5/2") {
        number_day_start = 5;
        number_day_end = 2;
      } else if (data.roster_type === "1/2") {
        // add this case
        number_day_start = 1;
        number_day_end = 2;
      }

      db.query(
        "SELECT * FROM locations WHERE id=? And duration_end > ? order by id desc",
        [data.customise_location, formattedDate],
        function (err, row, fields) {
          if (err) throw err;
          var ss = row;
          // console.log(row);
          if (row.length > 0) {
            var std = nextdaysget(data.start_date, 365);
            const lastDate = std[std.length - 1];
            //console.log("ch");
            //console.log(lastDate);
            let rosters = {
              number_day_start: number_day_start,
              number_day_end: number_day_end,
              duration_date: ss[0].duration_end,
              location_id: data.customise_location,
              client_id: data.customise_client,
              user_id: data.user_id,
              startdate: data.start_date,
              month_end_date: new Date(lastDate),
              type: data.roster_type,
              created_at: new Date(),
            };

            db.query(
              "INSERT INTO rosters SET ?",
              rosters,
              function (error, results, fields) {
                if (error) throw error;
                var insertid = results.insertId;
                db.query(
                  "SELECT * FROM users WHERE id=?",
                  [data.user_id],
                  function (err, row, fields) {
                    if (err) throw err;
                    var em = row;
                    var emm = row[0];
                    // var msg = "is select the roster";
                    const startDatee = new Date(
                      ss[0].duration_end
                    ).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    });

                    const endDatee = new Date(lastDate).toLocaleDateString(
                      "en-GB",
                      {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      }
                    );

                    const msg = `Created a new ${data.type} roster starting from ${startDatee} until ${endDatee}.`;
                    let notifications = {
                      user_id: data.user_id,
                      message: msg,
                      date: new Date(),
                    };
                    db.query(
                      "INSERT INTO notifications SET ?",
                      notifications,
                      function (error, results, fields) {
                        if (error) throw error;
                        var st = "Incomplete";
                        db.query(
                          "SELECT rosters.*, rosters.startdate AS stdate,rosters.id as r_id,rosters.type as r_type, subquery.total_count, attendance.id AS attend_id, attendance.roster_id,attendance.roster, attendance.hours, attendance.shift, attendance.date, clients.name AS client_name FROM rosters LEFT JOIN attendance ON rosters.id = attendance.roster_id JOIN locations ON locations.id = rosters.location_id JOIN clients ON clients.id = rosters.client_id LEFT JOIN ( SELECT roster_id, COUNT(*) AS total_count FROM attendance GROUP BY roster_id ) AS subquery ON rosters.id = subquery.roster_id WHERE rosters.user_id = ? AND locations.duration_end >= ? AND rosters.status = ? And rosters.id = ? ORDER BY rosters.id asc",
                          [data.user_id, formattedDate, st, insertid],
                          function (err, results, fields) {
                            if (err) throw err;

                            const data = [];
                            const mmdata = [];

                            results.forEach((row) => {
                              const currentDate = new Date(row.date);
                              const year = currentDate.getFullYear();
                              const month = String(
                                currentDate.getMonth() + 1
                              ).padStart(2, "0"); // January is 0, so we add 1
                              const day = String(
                                currentDate.getDate()
                              ).padStart(2, "0");

                              // Form the desired format: YYYY-

                              missingday = formattedDate;

                              if (row.date == null) {
                                const ged = getdaysdata(row.stdate);
                                const getcuudate = nextdaysget(
                                  ged,
                                  row.number_day_start
                                );
                                let mid = {
                                  client_id: row.client_id,
                                  number_day_start: row.number_day_start,
                                  count: row.total_count,
                                  attend_id: row.attend_id,
                                  date: getcuudate,
                                  user_id: row.user_id,
                                  location_id: row.location_id,
                                  roster: row.r_type,
                                  roster_id: row.r_id,
                                };
                                data.push(mid);
                              }
                            });
                            //console.log(data);

                            const groupedData = data.reduce((acc, row) => {
                              //console.log(row);
                              const {
                                client_id,
                                number_day_start,
                                count,
                                date,
                                user_id,
                                attend_id,
                                location_id,
                                roster,
                                roster_id,
                              } = row;
                              const existingEntry = acc.find(
                                (item) => item.client_id === client_id
                              );

                              if (!existingEntry) {
                                acc.push({
                                  client_id,
                                  number_day_start,
                                  count,
                                  dates: date,
                                  user_id,
                                  attend_id,
                                  location_id,
                                  roster,
                                  roster_id,
                                });
                              } else {
                                existingEntry.number_day_start =
                                  number_day_start;
                                existingEntry.count = count;
                                existingEntry.dates.push(date);
                              }

                              return acc;
                            }, []);

                            if (groupedData != "") {
                              const groupedDataa = groupedData[0].dates;
                              const mnrr = groupedData[0];

                              const resultArray = [];
                              var dd =
                                results[0].number_day_start +
                                results[0].number_day_end;
                              for (let i = 0; i < groupedDataa.length; i++) {
                                const date = groupedDataa[i];
                                let param = "";

                                if (i % dd < results[0].number_day_start) {
                                  param = "Edit";
                                } else if (i % dd < dd) {
                                  param = "Add";
                                }

                                resultArray.push({ param, date });
                              }
                              const ccc =
                                removeDuplicatesFromArray(resultArray);

                              insertAttendanceRecords(data.user_id, ccc, mnrr);
                            }
                          }
                        );
                        res.json({
                          roster_id: insertid,
                          status: "1",
                          message: "Roster has been created successfully",
                        });
                      }
                    );
                  }
                );
              }
            );
          } else {
            res.json({
              status: "2",
              message:
                "You have no permission to add this roster,because your location duration date is expire!.",
            });
          }
        }
      );
    }
  });
};
function getdays(forma) {
  const currentDate = new Date(forma);

  const formattedDate = currentDate.toISOString().split("T")[0];
  return formattedDate;
}
async function insertAttendanceRecords(uid, ccc, mnrr) {
  for (const rr of ccc) {
    const dddd = getdays(rr.date);
    const sd = new Date(rr.date);

    try {
      const row = await queryAsync(
        "SELECT * FROM attendance WHERE user_id = ? AND date = ?",
        [uid, dddd]
      );

      if (!row.length) {
        const pp = rr.param;
        const inst = {
          user_id: mnrr.user_id,
          client_id: mnrr.client_id,
          location_id: mnrr.location_id,
          roster_id: mnrr.roster_id,
          roster: mnrr.roster,
          shift: pp,
          shift_type: pp,
          date: sd,
          status: null,
          hours: null,
          created_at: sd,
        };
        //console.log(inst);
        await queryAsync("INSERT INTO attendance SET ?", inst);
        await queryAsync("UPDATE rosters SET month_end_date = ? WHERE id = ?", [
          sd,
          mnrr.roster_id,
        ]);
      }
    } catch (err) {
      console.error(err);
    }
  }

  // After the loop completes, run the delete query
  try {
    const results = await queryAsync(
      "SELECT date, id, COUNT(*) AS count FROM attendance WHERE user_id = ? AND client_id = ? AND location_id = ? AND roster_id = ? GROUP BY date HAVING count > 1",
      [mnrr.user_id, mnrr.client_id, mnrr.location_id, mnrr.roster_id]
    );
    for (const rowss of results) {
      await queryAsync("DELETE FROM attendance WHERE id = ?", [rowss.id]);
    }
  } catch (err) {
    console.error(err);
  }
}
function removeDuplicatesFromArray(arr) {
  return Array.from(new Set(arr));
}
function getdaysdata(forma) {
  const currentDate = new Date(forma);

  // Adjust the date to the local time zone by extracting the components
  const year = currentDate.getFullYear();
  const month = String(currentDate.getMonth() + 1).padStart(2, "0"); // Month is 0-indexed, so add 1
  const day = String(currentDate.getDate()).padStart(2, "0");

  // Format the date as YYYY-MM-DD
  const formattedDate = `${year}-${month}-${day}`;
  return formattedDate;
}
function nextdaysget(startdate, length) {
  var strt = startdate;
  const today = new Date(strt);
  const dates = [];
  var dcount = getDaysInNextOneYear(startdate);
  for (let i = 0; i < dcount; i++) {
    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + i);
    const formattedDate = nextDate.toISOString().slice(0, 10);
    dates.push(formattedDate);
  }

  return dates;
}
function getDaysInNextOneYear(dd) {
  // Get the current date
  const currentDate = new Date(dd);

  // Add 3 months to the current date
  currentDate.setUTCMonth(currentDate.getUTCMonth() + 12);

  // Calculate the difference in days between the original date and the updated date
  const timeDifference = currentDate - new Date(dd);
  const totalDaysCount = timeDifference / (1000 * 60 * 60 * 24);

  return totalDaysCount;
}

exports.activeRoster = (req, res) => {
  const { id, user_id } = req.body; // id is the roster to activate, userId is the user

  // 1. Get all rosters for this user
  db.query(
    "SELECT id FROM rosters WHERE user_id = ?",
    [user_id],
    function (err, results) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Database error on select" });
      }

      // 2. Loop through the results and update each one
      results.forEach((roster) => {
        const active = roster.id === id ? "Yes" : "No";
        db.query(
          "UPDATE rosters SET active_roster = ? WHERE id = ?",
          [active, roster.id],
          function (err2) {
            if (err2) {
              console.error(err2);
              // Optionally handle partial failure
            }
          }
        );
      });

      // 3. After updates, send a response
      res.json({ message: "Rosters updated successfully." });
    }
  );
};
exports.getuserallRoster = (req, res) => {
  const { user_id } = req.body; // id is the roster to activate, userId is the user

  // 1. Get all rosters for this user
  db.query(
    "SELECT rosters.*,locations.location_name FROM rosters join locations on locations.id = rosters.location_id WHERE rosters.user_id = ? And rosters.month_end_date >= Now() order by rosters.id desc",
    [user_id],
    function (err, results) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Database error on select" });
      }
      res.json({ message: "", results: results });
    }
  );
};
exports.getCoverageRoster = (req, res) => {
  const { user_id, roster_id } = req.body; // id is the roster to activate, userId is the user

  // 1. Get all rosters for this user
  db.query(
    `SELECT rosters.*, rosters.startdate AS stdate, 
            subquery.total_count, 
            attendance.id AS attend_id, 
            attendance.roster, 
            attendance.hours, 
            attendance.shift, 
            attendance.date, 
            clients.name AS client_name 
     FROM rosters  
     JOIN attendance ON rosters.id = attendance.roster_id 
     JOIN locations ON locations.id = rosters.location_id 
     JOIN clients ON clients.id = rosters.client_id 
     LEFT JOIN ( 
         SELECT roster_id, COUNT(*) AS total_count 
         FROM attendance 
         GROUP BY roster_id 
     ) AS subquery ON rosters.id = subquery.roster_id 
     WHERE rosters.user_id = ? And rosters.active_roster = ?
     AND locations.duration_end >= NOW()  AND  rosters.id = ? And attendance.shift = ?
     ORDER BY rosters.id DESC`,
    [user_id, "Yes", roster_id, "Add"],
    function (err, results, fields) {
      if (err) throw err;
      var cu = new Date();
      var currd = getdays(cu);
      let currentarray = {
        title: "",
        start: currd,
        end: currd,
        color: "white",
        pop: "Open",
        id: "",
        Shift: "Attend",
      };

      const check = [];
      results.forEach((row) => {
        var d = getdays(row.date);
        if (d === currd) {
          var ch = 1;
        }
        if (ch != undefined) {
          check.push(ch);
        }
      });
      if (check == 1) {
        const maindata = results;
        res.json({ maindata });
      }
      if (check == "") {
        const maindata = results.concat(currentarray);
        res.json({ maindata });
      }
    }
  );
};
