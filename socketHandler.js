// backend/socketHandler.js
const onlineUsers = new Map(); // "userId_userType" -> socket.id

module.exports = (io) => {
  io.on("connection", (socket) => {
    console.log("🟢 New client connected:", socket.id);

    // User comes online — store their socket
    socket.on("user-online", (data) => {
      const key = `${data.user_id}_${data.user_type}`;
      onlineUsers.set(key, socket.id);
      socket.userId = data.user_id;
      socket.userType = data.user_type;
      socket.userKey = key;

      // Broadcast online status
      io.emit("user-status-change", { ...data, status: "online" });
      console.log(`✅ Online: ${key} → ${socket.id}`);
    });

    // Join conversation room
    socket.on("join-conversation", (conversation_id) => {
      socket.join(`conv_${conversation_id}`);
    });

    // Leave conversation room
    socket.on("leave-conversation", (conversation_id) => {
      socket.leave(`conv_${conversation_id}`);
    });

    // Check if user is online
    socket.on("check-online", (data) => {
      const key = `${data.user_id}_${data.user_type}`;
      socket.emit("online-status", {
        ...data,
        status: onlineUsers.has(key) ? "online" : "offline",
      });
    });

    // Typing
    socket.on("typing-start", (data) => {
      socket
        .to(`conv_${data.conversation_id}`)
        .emit("user-typing", { ...data, isTyping: true });
    });

    socket.on("typing-end", (data) => {
      socket
        .to(`conv_${data.conversation_id}`)
        .emit("user-typing", { ...data, isTyping: false });
    });

    // Mark as read
    socket.on("mark-as-read", (data) => {
      socket.to(`conv_${data.conversation_id}`).emit("messages-read", data);
    });

    // Disconnect
    socket.on("disconnect", () => {
      if (socket.userKey) {
        onlineUsers.delete(socket.userKey);
        io.emit("user-status-change", {
          user_id: socket.userId,
          user_type: socket.userType,
          status: "offline",
        });
        console.log(`🔴 Offline: ${socket.userKey}`);
      }
    });
  });

  // ✅ Helper: emit new-message to conversation room AND directly to receiver
  // Call this from controller: emitNewMessage(io, conversation_id, receiver_id, receiver_type, savedMessage)
  io.emitNewMessage = (
    conversation_id,
    receiver_id,
    receiver_type,
    savedMessage,
  ) => {
    // 1. Emit to conversation room (both users who joined)
    io.to(`conv_${conversation_id}`).emit("new-message", savedMessage);

    // 2. Also emit directly to receiver socket (even if not in room)
    const receiverKey = `${receiver_id}_${receiver_type}`;
    const receiverSocketId = onlineUsers.get(receiverKey);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("new-message", savedMessage);
      console.log(`📨 Direct emit to ${receiverKey} (${receiverSocketId})`);
    }
  };
};
