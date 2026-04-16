const bcrypt = require("bcryptjs");
const multer = require("multer");
const crypto = require("crypto");
const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const { format } = require("date-fns");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

require("dotenv").config();
const JWT_SECRET = process.env.JWT_SECRET;
const logoBase64 = process.env.LOGO_BASE64;

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ─── Multer Storage ───────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(
      __dirname,
      "..",
      "..",
      "upload",
      "docs",
      "social_post",
    );
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `post_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
  ];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error("Only image files are allowed"), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
});

exports.uploadMiddleware = upload.array("images", 10);

// ─── Helper: get user name + image ───────────────────────────────────────────
const getUserDetails = (userId, userType) => {
  return new Promise((resolve) => {
    if (userType === "company") {
      db.query(
        `SELECT id, company_name as name, company_logo as image FROM company WHERE id = ?`,
        [userId],
        (err, results) => {
          if (err || !results || results.length === 0)
            resolve({ id: userId, name: "Unknown", image: null });
          else {
            const row = results[0];
            const imageUrl = row.image
              ? `https://capavate.com/api/upload/docs/doc_${userId}/company_profile/${row.image}`
              : null;
            resolve({
              id: userId,
              name: row.name || "Company",
              image: imageUrl,
            });
          }
        },
      );
    } else {
      db.query(
        `SELECT id,
                TRIM(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))) as name,
                profile_picture as image
         FROM investor_information WHERE id = ?`,
        [userId],
        (err, results) => {
          if (err || !results || results.length === 0)
            resolve({ id: userId, name: "Investor", image: null });
          else {
            const row = results[0];
            const imageUrl = row.image
              ? `https://capavate.com/api/upload/investor/inv_${userId}/${row.image}`
              : null;
            resolve({
              id: userId,
              name: row.name || "Investor",
              image: imageUrl,
            });
          }
        },
      );
    }
  });
};

// ─── Helper: get visible user ids for socket emit ────────────────────────────
const getVisibleUserIds = async (author_id, author_type) => {
  return new Promise((resolve, reject) => {
    let query = "";
    let params = [];

    if (author_type === "company") {
      query = `
        SELECT DISTINCT srr.investor_id as user_id
        FROM sharerecordround srr
        WHERE srr.company_id = ?
          AND srr.investor_id IS NOT NULL
          AND srr.investor_id != 0
      `;
      params = [author_id];

      console.log(`🔍 Getting visible users for company ${author_id}`);

      db.query(query, params, (err, results) => {
        if (err) {
          console.error("Error in getVisibleUserIds:", err);
          reject(err);
          return;
        }
        if (!results || !Array.isArray(results)) {
          resolve([]);
          return;
        }
        const userIds = results
          .map((r) => r.user_id)
          .filter((id) => id !== null && id !== 0);
        console.log(
          `✅ Company ${author_id} post visible to investors:`,
          userIds,
        );
        resolve([...new Set(userIds)]);
      });
    } else if (author_type === "investor") {
      query = `
        SELECT DISTINCT user_id FROM (
          SELECT DISTINCT srr.company_id as user_id
          FROM sharerecordround srr
          WHERE srr.investor_id = ?
          UNION
          SELECT DISTINCT srr2.investor_id as user_id
          FROM sharerecordround srr1
          INNER JOIN sharerecordround srr2 ON srr1.company_id = srr2.company_id
          WHERE srr1.investor_id = ? AND srr2.investor_id != ?
          UNION
          SELECT DISTINCT w.author_id as user_id
          FROM waitlist w
          WHERE w.type = 'Investor' AND w.author_id != ?
        ) AS users
      `;
      params = [author_id, author_id, author_id, author_id];

      console.log(`🔍 Getting visible users for investor ${author_id}`);

      db.query(query, params, (err, results) => {
        if (err) {
          console.error("Error in getVisibleUserIds:", err);
          reject(err);
          return;
        }
        if (!results || !Array.isArray(results)) {
          resolve([]);
          return;
        }
        const userIds = results
          .map((r) => r.user_id)
          .filter((id) => id !== null && id !== 0);
        console.log(`✅ Investor ${author_id} post visible to:`, userIds);
        resolve([...new Set(userIds)]);
      });
    } else {
      resolve([]);
    }
  });
};

// =============================================================================
// CREATE POST
// =============================================================================
exports.createPost = async (req, res) => {
  try {
    const { content, post_type, author_id, author_type, visibility } = req.body;

    if (!author_id || !author_type) {
      return res.status(400).json({
        success: false,
        message: "author_id and author_type are required",
      });
    }

    const imageUrls = (req.files || []).map(
      (f) => `/upload/docs/social_post/${f.filename}`,
    );
    const imageUrlsJson = JSON.stringify(imageUrls);

    db.query(
      `INSERT INTO social_posts 
        (author_id, author_type, content, image_urls, visibility, likes_count, comments_count, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, NOW(), NOW())`,
      [
        author_id,
        author_type,
        content || "",
        imageUrlsJson,
        visibility || "network",
      ],
      async (err, result) => {
        if (err) {
          return res
            .status(500)
            .json({ success: false, message: "Database error", error: err });
        }

        const postId = result.insertId;
        const authorDetails = await getUserDetails(author_id, author_type);

        const base = process.env.API_BASE_URL || "https://capavate.com/api";
        const imagesWithBase = imageUrls.map((img) =>
          img && !img.startsWith("http") ? `${base}${img}` : img,
        );

        const newPost = {
          id: postId,
          author_id: parseInt(author_id),
          author_type,
          author_name: authorDetails.name,
          author_image: authorDetails.image,
          content: content || "",
          image_urls: imageUrlsJson,
          images: imagesWithBase, // ✅ full URL with /api prefix
          visibility: visibility || "network",
          likes_count: 0,
          comments_count: 0,
          liked: false,
          followed: false,
          sender_category: "own",
          created_at: new Date().toISOString(),
        };

        const io = req.app.get("io");
        if (io) {
          const visibleUserIds = await getVisibleUserIds(
            author_id,
            author_type,
          );
          io.emitSocialPost(visibleUserIds, newPost);
        }

        return res.status(200).json({
          success: true,
          message: "Post created successfully",
          post: newPost,
        });
      },
    );
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// =============================================================================
// GET POSTS (with visibility filter + sender_category)
// =============================================================================
exports.getPosts = (req, res) => {
  const { user_id, user_type, page = 1 } = req.body;
  const limit = 10;
  const offset = (parseInt(page) - 1) * limit;

  if (!user_id || !user_type) {
    return res
      .status(400)
      .json({ success: false, message: "user_id and user_type are required" });
  }

  let query = "";
  let queryParams = [];

  if (user_type === "investor") {
    query = `
      SELECT DISTINCT sp.*,
        CASE WHEN spl.id IS NOT NULL THEN 1 ELSE 0 END as is_liked,
        CASE
          WHEN sp.author_type = 'company' THEN c.company_name
          ELSE TRIM(CONCAT(COALESCE(ii.first_name,''), ' ', COALESCE(ii.last_name,'')))
        END as author_name,
        CASE
          WHEN sp.author_type = 'company' THEN c.company_logo
          ELSE ii.profile_picture
        END as author_raw_image,
        COALESCE(sp.likes_count, 0) as likes_count,
        COALESCE(sp.comments_count, 0) as comments_count,

        -- ✅ Is following
        CASE WHEN sf.id IS NOT NULL THEN 1 ELSE 0 END as is_following,

        -- ✅ Sender Category
        CASE
          WHEN sp.author_id = ? AND sp.author_type = 'investor' THEN 'own'

          WHEN sp.author_type = 'company'
            AND sp.author_id IN (
              SELECT DISTINCT company_id FROM sharerecordround WHERE investor_id = ?
            ) THEN 'portfolio_company'

          WHEN sp.author_type = 'investor'
            AND sp.author_id IN (
              SELECT DISTINCT srr2.investor_id
              FROM sharerecordround srr1
              JOIN sharerecordround srr2 ON srr1.company_id = srr2.company_id
              WHERE srr1.investor_id = ? AND srr2.investor_id != srr1.investor_id
            ) THEN 'fellow_shareholder'

          WHEN sp.author_type = 'investor'
            AND sp.author_id IN (
              SELECT DISTINCT w2.author_id FROM waitlist w1
              JOIN waitlist w2 ON w1.type = w2.type
              WHERE w1.type = 'Investor' AND w1.author_id = ? AND w2.author_id != w1.author_id
            ) THEN 'angel_network'

          ELSE 'network'
        END as sender_category,

        -- ✅ Region from waitlist (for angel_network badge)
        (SELECT w.city FROM waitlist w
          WHERE w.author_id = sp.author_id AND w.type = 'Investor' LIMIT 1
        ) as author_region,

        -- ✅ Shared company name (for fellow_shareholder badge)
        (
          SELECT c2.company_name
          FROM sharerecordround srr1
          JOIN sharerecordround srr2 ON srr1.company_id = srr2.company_id
          JOIN company c2 ON c2.id = srr1.company_id
          WHERE srr1.investor_id = ? AND srr2.investor_id = sp.author_id
          LIMIT 1
        ) as shared_company_name

      FROM social_posts sp
      LEFT JOIN social_post_likes spl
        ON spl.post_id = sp.id AND spl.user_id = ? AND spl.user_type = ?
      LEFT JOIN company c ON sp.author_type = 'company' AND c.id = sp.author_id
      LEFT JOIN investor_information ii ON sp.author_type = 'investor' AND ii.id = sp.author_id
      LEFT JOIN follows sf ON sf.follower_id = ? AND sf.follower_type = ?
        AND sf.following_id = sp.author_id AND sf.following_type = sp.author_type
      WHERE sp.is_deleted = 0
        AND (
          (sp.author_id = ? AND sp.author_type = ?)

          OR (
            sp.author_type = 'company'
            AND sp.author_id IN (
              SELECT DISTINCT company_id FROM sharerecordround WHERE investor_id = ?
            )
          )

          OR (
            sp.author_type = 'investor'
            AND sp.author_id IN (
              SELECT DISTINCT srr2.investor_id
              FROM sharerecordround srr1
              INNER JOIN sharerecordround srr2 ON srr1.company_id = srr2.company_id
              WHERE srr1.investor_id = ? AND srr2.investor_id != srr1.investor_id
            )
          )

          OR (
            sp.author_type = 'investor'
            AND sp.author_id IN (
              SELECT DISTINCT w2.author_id FROM waitlist w1
              INNER JOIN waitlist w2 ON w1.type = w2.type
              WHERE w1.type = 'Investor' AND w1.author_id = ? AND w2.author_id != w1.author_id
            )
          )
        )
      ORDER BY sp.created_at DESC
      LIMIT ? OFFSET ?
    `;

    queryParams = [
      user_id,
      user_id,
      user_id,
      user_id,
      user_id, // sender_category (5)
      user_id,
      user_type, // likes check
      user_id,
      user_type, // is_following join
      user_id,
      user_type, // own posts
      user_id,
      user_id,
      user_id, // visibility (3)
      limit,
      offset,
    ];
  } else if (user_type === "company") {
    query = `
      SELECT DISTINCT sp.*,
        CASE WHEN spl.id IS NOT NULL THEN 1 ELSE 0 END as is_liked,
        CASE
          WHEN sp.author_type = 'company' THEN c.company_name
          ELSE TRIM(CONCAT(COALESCE(ii.first_name,''), ' ', COALESCE(ii.last_name,'')))
        END as author_name,
        CASE
          WHEN sp.author_type = 'company' THEN c.company_logo
          ELSE ii.profile_picture
        END as author_raw_image,
        COALESCE(sp.likes_count, 0) as likes_count,
        COALESCE(sp.comments_count, 0) as comments_count,

        -- ✅ Is following
        CASE WHEN sf.id IS NOT NULL THEN 1 ELSE 0 END as is_following,

        -- ✅ Sender Category
        CASE
          WHEN sp.author_id = ? AND sp.author_type = 'company' THEN 'own'

          WHEN sp.author_type = 'investor'
            AND sp.author_id IN (
              SELECT DISTINCT investor_id FROM sharerecordround
              WHERE company_id = ? AND investor_id IS NOT NULL
            ) THEN 'fellow_shareholder'

          WHEN sp.author_type = 'investor'
            AND EXISTS (
              SELECT 1 FROM waitlist w WHERE w.type = 'Investor' AND w.author_id = sp.author_id
              AND EXISTS (
                SELECT 1 FROM waitlist wc WHERE wc.type = 'Company' AND wc.company_id = ?
              )
            ) THEN 'angel_network'

          ELSE 'network'
        END as sender_category,

        -- ✅ Region from waitlist (for angel_network badge)
        (SELECT w.city FROM waitlist w
          WHERE w.author_id = sp.author_id AND w.type = 'Investor' LIMIT 1
        ) as author_region,

        NULL as shared_company_name

      FROM social_posts sp
      LEFT JOIN social_post_likes spl
        ON spl.post_id = sp.id AND spl.user_id = ? AND spl.user_type = ?
      LEFT JOIN company c ON sp.author_type = 'company' AND c.id = sp.author_id
      LEFT JOIN investor_information ii ON sp.author_type = 'investor' AND ii.id = sp.author_id
      LEFT JOIN follows sf ON sf.follower_id = ? AND sf.follower_type = ?
        AND sf.following_id = sp.author_id AND sf.following_type = sp.author_type
      WHERE sp.is_deleted = 0
        AND (
          (sp.author_id = ? AND sp.author_type = ?)

          OR (
            sp.author_type = 'investor'
            AND sp.author_id IN (
              SELECT DISTINCT investor_id FROM sharerecordround
              WHERE company_id = ? AND investor_id IS NOT NULL AND investor_id != 0
            )
          )

          OR (
            sp.author_type = 'investor'
            AND EXISTS (
              SELECT 1 FROM waitlist w WHERE w.type = 'Investor' AND w.author_id = sp.author_id
              AND EXISTS (
                SELECT 1 FROM waitlist w_company
                WHERE w_company.type = 'Company' AND w_company.company_id = ?
              )
            )
          )
        )
      ORDER BY sp.created_at DESC
      LIMIT ? OFFSET ?
    `;

    queryParams = [
      user_id,
      user_id,
      user_id, // sender_category (3)
      user_id,
      user_type, // likes check
      user_id,
      user_type, // is_following join
      user_id,
      user_type, // own posts
      user_id,
      user_id, // visibility (2)
      limit,
      offset,
    ];
  } else {
    return res.status(400).json({
      success: false,
      message: "Invalid user_type. Must be 'company' or 'investor'",
    });
  }

  db.query(query, queryParams, (err, posts) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: err.message,
      });
    }

    const enriched = posts.map((p) => {
      let authorImage = null;
      if (p.author_raw_image) {
        if (p.author_type === "company") {
          authorImage = `https://capavate.com/api/upload/docs/doc_${p.author_id}/company_profile/${p.author_raw_image}`;
        } else {
          authorImage = `https://capavate.com/api/upload/investor/inv_${p.author_id}/${p.author_raw_image}`;
        }
      }

      return {
        ...p,
        author_name:
          (p.author_name || "").trim() ||
          (p.author_type === "company" ? "Company" : "Investor"),
        author_image: authorImage,
        images: p.image_urls
          ? (() => {
              try {
                const parsed =
                  typeof p.image_urls === "string"
                    ? JSON.parse(p.image_urls)
                    : p.image_urls;
                const base = "https://capavate.com/api";
                return Array.isArray(parsed)
                  ? parsed.map((img) =>
                      img && !img.startsWith("http") ? `${base}${img}` : img,
                    )
                  : [];
              } catch {
                return [];
              }
            })()
          : [],
        liked: p.is_liked === 1,
        followed: p.is_following === 1, // ✅ real follow status from DB
        likes: parseInt(p.likes_count) || 0,
        comments: parseInt(p.comments_count) || 0,
        // ✅ Sender info for frontend badge
        sender_category: p.sender_category || "network",
        author_region: p.author_region || null,
        shared_company_name: p.shared_company_name || null,
      };
    });

    return res.status(200).json({
      success: true,
      posts: enriched,
      pagination: {
        current_page: parseInt(page),
        limit: limit,
        has_more: enriched.length === limit,
      },
    });
  });
};

// =============================================================================
// LIKE / UNLIKE POST
// =============================================================================
exports.likePost = (req, res) => {
  const { post_id, user_id, user_type } = req.body;

  if (!post_id || !user_id || !user_type) {
    return res.status(400).json({
      success: false,
      message: "post_id, user_id, user_type are required",
    });
  }

  db.query(
    `SELECT id FROM social_post_likes WHERE post_id = ? AND user_id = ? AND user_type = ?`,
    [post_id, user_id, user_type],
    (err, existing) => {
      if (err)
        return res
          .status(500)
          .json({ success: false, message: "Database error", error: err });

      if (existing && existing.length > 0) {
        // ── Unlike ──
        db.query(
          `DELETE FROM social_post_likes WHERE post_id = ? AND user_id = ? AND user_type = ?`,
          [post_id, user_id, user_type],
          (err2) => {
            if (err2)
              return res
                .status(500)
                .json({ success: false, message: err2.message });
            db.query(
              `UPDATE social_posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = ?`,
              [post_id],
              (err3) => {
                if (err3)
                  return res
                    .status(500)
                    .json({ success: false, message: err3.message });
                db.query(
                  `SELECT likes_count FROM social_posts WHERE id = ?`,
                  [post_id],
                  (err4, updated) => {
                    if (err4)
                      return res
                        .status(500)
                        .json({ success: false, message: err4.message });
                    const likesCount = updated[0]?.likes_count || 0;
                    const io = req.app.get("io");
                    if (io) io.emitLikeUpdate(post_id, likesCount);
                    return res.status(200).json({
                      success: true,
                      action: "unliked",
                      likes_count: likesCount,
                    });
                  },
                );
              },
            );
          },
        );
      } else {
        // ── Like ──
        db.query(
          `INSERT INTO social_post_likes (post_id, user_id, user_type, created_at) VALUES (?, ?, ?, NOW())`,
          [post_id, user_id, user_type],
          (err2) => {
            if (err2)
              return res
                .status(500)
                .json({ success: false, message: err2.message });
            db.query(
              `UPDATE social_posts SET likes_count = likes_count + 1 WHERE id = ?`,
              [post_id],
              (err3) => {
                if (err3)
                  return res
                    .status(500)
                    .json({ success: false, message: err3.message });
                db.query(
                  `SELECT likes_count FROM social_posts WHERE id = ?`,
                  [post_id],
                  (err4, updated) => {
                    if (err4)
                      return res
                        .status(500)
                        .json({ success: false, message: err4.message });
                    const likesCount = updated[0]?.likes_count || 0;
                    const io = req.app.get("io");
                    if (io) io.emitLikeUpdate(post_id, likesCount);
                    return res.status(200).json({
                      success: true,
                      action: "liked",
                      likes_count: likesCount,
                    });
                  },
                );
              },
            );
          },
        );
      }
    },
  );
};

// =============================================================================
// ADD COMMENT
// =============================================================================
exports.addComment = (req, res) => {
  const { post_id, comment, author_id, author_type, parent_comment_id } =
    req.body;

  if (!post_id || !comment?.trim() || !author_id || !author_type) {
    return res.status(400).json({
      success: false,
      message: "post_id, comment, author_id, author_type are required",
    });
  }

  db.query(
    `INSERT INTO social_post_comments 
      (post_id, author_id, author_type, comment, parent_comment_id, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, NOW(), NOW())`,
    [
      post_id,
      author_id,
      author_type,
      comment.trim(),
      parent_comment_id || null,
    ],
    async (err, result) => {
      if (err)
        return res
          .status(500)
          .json({ success: false, message: "Database error", error: err });

      db.query(
        `UPDATE social_posts SET comments_count = comments_count + 1 WHERE id = ?`,
        [post_id],
      );

      const authorDetails = await getUserDetails(author_id, author_type);

      const newComment = {
        id: result.insertId,
        post_id: parseInt(post_id),
        author_id: parseInt(author_id),
        author_type,
        author: authorDetails.name,
        author_image: authorDetails.image,
        text: comment.trim(),
        parent_comment_id: parent_comment_id || null,
        created_at: new Date().toISOString(),
      };

      const io = req.app.get("io");
      if (io) io.emitNewComment(post_id, newComment);

      return res.status(200).json({
        success: true,
        message: "Comment added successfully",
        comment: newComment,
      });
    },
  );
};

// =============================================================================
// GET COMMENTS
// =============================================================================
exports.getComments = (req, res) => {
  const { post_id } = req.body;

  if (!post_id) {
    return res
      .status(400)
      .json({ success: false, message: "post_id is required" });
  }

  db.query(
    `SELECT spc.*,
      CASE
        WHEN spc.author_type = 'company' THEN c.company_name
        ELSE TRIM(CONCAT(COALESCE(ii.first_name,''), ' ', COALESCE(ii.last_name,'')))
      END as author_name,
      CASE
        WHEN spc.author_type = 'company' THEN c.company_logo
        ELSE ii.profile_picture
      END as author_raw_image
     FROM social_post_comments spc
     LEFT JOIN company c ON spc.author_type = 'company' AND c.id = spc.author_id
     LEFT JOIN investor_information ii ON spc.author_type = 'investor' AND ii.id = spc.author_id
     WHERE spc.post_id = ? AND spc.is_deleted = 0
     ORDER BY spc.created_at ASC`,
    [post_id],
    (err, results) => {
      if (err)
        return res
          .status(500)
          .json({ success: false, message: "Database error", error: err });

      const comments = results.map((c) => {
        let authorImage = null;
        if (c.author_raw_image) {
          if (c.author_type === "company") {
            authorImage = `https://capavate.com/api/upload/docs/doc_${c.author_id}/company_profile/${c.author_raw_image}`;
          } else {
            authorImage = `https://capavate.com/api/upload/investor/inv_${c.author_id}/${c.author_raw_image}`;
          }
        }
        return {
          ...c,
          author:
            (c.author_name || "").trim() ||
            (c.author_type === "company" ? "Company" : "Investor"),
          author_image: authorImage,
        };
      });

      return res.status(200).json({ success: true, comments });
    },
  );
};

// =============================================================================
// GET SINGLE POST BY ID
// GET /api/user/socialpost/post/:id
// =============================================================================
exports.getPostById = (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res
      .status(400)
      .json({ success: false, message: "post id is required" });
  }

  db.query(
    `SELECT sp.*,
      CASE
        WHEN sp.author_type = 'company' THEN c.company_name
        ELSE TRIM(CONCAT(COALESCE(ii.first_name,''), ' ', COALESCE(ii.last_name,'')))
      END as author_name,
      CASE
        WHEN sp.author_type = 'company' THEN c.company_logo
        ELSE ii.profile_picture
      END as author_raw_image
     FROM social_posts sp
     LEFT JOIN company c ON sp.author_type = 'company' AND c.id = sp.author_id
     LEFT JOIN investor_information ii ON sp.author_type = 'investor' AND ii.id = sp.author_id
     WHERE sp.id = ? AND sp.is_deleted = 0`,
    [id],
    (err, results) => {
      if (err)
        return res
          .status(500)
          .json({ success: false, message: "Database error", error: err });
      if (!results || results.length === 0)
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });

      const p = results[0];
      let authorImage = null;
      if (p.author_raw_image) {
        if (p.author_type === "company") {
          authorImage = `https://capavate.com/api/upload/docs/doc_${p.author_id}/company_profile/${p.author_raw_image}`;
        } else {
          authorImage = `https://capavate.com/api/upload/investor/inv_${p.author_id}/${p.author_raw_image}`;
        }
      }

      const post = {
        ...p,
        author_name:
          (p.author_name || "").trim() ||
          (p.author_type === "company" ? "Company" : "Investor"),
        author_image: authorImage,
        images: p.image_urls
          ? (() => {
              try {
                return typeof p.image_urls === "string"
                  ? JSON.parse(p.image_urls)
                  : p.image_urls;
              } catch {
                return [];
              }
            })()
          : [],
        likes: p.likes_count || 0,
        comments: p.comments_count || 0,
      };

      return res.status(200).json({ success: true, post });
    },
  );
};

// =============================================================================
// FOLLOW / UNFOLLOW
// POST /api/user/socialpost/follow
// =============================================================================
exports.followUser = (req, res) => {
  const { follower_id, follower_type, following_id, following_type } = req.body;

  if (!follower_id || !follower_type || !following_id || !following_type) {
    return res
      .status(400)
      .json({ success: false, message: "All fields required" });
  }

  if (
    String(follower_id) === String(following_id) &&
    follower_type === following_type
  ) {
    return res
      .status(400)
      .json({ success: false, message: "Cannot follow yourself" });
  }

  // Check if already following
  db.query(
    `SELECT id FROM follows
     WHERE follower_id = ? AND follower_type = ?
       AND following_id = ? AND following_type = ?`,
    [follower_id, follower_type, following_id, following_type],
    (err, existing) => {
      if (err)
        return res.status(500).json({ success: false, message: err.message });

      if (existing && existing.length > 0) {
        // ── Unfollow ──
        db.query(
          `DELETE FROM follows
           WHERE follower_id = ? AND follower_type = ?
             AND following_id = ? AND following_type = ?`,
          [follower_id, follower_type, following_id, following_type],
          (err2) => {
            if (err2)
              return res
                .status(500)
                .json({ success: false, message: err2.message });
            const io = req.app.get("io");
            if (io) {
              io.to(`social_user_${following_id}`).emit(
                "social:follow_update",
                {
                  follower_id: parseInt(follower_id),
                  follower_type,
                  following_id: parseInt(following_id),
                  following_type,
                  action: "unfollowed",
                },
              );
            }
            return res
              .status(200)
              .json({ success: true, action: "unfollowed" });
          },
        );
      } else {
        // ── Follow ──
        db.query(
          `INSERT INTO follows (follower_id, follower_type, following_id, following_type)
           VALUES (?, ?, ?, ?)`,
          [follower_id, follower_type, following_id, following_type],
          (err2) => {
            if (err2)
              return res
                .status(500)
                .json({ success: false, message: err2.message });
            const io = req.app.get("io");
            if (io) {
              io.to(`social_user_${following_id}`).emit(
                "social:follow_update",
                {
                  follower_id: parseInt(follower_id),
                  follower_type,
                  following_id: parseInt(following_id),
                  following_type,
                  action: "followed",
                },
              );
            }
            return res.status(200).json({ success: true, action: "followed" });
          },
        );
      }
    },
  );
};

// =============================================================================
// CHECK FOLLOW STATUS
// POST /api/user/socialpost/follow/status
// =============================================================================
exports.checkFollowStatus = (req, res) => {
  const { follower_id, follower_type, following_id, following_type } = req.body;

  db.query(
    `SELECT id FROM follows
     WHERE follower_id = ? AND follower_type = ?
       AND following_id = ? AND following_type = ?`,
    [follower_id, follower_type, following_id, following_type],
    (err, results) => {
      if (err)
        return res.status(500).json({ success: false, message: err.message });
      return res.status(200).json({
        success: true,
        is_following: results && results.length > 0,
      });
    },
  );
};

// =============================================================================
// GET FOLLOWERS LIST
// POST /api/user/socialpost/followers
// body: { user_id, user_type }
// =============================================================================
exports.getFollowers = (req, res) => {
  const { user_id, user_type } = req.body;

  if (!user_id || !user_type) {
    return res
      .status(400)
      .json({ success: false, message: "user_id and user_type required" });
  }

  db.query(
    `SELECT sf.*,
      CASE
        WHEN sf.follower_type = 'company' THEN c.company_name
        ELSE TRIM(CONCAT(COALESCE(ii.first_name,''), ' ', COALESCE(ii.last_name,'')))
      END as follower_name,
      CASE
        WHEN sf.follower_type = 'company' THEN c.company_logo
        ELSE ii.profile_picture
      END as follower_raw_image
     FROM follows sf
     LEFT JOIN company c ON sf.follower_type = 'company' AND c.id = sf.follower_id
     LEFT JOIN investor_information ii ON sf.follower_type = 'investor' AND ii.id = sf.follower_id
     WHERE sf.following_id = ? AND sf.following_type = ?
     ORDER BY sf.created_at DESC`,
    [user_id, user_type],
    (err, results) => {
      if (err)
        return res.status(500).json({ success: false, message: err.message });

      const followers = results.map((f) => {
        let image = null;
        if (f.follower_raw_image) {
          if (f.follower_type === "company") {
            image = `https://capavate.com/api/upload/docs/doc_${f.follower_id}/company_profile/${f.follower_raw_image}`;
          } else {
            image = `https://capavate.com/api/upload/investor/inv_${f.follower_id}/${f.follower_raw_image}`;
          }
        }
        return {
          id: f.follower_id,
          type: f.follower_type,
          name:
            (f.follower_name || "").trim() ||
            (f.follower_type === "company" ? "Company" : "Investor"),
          image,
          followed_at: f.created_at,
        };
      });

      return res.status(200).json({
        success: true,
        followers,
        total: followers.length,
      });
    },
  );
};

// =============================================================================
// GET FOLLOWING LIST
// POST /api/user/socialpost/following
// body: { user_id, user_type }
// =============================================================================
exports.getFollowing = (req, res) => {
  const { user_id, user_type } = req.body;

  if (!user_id || !user_type) {
    return res
      .status(400)
      .json({ success: false, message: "user_id and user_type required" });
  }

  db.query(
    `SELECT sf.*,
      CASE
        WHEN sf.following_type = 'company' THEN c.company_name
        ELSE TRIM(CONCAT(COALESCE(ii.first_name,''), ' ', COALESCE(ii.last_name,'')))
      END as following_name,
      CASE
        WHEN sf.following_type = 'company' THEN c.company_logo
        ELSE ii.profile_picture
      END as following_raw_image
     FROM follows sf
     LEFT JOIN company c ON sf.following_type = 'company' AND c.id = sf.following_id
     LEFT JOIN investor_information ii ON sf.following_type = 'investor' AND ii.id = sf.following_id
     WHERE sf.follower_id = ? AND sf.follower_type = ?
     ORDER BY sf.created_at DESC`,
    [user_id, user_type],
    (err, results) => {
      if (err)
        return res.status(500).json({ success: false, message: err.message });

      const following = results.map((f) => {
        let image = null;
        if (f.following_raw_image) {
          if (f.following_type === "company") {
            image = `https://capavate.com/api/upload/docs/doc_${f.following_id}/company_profile/${f.following_raw_image}`;
          } else {
            image = `https://capavate.com/api/upload/investor/inv_${f.following_id}/${f.following_raw_image}`;
          }
        }
        return {
          id: f.following_id,
          type: f.following_type,
          name:
            (f.following_name || "").trim() ||
            (f.following_type === "company" ? "Company" : "Investor"),
          image,
          followed_at: f.created_at,
        };
      });

      return res.status(200).json({
        success: true,
        following,
        total: following.length,
      });
    },
  );
};
