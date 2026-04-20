// controllers/user/chatmessageController.js
const db = require("../../db");

const generateConversationId = () => {
  return `conv_${Date.now()}_${Math.random().toString(36).substring(7)}`;
};

const getUserDetails = (userType, userId) => {
  return new Promise((resolve, reject) => {
    let table = "";
    let nameField = "";
    let emailField = "";

    if (userType === "investor") {
      table = "investor_information";
      nameField = "CONCAT(first_name, ' ', last_name) as name";
      emailField = "email";
    } else if (userType === "company") {
      table = "company";
      nameField = "company_name as name";
      emailField = "company_email as email";
    } else {
      table = "admin";
      nameField = "name";
      emailField = "email";
    }

    db.query(
      `SELECT id, ${nameField}, ${emailField} FROM ${table} WHERE id = ?`,
      [userId],
      (err, results) => {
        if (err) reject(err);
        else resolve(results[0] || null);
      },
    );
  });
};

// ==================== GET OR CREATE CONVERSATION ====================
exports.getOrCreateConversation = async (req, res) => {
  const {
    participant1_type,
    participant1_id,
    participant2_type,
    participant2_id,
  } = req.body;
  try {
    const checkQuery = `
      SELECT * FROM chat_conversations 
      WHERE (participant1_type = ? AND participant1_id = ? AND participant2_type = ? AND participant2_id = ?)
      OR (participant1_type = ? AND participant1_id = ? AND participant2_type = ? AND participant2_id = ?)
      LIMIT 1
    `;

    db.query(
      checkQuery,
      [
        participant1_type,
        participant1_id,
        participant2_type,
        participant2_id,
        participant2_type,
        participant2_id,
        participant1_type,
        participant1_id,
      ],
      (err, results) => {
        if (err)
          return res
            .status(500)
            .json({ success: false, message: "Database error", error: err });

        if (results.length > 0) {
          return res.json({
            success: true,
            conversation: results[0],
            isNew: false,
          });
        }

        const conversation_id = generateConversationId();
        const insertQuery = `
          INSERT INTO chat_conversations 
          (conversation_id, participant1_type, participant1_id, participant2_type, participant2_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, NOW(), NOW())
        `;

        db.query(
          insertQuery,
          [
            conversation_id,
            participant1_type,
            participant1_id,
            participant2_type,
            participant2_id,
          ],
          (err, result) => {
            if (err)
              return res.status(500).json({
                success: false,
                message: "Database error",
                error: err,
              });

            res.json({
              success: true,
              conversation: {
                id: result.insertId,
                conversation_id,
                participant1_type,
                participant1_id,
                participant2_type,
                participant2_id,
              },
              isNew: true,
            });
          },
        );
      },
    );
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== GET USER CONVERSATIONS ====================
exports.getUserConversations = async (req, res) => {
  const { user_type, user_id } = req.body;
  try {
    // ✅ GROUP BY prevents duplicates when user appears as both participant1 and participant2
    const query = `
      SELECT c.*,
        CASE 
          WHEN c.participant1_type = ? AND c.participant1_id = ? THEN c.participant2_type
          ELSE c.participant1_type
        END as other_user_type,
        CASE 
          WHEN c.participant1_type = ? AND c.participant1_id = ? THEN c.participant2_id
          ELSE c.participant1_id
        END as other_user_id
      FROM chat_conversations c
      WHERE (c.participant1_type = ? AND c.participant1_id = ?)
         OR (c.participant2_type = ? AND c.participant2_id = ?)
      GROUP BY c.conversation_id
      ORDER BY c.updated_at DESC
    `;
    db.query(
      query,
      [
        user_type,
        user_id,
        user_type,
        user_id,
        user_type,
        user_id,
        user_type,
        user_id,
      ],
      async (err, results) => {
        if (err)
          return res
            .status(500)
            .json({ success: false, message: "Database error", error: err });

        for (let conv of results) {
          const otherUser = await getUserDetails(
            conv.other_user_type,
            conv.other_user_id,
          );
          conv.other_user = otherUser;

          await new Promise((resolve) => {
            db.query(
              `SELECT message, created_at FROM chat_messages WHERE conversation_id = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1`,
              [conv.conversation_id],
              (err, msgResults) => {
                if (msgResults && msgResults.length > 0) {
                  conv.last_message = msgResults[0].message;
                  conv.last_message_time = msgResults[0].created_at;
                }
                resolve();
              },
            );
          });
        }

        res.json({ success: true, conversations: results });
      },
    );
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== GET MESSAGES ====================
exports.getMessages = async (req, res) => {
  const {
    conversation_id,
    user_id,
    user_type,
    limit = 50,
    offset = 0,
  } = req.body;

  try {
    db.query(
      `UPDATE chat_messages SET is_read = 1 WHERE conversation_id = ? AND receiver_id = ? AND receiver_type = ? AND is_read = 0`,
      [conversation_id, user_id, user_type],
      (err) => {
        if (err) console.error("Error marking messages as read:", err);
      },
    );

    const getMessagesQuery = `
      SELECT m.*,
        CASE 
          WHEN m.sender_type = 'investor' THEN 
            (SELECT CONCAT(first_name, ' ', last_name) FROM investor_information WHERE id = m.sender_id)
          WHEN m.sender_type = 'company' THEN 
            (SELECT company_name FROM company WHERE id = m.sender_id)
          ELSE (SELECT name FROM admin WHERE id = m.sender_id)
        END as sender_name,
        0 as is_starred
      FROM chat_messages m
      WHERE m.conversation_id = ? AND m.is_deleted = 0
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `;

    db.query(
      getMessagesQuery,
      [conversation_id, parseInt(limit), parseInt(offset)],
      (err, results) => {
        if (err)
          return res
            .status(500)
            .json({ success: false, message: "Database error", error: err });

        // Reset unread count for the user who is reading
        // participant1 = first person, participant2 = second person
        // We reset whichever side belongs to the current reader
        const resetUnreadQuery = `
          UPDATE chat_conversations 
          SET participant1_unread = CASE WHEN participant1_type = ? AND participant1_id = ? THEN 0 ELSE participant1_unread END,
              participant2_unread = CASE WHEN participant2_type = ? AND participant2_id = ? THEN 0 ELSE participant2_unread END
          WHERE conversation_id = ?
        `;
        db.query(
          resetUnreadQuery,
          [user_type, user_id, user_type, user_id, conversation_id],
          () => {},
        );

        res.json({
          success: true,
          messages: results.reverse(),
          total: results.length,
        });
      },
    );
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== SEND MESSAGE ====================
exports.sendMessage = async (req, res) => {
  const {
    conversation_id,
    sender_type,
    sender_id,
    receiver_type,
    receiver_id,
    message,
  } = req.body;

  if (!message || message.trim() === "") {
    return res
      .status(400)
      .json({ success: false, message: "Message cannot be empty" });
  }

  try {
    const insertQuery = `
      INSERT INTO chat_messages 
      (conversation_id, sender_type, sender_id, receiver_type, receiver_id, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
    `;

    db.query(
      insertQuery,
      [
        conversation_id,
        sender_type,
        sender_id,
        receiver_type,
        receiver_id,
        message,
      ],
      (err, result) => {
        if (err)
          return res
            .status(500)
            .json({ success: false, message: "Database error", error: err });

        // Update conversation last message
        // ✅ Correctly increment unread for receiver
        // Check if receiver is participant1 or participant2 in this conversation
        const updateConvQuery = `
          UPDATE chat_conversations 
          SET last_message = ?, last_message_time = NOW(), updated_at = NOW(),
          participant1_unread = CASE 
            WHEN participant1_type = ? AND participant1_id = ? THEN participant1_unread + 1 
            ELSE participant1_unread 
          END,
          participant2_unread = CASE 
            WHEN participant2_type = ? AND participant2_id = ? THEN participant2_unread + 1 
            ELSE participant2_unread 
          END
          WHERE conversation_id = ?
        `;
        db.query(
          updateConvQuery,
          [
            message,
            receiver_type,
            receiver_id, // participant1 check
            receiver_type,
            receiver_id, // participant2 check
            conversation_id,
          ],
          (err) => {
            if (err) console.error("Error updating conversation:", err);
          },
        );

        // Fetch saved message with sender_name
        const getMsgQuery = `
          SELECT m.*,
            CASE 
              WHEN m.sender_type = 'investor' THEN 
                (SELECT CONCAT(first_name, ' ', last_name) FROM investor_information WHERE id = m.sender_id)
              WHEN m.sender_type = 'company' THEN 
                (SELECT company_name FROM company WHERE id = m.sender_id)
              ELSE (SELECT name FROM admin WHERE id = m.sender_id)
            END as sender_name
          FROM chat_messages m
          WHERE m.id = ?
        `;

        db.query(getMsgQuery, [result.insertId], (err, msgResults) => {
          if (err)
            return res.json({ success: true, messageId: result.insertId });

          const savedMessage = msgResults[0];

          const io = req.app.get("io");
          if (io) {
            // Emit to room + directly to receiver's socket (even if not in room)
            if (io.emitNewMessage) {
              io.emitNewMessage(
                conversation_id,
                receiver_id,
                receiver_type,
                savedMessage,
              );
            } else {
              io.to(`conv_${conversation_id}`).emit(
                "new-message",
                savedMessage,
              );
            }
          }

          res.json({
            success: true,
            message: savedMessage,
            messageId: result.insertId,
          });
        });
      },
    );
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== DELETE MESSAGE ====================
exports.deleteMessage = async (req, res) => {
  const { message_id, user_id, user_type } = req.body;

  try {
    db.query(
      `UPDATE chat_messages SET is_deleted = 1 WHERE id = ?`,
      [message_id],
      (err, result) => {
        if (err)
          return res
            .status(500)
            .json({ success: false, message: "Database error", error: err });
        res.json({ success: true, message: "Message deleted successfully" });
      },
    );
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== UPLOAD FILE ====================
exports.uploadFile = async (req, res) => {
  const {
    conversation_id,
    sender_type,
    sender_id,
    receiver_type,
    receiver_id,
  } = req.body;
  const file = req.file;

  if (!file)
    return res
      .status(400)
      .json({ success: false, message: "No file uploaded" });

  try {
    const insertQuery = `
      INSERT INTO chat_messages 
      (conversation_id, sender_type, sender_id, receiver_type, receiver_id, file_url, file_name, file_size, file_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    db.query(
      insertQuery,
      [
        conversation_id,
        sender_type,
        sender_id,
        receiver_type,
        receiver_id,
        file.path,
        file.originalname,
        file.size,
        file.mimetype,
      ],
      (err, result) => {
        if (err)
          return res
            .status(500)
            .json({ success: false, message: "Database error", error: err });

        const unreadField =
          receiver_type === "investor"
            ? "participant1_unread"
            : "participant2_unread";
        db.query(
          `UPDATE chat_conversations SET last_message = '📎 File sent', last_message_time = NOW(), updated_at = NOW(), ${unreadField} = ${unreadField} + 1 WHERE conversation_id = ?`,
          [conversation_id],
          () => {},
        );

        // ✅ Realtime emit for file too
        const io = req.app.get("io");
        if (io) {
          io.to(`conv_${conversation_id}`).emit("new-message", {
            id: result.insertId,
            conversation_id,
            sender_type,
            sender_id,
            receiver_type,
            receiver_id,
            file_url: file.path,
            file_name: file.originalname,
            file_size: file.size,
            file_type: file.mimetype,
            created_at: new Date(),
          });
        }

        res.json({
          success: true,
          messageId: result.insertId,
          file: { url: file.path, name: file.originalname, size: file.size },
        });
      },
    );
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.markMessageRead = async (req, res) => {
  const { message_id, user_id, user_type } = req.body;

  if (!message_id) return res.json({ success: false });

  try {
    db.query(
      `UPDATE chat_messages SET is_read = 1 WHERE id = ? AND receiver_id = ? AND receiver_type = ?`,
      [message_id, user_id, user_type],
      (err) => {
        if (err) return res.status(500).json({ success: false, error: err });

        // Reset unread count for this user in the conversation
        db.query(
          `SELECT conversation_id FROM chat_messages WHERE id = ?`,
          [message_id],
          (err2, rows) => {
            if (!err2 && rows?.length > 0) {
              db.query(
                `UPDATE chat_conversations 
                 SET participant1_unread = CASE WHEN participant1_type = ? AND participant1_id = ? THEN 0 ELSE participant1_unread END,
                     participant2_unread = CASE WHEN participant2_type = ? AND participant2_id = ? THEN 0 ELSE participant2_unread END
                 WHERE conversation_id = ?`,
                [
                  user_type,
                  user_id,
                  user_type,
                  user_id,
                  rows[0].conversation_id,
                ],
                () => {},
              );
            }
          },
        );
        res.json({ success: true });
      },
    );
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// =============================================================================
// STAR / UNSTAR MESSAGE
// POST /api/user/chatmessage/star
// ✅ Uses chat_message_stars table — per-user star
//    User A star kare → sirf User A ko dikhega
// =============================================================================
exports.starMessage = (req, res) => {
  const { message_id, conversation_id, starred_by_id, starred_by_type } =
    req.body;

  if (!message_id || !conversation_id || !starred_by_id || !starred_by_type) {
    return res
      .status(400)
      .json({ success: false, message: "All fields required" });
  }

  // Check already starred
  db.query(
    `SELECT id FROM chat_message_stars WHERE message_id = ? AND starred_by_id = ? AND starred_by_type = ?`,
    [message_id, starred_by_id, starred_by_type],
    (err, existing) => {
      if (err)
        return res.status(500).json({ success: false, message: err.message });

      if (existing && existing.length > 0) {
        // ── Unstar ──
        db.query(
          `DELETE FROM chat_message_stars WHERE message_id = ? AND starred_by_id = ? AND starred_by_type = ?`,
          [message_id, starred_by_id, starred_by_type],
          (err2) => {
            if (err2)
              return res
                .status(500)
                .json({ success: false, message: err2.message });
            return res
              .status(200)
              .json({ success: true, action: "unstarred", is_starred: false });
          },
        );
      } else {
        // ── Star ──
        db.query(
          `INSERT INTO chat_message_stars (message_id, conversation_id, starred_by_id, starred_by_type, created_at)
           VALUES (?, ?, ?, ?, NOW())`,
          [message_id, conversation_id, starred_by_id, starred_by_type],
          (err2) => {
            if (err2)
              return res
                .status(500)
                .json({ success: false, message: err2.message });
            return res
              .status(200)
              .json({ success: true, action: "starred", is_starred: true });
          },
        );
      }
    },
  );
};

// =============================================================================
// GET STARRED MESSAGES
// POST /api/user/chatmessage/starred
// Returns all starred messages for a user in a conversation
// =============================================================================
exports.getStarredMessages = (req, res) => {
  const { conversation_id, starred_by_id, starred_by_type } = req.body;

  if (!conversation_id || !starred_by_id || !starred_by_type) {
    return res
      .status(400)
      .json({ success: false, message: "All fields required" });
  }

  db.query(
    `SELECT m.*,
      cms.created_at as starred_at,
      CASE
        WHEN m.sender_type = 'investor' THEN
          (SELECT CONCAT(first_name, ' ', last_name) FROM investor_information WHERE id = m.sender_id)
        WHEN m.sender_type = 'company' THEN
          (SELECT company_name FROM company WHERE id = m.sender_id)
        ELSE (SELECT name FROM admin WHERE id = m.sender_id)
      END as sender_name,
      1 as is_starred
     FROM chat_message_stars cms
     INNER JOIN chat_messages m ON m.id = cms.message_id
     WHERE cms.conversation_id = ?
       AND cms.starred_by_id = ?
       AND cms.starred_by_type = ?
       AND m.is_deleted = 0
     ORDER BY m.created_at ASC`,
    [conversation_id, starred_by_id, starred_by_type],
    (err, results) => {
      if (err)
        return res.status(500).json({ success: false, message: err.message });
      return res.status(200).json({ success: true, messages: results });
    },
  );
};

// =============================================================================
// STAR / UNSTAR CONVERSATION
// POST /api/user/chatmessage/star-conversation
// ✅ Per-user star — sirf us user ko dikhega jisne star kiya
// =============================================================================
exports.starConversation = (req, res) => {
  const { conversation_id, starred_by_id, starred_by_type } = req.body;

  if (!conversation_id || !starred_by_id || !starred_by_type) {
    return res
      .status(400)
      .json({ success: false, message: "All fields required" });
  }

  db.query(
    `SELECT id FROM chat_conversation_stars WHERE conversation_id = ? AND starred_by_id = ? AND starred_by_type = ?`,
    [conversation_id, starred_by_id, starred_by_type],
    (err, existing) => {
      if (err)
        return res.status(500).json({ success: false, message: err.message });

      if (existing && existing.length > 0) {
        // Unstar
        db.query(
          `DELETE FROM chat_conversation_stars WHERE conversation_id = ? AND starred_by_id = ? AND starred_by_type = ?`,
          [conversation_id, starred_by_id, starred_by_type],
          (err2) => {
            if (err2)
              return res
                .status(500)
                .json({ success: false, message: err2.message });
            return res.status(200).json({ success: true, action: "unstarred" });
          },
        );
      } else {
        // Star
        db.query(
          `INSERT INTO chat_conversation_stars (conversation_id, starred_by_id, starred_by_type, created_at) VALUES (?, ?, ?, NOW())`,
          [conversation_id, starred_by_id, starred_by_type],
          (err2) => {
            if (err2)
              return res
                .status(500)
                .json({ success: false, message: err2.message });
            return res.status(200).json({ success: true, action: "starred" });
          },
        );
      }
    },
  );
};

// =============================================================================
// GET STARRED CONVERSATION IDs
// POST /api/user/chatmessage/starred-conversations
// =============================================================================
exports.getStarredConversations = (req, res) => {
  const { starred_by_id, starred_by_type } = req.body;

  if (!starred_by_id || !starred_by_type) {
    return res.status(400).json({
      success: false,
      message: "starred_by_id and starred_by_type required",
    });
  }

  db.query(
    `SELECT conversation_id FROM chat_conversation_stars WHERE starred_by_id = ? AND starred_by_type = ?`,
    [starred_by_id, starred_by_type],
    (err, results) => {
      if (err)
        return res.status(500).json({ success: false, message: err.message });
      return res.status(200).json({
        success: true,
        starred_ids: results.map((r) => r.conversation_id),
      });
    },
  );
};

//getInvestorCrmData
exports.getInvestorCrmData = (req, res) => {
  const { investor_id, company_id } = req.body;

  if (!investor_id || !company_id) {
    return res.status(400).json({
      success: false,
      message: "investor_id and company_id required",
    });
  }

  db.query(
    `SELECT cai.id as crm_id, cai.company_id, ii.id as investor_id, ii.email
     FROM investor_information ii
     LEFT JOIN company_add_investors cai
       ON cai.email = ii.email AND cai.company_id = ?
     WHERE ii.id = ?`,
    [company_id, investor_id],
    (err, results) => {
      if (err)
        return res.status(500).json({ success: false, message: err.message });

      // ✅ in_crm = true agar company_add_investors mein record hai (crm_id not null)
      const isInCrm = results.length > 0 && results[0].crm_id !== null;

      return res.status(200).json({
        success: true,
        in_crm: isInCrm,
      });
    },
  );
};
exports.addInvestorToCrm = (req, res) => {
  const { investor_id, company_id } = req.body;

  if (!investor_id || !company_id) {
    return res.status(400).json({
      success: false,
      message: "investor_id and company_id required",
    });
  }

  db.query(
    `SELECT cai.id as crm_id, cai.company_id, ii.id as investor_id, ii.email
     FROM investor_information ii
     LEFT JOIN company_add_investors cai
       ON cai.email = ii.email AND cai.company_id = ?
     WHERE ii.id = ?`,
    [company_id, investor_id],
    (err, results) => {
      if (err)
        return res.status(500).json({ success: false, message: err.message });

      // ✅ in_crm = true agar company_add_investors mein record hai (crm_id not null)
      const isInCrm = results.length > 0 && results[0].crm_id !== null;

      return res.status(200).json({
        success: true,
        in_crm: isInCrm,
      });
    },
  );
};
exports.addInvestorToCrm = (req, res) => {
  const { investor_id, company_id } = req.body;

  if (!investor_id || !company_id) {
    return res
      .status(400)
      .json({ success: false, message: "investor_id and company_id required" });
  }

  // Step 1: investor_information se details fetch karo
  db.query(
    `SELECT id, email, first_name, last_name FROM investor_information WHERE id = ?`,
    [investor_id],
    (err, invResults) => {
      if (err)
        return res.status(500).json({ success: false, message: err.message });
      if (!invResults || invResults.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Investor not found" });
      }

      const investor = invResults[0];

      // Step 2: Check already in CRM
      db.query(
        `SELECT id FROM company_add_investors WHERE email = ? AND company_id = ?`,
        [investor.email, company_id],
        (err2, existing) => {
          if (err2)
            return res
              .status(500)
              .json({ success: false, message: err2.message });

          if (existing && existing.length > 0) {
            // Already in CRM
            return res
              .status(200)
              .json({ success: true, in_crm: true, message: "Already in CRM" });
          }

          // Step 3: Insert into company_add_investors
          db.query(
            `INSERT INTO company_add_investors (company_id, email, first_name, last_name, created_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [
              company_id,
              investor.email,
              investor.first_name,
              investor.last_name,
            ],
            (err3) => {
              if (err3)
                return res
                  .status(500)
                  .json({ success: false, message: err3.message });
              return res.status(200).json({
                success: true,
                in_crm: true,
                message: "Investor added to CRM",
              });
            },
          );
        },
      );
    },
  );
};
exports.getInvestorData = async (req, res) => {
  const id = req.body.investor_id;

  db.query(
    `SELECT * from investor_information where id = ?`,
    [id],
    async (err, row) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      // Add company logo URL to each row if company_logo exists
      const resultsWithLogo = row.map((item) => {
        if (item.company_logo) {
          const pathname = `upload/docs/inv_${item.id}`;
          const fullPath = `https://capavate.com/api/${pathname}/${item.profile_picture}`;
          return { ...item, company_logo_url: fullPath };
        }
        return { ...item, company_logo_url: null };
      });

      res.status(200).json({
        message: "",
        results: resultsWithLogo,
      });
    },
  );
};
exports.getCompanyDetails = async (req, res) => {
  const id = req.body.company_id;

  db.query(`SELECT * from company where id = ?`, [id], async (err, row) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Database query error", error: err });
    }

    // Add company logo URL to each row if company_logo exists
    const resultsWithLogo = row.map((item) => {
      if (item.company_logo) {
        const pathname = `upload/docs/doc_${item.id}`;
        const fullPath = `https://capavate.com/api/${pathname}/company_profile/${item.company_logo}`;
        return { ...item, company_logo_url: fullPath };
      }
      return { ...item, company_logo_url: null };
    });

    res.status(200).json({
      message: "",
      results: resultsWithLogo,
    });
  });
};
