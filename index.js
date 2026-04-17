const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const http = require("http");
const path = require("path");
const socketIo = require("socket.io");
const helmet = require("helmet"); // ✅ Add this

//Admin
const AdminloginRoutes = require("./routes/admin/login");
const AdminvideoRoutes = require("./routes/admin/video");
const AdminmoduleRoutes = require("./routes/admin/module");
const AdminmoduleDashboard = require("./routes/admin/dashboard");
const Adminadminall = require("./routes/admin/adminall");
const Adminzoomeet = require("./routes/admin/zoomeet");
const Admincompany = require("./routes/admin/company");
const Admininvestor = require("./routes/admin/investors");
// Admin

//User
const UserRegisterRoutes = require("./routes/user/register");
const UserAifileRoutes = require("./routes/user/aifiles");
const UserpaymentRoutes = require("./routes/user/payment");
const UsercronjobRoutes = require("./routes/user/cronjob");
const UserInvestorReportRoutes = require("./routes/user/investorreport");
const UserInvestorRoutes = require("./routes/user/investor");
const UserCapitalRoundRoutes = require("./routes/user/capitalround");
const UserCapitalInvestmentRoundRoutes = require("./routes/user/capitalroundinvestment");
const UserDashboardRoutes = require("./routes/user/dashboard");
const UserCompanyRoutes = require("./routes/user/company");
const CompanyAccessLogsRoutes = require("./routes/user/accesslogs");
const Userwaitlist = require("./routes/user/waitlist");
const Companydashboard = require("./routes/user/companydashboard");
const InvestmentHistory = require("./routes/user/investmenthistory");
const InvestorRound = require("./routes/user/investorround");
const Chatmessage = require("./routes/user/chatmessage");
const Dataroom = require("./routes/user/dataroom");
const Follow = require("./routes/user/follow");
const Socialpost = require("./routes/user/socialpost");
//User

//Investor Login
const InvestorLogin = require("./routes/user/investorlogin");
//Investor Login

//FronteHome
const HomePage = require("./routes/frontpage/home");
//FronteHome

//Signatory
const SignatoryRoutes = require("./routes/user/signatory");
const SignatorydashboardRoutes = require("./routes/user/signatorydashboard");
//Signatory
dotenv.config();

const app = express();
const server = http.createServer(app);
// ✅ Socket.IO initialized
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.set("io", io); // ✅ Routes mein req.app.get("io") se access hoga
require("./socketHandler")(io);
const allowedOrigins = [
  "https://capavate.com",
  "https://www.capavate.com",
  "http://localhost:3000", // Development only
  "https://capavate.com", // Development only
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, curl)
      if (!origin) return callback(null, true);

      if (
        allowedOrigins.indexOf(origin) !== -1 ||
        process.env.NODE_ENV !== "production"
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  }),
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use((err, req, res, next) => {
  // Log internally
  console.error("Error:", {
    message: err.message,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    url: req.url,
    method: req.method,
    body: req.body,
  });

  // Production mein detailed error mat dikhao
  if (process.env.NODE_ENV === "production") {
    res.status(err.status || 500).json({
      success: false,
      message: "Internal Server Error",
    });
  } else {
    // Development mein detailed error dikhao (debugging ke liye)
    res.status(err.status || 500).json({
      success: false,
      message: err.message,
      stack: err.stack,
    });
  }
});
const authMiddleware = require("./middlewares/auth");
const adminAuthMiddleware = require("./middlewares/adminAuth");
// Serve static video files
app.use(
  "/upload/video",
  express.static(path.join(__dirname, "upload", "video")),
);
app.use("/upload/docs", express.static(path.join(__dirname, "upload", "docs")));

// Routes
app.use("/api/admin/", AdminloginRoutes);
app.use("/api/admin/video", AdminvideoRoutes);
app.use("/api/admin/module", AdminmoduleRoutes);
app.use("/api/admin/dashboard", AdminmoduleDashboard);
app.use("/api/admin/adminall", Adminadminall);
app.use("/api/admin/zoomeet", Adminzoomeet);
app.use("/api/admin/company", Admincompany);
app.use("/api/admin/investor", Admininvestor);
//User Routes
app.use("/api/user/", UserRegisterRoutes);
app.use("/api/user/aifile", authMiddleware, UserAifileRoutes);
app.use("/api/user/payment", authMiddleware, UserpaymentRoutes);
app.use("/api/user/cronjob", authMiddleware, UsercronjobRoutes);
app.use("/api/user/investorreport", authMiddleware, UserInvestorReportRoutes);
app.use("/api/user/investor", authMiddleware, UserInvestorRoutes);
app.use("/api/user/capitalround", authMiddleware, UserCapitalRoundRoutes);
app.use(
  "/api/user/capitalroundinvestment",
  authMiddleware,
  UserCapitalInvestmentRoundRoutes,
);
app.use("/api/user/dashboard", authMiddleware, UserDashboardRoutes);
app.use("/api/user/company", authMiddleware, UserCompanyRoutes);
app.use("/api/user/accesslogs", authMiddleware, CompanyAccessLogsRoutes);
app.use("/api/user/waitlist", authMiddleware, Userwaitlist);
app.use("/api/user/companydashboard", authMiddleware, Companydashboard);
app.use("/api/user/investmenthistory", authMiddleware, InvestmentHistory);
app.use("/api/user/investorround", authMiddleware, InvestorRound);
app.use("/api/user/chatmessage", Chatmessage);
app.use("/api/user/dataroom", authMiddleware, Dataroom);
app.use("/api/user/follow", authMiddleware, Follow);
app.use("/api/user/socialpost", Socialpost);

//User Routes

//Investor Login
app.use("/api/user/investorlogin", InvestorLogin);
//Investor Login
//FronteHome
app.use("/api/frontpage/home", HomePage);

//FronteHome

//Signatory Routes
app.use("/api/user/signatory", authMiddleware, SignatoryRoutes);
app.use(
  "/api/user/signatorydashboard",
  authMiddleware,
  SignatorydashboardRoutes,
);
//Signatory Routes

// Start server
server.listen(process.env.PORT || 5000, () => {
  console.log(`Server running on port ${process.env.PORT || 5000}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
});
server.setTimeout(600000);
