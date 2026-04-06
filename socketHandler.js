// socketHandler.js
const db = require("./db");

// backend/socketHandler.js
module.exports = (io) => {
  io.on("connection", (socket) => {
    console.log("🟢 New client connected:", socket.id);

    socket.on("user-online", (data) => {
      console.log("User online:", data);
      socket.broadcast.emit("user-status-change", {
        ...data,
        status: "online",
      });
    });

    socket.on("join-conversation", (conversation_id) => {
      socket.join(`conv_${conversation_id}`);
      console.log(
        `Socket ${socket.id} joined conversation: ${conversation_id}`,
      );
    });

    socket.on("leave-conversation", (conversation_id) => {
      socket.leave(`conv_${conversation_id}`);
    });

    socket.on("typing-start", (data) => {
      socket.to(`conv_${data.conversation_id}`).emit("user-typing", data);
    });

    socket.on("typing-end", (data) => {
      socket.to(`conv_${data.conversation_id}`).emit("user-typing", data);
    });

    socket.on("mark-as-read", (data) => {
      socket.to(`conv_${data.conversation_id}`).emit("messages-read", data);
    });

    socket.on("disconnect", () => {
      console.log("🔴 Client disconnected:", socket.id);
    });
  });
};
