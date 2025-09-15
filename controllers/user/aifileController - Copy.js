const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const { format } = require("date-fns");
const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const mysql = require("mysql2/promise"); // 👈 only used in this API
const cron = require("node-cron");

const pdfParse = require("pdf-parse");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const Stripe = require("stripe");
const stripe = new Stripe(
  "sk_test_51RUJzWAx6rm2q3pyUl86ZMypACukdO7IsZ0AbsWOcJqg9xWGccwcQwbQvfCaxQniDCWzNg7z2p4rZS1u4mmDDyou00DM7rK8eY"
);
const upload = require("../../middlewares/uploadMiddleware");

require("dotenv").config();

exports.uploadDocuments = async (req, res) => {
  const datasave = req.body;

  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const extractedTexts = [];

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      let text = "";

      try {
        if (ext === ".pdf") {
          const buffer = fs.readFileSync(file.path);
          const data = await pdfParse(buffer);
          text = data.text;
        } else if (ext === ".docx") {
          const result = await mammoth.extractRawText({ path: file.path });
          text = result.value;
        } else if (ext === ".xlsx") {
          const workbook = xlsx.readFile(file.path);
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          text = xlsx.utils.sheet_to_csv(sheet);
        } else if (ext === ".txt") {
          text = fs.readFileSync(file.path, "utf-8");
        } else {
          extractedTexts.push({
            filename: file.originalname,
            text: null,
            error: "Unsupported file type",
          });
          continue;
        }

        extractedTexts.push({
          filename: file.originalname,
          text,
          fileSavedAs: file.savedAs,
          filePath: file.path,
          error: null,
        });
      } catch (err) {
        extractedTexts.push({
          filename: file.originalname,
          text: null,
          error: "Error extracting text",
        });
        continue;
      }
    }

    // Save to DB (without AI summary/questions)
    for (const fileObj of extractedTexts) {
      if (!fileObj.text || fileObj.error) continue;

      const uploadedAt = new Date();
      await db.promise().query(
        `INSERT INTO dataroomdocuments 
         (user_id, category_id, subcategory_id, folder_name, doc_name, summary_txt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          datasave.user_id,
          datasave.catgeoryId || 0,
          datasave.subcatgeoryId || 0,
          datasave.filetype,
          fileObj.fileSavedAs,
          null, // No summary text saved
          uploadedAt,
        ]
      );
    }

    return res.json({
      message: "Files uploaded and saved successfully",
      extractedTexts,
    });
  } catch (error) {
    console.error("Error in uploadDocuments:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
exports.uploadDocumentsEdit = async (req, res) => {
  var datasave = req.body;
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    if (datasave.documentId) {
      // ✅ Update existing document
      await db.promise().query(
        `UPDATE dataroomdocuments
     SET doc_name = ?
     WHERE id = ?`,
        [files.savedAs, datasave.documentId]
      );
    }

    res.status(200).json({ message: "" });
    // Combine all texts for AI prompt
    // const combinedText = extractedTexts
    //   .filter((f) => f.text)
    //   .map((f) => `File: ${f.filename}\n${f.text}`)
    //   .join("\n\n---\n\n");

    // const truncatedCombinedText = combinedText.slice(0, 15000); // Token limit adjust karein

    // const aiPrompt = `
    //   You are an AI assistant performing due diligence analysis.

    //   The following documents' contents are provided:

    //   ${truncatedCombinedText}

    //   Please:
    //   1. Identify key sections/headings from the combined documents.
    //   2. For each section, provide a detailed summary of max 1000 characters.

    //   Return JSON with each heading and its summary.
    //   `;

    // // Call OpenAI API
    // const gptResponse = await openai.chat.completions.create({
    //   model: "gpt-4",
    //   messages: [
    //     { role: "system", content: "You summarize due diligence documents." },
    //     { role: "user", content: aiPrompt },
    //   ],
    //   max_tokens: 1500,
    // });

    // let overview;
    // try {
    //   overview = JSON.parse(gptResponse.choices[0].message.content);
    // } catch (e) {
    //   overview = {
    //     error: "Failed to parse AI summary output",
    //     raw: gptResponse.choices[0].message.content,
    //   };
    // }

    // return res.json({ overview, extractedTexts });
  } catch (error) {
    console.error("Error uploading documents:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.CreateuserSubscriptionDataRoomCheck = async (req, res) => {
  const { amount } = req.body;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "eur",
      automatic_payment_methods: { enabled: true },
    });

    if (paymentIntent.client_secret) {
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    }
  } catch (err) {
    console.error("Stripe Error:", err);
    res.status(500).json({ error: err.message });
  }
};
exports.CreateuserSubscriptionDataRoom = async (req, res) => {
  const { amount, user_id, clientSecret, payment_status } = req.body;
  var dd = req.body;
  try {
    const userInsertQuery = `
        INSERT INTO usersubscriptiondataroomone_time 
        (payment_status,start_date, end_date, price, user_id, clientSecret, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

    const startDate = new Date();

    // Add 3 months to start date
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 3);

    db.query(
      userInsertQuery,
      [
        payment_status,
        startDate,
        endDate,
        amount,
        user_id,
        clientSecret,
        startDate,
      ],
      async (err, result) => {
        if (err) {
          console.error("DB Insert Error:", err);
          return res.status(500).json({ error: "Database error" + dd });
        }

        res.status(200).json({
          message: "",
          status: 1,
        });
      }
    );
  } catch (err) {
    console.error("Stripe Error:", err);
    res.status(500).json({ error: err.message });
  }
};
exports.CreateuserSubscriptionDataRoomPerinstance = async (req, res) => {
  const { amount, user_id, clientSecret, PayidOnetime, payment_status } =
    req.body;

  try {
    const userInsertQuery = `
        INSERT INTO usersubscriptiondataroom_perinstance 
        (payment_status,usersubscriptiondataroomone_time_id, price, user_id, clientSecret, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `;

    const startDate = new Date();

    db.query(
      userInsertQuery,
      [payment_status, PayidOnetime, amount, user_id, clientSecret, startDate],
      async (err, result) => {
        if (err) {
          console.error("DB Insert Error:", err);
          return res.status(500).json({ error: "Database error" });
        }

        res.status(200).json({
          message: "",
          status: 1,
        });
      }
    );
  } catch (err) {
    console.error("Stripe Error:", err);
    res.status(500).json({ error: err.message });
  }
};
exports.getcategoryname = (req, res) => {
  var cat_id = req.body.cat_id;
  const query = "SELECT * FROM  dataroomcategories where id = ?";

  db.query(query, [cat_id], (err, row) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      row: row,
    });
  });
};
//sendmailcheck();
function sendmailcheck() {
  const transporter = nodemailer.createTransport({
    host: "mail.blueprintcatalyst.com",
    port: 587,
    secure: false, // STARTTLS
    auth: {
      user: "angels@blueprintcatalyst.com",
      pass: "m.@biCC^oY3*2hx1",
    },
    tls: {
      rejectUnauthorized: false, // if you get SSL certificate errors
    },
  });

  const mailOptions = {
    from: "angels@blueprintcatalyst.com",
    to: "avinayquicktech@gmail.com",
    subject: "Test email",
    text: "This is a test email",
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      return console.error("Error sending email:", error);
    }
    console.log("Email sent:", info);
  });
}

exports.UserDocDeleteFile = (req, res) => {
  const user_id = req.body.user_id;
  const id = req.body.id;

  if (!user_id || !id) {
    return res.status(400).json({ message: "user_id and id are required" });
  }

  // 1. Find the document record by id and user_id
  const query = "SELECT * FROM dataroomdocuments WHERE id = ? AND user_id = ?";

  db.query(query, [id, user_id], (err, rows) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    if (rows.length === 0) {
      return res.status(404).json({ message: "Document not found" });
    }

    const doc = rows[0];
    // Construct the file path based on your folder structure
    // Example: assuming folder_name corresponds to a folder, and doc_name is the file
    // Adjust folder path as per your upload folder structure
    const filePath = path.join(
      __dirname,
      "..",
      "..",
      "upload",
      "docs",
      `doc_${user_id}`,
      doc.folder_name,
      doc.doc_name
    );

    // 2. Delete the file from filesystem
    fs.unlink(filePath, (fsErr) => {
      if (fsErr && fsErr.code !== "ENOENT") {
        // ENOENT means file doesn't exist - maybe already deleted, ignore if so
        return res.status(500).json({
          message: "Failed to delete file from server",
          error: fsErr,
        });
      }

      // 3. Delete the record from database
      const deleteQuery =
        "DELETE FROM dataroomdocuments WHERE id = ? AND user_id = ?";

      db.query(deleteQuery, [id, user_id], (deleteErr, result) => {
        if (deleteErr) {
          return res.status(500).json({
            message: "Failed to delete document record",
            error: deleteErr,
          });
        }

        return res.json({
          message: "Document deleted successfully",
          affectedRows: result.affectedRows,
        });
      });
    });
  });
};
// In aifileController.js
exports.filedownload = (req, res) => {
  const { userId, folderName, filename } = req.body;

  const filePath = path.join(
    __dirname,
    "..",
    "..",
    "upload",
    "docs",
    `doc_${userId}`,
    folderName,
    filename
  );

  if (fs.existsSync(filePath)) {
    return res.download(filePath, filename); // ✅ Triggers file download in browser
  } else {
    return res.status(404).json({ error: "File not found" });
  }
};

exports.getAIquestion = (req, res) => {
  const user_id = req.body.user_id;
  const id = req.body.id;

  if (!user_id || !id) {
    return res.status(400).json({ message: "user_id and id are required" });
  }

  // 1. Find the document record by id and user_id
  const query =
    "SELECT * FROM dataroomai_response WHERE dataroomai_summary_id = ? AND user_id = ?";

  db.query(query, [id, user_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    return res.status(200).json({ results: results });
  });
};
exports.RespoonseAIquestion = async (req, res) => {
  const responses = req.body;

  if (!Array.isArray(responses)) {
    return res.status(400).json({ error: "Invalid data format" });
  }

  const connection = db.promise();

  try {
    for (const item of responses) {
      const { questionId, answer } = item;

      if (!questionId || answer === undefined) continue;

      await connection.query(
        `UPDATE dataroomai_response 
         SET answer = ?, updated_at = ? 
         WHERE id = ?`,
        [answer, new Date(), questionId]
      );
    }

    res.status(200).json({ message: "Responses updated" });
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
exports.fileApproved = async (req, res) => {
  const responses = req.body;
  console.log(responses.id);
  db.query(
    "UPDATE dataroomdocuments SET status = ? WHERE category_id = ? And user_id =?",
    ["Yes", responses.id, responses.user_id],
    (finalErr) => {
      if (finalErr) {
        return res
          .status(500)
          .json({ message: "Update failed", error: finalErr });
      }
      return res.status(200).json({ message: "Updated successfully" });
    }
  );
};
function formatCurrentDate() {
  const date = new Date(); // current date
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  const getOrdinal = (n) => {
    if (n >= 11 && n <= 13) return "th";
    switch (n % 10) {
      case 1:
        return "st";
      case 2:
        return "nd";
      case 3:
        return "rd";
      default:
        return "th";
    }
  };

  return `${month} ${day}${getOrdinal(day)}, ${year}`;
}
const safedoc = (val) => (val?.toString().trim() ? val : "N/A");

exports.generateDocFile = async (req, res) => {
  const responses = req.body;

  try {
    db.query(
      "SELECT * FROM company WHERE id = ?",
      [responses.user_id],
      (err, result) => {
        if (err)
          return res
            .status(500)
            .json({ message: "DB query failed", error: err });
        if (!result || result.length === 0)
          return res.status(404).json({ message: "Company not found" });

        const company = result[0];

        db.query(
          `SELECT * FROM usersubscriptiondataroomone_time WHERE unique_code = ?`,
          [responses.code],
          (err, qaResultss) => {
            if (err || !qaResultss?.length) {
              return res
                .status(500)
                .json({ message: "One-time code not found", error: err });
            }

            const oneTimeId = qaResultss[0].id;

            db.query(
              `SELECT MAX(version) AS latestVersion 
             FROM dataroom_generatedocument 
             WHERE user_id = ? AND usersubscriptiondataroomone_time_id = ?`,
              [responses.user_id, oneTimeId],
              (err, versionResult) => {
                if (err) {
                  return res
                    .status(500)
                    .json({ message: "Version fetch failed", error: err });
                }

                const version = (versionResult[0]?.latestVersion || 0) + 1;

                db.query(
                  `SELECT doc_name, summary FROM dataroomai_summary_files WHERE user_id = ? AND uniqcode = ?`,
                  [responses.user_id, responses.code],
                  (err, fileResults) => {
                    if (err)
                      return res
                        .status(500)
                        .json({ message: "Summary fetch failed", error: err });

                    const documents = (fileResults || []).map((doc) => ({
                      doc_name: doc.doc_name,
                      summary: doc.summary ? doc.summary.substring(0, 200) : "",
                    }));

                    db.query(
                      `SELECT summary, category_id FROM dataroomai_summary WHERE user_id = ? AND uniqcode = ?`,
                      [responses.user_id, responses.code],
                      (err, fileSummaryResults) => {
                        if (err)
                          return res.status(500).json({
                            message: "Management Summary fetch failed",
                            error: err,
                          });

                        let managementSummary = "",
                          productOr_Summary = "",
                          salesmarketing = "",
                          operations = "",
                          regulatory = "",
                          technology = "",
                          riskmanagement = "",
                          finanicalinformation = "";

                        fileSummaryResults?.forEach((row) => {
                          const text = row.summary?.substring(0, 800) || "";
                          switch (row.category_id) {
                            case 1:
                              if (!managementSummary) managementSummary = text;
                              break;
                            case 2:
                              if (!productOr_Summary) productOr_Summary = text;
                              break;
                            case 3:
                              if (!salesmarketing) salesmarketing = text;
                              break;
                            case 4:
                              if (!technology) technology = text;
                              break;
                            case 5:
                              if (!operations) operations = text;
                              break;
                            case 6:
                              if (!regulatory) regulatory = text;
                              break;
                            case 7:
                              if (!riskmanagement) riskmanagement = text;
                              break;
                            case 8:
                              if (!finanicalinformation)
                                finanicalinformation = text;
                              break;
                          }
                        });

                        db.query(
                          `SELECT category_id, subcategory_id, summary 
                         FROM dataroomai_summary_subcategory 
                         WHERE user_id = ? AND uniqcode = ? 
                         ORDER BY id DESC`,
                          [responses.user_id, responses.code],
                          (err, advisorResults) => {
                            if (err)
                              return res.status(500).json({
                                message: "Advisor fetch failed",
                                error: err,
                              });

                            let boardOfadvisor = "N/A",
                              Intellectual = "N/A";

                            for (const row of advisorResults) {
                              if (
                                row.category_id === 1 &&
                                row.subcategory_id === 3
                              )
                                boardOfadvisor =
                                  row.summary?.substring(0, 200) || "N/A";
                              else if (
                                row.category_id === 2 &&
                                row.subcategory_id === 6
                              )
                                Intellectual =
                                  row.summary?.substring(0, 200) || "N/A";
                            }

                            db.query(
                              `SELECT questions, answer, category_id 
                             FROM dataroomai_response 
                             WHERE user_id = ? AND uniqcode = ?`,
                              [responses.user_id, responses.code],
                              (err, qaResults) => {
                                if (err)
                                  return res.status(500).json({
                                    message: "Q&A fetch failed",
                                    error: err,
                                  });

                                const getQA = (categoryId) =>
                                  (qaResults || [])
                                    .filter(
                                      (item) => item.category_id === categoryId
                                    )
                                    .slice(0, 3)
                                    .map((item, index) => ({
                                      index: index + 1,
                                      question: item.questions?.trim() || "N/A",
                                      answer: item.answer?.trim() || "N/A",
                                    }));

                                const questionAnswers = getQA(2);
                                const questionAnswersSalesMarketing = getQA(3);
                                const questionAnswersTechnology = getQA(4);
                                const questionAnswersOperations = getQA(5);
                                const questionAnswersRegulatory = getQA(6);
                                const questionAnswersfinancialinformation =
                                  getQA(8);

                                const templatePath = path.resolve(
                                  __dirname,
                                  "../../upload/temp/Due_Diligence_and_Company_Overview_Document_Keiretsu_Forum_Canada.docx"
                                );

                                const content = fs.readFileSync(
                                  templatePath,
                                  "binary"
                                );
                                const zip = new PizZip(content);
                                const doc = new Docxtemplater(zip, {
                                  paragraphLoop: true,
                                  linebreaks: true,
                                });

                                const currentDate = formatCurrentDate();
                                const fileName = generateFileName(
                                  company.company_name,
                                  version
                                );

                                doc.render({
                                  company_name: safedoc(company.company_name),
                                  contact_email: safedoc(company.email),
                                  contact_phone: safedoc(company.phone),
                                  company_website: safedoc(
                                    company.company_website
                                  ),
                                  city_step2: safedoc(company.city_step2),
                                  company_country: safedoc(
                                    company.company_country
                                  ),
                                  company_mail_address: safedoc(
                                    company.company_mail_address
                                  ),
                                  website: safedoc(company.website),
                                  first_name: safedoc(company.first_name),
                                  last_name: safedoc(company.last_name),
                                  created_at: formatWithOrdinal(
                                    new Date(company.created_at)
                                  ),
                                  current_Date: currentDate,
                                  documents,
                                  managementSummary: safedoc(managementSummary),
                                  boardOfadvisor: safedoc(boardOfadvisor),
                                  productOr_Summary: safedoc(productOr_Summary),
                                  Intellectual: safedoc(Intellectual),
                                  salesmarketing: safedoc(salesmarketing),
                                  operations: safedoc(operations),
                                  regulatory: safedoc(regulatory),
                                  technology: safedoc(technology),
                                  riskmanagement: safedoc(riskmanagement),
                                  finanicalinformation:
                                    safedoc(finanicalinformation),
                                  qas: questionAnswers,
                                  salesMarketing: questionAnswersSalesMarketing,
                                  technologyInfrastructure:
                                    questionAnswersTechnology,
                                  questionAnswersOperations,
                                  questionAnswersRegulatory,
                                  questionAnswersfinancialinformation,
                                });

                                const buffer = doc
                                  .getZip()
                                  .generate({ type: "nodebuffer" });

                                // Save to DB
                                db.query(
                                  `INSERT INTO dataroom_generatedocument 
                                 (user_id, version, usersubscriptiondataroomone_time_id, document_name, created_at) 
                                 VALUES (?, ?, ?, ?, NOW())`,
                                  [
                                    responses.user_id,
                                    version,
                                    oneTimeId,
                                    fileName,
                                  ],
                                  (insertErr) => {
                                    if (insertErr)
                                      console.error(
                                        "Document log insert failed",
                                        insertErr
                                      );
                                  }
                                );

                                // Save to file system
                                const folderPath = path.join(
                                  __dirname,
                                  "..",
                                  "..",
                                  "upload",
                                  "docs",
                                  `doc_${responses.user_id}`,
                                  "diligence_document"
                                );

                                fs.mkdirSync(folderPath, { recursive: true });

                                const filePath = path.join(
                                  folderPath,
                                  fileName
                                );
                                fs.writeFileSync(filePath, buffer);

                                // Update subscription status
                                db.query(
                                  `UPDATE usersubscriptiondataroomone_time
                                 SET status = ?
                                 WHERE user_id = ? AND unique_code = ?`,
                                  [
                                    "Inactive",
                                    responses.user_id,
                                    responses.code,
                                  ],
                                  (finalErr) => {
                                    if (finalErr)
                                      console.error(
                                        "Update status failed",
                                        finalErr
                                      );
                                  }
                                );

                                // Send the file as response
                                // ✅ Set headers BEFORE sending response
                                res.setHeader(
                                  "Access-Control-Expose-Headers",
                                  "Content-Disposition"
                                );
                                res.setHeader(
                                  "Content-Disposition",
                                  `attachment; filename="${fileName}"`
                                );
                                res.setHeader(
                                  "Content-Type",
                                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                );
                                res.send(buffer);
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
    );
  } catch (error) {
    console.error("Error generating document:", error);
    res.status(500).json({ message: "Internal Server Error", error });
  }
};

// Helper: Create file name
function generateFileName(companyName, version) {
  const sanitized = companyName.replace(/[^a-zA-Z0-9]/g, "_");
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${sanitized}_Diligence_${dateStr}_v${version}.docx`;
}

function formatWithOrdinal(dateObj) {
  const day = dateObj.getDate();
  const month = dateObj.toLocaleString("en-US", { month: "long" });
  const year = dateObj.getFullYear();

  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
      ? "nd"
      : day % 10 === 3 && day !== 13
      ? "rd"
      : "th";

  return `${month} ${day}${suffix}, ${year}`;
}

exports.getAISummary = async (req, res) => {
  const responses = req.body;
  try {
    db.query(
      "SELECT * FROM  dataroomai_summary WHERE category_id = ? And user_id =?",
      [responses.id, responses.user_id],
      (err, row) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB query failed", error: err });
        }
        res.status(200).json({ results: row[0].summary, row: row });
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error });
  }
};
exports.aisummaryUpdate = async (req, res) => {
  const responses = req.body;
  try {
    db.query(
      "UPDATE dataroomai_summary SET summary = ? WHERE id = ?",
      [responses.aisummary, responses.id],
      (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB query failed", error: err });
        }
        res.status(200).json({});
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error });
  }
};

exports.generateProcessAI = async (req, res) => {
  const { user_id, payid } = req.body;
  const uniqcode = generateUniqueCode();
  try {
    const [docs] = await db
      .promise()
      .query(`SELECT * FROM dataroomdocuments WHERE user_id = ?`, [user_id]);

    if (!docs.length) {
      return res.status(404).json({ message: "No documents found." });
    }

    const catGroups = {};
    for (const doc of docs) {
      const catId = doc.category_id;
      if (!catGroups[catId]) catGroups[catId] = [];
      catGroups[catId].push(doc);
    }

    const summaries = [];
    const createdAt = new Date();

    for (const [category_id, groupDocs] of Object.entries(catGroups)) {
      const fileTexts = [];

      for (const doc of groupDocs) {
        const filePath = path.join(
          __dirname,
          "..",
          "..",
          "upload",
          "docs",
          `doc_${doc.user_id}`,
          doc.folder_name,
          doc.doc_name
        );

        if (!fs.existsSync(filePath)) continue;

        let content = "";
        const ext = path.extname(doc.doc_name).toLowerCase();

        try {
          if (ext === ".txt") {
            content = fs.readFileSync(filePath, "utf-8");
          } else if (ext === ".pdf") {
            const buffer = fs.readFileSync(filePath);
            const data = await pdfParse(buffer);
            content = data.text;
          } else if (ext === ".docx") {
            const result = await mammoth.extractRawText({ path: filePath });
            content = result.value;
          } else if (ext === ".xlsx") {
            const workbook = xlsx.readFile(filePath);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            content = xlsx.utils.sheet_to_csv(sheet);
          } else {
            continue;
          }

          fileTexts.push(`File: ${doc.doc_name}\n${content}`);
        } catch (e) {
          console.error(`Error reading file: ${filePath}`, e);
        }
      }

      if (!fileTexts.length) continue;

      const combinedText = fileTexts.join("\n\n---\n\n").slice(0, 15000);
      const prompt = `You are an AI assistant helping with due diligence document analysis.\n\nHere is the combined content of multiple documents:\n\n${combinedText}\n\nPlease:\n1. Identify key sections or topics.\n2. Summarize each in no more than 1000 characters.\n3. Return the result as a JSON array in this format:\n[\n  {\n    \"heading\": \"Section Heading\",\n    \"summary\": \"Summary text...\"\n  }\n]`;

      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: "You summarize due diligence documents." },
          { role: "user", content: prompt },
        ],
        max_tokens: 1000,
      });

      const rawContent = response.choices[0].message.content;
      const match = rawContent.match(/\[\s*{[\s\S]*?}\s*\]/);
      let finalSummaries = [];

      try {
        finalSummaries = JSON.parse(match ? match[0] : "[]");
      } catch (err) {
        console.error("\u274C Failed to parse summary JSON:", err);
        continue;
      }

      let fileSummary = "";
      finalSummaries.forEach((item) => {
        if (item.heading && item.summary) {
          fileSummary += `${item.heading}\n${item.summary}\n\n`;
        }
      });

      const [summaryResult] = await db.promise().query(
        `INSERT INTO dataroomai_summary 
         (uniqcode, usersubscriptiondataroomone_time_id, user_id, summary, category_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [uniqcode, payid, user_id, fileSummary, category_id, createdAt]
      );

      const summaryId = summaryResult.insertId;
      summaries.push({ category_id, summary: fileSummary });

      const qPrompt = `You are a due diligence analyst. Based on the following summary:\n\n\"${fileSummary}\"\n\nGenerate 3 important due diligence questions. Return them as a JSON array of strings.`;

      const qResponse = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: "You generate due diligence questions." },
          { role: "user", content: qPrompt },
        ],
        max_tokens: 500,
      });

      let questions = [];
      try {
        const qMatch = qResponse.choices[0].message.content.match(/\[.*\]/s);
        questions = qMatch ? JSON.parse(qMatch[0]) : [];
      } catch (err) {
        console.error("\u274C Failed to parse questions JSON:", err);
      }

      for (const question of questions.slice(0, 3)) {
        await db.promise().query(
          `INSERT INTO dataroomai_response 
         (user_id, dataroomai_summary_id, uniqcode, category_id,  questions, answer, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            user_id,
            summaryId,
            uniqcode,
            category_id,
            question,
            null,
            new Date(),
          ]
        );
      }

      // ✅ SUBCATEGORY processing
      const subcategoryGroups = {};
      for (const doc of groupDocs) {
        const key = `${doc.category_id}_${doc.subcategory_id}`;
        if (!subcategoryGroups[key]) subcategoryGroups[key] = [];
        subcategoryGroups[key].push(doc);
      }

      for (const [catSubKey, subDocs] of Object.entries(subcategoryGroups)) {
        const [catId, subId] = catSubKey.split("_");
        const subFileTexts = [];

        for (const doc of subDocs) {
          const filePath = path.join(
            __dirname,
            "..",
            "..",
            "upload",
            "docs",
            `doc_${doc.user_id}`,
            doc.folder_name,
            doc.doc_name
          );

          if (!fs.existsSync(filePath)) continue;

          let content = "";
          const ext = path.extname(doc.doc_name).toLowerCase();

          try {
            if (ext === ".txt") {
              content = fs.readFileSync(filePath, "utf-8");
            } else if (ext === ".pdf") {
              const buffer = fs.readFileSync(filePath);
              const data = await pdfParse(buffer);
              content = data.text;
            } else if (ext === ".docx") {
              const result = await mammoth.extractRawText({ path: filePath });
              content = result.value;
            } else if (ext === ".xlsx") {
              const workbook = xlsx.readFile(filePath);
              const sheet = workbook.Sheets[workbook.SheetNames[0]];
              content = xlsx.utils.sheet_to_csv(sheet);
            } else {
              continue;
            }

            const filePrompt = `You are an AI assistant summarizing due diligence documents.\n\nDocument:\n${content}\n\nSummarize the content in less than 1000 characters:`;

            const aiFileSummary = await openai.chat.completions.create({
              model: "gpt-4",
              messages: [
                {
                  role: "system",
                  content: "You summarize due diligence documents.",
                },
                { role: "user", content: filePrompt },
              ],
              max_tokens: 250,
            });

            const parsed = aiFileSummary.choices[0].message.content.trim();

            if (parsed) {
              await db.promise().query(
                `INSERT INTO dataroomai_summary_files 
                 (user_id, usersubscriptiondataroomone_time_id, uniqcode, category_id, subcategory_id, doc_name, folder_name, summary, created_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  user_id,
                  payid,
                  uniqcode,
                  doc.category_id,
                  doc.subcategory_id,
                  doc.doc_name,
                  doc.folder_name,
                  parsed,
                  createdAt,
                ]
              );
            }

            subFileTexts.push(`File: ${doc.doc_name}\n${parsed}`);
          } catch (e) {
            console.error("Error reading file:", filePath, e);
          }
        }

        if (subFileTexts.length) {
          const combinedSubText = subFileTexts
            .join("\n\n---\n\n")
            .slice(0, 15000);

          await db.promise().query(
            `INSERT INTO dataroomai_summary_subcategory 
             (user_id, uniqcode, usersubscriptiondataroomone_time_id, category_id, subcategory_id, summary, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              user_id,
              uniqcode,
              payid,
              parseInt(catId),
              parseInt(subId),
              combinedSubText,
              "Active",
              new Date(),
            ]
          );
        }
      }
    }

    db.query(
      "UPDATE usersubscriptiondataroomone_time SET unique_code = ?,status=? WHERE id = ?",
      [uniqcode, "Active", payid],
      (finalErr) => {
        if (finalErr) {
          return res
            .status(500)
            .json({ message: "Update failed", error: finalErr });
        }
      }
    );

    return res.status(200).json({
      message: "Summaries and questions generated.",
      summaries,
      code: uniqcode,
    });
  } catch (error) {
    console.error("\u274C Error in generateProcessAI:", error);
    return res.status(500).json({ message: "Internal server error", error });
  }
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

exports.checkuserSubscriptionThreeMonth = async (req, res) => {
  const responses = req.body;
  try {
    db.query(
      "SELECT * FROM usersubscriptiondataroomone_time WHERE user_id = ? AND end_date >= CURRENT_DATE ORDER BY id DESC;",
      [responses.user_id],
      (err, row) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB query failed", error: err });
        }

        res.status(200).json({ results: row });
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error });
  }
};
exports.perInstancePayment = async (req, res) => {
  const { user_id, payid } = req.body;
  console.log(req.body);
  try {
    // Step 1: Get total summaries
    db.query(
      "SELECT COUNT(*) AS summaryCount FROM dataroomai_summary WHERE user_id = ? AND usersubscriptiondataroomone_time_id = ?",
      [user_id, payid],
      (err, summaryResults) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB summary query failed", error: err });
        }

        const totalSummaries = summaryResults[0].summaryCount;

        // Step 2: Get total per-instance payments
        db.query(
          "SELECT COUNT(*) AS paymentCount FROM usersubscriptiondataroom_perinstance WHERE user_id = ? AND usersubscriptiondataroomone_time_id = ?",
          [user_id, payid],
          (err, paymentResults) => {
            if (err) {
              return res
                .status(500)
                .json({ message: "DB payment query failed", error: err });
            }

            const paymentCount = paymentResults[0].paymentCount;

            const allowedFree = 2;
            const paidSummaries = totalSummaries - allowedFree;

            // Step 3: Business logic
            if (totalSummaries < allowedFree) {
              return res.status(200).json({
                status: "free",
                allowGeneration: true,
                totalSummaries,
                paymentCount,
              });
            }

            if (paidSummaries < paymentCount) {
              return res.status(200).json({
                status: "paid-allowed",
                allowGeneration: true,
                totalSummaries,
                paymentCount,
              });
            } else {
              return res.status(200).json({
                status: "need-payment",
                allowGeneration: false,
                totalSummaries,
                paymentCount,
              });
            }
          }
        );
      }
    );
  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error", error });
  }
};
exports.getDocumentcheck = async (req, res) => {
  const { user_id } = req.body;

  try {
    // Step 1: Get total summaries
    db.query(
      "SELECT * FROM dataroomdocuments WHERE user_id = ?",
      [user_id],
      (err, summaryResults) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB summary query failed", error: err });
        }

        return res.status(200).json({
          status: "",
          results: summaryResults,
        });
      }
    );
  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error", error });
  }
};
exports.checkunicode = async (req, res) => {
  const { user_id, code } = req.body;
  try {
    // Step 1: Get total summaries
    db.query(
      "SELECT * FROM usersubscriptiondataroomone_time WHERE user_id = ? And unique_code = ? And status =?",
      [user_id, code, "Active"],
      (err, summaryResults) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB summary query failed", error: err });
        }

        return res.status(200).json({
          status: "",
          results: summaryResults,
        });
      }
    );
  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error", error });
  }
};
exports.checkcreditbalance = async (req, res) => {
  const { user_id } = req.body;

  try {
    // Step 1: Get latest subscription
    db.query(
      `SELECT id, end_date 
       FROM usersubscriptiondataroomone_time 
       WHERE user_id = ? And end_date >= CURRENT_DATE
       ORDER BY id DESC 
       LIMIT 1`,
      [user_id],
      (err, subscriptionResults) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Subscription query failed", error: err });
        }

        if (subscriptionResults.length === 0) {
          return res.status(404).json({ message: "No subscription found" });
        }

        const subscription = subscriptionResults[0];
        const subscriptionId = subscription.id;

        // Step 2: Count generated summaries
        db.query(
          `SELECT COUNT(*) AS total_generated 
           FROM dataroomai_summary 
           WHERE user_id = ? AND usersubscriptiondataroomone_time_id = ?`,
          [user_id, subscriptionId],
          (err, summaryCountResults) => {
            if (err) {
              return res
                .status(500)
                .json({ message: "Summary count query failed", error: err });
            }

            const totalGenerated = summaryCountResults[0].total_generated;
            const freeCredits = 2;
            const extraGenerations = Math.max(0, totalGenerated - freeCredits);
            const creditBalance = Math.max(0, freeCredits - totalGenerated);
            const amountDue = extraGenerations * 100;

            return res.status(200).json({
              status: "success",
              subscription_id: subscriptionId,
              total_generated: totalGenerated,
              credit_balance: creditBalance,
              extra_generations: extraGenerations,
              amount_due: amountDue,
              valid_until: subscription.end_date,
            });
          }
        );
      }
    );
  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error", error });
  }
};

const safe = (value) => {
  if (value === undefined || value === null || value === "") return null;
  return value;
};

exports.Addinvenstorreport = async (req, res) => {
  try {
    const {
      user_id,
      financialPerformance,
      operationalUpdates,
      marketCompetitive,
      customerProduct,
      fundraisingFinancial,
      futureOutlook,
    } = req.body;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "user_id is required.",
      });
    }

    // 1. Get latest version
    const versionQuery = `SELECT MAX(version) AS max_version FROM investor_updates WHERE user_id = ?`;
    db.query(versionQuery, [user_id], async (err, versionResults) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Version fetch failed.",
        });
      }

      const latestVersion = Number(versionResults[0]?.max_version || 0);
      const newVersion = latestVersion + 1;

      let previousData = null;
      if (latestVersion > 0) {
        const prevQuery = `
          SELECT financial_performance, operational_updates, market_competitive,
                 customer_product, fundraising_financial, future_outlook
          FROM investor_updates
          WHERE user_id = ? AND version = ?
        `;
        const [prevResults] = await db
          .promise()
          .query(prevQuery, [user_id, latestVersion]);
        previousData = prevResults[0] || null;
      }

      // 2. Prepare prompt for OpenAI
      const comparisonPrompt = previousData
        ? `
You are an AI assistant helping write investor updates. Compare the previous update with the latest update and summarize the differences clearly.

Previous Update:
- Financial: ${previousData.financial_performance}
- Operational: ${previousData.operational_updates}
- Market: ${previousData.market_competitive}
- Customer/Product: ${previousData.customer_product}
- Fundraising: ${previousData.fundraising_financial}
- Outlook: ${previousData.future_outlook}

Current Update:
- Financial: ${financialPerformance}
- Operational: ${operationalUpdates}
- Market: ${marketCompetitive}
- Customer/Product: ${customerProduct}
- Fundraising: ${fundraisingFinancial}
- Outlook: ${futureOutlook}

Write a detailed executive summary (~200 words) showing progress or changes.
`
        : `
You are an AI assistant helping prepare a professional investor update. Summarize the following information into an executive summary (~200 words).

Financial Performance: ${financialPerformance}
Operational Updates: ${operationalUpdates}
Market & Competitive Landscape: ${marketCompetitive}
Customer & Product Insights: ${customerProduct}
Fundraising & Financial Strategy: ${fundraisingFinancial}
Future Outlook & Strategy: ${futureOutlook}
`;

      const chatResponse = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: comparisonPrompt }],
        temperature: 0.7,
      });

      const executive_summary = chatResponse.choices[0].message.content.trim();

      // 3. Get company name
      const [companyResult] = await db
        .promise()
        .query("SELECT company_name FROM users WHERE id = ? LIMIT 1", [
          user_id,
        ]);
      const companyName =
        companyResult[0]?.company_name?.replace(/\s+/g, "_") || "company";

      const formattedDate = formatCustomDate(new Date());
      const docFileName = `${companyName}_investor_update_v${newVersion}_${formattedDate}.docx`;

      // 4. Generate .docx file
      const templateText = `
Investor Report for ${companyName} (Version ${newVersion} - ${formattedDate})

Executive Summary:
${executive_summary}
`;

      const zip = new PizZip();
      zip.file(
        "word/document.xml",
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
           <w:body>
             <w:p><w:r><w:t>${templateText}</w:t></w:r></w:p>
           </w:body>
         </w:document>`
      );

      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
      });

      const buffer = doc.getZip().generate({ type: "nodebuffer" });

      // 5. Save file to disk
      const folderPath = path.join(
        __dirname,
        "..",
        "..",
        "upload",
        "docs",
        `doc_${user_id}`,
        "investor_report"
      );

      fs.mkdirSync(folderPath, { recursive: true });
      const filePath = path.join(folderPath, docFileName);
      fs.writeFileSync(filePath, buffer);

      // 6. Insert into DB
      const insertQuery = `
        INSERT INTO investor_updates (
          user_id, version, update_date,
          financial_performance, operational_updates, market_competitive,
          customer_product, fundraising_financial, future_outlook,
          executive_summary, document_name, is_locked, created_at, updated_at
        ) VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;

      const safe = (v) =>
        v === undefined || v === null || v === "" ? null : v;

      const values = [
        safe(user_id),
        newVersion,
        safe(financialPerformance),
        safe(operationalUpdates),
        safe(marketCompetitive),
        safe(customerProduct),
        safe(fundraisingFinancial),
        safe(futureOutlook),
        safe(executive_summary),
        docFileName,
        0,
      ];

      db.query(insertQuery, values, (err, result) => {
        if (err) {
          return res.status(500).json({
            success: false,
            message: "Insert failed.",
            error: err.message,
          });
        }

        return res.status(200).json({
          success: true,
          message: `Investor report version ${newVersion} created and saved.`,
          document_name: docFileName,
          executive_summary,
        });
      });
    });
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong.",
      error: error.message,
    });
  }
};
function formatCustomDate(date) {
  const month = format(date, "LLLL");
  const day = Number(format(date, "d"));
  const year = format(date, "yyyy");

  const suffix =
    day > 3 && day < 21 ? "th" : ["st", "nd", "rd"][(day % 10) - 1] || "th";

  return `${month}_${day}${suffix}_${year}`;
}
exports.getinvestorReports = (req, res) => {
  const user_id = req.body.user_id;

  const query = `
    SELECT investor_updates.*, company.company_name 
    FROM investor_updates 
    LEFT JOIN company ON company.id = investor_updates.user_id 
    WHERE investor_updates.user_id = ? 
    ORDER BY investor_updates.id DESC;
  `;

  db.query(query, [user_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    var pathname = "upload/docs/doc_" + user_id;
    const updatedResults = results.map((doc) => ({
      ...doc,
      downloadUrl: `https://blueprintcatalyst.com/${pathname}/investor_report/${doc.document_name}`,
    }));
    console.log(updatedResults);
    res.status(200).json({
      results: updatedResults,
    });
  });
};

exports.downloadFile = (req, res) => {
  const { userId, folder, filename } = req.params;

  const filePath = path.join(
    __dirname,
    "..",
    "..",
    "upload",
    "docs",
    `doc_${userId}`,
    folder,
    filename
  );

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }

  res.download(filePath, filename, (err) => {
    if (err) {
      console.error("Download error:", err);
      res.status(500).send("Download failed");
    }
  });
};
exports.getinvestorReportsSingle = (req, res) => {
  var user_id = req.body.user_id;
  var id = req.body.id;
  const query = "SELECT * from investor_updates where user_id =?  And id=?";
  db.query(query, [user_id, id], (err, row) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    res.status(200).json({
      results: row,
    });
  });
};

exports.aisummaryInvestorreportUpdate = async (req, res) => {
  const responses = req.body;
  try {
    db.query(
      "UPDATE investor_updates SET executive_summary = ?,is_locked=? WHERE id = ?",
      [responses.aisummary, 1, responses.id],
      (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB query failed", error: err });
        }
        res.status(200).json({});
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error });
  }
};
exports.checkSubscriptionInvestorReport = async (req, res) => {
  const responses = req.body;
  try {
    db.query(
      "SELECT * from userinvestorreporting_subscription where user_id=? And end_date >= CURRENT_DATE Order by id desc",
      [responses.user_id],
      (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB query failed", error: err });
        }
        res.status(200).json({ results: results });
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error });
  }
};

exports.CreateuserSubscriptionInvestorReporting = async (req, res) => {
  const { amount, user_id, clientSecret } = req.body;

  try {
    const userInsertQuery = `
        INSERT INTO userinvestorreporting_subscription 
        (start_date, end_date, price, user_id, clientSecret, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `;

    const startDate = new Date();

    // Add 3 months to start date
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 12);

    db.query(
      userInsertQuery,
      [startDate, endDate, amount, user_id, clientSecret, startDate],
      async (err, result) => {
        if (err) {
          console.error("DB Insert Error:", err);
          return res.status(500).json({ error: "Database error" });
        }

        res.status(200).json({
          message: "",
          status: 1,
        });
      }
    );
  } catch (err) {
    console.error("Stripe Error:", err);
    res.status(500).json({ error: err.message });
  }
};
exports.getcheckDataRoomPlusInvestorSubscription = async (req, res) => {
  const { user_id } = req.body;

  try {
    db.query(
      "SELECT MAX(end_date) AS active_until FROM ( SELECT end_date FROM usersubscriptiondataroomone_time WHERE user_id = ? UNION SELECT end_date FROM userinvestorreporting_subscription WHERE user_id = 1 ) AS all_dates WHERE end_date >= CURDATE();",
      [user_id],
      (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB query failed", error: err });
        }
        res.status(200).json({ results: results });
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error });
  }
};
{
  /***This api use for all user Data delete Related***/
}
exports.getAllActiveSubscriptions = async (req, res) => {
  try {
    db.query(
      `SELECT 
         user_id, 
         MAX(end_date) AS active_until 
       FROM (
         SELECT user_id, end_date FROM usersubscriptiondataroomone_time
         UNION 
         SELECT user_id, end_date FROM userinvestorreporting_subscription
       ) AS all_dates 
       GROUP BY user_id;`,
      async (err, results) => {
        if (err) {
          console.error("DB query failed:", err);
          return;
        }
        console.log(results);
        const today = new Date();
        for (let row of results) {
          const endDate = new Date(row.active_until);
          const diffDays = Math.floor(
            (today - endDate) / (1000 * 60 * 60 * 24)
          );
          const userId = row.user_id;
          console.log(diffDays, endDate);
          if (diffDays === 42) {
            console.log("Your data room will be deleted in 2 weeks");
            // sendReminder(userId, "Your data room will be deleted in 2 weeks.");
          } else if (diffDays === 49) {
            console.log("Your data room will be deleted in 1 week.");
            //sendReminder(userId, "Your data room will be deleted in 1 week.");
          } else if (diffDays >= 56) {
            console.log("Your data room will be deleted in 1 week.");
            // deleteUserFiles(userId); // Delete the actual data room files
          }
        }
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error });
  }
};
{
  /***This api use for all user Data delete Related***/
}

exports.checkapprovedorNot = async (req, res) => {
  const responses = req.body;
  try {
    db.query(
      "SELECT * from dataroomdocuments where user_id = ? And status = ?",
      [responses.user_id, "No"],
      (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "DB query failed", error: err });
        }
        res.status(200).json({ results: results });
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error });
  }
};
