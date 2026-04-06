// controllers/user/chatmessageController.js
const db = require("../../db");

// Helper function to generate unique conversation ID
const generateConversationId = () => {
  return `conv_${Date.now()}_${Math.random().toString(36).substring(7)}`;
};

// Helper function to get user details
const getUserDetails = (userType, userId) => {
  return new Promise((resolve, reject) => {
    let table = "";
    let nameField = "";

    if (userType === "investor") {
      table = "investor_information";
      nameField = "CONCAT(first_name, ' ', last_name) as name";
    } else if (userType === "company") {
      table = "company";
      nameField = "company_name as name";
    } else {
      table = "admin";
      nameField = "name";
    }

    db.query(
      `SELECT id, ${nameField}, email FROM ${table} WHERE id = ?`,
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
    // Check if conversation exists
    const checkQuery = `
      SELECT * FROM chat_conversations 
      WHERE (participant1_type = ? AND participant1_id = ? AND participant2_type = ? AND participant2_id = ?)
      OR (participant1_type = ? AND participant1_id = ? AND participant2_type = ? AND participant2_id = ?)
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
        if (err) {
          return res
            .status(500)
            .json({ success: false, message: "Database error", error: err });
        }

        if (results.length > 0) {
          return res.json({
            success: true,
            conversation: results[0],
            isNew: false,
          });
        }

        // Create new conversation
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
            if (err) {
              return res.status(500).json({
                success: false,
                message: "Database error",
                error: err,
              });
            }

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
        if (err) {
          return res
            .status(500)
            .json({ success: false, message: "Database error", error: err });
        }

        // Get other user details for each conversation
        for (let conv of results) {
          const otherUser = await getUserDetails(
            conv.other_user_type,
            conv.other_user_id,
          );
          conv.other_user = otherUser;

          // Get last message
          const lastMsgQuery = `SELECT message, created_at, sender_type, sender_id FROM chat_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1`;

          await new Promise((resolve) => {
            db.query(
              lastMsgQuery,
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
    // Mark messages as read
    const updateReadQuery = `
      UPDATE chat_messages 
      SET is_read = 1 
      WHERE conversation_id = ? AND receiver_id = ? AND receiver_type = ? AND is_read = 0
    `;

    db.query(updateReadQuery, [conversation_id, user_id, user_type], (err) => {
      if (err) console.error("Error marking messages as read:", err);
    });

    // Get messages
    const getMessagesQuery = `
      SELECT m.*,
        CASE 
          WHEN m.sender_type = 'investor' THEN 
            (SELECT CONCAT(first_name, ' ', last_name) FROM investor_information WHERE id = m.sender_id)
          WHEN m.sender_type = 'company' THEN 
            (SELECT company_name FROM company WHERE id = m.sender_id)
          ELSE (SELECT name FROM admin WHERE id = m.sender_id)
        END as sender_name
      FROM chat_messages m
      WHERE m.conversation_id = ? AND m.is_deleted = 0
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `;

    db.query(
      getMessagesQuery,
      [conversation_id, parseInt(limit), parseInt(offset)],
      (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ success: false, message: "Database error", error: err });
        }

        // Update unread count in conversation
        const unreadField =
          user_type === "investor"
            ? "participant1_unread"
            : "participant2_unread";
        const updateUnreadQuery = `UPDATE chat_conversations SET ${unreadField} = 0 WHERE conversation_id = ?`;

        db.query(updateUnreadQuery, [conversation_id], () => {});

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
    // Insert message
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
        if (err) {
          return res
            .status(500)
            .json({ success: false, message: "Database error", error: err });
        }

        // Update conversation last message and time
        const updateConvQuery = `
        UPDATE chat_conversations 
        SET last_message = ?, last_message_time = NOW(), updated_at = NOW(),
        ${receiver_type === "investor" ? "participant2_unread = participant2_unread + 1" : "participant1_unread = participant1_unread + 1"}
        WHERE conversation_id = ?
      `;

        db.query(updateConvQuery, [message, conversation_id], (err) => {
          if (err) console.error("Error updating conversation:", err);
        });

        // Get the inserted message with sender name
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
          if (err) {
            return res.json({ success: true, messageId: result.insertId });
          }

          res.json({
            success: true,
            message: msgResults[0],
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
    const query = `UPDATE chat_messages SET is_deleted = 1 WHERE id = ?`;

    db.query(query, [message_id], (err, result) => {
      if (err) {
        return res
          .status(500)
          .json({ success: false, message: "Database error", error: err });
      }

      res.json({ success: true, message: "Message deleted successfully" });
    });
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

  if (!file) {
    return res
      .status(400)
      .json({ success: false, message: "No file uploaded" });
  }

  try {
    // Insert message with file
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
        if (err) {
          return res
            .status(500)
            .json({ success: false, message: "Database error", error: err });
        }

        // Update conversation
        const updateConvQuery = `
        UPDATE chat_conversations 
        SET last_message = '📎 File sent', last_message_time = NOW(), updated_at = NOW(),
        ${receiver_type === "investor" ? "participant2_unread = participant2_unread + 1" : "participant1_unread = participant1_unread + 1"}
        WHERE conversation_id = ?
      `;

        db.query(updateConvQuery, [conversation_id], () => {});

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
