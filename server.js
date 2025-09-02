const express = require("express");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const nodemailer = require("nodemailer");
const app = express();
app.use(express.static("public"));

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.static("public"));

const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    cb(null, base + ext);
  },
});

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
const upload = multer({ storage });

const JWT_SECRET = process.env.JWT_SECRET || "devsecret";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "15m";

function signShareToken(fileId, recipientEmail) {
  return jwt.sign({ fileId, recipientEmail }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function requireToken(req, res, next) {
  const token = req.query.token || (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid/expired token" });
  }
}

// 1) Upload an image (returns fileId)
app.post("/api/upload", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  res.json({ fileId: req.file.filename });
});

// 2) Create a recipient-only edit link

app.post("/api/share", async (req, res) => {
  const { fileId, recipientEmail, origin } = req.body || {};
  if (!fileId || !recipientEmail) return res.status(400).json({ error: "fileId and recipientEmail required" });

  const token = signShareToken(fileId, recipientEmail);
  const base = process.env.PUBLIC_URL || origin || `http://localhost:${process.env.PORT || 3000}`;
  const url = `${base}/edit.html?token=${encodeURIComponent(token)}`;

  try {
    await transporter.sendMail({
      from: `"Secure Photo App" <${process.env.EMAIL_USER}>`,
      to: recipientEmail,
      subject: "You have a photo to edit",
      html: `<p>Hello,</p>
             <p>You’ve been invited to securely edit a photo.</p>
             <p><a href="${url}" target="_blank">Click here to open the editor</a></p>
             <p>This link will expire soon.</p>`,
    });

    res.json({ success: true, message: "Link sent to email", url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send email" });
  }
});


// 3) Serve the original image (auth required)
app.get("/api/image", requireToken, (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.auth.fileId);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });
  res.sendFile(filePath);
});

// 4) Save the edited image (auth required)
app.post("/api/save", requireToken, (req, res) => {
  const { imageData } = req.body || {};
  if (!imageData || !imageData.startsWith("data:image/")) {
    return res.status(400).json({ error: "Invalid image data" });
  }
  const buffer = Buffer.from(imageData.split(",")[1], "base64");
  const outPath = path.join(UPLOAD_DIR, req.auth.fileId.replace(/\.(\w+)$/, "-edited.png"));
  fs.writeFileSync(outPath, buffer);
  return res.json({ savedAs: path.basename(outPath) });
});

// Optional: expose who/what the token is for
app.get("/api/me", requireToken, (req, res) => {
  res.json({ fileId: req.auth.fileId, recipientEmail: req.auth.recipientEmail });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server http://localhost:${PORT}`));
