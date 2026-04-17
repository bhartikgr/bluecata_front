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

      // ✅ user-online pe hi personal social room join ho jaaye
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

    socket.on("join_social_room", (data) => {
      if (!data?.user_id) return;
      socket.join(`social_user_${data.user_id}`);
      console.log(`📰 Joined social room: social_user_${data.user_id}`);
      socket.emit("room_joined", { room: `social_user_${data.user_id}` });
    });

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
  // =========================================================================
  io.emitSocialPost = (visibleUserIds, newPost) => {
    console.log(
      `📢 emitSocialPost: author=${newPost.author_id}, visible:`,
      visibleUserIds,
    );
    visibleUserIds.forEach((uid) => {
      const room = `social_user_${uid}`;
      const roomSize = io.sockets.adapter.rooms.get(room)?.size || 0;
      console.log(`  → emit to ${room} (${roomSize} sockets)`);
      io.to(room).emit("social:new_post", newPost);
    });
  };

  // =========================================================================
  // NEW Helper — social:like_update
  // ✅ FIX: sirf post room nahi — saare visible users ke social_user rooms mein bhi emit
  // =========================================================================
  io.emitLikeUpdate = (
    post_id,
    likes_count,
    author_id,
    visibleUserIds = [],
  ) => {
    const payload = { post_id: parseInt(post_id), likes_count };

    // 1. Post room (users who opened comments)
    io.to(`social_post_${post_id}`).emit("social:like_update", payload);

    // 2. ✅ Author ke social_user room mein
    if (author_id) {
      io.to(`social_user_${author_id}`).emit("social:like_update", payload);
    }

    // 3. ✅ Saare visible users ke rooms mein
    visibleUserIds.forEach((uid) => {
      io.to(`social_user_${uid}`).emit("social:like_update", payload);
    });

    console.log(
      `👍 like_update post=${post_id}, likes=${likes_count}, broadcast to ${visibleUserIds.length} users`,
    );
  };

  // =========================================================================
  // NEW Helper — social:new_comment
  // ✅ FIX: saare visible users ke rooms mein bhi emit
  // =========================================================================
  io.emitNewComment = (post_id, comment, author_id, visibleUserIds = []) => {
    const payload = { post_id: parseInt(post_id), comment };

    // 1. Post room (users who opened comments)
    io.to(`social_post_${post_id}`).emit("social:new_comment", payload);

    // 2. ✅ Author ke social_user room mein
    if (author_id) {
      io.to(`social_user_${author_id}`).emit("social:new_comment", payload);
    }

    // 3. ✅ Saare visible users ke rooms mein
    visibleUserIds.forEach((uid) => {
      io.to(`social_user_${uid}`).emit("social:new_comment", payload);
    });

    console.log(
      `💬 new_comment post=${post_id}, broadcast to ${visibleUserIds.length} users`,
    );
  };

  // =========================================================================
  // NEW Helper — social:follow_update
  // =========================================================================
  io.emitFollowUpdate = (following_id, data) => {
    io.to(`social_user_${following_id}`).emit("social:follow_update", data);
    console.log(`👥 follow_update → social_user_${following_id}:`, data.action);
  };
};
