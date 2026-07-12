const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data", "attachments");

// Content-addressed by a random id, not by filename — two uploads named
// "image.png" never collide, and the id alone (not the original name) is
// what actually locates the file on disk.
const ID_RE = /^[a-f0-9]{24}$/;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function saveAttachment(buffer, filename, mimeType) {
  ensureDir();
  const id = crypto.randomBytes(12).toString("hex");
  const dir = path.join(DATA_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const safeName = path.basename(filename || "file").replace(/[^\w.\-]+/g, "_") || "file";
  fs.writeFileSync(path.join(dir, safeName), buffer);
  const meta = {
    id,
    filename: safeName,
    mimeType: mimeType || "application/octet-stream",
    size: buffer.length,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
  return meta;
}

// Always resolves the served file from meta.json's own recorded filename,
// never from a caller-supplied path segment — the :filename in the GET
// route is cosmetic (matches what saveAttachment returned, for a sane
// download name) and never used to build a filesystem path.
function getAttachment(id) {
  if (!ID_RE.test(id)) return null;
  const dir = path.join(DATA_DIR, id);
  const metaPath = path.join(dir, "meta.json");
  if (!fs.existsSync(metaPath)) return null;
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return null;
  }
  const filePath = path.join(dir, meta.filename);
  if (!fs.existsSync(filePath)) return null;
  return { ...meta, filePath };
}

module.exports = { saveAttachment, getAttachment };
