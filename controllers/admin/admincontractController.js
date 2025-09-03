const db = require("../../db");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const nodemailer = require("nodemailer");
// Function to set the WebSocket server

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(
      __dirname,
      "../../public/uploads/contractfolder/"
    );
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const storageup = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(
      __dirname,
      "../../public/uploads/uploadcontractFile/"
    );
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const uploadup = multer({ storage: storageup });

const upload = multer({ storage });
exports.deletefoldercontract = (req, res) => {
  const data = req.body;
  const resultArrays = data.multi_Id;

  if (!resultArrays || resultArrays.length === 0) {
    return res.status(400).json({ error: "No folder IDs provided" });
  }

  let ids = resultArrays.map((row) => row.id);

  // Step 1: Fetch folder details
  let sqlQuery = "SELECT id, name FROM contract_folder WHERE id IN (?)";
  db.query(sqlQuery, [ids], async (err, folders) => {
    if (err) {
      console.error("Error fetching folders:", err);
      return res.status(500).json({ error: "Database error" });
    }

    console.log("Fetched Folders:", folders);

    try {
      await Promise.all(
        folders.map(async (folderRow) => {
          let folderPath = path.join(
            __dirname,
            "../../public/uploads/contractfolder/",
            folderRow.name
          );

          // Step 2: Delete related records from `contract_filesusers`
          await new Promise((resolve, reject) => {
            db.query(
              "DELETE FROM contract_filesusers WHERE folder_id = ?",
              [folderRow.id],
              (err, result) => {
                if (err) reject(err);
                else resolve(result);
              }
            );
          });

          // Step 3: Delete related records from `contract_folder_files`
          await new Promise((resolve, reject) => {
            db.query(
              "DELETE FROM contract_folder_files WHERE contract_filesusers = ?",
              [folderRow.id],
              (err, result) => {
                if (err) reject(err);
                else resolve(result);
              }
            );
          });

          // Step 4: Delete the folder from `contract_folder`
          await new Promise((resolve, reject) => {
            db.query(
              "DELETE FROM contract_folder WHERE id = ?",
              [folderRow.id],
              (err, result) => {
                if (err) reject(err);
                else resolve(result);
              }
            );
          });

          // Step 5: Delete folder from the file system
          if (fs.existsSync(folderPath)) {
            fs.rm(folderPath, { recursive: true, force: true }, (err) => {
              if (err)
                console.error(`Error deleting folder ${folderPath}:`, err);
              else console.log(`Deleted folder: ${folderPath}`);
            });
          } else {
            console.log(`Folder not found: ${folderPath}`);
          }
        })
      );

      // Step 6: Fetch updated list
      db.query(
        "SELECT * FROM contract_folder ORDER BY id DESC",
        (err, results) => {
          if (err) {
            console.error("Error fetching updated list:", err);
            return res.status(500).json({ error: "Database error" });
          }
          res.json({ results });
        }
      );
    } catch (error) {
      console.error("Error processing deletions:", error);
      return res.status(500).json({ error: "Database operation failed" });
    }
  });
};
exports.deletefoldercontractFiles = async (req, res) => {
  console.log(req.body);
  try {
    const { multi_Id, folder_id } = req.body;

    if (!folder_id) {
      return res.status(400).json({ error: "No folder ID provided" });
    }

    if (!multi_Id || !Array.isArray(multi_Id) || multi_Id.length === 0) {
      return res.status(400).json({ error: "No valid file IDs provided" });
    }

    // Extract only file IDs
    const fileIds = multi_Id.map((item) => item.id);

    // Step 1: Get folder name from `contract_folder`
    let folderResults = await new Promise((resolve, reject) => {
      db.query(
        "SELECT name FROM contract_folder WHERE id = ?",
        [folder_id],
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      );
    });

    if (folderResults.length === 0) {
      return res.status(404).json({ error: "Folder not found" });
    }

    let folderName = folderResults[0].name;
    let folderPath = path.join(
      __dirname,
      "../../public/uploads/contractfolder/",
      folderName
    );

    console.log(`Target Folder: ${folderPath}`);

    // Step 2: Get file names
    let files = await new Promise((resolve, reject) => {
      db.query(
        "SELECT name FROM contract_filesusers WHERE id IN (?)",
        [fileIds],
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      );
    });

    if (files.length === 0) {
      return res.status(404).json({ error: "No matching files found" });
    }

    console.log(
      `Files to Delete:`,
      files.map((f) => f.name)
    );

    // Step 3: Delete files from filesystem
    for (const file of files) {
      let filePath = path.join(folderPath, file.name);
      console.log(`Checking file: ${filePath}`);

      if (fs.existsSync(filePath)) {
        try {
          await fs.promises.unlink(filePath);
          console.log(`Deleted file: ${filePath}`);
        } catch (err) {
          console.error(`Failed to delete file: ${filePath}`, err);
        }
      } else {
        console.log(`File not found: ${filePath}`);
      }
    }

    // Step 4: Delete from `contract_filesusers`
    await new Promise((resolve, reject) => {
      db.query(
        "DELETE FROM contract_filesusers WHERE id IN (?)",
        [fileIds],
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      );
    });

    return res.json({ message: "Files deleted successfully" });
  } catch (error) {
    console.error("Error processing deletions:", error);
    return res.status(500).json({ error: "Database operation failed" });
  }
};

// exports.savecontractfiles = (req, res) => {
//   upload.array("files", 10)(req, res, async (err) => {
//     if (err) {
//       return res.status(400).json({ error: "File upload failed" });
//     }
//     console.log(req.files);
//     const uploadedFiles = req.files; // Files from multer

//     if (!uploadedFiles || uploadedFiles.length === 0) {
//       return res.status(400).json({ error: "No files uploaded" });
//     }

//     try {
//       // Insert files for each user_id in the `contract_filesusers` table
//       for (const file of uploadedFiles) {
//         await new Promise((resolve, reject) => {
//           db.query(
//             "INSERT INTO contract_filesusers ( name, created_at) VALUES (?,  NOW())",
//             [file.filename],
//             (err, result) => {
//               if (err) reject(err);
//               else resolve(result);
//             }
//           );
//         });
//       }

//       return res.status(200).json({ message: "Files uploaded successfully" });
//     } catch (error) {
//       console.error("Database Error:", error);
//       return res.status(500).json({ error: "Database operation failed" });
//     }
//   });
// };
exports.getcontrectfiled = (req, res) => {
  db.query(
    "SELECT * from contract_folder order by id desc",
    function (err, results, fields) {
      res.json({ results });
    }
  );
};
exports.getcontrectfiledWithfolder = (req, res) => {
  var id = req.body.id;
  db.query(
    "SELECT * from contract_filesusers where folder_id = ? order by id desc",
    [id],
    function (err, results, fields) {
      res.json({ results });
    }
  );
};
exports.checkidvalid = (req, res) => {
  var id = req.body.id;
  db.query(
    "SELECT * from contract_folder where id =?",
    [id],
    function (err, row, fields) {
      res.json({ row });
    }
  );
};
async function sendEmaillink(to, msg) {
  const transporter = nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    auth: {
      user: "no-reply@jlmining.online",
      pass: "Macbookm1!", // Make sure this is correct
    },
  });

  const mailOptions = {
    from: "no-reply@jlmining.online",
    to,
    subject: "New contract link from Jlmining.app",
    text: msg,
  };

  try {
    await transporter.sendMail(mailOptions);
    // console.log(`Email sent to ${to}`);
  } catch (error) {
    //console.error("Error sending email:", error);
  }
}

exports.sendcontractFiles = async (req, res) => {
  const { user_id, files } = req.body;
  const wss = req.wss;

  if (!user_id || !files || !Array.isArray(user_id) || !Array.isArray(files)) {
    return res.status(400).json({ error: "Invalid data format" });
  }

  try {
    const dbPromises = [];
    const insertedFiles = [];
    const alreadyExists = [];

    for (const userId of user_id) {
      for (const file of files) {
        if (file.isChecked) {
          // Fetch user email & folder name
          const userInfo = await new Promise((resolve, reject) => {
            db.query(
              `SELECT u.email, u.first_name, u.last_name, f.name AS file_name
               FROM users u
               JOIN contract_filesusers f ON f.id = ?
               WHERE u.id = ?`,
              [file.id, userId],
              (err, results) => {
                if (err) return reject(err);

                if (results.length > 0) {
                  resolve({
                    email: results[0].email,
                    file_name: results[0].file_name,
                    fullName: `${results[0].first_name} ${results[0].last_name}`,
                  });
                } else {
                  resolve(null);
                }
              }
            );
          });

          if (!userInfo) continue;

          // Check if record exists
          const recordExists = await new Promise((resolve, reject) => {
            db.query(
              `SELECT COUNT(*) AS count FROM contract_folder_files WHERE user_id = ? AND contract_filesusers = ?`,
              [userId, file.id],
              (err, results) => {
                if (err) return reject(err);
                resolve(results[0].count > 0);
              }
            );
          });

          if (!recordExists) {
            const insertPromise = new Promise((resolve, reject) => {
              db.query(
                "INSERT INTO contract_folder_files (user_id, contract_filesusers, created_at) VALUES (?, ?, NOW())",
                [userId, file.id],
                async (err, result) => {
                  if (err) return reject(err);

                  insertedFiles.push({
                    file_name: userInfo.file_name,
                    userId,
                    fullName: userInfo.fullName,
                  });

                  // Send Email
                  const message = `Hello ${userInfo.fullName},\n\nA new contract file "${userInfo.file_name}" has been assigned to you. Click the link below to review it:\n\nhttps://jlmining.online/acknowledgedoc\n\nBest regards,\nJL Mining Team`;

                  await sendEmaillink(userInfo.email, message);

                  resolve(result);
                }
              );
            });

            dbPromises.push(insertPromise);
          } else {
            alreadyExists.push({
              file_name: userInfo.file_name,
              userId,
              fullName: userInfo.fullName,
            });
          }

          // Send Notification
          const notifPromise = new Promise((resolve, reject) => {
            const notif_user = {
              user_id: userId,
              message: `File "${userInfo.file_name}" has been assigned to you. Click here to acknowledge.`,
              href_status: "acknowledge",
              created_at: new Date(),
            };
            const notif_users = {
              user_id: userId,
              message: `File "${userInfo.file_name}" has been assigned to you. Click here to acknowledge.`,
              name: userInfo.file_name,
              href_status: "acknowledge",
              created_at: new Date(),
            };

            db.query(
              "INSERT INTO notificationuser SET ?",
              notif_user,
              (err) => {
                if (err) return reject(err);
                resolve();
              }
            );
            db.query(
              "INSERT INTO notificationhomepage SET ?",
              notif_users,
              (err) => {
                if (err) return reject(err);
                resolve();
              }
            );
          });

          dbPromises.push(notifPromise);
        }
      }
    }

    await Promise.all(dbPromises);

    // WebSocket Broadcast
    if (wss && wss.clients.size > 0) {
      const broadcastMessage = JSON.stringify({ event: "AssignNewFolder" });

      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(broadcastMessage);
        }
      });
    } else {
      console.log("No WebSocket clients connected. Skipping broadcast.");
    }

    return res.status(200).json({
      message: "Folders processed successfully",
      insertedFiles,
      alreadyExists,
    });
  } catch (error) {
    console.error("Database Error:", error);
    return res.status(500).json({ error: "Database operation failed" });
  }
};
async function sendEmailsendfolderfile(too, msg, callback) {
  const transporter = nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    auth: {
      user: "no-reply@jlmining.online",
      pass: "Macbookm1!", // Make sure this is correct
    },
  });
  const mailOptions = {
    from: "no-reply@jlmining.online",
    to: too,
    subject: "Assign new course from Jlmining.app",
    text: msg,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error:", error);
    } else {
      //console.log("Email sent:", info.response);
    }
  });
}
exports.sendcontractFolder = async (req, res) => {
  const { user_id, files } = req.body;

  if (!Array.isArray(user_id) || !Array.isArray(files)) {
    return res.status(400).json({ error: "Invalid data format" });
  }

  try {
    const insertedFiles = [];
    const alreadyExists = [];

    for (const userId of user_id) {
      for (const file of files) {
        if (file.isChecked) {
          // Get folder name from contract_folder table
          const folderQuery = `SELECT name as folder_name FROM contract_folder WHERE id = ?`;
          const folderName = await new Promise((resolve, reject) => {
            db.query(folderQuery, [file.id], (err, results) => {
              if (err) {
                console.error("Error fetching folder name:", err);
                return reject(err);
              }
              resolve(
                results.length > 0 ? results[0].folder_name : "Unknown Folder"
              );
            });
          });

          // Check if the entry already exists
          const existsQuery = `SELECT COUNT(*) AS count FROM contract_folder_files WHERE user_id = ? AND folder_id = ?`;
          const existsResult = await new Promise((resolve, reject) => {
            db.query(existsQuery, [userId, file.id], (err, results) => {
              if (err) {
                console.error("Error checking existing record:", err);
                return reject(err);
              }
              resolve(results[0].count > 0);
            });
          });

          if (!existsResult) {
            // Insert the record if it does not exist
            await new Promise((resolve, reject) => {
              db.query(
                `INSERT INTO contract_folder_files 
                  (contract_filesusers, user_id, folder_id, created_at) 
                  VALUES (?, ?, ?, NOW())`,
                [0, userId, file.id],
                async (err, result) => {
                  if (err) {
                    console.error("Error inserting record:", err);
                    return reject(err);
                  }

                  insertedFiles.push({
                    fileName: folderName, // Use folder name instead of file name
                    userId,
                    fullName: file.fullName || "",
                  });
                  db.query(
                    "SELECT * FROM users WHERE id = ?",
                    [userId],
                    function (err, rows) {
                      const user = rows[0];
                      // Send Email with folder name
                      const message = `Hello ${file.fullName},\n\nA new contract folder "${folderName}" has been assigned to you. Click the link below to review it:\n\nhttps://jlmining.online/acknowledgedoc\n\nBest regards,\nJL Mining Team`;

                      sendEmaillink(user.email, message);
                    }
                  );

                  // Insert into notificationuser table
                  const notif_user = {
                    user_id: userId,
                    message: `Folder "${folderName}" sent and click this`,
                    href_status: "acknowledge",
                    created_at: new Date(),
                  };
                  const notif_users = {
                    user_id: userId,
                    message: `Folder "${folderName}" sent and click this`,
                    name: folderName,
                    href_status: "acknowledge",
                    created_at: new Date(),
                  };

                  db.query(
                    "INSERT INTO notificationuser SET ?",
                    notif_user,
                    (error) => {
                      if (error) {
                        console.error("Error inserting notification:", error);
                        return reject(error);
                      }
                    }
                  );
                  db.query(
                    "INSERT INTO notificationhomepage SET ?",
                    notif_users,
                    (error) => {
                      if (error) {
                        console.error("Error inserting notification:", error);
                        return reject(error);
                      }
                    }
                  );

                  resolve(result);
                }
              );
            });
          } else {
            alreadyExists.push({
              fileName: folderName,
              userId,
              fullName: file.fullName || "",
            });
          }
        }
      }
    }

    return res.status(200).json({
      message: "Files processed successfully",
      insertedFiles,
      alreadyExists,
    });
  } catch (error) {
    console.error("Database Error:", error);
    return res.status(500).json({ error: "Database operation failed" });
  }
};

exports.searchfile = async (req, res) => {
  var data = req.body;

  db.query(
    "SELECT * FROM contract_filesusers WHERE folder_id =? And name LIKE ?",
    [data.id, "%" + data.search + "%"],
    function (err, results, fields) {
      //console.log(row);
      res.json({ results });
    }
  );
};
exports.searchfolder = async (req, res) => {
  var data = req.body;

  db.query(
    "SELECT * FROM contract_folder WHERE  name LIKE ?",
    ["%" + data.search + "%"],
    function (err, results, fields) {
      //console.log(row);
      res.json({ results });
    }
  );
};
exports.searcfileemployee = async (req, res) => {
  var data = req.body;
  let searchWords = data.search.trim().split(" "); // Split input into words

  let conditions = searchWords
    .map(() => "(step2_title LIKE ? OR first_name LIKE ? OR last_name LIKE ?)")
    .join(" AND "); // Ensuring all words are matched

  let values = [];
  searchWords.forEach((word) => {
    values.push(`%${word}%`, `%${word}%`, `%${word}%`);
  });

  values.push("Valid"); // Add type filter

  let query = `SELECT * FROM users WHERE (${conditions}) AND type = ?`;

  db.query(query, values, function (err, results, fields) {
    if (err) {
      console.error("Error fetching employees:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json({ results });
  });
};
exports.getusercontractDetail = async (req, res) => {
  var data = req.body;
  console.log(data);
  db.query(
    "SELECT cff.*, cf.name AS file_name, COALESCE(f1.name, f2.name) AS folder_name FROM contract_folder_files cff LEFT JOIN contract_filesusers cf ON (cff.folder_id != 0 AND cf.folder_id = cff.folder_id) OR (cff.folder_id = 0 AND cf.id = cff.contract_filesusers) LEFT JOIN contract_folder f1 ON cff.folder_id = f1.id  LEFT JOIN contract_folder f2 ON cf.folder_id = f2.id  WHERE cff.user_id = ? ORDER BY cf.id DESC;",
    [data.user_id],
    function (err, results, fields) {
      res.json({ results });
    }
  );
};

exports.uploadcontractFiles = async (req, res) => {
  uploadup.single("file")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: "File upload failed" });
    }

    const { user_id } = req.body; // Extract user_id
    const uploadedFile = req.file; // Single file from multer
    var oldname = req.body.old_name;

    if (!user_id || !uploadedFile) {
      return res.status(400).json({ error: "Invalid request data" });
    }

    try {
      const insertQuery = `
        INSERT INTO contract_upload (user_id, name, date, expirydate)
        VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 12 MONTH))
      `;

      db.query(insertQuery, [user_id, uploadedFile.filename], (err, result) => {
        if (err) {
          console.error("Database Insert Error:", err);
          return res.status(500).json({ error: "Database operation failed" });
        }
        if (oldname !== null && oldname !== undefined) {
          const updatequery = `UPDATE notificationhomepage SET status = 'Seen' WHERE name = ? AND href_status = 'acknowledge';`;
          db.query(updatequery, [oldname], (err, result) => {
            if (err) {
              console.error("Database Insert Error:", err);
            }
          });
        }
        return res.status(200).json({
          message: "File uploaded successfully",
          fileName: uploadedFile.filename,
        });
      });
    } catch (error) {
      console.error("Database Error:", error);
      return res.status(500).json({ error: "Database operation failed" });
    }
  });
};
exports.getackdocData = async (req, res) => {
  var data = req.body;

  db.query(
    "SELECT * FROM contract_upload WHERE  user_id =?",
    [data.user_id],
    function (err, results, fields) {
      res.json({ results });
    }
  );
};

exports.docdelete = async (req, res) => {
  const dd = req.body;

  var resultArrays = dd.id;
  var ss = "";
  counter = 0;
  resultArrays.forEach((roww) => {
    if (roww.isChecked === true) {
      var ss = "1";
      db.query(
        "DELETE FROM contract_upload WHERE id= ?",
        [roww.id],
        function (err, result) {
          if (err) throw err;
          counter++;
          if (resultArrays.length === counter) {
            db.query(
              "SELECT * from contract_upload where user_id=? order by id desc",
              [dd.user_id],
              function (err, results, fields) {
                if (err) throw err;
                res.json({ results });
              }
            );
          }
        }
      );
    }
  });
};

exports.savecontractfileswithfolder = (req, res) => {
  upload.array("files", 10)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: "File upload failed" });
    }

    console.log(req.files);
    const uploadedFiles = req.files;
    if (!uploadedFiles || uploadedFiles.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const folder_id = req.body.folder_id;

    try {
      // Step 1: Fetch folder name from `contract_folder` using `folder_id`
      const folderResult = await new Promise((resolve, reject) => {
        db.query(
          "SELECT name FROM contract_folder WHERE id = ?",
          [folder_id],
          (err, result) => {
            if (err) reject(err);
            else resolve(result);
          }
        );
      });

      if (!folderResult.length) {
        return res.status(400).json({ error: "Invalid folder ID" });
      }

      const folderName = folderResult[0].name;

      // Step 2: Ensure the folder exists
      const uploadPath = path.join(
        __dirname,
        "../../public/uploads/contractfolder/",
        folderName
      );

      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }

      // Step 3: Move uploaded files to the correct folder and insert into DB
      for (const file of uploadedFiles) {
        const newFilePath = path.join(uploadPath, file.filename);

        fs.renameSync(file.path, newFilePath); // Move file to the correct folder

        // Step 4: Save file details in `contract_filesusers`
        await new Promise((resolve, reject) => {
          db.query(
            "INSERT INTO contract_filesusers (folder_id, name, created_at) VALUES (?, ?, NOW())",
            [folder_id, file.filename],
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
        });
      }

      return res.status(200).json({ message: "Files uploaded successfully" });
    } catch (error) {
      console.error("Database Error:", error);
      return res.status(500).json({ error: "Database operation failed" });
    }
  });
};
exports.savecontractfiles = async (req, res) => {
  const { folder } = req.body; // Expecting a single folder name

  // Define the folder path
  const uploadPath = path.join(
    __dirname,
    "../../public/uploads/contractfolder/",
    folder
  );

  try {
    // Check if the folder name already exists in the database
    const existingFolder = await new Promise((resolve, reject) => {
      db.query(
        "SELECT id FROM contract_folder WHERE name = ?",
        [folder],
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        }
      );
    });

    if (existingFolder.length > 0) {
      return res.status(400).json({ error: "Folder name already exists" });
    }

    // Insert the folder name into the contract_folder table
    await new Promise((resolve, reject) => {
      db.query(
        "INSERT INTO contract_folder (name) VALUES (?)",
        [folder],
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      );
    });

    // ✅ Create the folder in the filesystem if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    return res.status(200).json({
      message: "Folder name saved and directory created successfully",
    });
  } catch (error) {
    console.error("Database/File System Error:", error);
    return res.status(500).json({ error: "Operation failed" });
  }
};

exports.getusercontractDetailFolderdetail = async (req, res) => {
  var data = req.body;
  var user_id = data.user_id;
  var folder_name = data.folder_name.folder_name; // Fix: Extract folder_name correctly

  console.log("Request Data:", data);

  db.query(
    `SELECT cf.*, cfu.name AS file_name
     FROM contract_folder cf
     LEFT JOIN contract_filesusers cfu ON cfu.folder_id = cf.id
     WHERE cf.name = ?`,
    [folder_name],
    function (err, results, fields) {
      if (err) {
        console.error("Database Error:", err);
        return res.status(500).json({ error: "Database query error" });
      }
      res.json({ results });
    }
  );
};
