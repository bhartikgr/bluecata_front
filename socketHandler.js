// backend/socketHandler.js
const onlineUsers = new Map(); // "userId_userType" -> socket.id

module.exports = (io) => {
  io.on("connection", (socket) => {
    console.log("🟢 New client connected:", socket.id);

    // =========================================================================
    // EXISTING — Chat handlers
    // =========================================================================

    socket.on("user-online", (data) => {
      const key = `${data.user_id}_${data.user_type}`;
      onlineUsers.set(key, socket.id);
      socket.userId = data.user_id;
      socket.userType = data.user_type;
      socket.userKey = key;

      // ✅ NEW: user-online pe hi personal social room join ho jaaye
      socket.join(`social_user_${data.user_id}`);

      io.emit("user-status-change", { ...data, status: "online" });
      console.log(`✅ Online: ${key} → ${socket.id}`);
    });

    socket.on("join-conversation", (conversation_id) => {
      socket.join(`conv_${conversation_id}`);
    });

    socket.on("leave-conversation", (conversation_id) => {
      socket.leave(`conv_${conversation_id}`);
    });

    socket.on("check-online", (data) => {
      const key = `${data.user_id}_${data.user_type}`;
      socket.emit("online-status", {
        ...data,
        status: onlineUsers.has(key) ? "online" : "offline",
      });
    });

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

    socket.on("mark-as-read", (data) => {
      socket.to(`conv_${data.conversation_id}`).emit("messages-read", data);
    });

    // =========================================================================
    // NEW — Social Post handlers
    // =========================================================================

    // Manually join social room (agar user-online se pehle call karna ho)
    socket.on("join_social_room", (data) => {
      if (!data?.user_id) return;
      socket.join(`social_user_${data.user_id}`);
      console.log(`📰 Joined social room: social_user_${data.user_id}`);
    });

    // Join specific post room — for live like/comment updates
    socket.on("join_post_room", (data) => {
      if (!data?.post_id) return;
      socket.join(`social_post_${data.post_id}`);
      console.log(`💬 Joined post room: social_post_${data.post_id}`);
    });

    socket.on("leave_post_room", (data) => {
      if (!data?.post_id) return;
      socket.leave(`social_post_${data.post_id}`);
    });

    // =========================================================================
    // Disconnect
    // =========================================================================
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

  // =========================================================================
  // EXISTING Helper — emit new chat message
  // =========================================================================
  io.emitNewMessage = (
    conversation_id,
    receiver_id,
    receiver_type,
    savedMessage,
  ) => {
    io.to(`conv_${conversation_id}`).emit("new-message", savedMessage);

    const receiverKey = `${receiver_id}_${receiver_type}`;
    const receiverSocketId = onlineUsers.get(receiverKey);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("new-message", savedMessage);
      console.log(`📨 Direct emit to ${receiverKey} (${receiverSocketId})`);
    }
  };

  // =========================================================================
  // NEW Helper — social:new_post
  // Controller mein call karo: io.emitSocialPost(visibleUserIds, newPost)
  // =========================================================================
  io.emitSocialPost = (visibleUserIds, newPost) => {
    console.log(
      `📢 emitSocialPost: author=${newPost.author_id}, visible users:`,
      visibleUserIds,
    );
    visibleUserIds.forEach((uid) => {
      const room = `social_user_${uid}`;
      const roomSize = io.sockets.adapter.rooms.get(room)?.size || 0;
      console.log(`  → emit to ${room} (${roomSize} sockets)`);
      io.to(room).emit("social:new_post", newPost);
    });
    // Author ko bhi emit karo
    io.to(`social_user_${newPost.author_id}`).emit("social:new_post", newPost);
  };

  // =========================================================================
  // NEW Helper — social:like_update
  // Controller mein call karo: io.emitLikeUpdate(post_id, likes_count)
  // =========================================================================
  io.emitLikeUpdate = (post_id, likes_count) => {
    io.to(`social_post_${post_id}`).emit("social:like_update", {
      post_id: parseInt(post_id),
      likes_count,
    });
  };

  // =========================================================================
  // NEW Helper — social:new_comment
  // Controller mein call karo: io.emitNewComment(post_id, comment)
  // =========================================================================
  io.emitNewComment = (post_id, comment) => {
    io.to(`social_post_${post_id}`).emit("social:new_comment", {
      post_id: parseInt(post_id),
      comment,
    });
  };
};
