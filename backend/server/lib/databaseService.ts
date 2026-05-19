// ❌ DELETE these imports (lines 39-40)
// import { companies, rounds, notifications, activity, reports, crmInvestors } from "./mockData";

// ✅ ADD this import
import { 
  getAllCompanies, 
  getAllRounds, 
  createRound,
  getAllContacts,
  getUserActivity,
  getAllReports
} from "./lib/databaseService";

// ✅ CHANGE /api/companies (line ~553)
app.get("/api/companies", async (req, res) => {
  try {
    const companies = await getAllCompanies();
    res.json(companies);
  } catch (error) {
    console.error("Error fetching companies:", error);
    res.status(500).json({ error: "Failed to fetch companies" });
  }
});

// ✅ CHANGE /api/rounds (line ~580)
app.get("/api/rounds", async (req, res) => {
  try {
    const rounds = await getAllRounds();
    res.json(rounds);
  } catch (error) {
    console.error("Error fetching rounds:", error);
    res.status(500).json({ error: "Failed to fetch rounds" });
  }
});

// ✅ CHANGE POST /api/rounds (line ~1000)
app.post("/api/rounds", async (req, res) => {
  try {
    const ctx = await getUserContext(req);
    if (!ctx.isAuthed) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const newRound = await createRound(req.body);
    res.json({ ok: true, round: newRound });
  } catch (error) {
    console.error("Error creating round:", error);
    res.status(500).json({ error: "Failed to create round" });
  }
});

// ✅ CHANGE /api/crm (line ~685)
app.get("/api/crm", async (req, res) => {
  try {
    const contacts = await getAllContacts();
    res.json(contacts);
  } catch (error) {
    console.error("Error fetching contacts:", error);
    res.json([]);
  }
});

// ✅ CHANGE /api/activity (line ~689)
app.get("/api/activity", async (req, res) => {
  try {
    const ctx = await getUserContext(req);
    if (!ctx.isAuthed) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const activity = await getUserActivity(ctx.userId);
    res.json(activity);
  } catch (error) {
    console.error("Error fetching activity:", error);
    res.json([]);
  }
});

// ✅ CHANGE /api/reports (line ~687)
app.get("/api/reports", async (req, res) => {
  try {
    const reports = await getAllReports();
    res.json(reports);
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.json([]);
  }
});