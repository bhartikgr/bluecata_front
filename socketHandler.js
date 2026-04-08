// backend/socketHandler.js
module.exports = (io) => {
  io.on("connection", (socket) => {
    console.log("🟢 New client connected:", socket.id);

    // User comes online
    socket.on("user-online", (data) => {
      console.log("User online:", data);
      // Store socket id mapped to user if needed
      socket.userId = data.user_id;
      socket.userType = data.user_type;

      socket.broadcast.emit("user-status-change", {
        ...data,
        status: "online",
      });
    });

    // Join a conversation room
    socket.on("join-conversation", (conversation_id) => {
      socket.join(`conv_${conversation_id}`);
      console.log(
        `Socket ${socket.id} joined conversation: conv_${conversation_id}`,
      );
    });

    // Leave a conversation room
    socket.on("leave-conversation", (conversation_id) => {
      socket.leave(`conv_${conversation_id}`);
      console.log(
        `Socket ${socket.id} left conversation: conv_${conversation_id}`,
      );
    });

    // Typing indicators
    socket.on("typing-start", (data) => {
      socket.to(`conv_${data.conversation_id}`).emit("user-typing", {
        ...data,
        isTyping: true,
      });
    });

    socket.on("typing-end", (data) => {
      socket.to(`conv_${data.conversation_id}`).emit("user-typing", {
        ...data,
        isTyping: false,
      });
    });

    // Mark messages as read
    socket.on("mark-as-read", (data) => {
      socket.to(`conv_${data.conversation_id}`).emit("messages-read", data);
    });

    // ✅ KEY: This is called from your backend route AFTER saving message to DB
    // In your Express route (send-message), after INSERT, call:
    //   io.to(`conv_${conversation_id}`).emit("new-message", savedMessage)
    // See note below in the file.

    socket.on("disconnect", () => {
      console.log("🔴 Client disconnected:", socket.id);
    });
  });
};
