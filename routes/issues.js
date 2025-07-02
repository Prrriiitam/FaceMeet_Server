const express = require("express");
const Issue  = require("../schemas/Issue");
const Reply  = require("../schemas/Reply");
const router = express.Router();

// Middleware you wrote earlier (JWT)
const authorize = require("../middleware/authorize");

// GET /api/issues?skip=0&limit=20  – list with no replies
router.get("/", async (req, res) => { 
  const { skip = 0, limit = 20 } = req.query;
  try{
  const issues = await Issue.find()
    .sort({ createdAt: -1 })
    .skip(+skip)
    .limit(+limit)
    .select("-body")           // send short list (no body)
    .lean();
  res.json(issues);
  }catch(err){
    console.error("Error fetching issues:", err); // Log the server-side error
    res.status(500).json({ error: "Internal server error while fetching issues." });
  }
});

// GET /api/issues/:id  – issue + replies
router.get("/:id", async (req, res) => {
  const issue = await Issue.findById(req.params.id).lean();
  if (!issue) return res.status(404).json({ error: "Not found" });

  const replies = await Reply.find({ issueId: issue._id })
    .sort({ createdAt: 1 })
    .lean();
  res.json({ issue, replies });
});

// POST /api/issues  – create new issue
router.post("/", authorize, async (req, res) => {
  const { title, body } = req.body;
  const { uid, name } = req.user;          // set in JWT
  const issue = await Issue.create({
    title,
    body,
    author: { id: req.user.uid, name: req.user.name, avatar: req.user.picture },
  });
  res.status(201).json(issue);
});

// POST /api/issues/:id/replies  – reply
router.post("/:id/replies", authorize, async (req, res) => {
  const { body } = req.body;
  const { uid, name } = req.user;

  const reply = await Reply.create({
    issueId: req.params.id,
    body,
    author: { id: uid, name, avatar: req.user.picture || "" },
  });
  await Issue.updateOne(
    { _id: req.params.id },
    { $inc: { repliesCount: 1 } }
  );
  res.status(201).json(reply);
});

module.exports = router;
