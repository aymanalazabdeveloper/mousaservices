const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const REQUESTS_FILE = path.join(DATA_DIR, "requests.json");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_FILES = 5;
const ALLOWED_FILE_TYPES = new Set([".jpg", ".jpeg", ".png", ".pdf"]);
const USERS_FILE = path.join(DATA_DIR, "users.json");
const sessions = new Map();

const ALLOWED_STATUSES = [
  "جديد", "قيد المراجعة", "يحتاج استكمال بيانات", "جاري المتابعة", "تم الحل", "مرفوض"
];

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

async function readJsonFile(file, fallback = []) {
  try {
    const text = await fs.readFile(file, "utf8");
    return JSON.parse(text || JSON.stringify(fallback));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}
async function writeJsonFile(file, data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}
const readRequests = () => readJsonFile(REQUESTS_FILE, []);
const writeRequests = requests => writeJsonFile(REQUESTS_FILE, requests);
const readUsers = () => readJsonFile(USERS_FILE, []);
const writeUsers = users => writeJsonFile(USERS_FILE, users);

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, passwordHash: hash };
}
function verifyPassword(password, user) {
  if (!user.salt || !user.passwordHash) return false;
  const actual = crypto.scryptSync(password, user.salt, 64);
  const expected = Buffer.from(user.passwordHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function safeUser(user) {
  return { id: user.id, username: user.username, name: user.name, role: user.role, active: user.active };
}
function requireAdmin(req, res, next) {
  const token = req.get("x-admin-token");
  const session = token && sessions.get(token);
  if (!session) return res.status(401).json({ success: false, message: "انتهت الجلسة أو لم يتم تسجيل الدخول. سجّل الدخول مرة أخرى." });
  req.user = session;
  next();
}
function generateRequestId(requests) {
  const year = new Date().getFullYear();
  const prefix = `REQ-${year}-`;
  let max = 0;
  for (const item of requests) {
    if (typeof item.id !== "string" || !item.id.startsWith(prefix)) continue;
    const number = Number(item.id.slice(prefix.length));
    if (Number.isInteger(number) && number > max) max = number;
  }
  return `${prefix}${String(max + 1).padStart(6, "0")}`;
}

app.get("/health", (req, res) => res.json({ ok: true, service: "citizen-service" }));

// First-account setup is fail-closed and protected by an exclusive lock.
const SETUP_LOCK_FILE = path.join(DATA_DIR, ".initial-admin-setup.lock");

async function readUsersForSetup() {
  // A missing users.json must NOT reopen public registration.
  const text = await fs.readFile(USERS_FILE, "utf8");
  const users = JSON.parse(text);
  if (!Array.isArray(users)) throw new Error("users.json must contain a JSON array");
  return users;
}

app.get("/api/auth/setup-status", async (req, res) => {
  try {
    const users = await readUsersForSetup();
    res.json({ success: true, setupRequired: users.length === 0 });
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.json({ success: true, setupRequired: false, message: "إعداد الحسابات غير متاح لأن ملف users.json غير موجود." });
    }
    console.error(error);
    res.status(500).json({ success: false, setupRequired: false, message: "تعذر التحقق من إعداد الحسابات." });
  }
});

app.post("/api/auth/setup", async (req, res) => {
  let lockHandle;
  let setupCompleted = false;
  try {
    const { username, name, password } = req.body || {};
    if (typeof username !== "string" || !/^[a-zA-Z0-9._-]{3,40}$/.test(username.trim())) return res.status(400).json({ success: false, message: "اسم المستخدم يجب أن يكون من 3 إلى 40 حرفًا إنجليزيًا أو رقمًا." });
    if (typeof name !== "string" || !name.trim()) return res.status(400).json({ success: false, message: "أدخل اسم الموظف." });
    if (typeof password !== "string" || password.length < 10) return res.status(400).json({ success: false, message: "كلمة المرور يجب ألا تقل عن 10 أحرف." });

    // wx creates the lock exclusively, preventing simultaneous setup requests
    // from creating more than one initial administrator on the same data volume.
    try {
      lockHandle = await fs.open(SETUP_LOCK_FILE, "wx");
    } catch (error) {
      if (error.code === "EEXIST") return res.status(409).json({ success: false, message: "هناك محاولة إعداد جارية أو تم قفل الإعداد الأول. استخدم شاشة تسجيل الدخول." });
      if (error.code === "ENOENT") return res.status(503).json({ success: false, message: "ملف users.json غير موجود؛ تم إيقاف إنشاء المدير حفاظًا على الأمان." });
      throw error;
    }

    let users;
    try {
      users = await readUsersForSetup();
    } catch (error) {
      if (error.code === "ENOENT") return res.status(503).json({ success: false, message: "ملف users.json غير موجود؛ تم إيقاف إنشاء المدير حفاظًا على الأمان." });
      throw error;
    }
    if (users.length) return res.status(409).json({ success: false, message: "تم إنشاء حساب بالفعل. استخدم شاشة تسجيل الدخول." });

    const credentials = hashPassword(password);
    const user = { id: crypto.randomUUID(), username: username.trim(), name: name.trim().slice(0, 100), role: "admin", active: true, ...credentials, createdAt: new Date().toISOString() };
    await writeUsers([user]);
    setupCompleted = true;
    res.status(201).json({ success: true, message: "تم إنشاء حساب الإدارة. يمكنك تسجيل الدخول الآن." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "حدث خطأ أثناء إنشاء الحساب." });
  } finally {
    if (lockHandle) {
      try { await lockHandle.close(); } catch {}
      // Keep the lock after successful setup, even if users.json is later lost.
      // On a failed attempt, release it so setup can be retried safely.
      if (!setupCompleted) {
        try { await fs.unlink(SETUP_LOCK_FILE); } catch {}
      }
    }
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== "string" || typeof password !== "string") return res.status(400).json({ success: false, message: "أدخل اسم المستخدم وكلمة المرور." });
    const users = await readUsers();
    const user = users.find(item => item.username.toLowerCase() === username.trim().toLowerCase());
    if (!user || !user.active || !verifyPassword(password, user)) return res.status(401).json({ success: false, message: "اسم المستخدم أو كلمة المرور غير صحيحة، أو الحساب موقوف." });
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { id: user.id, username: user.username, name: user.name, role: user.role });
    res.json({ success: true, token, user: safeUser(user) });
  } catch (error) { console.error(error); res.status(500).json({ success: false, message: "حدث خطأ أثناء تسجيل الدخول." }); }
});
app.post("/api/auth/logout", (req, res) => {
  const token = req.get("x-admin-token");
  if (token) sessions.delete(token);
  res.json({ success: true });
});

app.get("/api/requests", requireAdmin, async (req, res) => {
  try { res.json({ success: true, requests: await readRequests() }); }
  catch (error) { console.error(error); res.status(500).json({ success: false, message: "حدث خطأ أثناء قراءة الطلبات." }); }
});
async function parseRequestMultipart(req, res, next) {
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("multipart/form-data")) return next();
  try {
    const contentType = req.headers["content-type"] || "";
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    const boundaryText = boundaryMatch && (boundaryMatch[1] || boundaryMatch[2]).trim();
    if (!boundaryText || boundaryText.length > 200) return res.status(400).json({ success: false, message: "صيغة رفع الملفات غير صحيحة." });
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_FILES * MAX_FILE_SIZE + 1024 * 1024) return res.status(413).json({ success: false, message: "إجمالي حجم الملفات لا يمكن أن يتجاوز 25 ميجابايت." });
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const boundary = Buffer.from(`--${boundaryText}`);
    const fields = {};
    const files = [];
    let cursor = body.indexOf(boundary);
    while (cursor !== -1) {
      cursor += boundary.length;
      if (body.slice(cursor, cursor + 2).equals(Buffer.from("--"))) break;
      if (body.slice(cursor, cursor + 2).equals(Buffer.from("\r\n"))) cursor += 2;
      const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), cursor);
      if (headerEnd === -1) throw new Error("صيغة مرفق غير صحيحة.");
      const headersText = body.slice(cursor, headerEnd).toString("utf8");
      const nextBoundary = body.indexOf(Buffer.concat([Buffer.from("\r\n"), boundary]), headerEnd + 4);
      if (nextBoundary === -1) throw new Error("نهاية المرفق غير صحيحة.");
      const content = body.slice(headerEnd + 4, nextBoundary);
      const disposition = headersText.match(/content-disposition:\s*form-data;([^\r\n]+)/i);
      const nameMatch = disposition && disposition[1].match(/(?:^|;)\s*name="([^"]*)"/i);
      const filenameMatch = disposition && disposition[1].match(/(?:^|;)\s*filename="([^"]*)"/i);
      if (nameMatch) {
        const fieldName = nameMatch[1];
        if (filenameMatch && filenameMatch[1]) {
          const originalName = filenameMatch[1].split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, "").slice(0, 180);
          const ext = path.extname(originalName).toLowerCase();
          if (fieldName !== "attachments") throw new Error("اسم حقل المرفقات غير صحيح.");
          if (!ALLOWED_FILE_TYPES.has(ext)) throw new Error(`نوع الملف ${originalName || "المرفق"} غير مسموح. ارفع JPG أو PNG أو PDF فقط.`);
          if (content.length > MAX_FILE_SIZE) throw new Error(`حجم الملف ${originalName} أكبر من 5 ميجابايت.`);
          if (files.length >= MAX_FILES) throw new Error("الحد الأقصى هو 5 مرفقات لكل طلب.");
          const isPdf = ext === ".pdf" && content.slice(0, 5).toString("ascii") === "%PDF-";
          const isPng = ext === ".png" && content.length >= 8 && content.slice(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
          const isJpeg = [".jpg", ".jpeg"].includes(ext) && content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
          if (!(isPdf || isPng || isJpeg)) throw new Error(`محتوى الملف ${originalName} لا يطابق نوعه.`);
          files.push({ originalName: originalName || `attachment${ext}`, ext, content });
        } else {
          fields[fieldName] = content.toString("utf8");
        }
      }
      cursor = nextBoundary + 2;
    }
    req.body = fields;
    req.uploadedFiles = files;
    next();
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || "تعذر قراءة الملفات المرفقة." });
  }
}

app.post("/api/requests", parseRequestMultipart, async (req, res) => {
  try {
    const { name, phone, type, details } = req.body || {};
    if (![name, phone, type, details].every(value => typeof value === "string" && value.trim())) return res.status(400).json({ success: false, message: "برجاء إدخال جميع البيانات المطلوبة." });
    const requests = await readRequests();
    const now = new Date().toISOString();
    const requestId = generateRequestId(requests);
    const savedAttachments = [];
    try {
      await fs.mkdir(UPLOADS_DIR, { recursive: true });
      for (const file of (req.uploadedFiles || [])) {
        const storedName = `${crypto.randomUUID()}${file.ext}`;
        await fs.writeFile(path.join(UPLOADS_DIR, storedName), file.content, { flag: "wx" });
        savedAttachments.push({ id: crypto.randomUUID(), originalName: file.originalName, storedName, size: file.content.length, type: file.ext === ".pdf" ? "application/pdf" : file.ext === ".png" ? "image/png" : "image/jpeg" });
      }
      const request = { id: requestId, name: name.trim(), phone: phone.trim(), type: type.trim(), details: details.trim(), attachments: savedAttachments, status: "جديد", createdAt: now, updatedAt: now, history: [{ status: "جديد", note: "تم استلام الطلب.", employee: "النظام", timestamp: now }] };
      requests.push(request);
      await writeRequests(requests);
      res.status(201).json({ success: true, message: "تم تقديم الطلب بنجاح.", request: { id: request.id, status: request.status, createdAt: request.createdAt } });
    } catch (error) {
      await Promise.all(savedAttachments.map(file => fs.unlink(path.join(UPLOADS_DIR, file.storedName)).catch(() => {})));
      throw error;
    }
  } catch (error) { console.error(error); res.status(500).json({ success: false, message: "حدث خطأ أثناء حفظ الطلب." }); }
});
app.post("/api/requests/track", async (req, res) => {
  try {
    const { id, phone } = req.body || {};
    if (typeof id !== "string" || !id.trim() || typeof phone !== "string" || !phone.trim()) {
      return res.status(400).json({ success: false, message: "أدخل رقم الطلب ورقم الهاتف المسجل على الطلب." });
    }
    const normalizePhone = value => String(value || "").replace(/\D/g, "");
    const requests = await readRequests();
    const request = requests.find(item =>
      item.id.toLowerCase() === id.trim().toLowerCase() &&
      normalizePhone(item.phone) === normalizePhone(phone)
    );
    if (!request) return res.status(404).json({ success: false, message: "رقم الطلب أو رقم الهاتف غير صحيح." });
    res.json({ success: true, request: { id: request.id, type: request.type, status: request.status, createdAt: request.createdAt, updatedAt: request.updatedAt, history: (request.history || []).map(entry => ({ status: entry.status, note: entry.note, timestamp: entry.timestamp })) } });
  } catch (error) { console.error(error); res.status(500).json({ success: false, message: "حدث خطأ أثناء البحث عن الطلب." }); }
});
app.get("/api/admin/requests/:id", requireAdmin, async (req, res) => {
  try {
    const requests = await readRequests();
    const request = requests.find(item => item.id.toLowerCase() === req.params.id.toLowerCase());
    if (!request) return res.status(404).json({ success: false, message: "لم يتم العثور على الطلب." });
    res.json({ success: true, request });
  } catch (error) { console.error(error); res.status(500).json({ success: false, message: "حدث خطأ أثناء قراءة تفاصيل الطلب." }); }
});
app.get("/api/admin/requests/:id/attachments/:attachmentId", requireAdmin, async (req, res) => {
  try {
    const requests = await readRequests();
    const request = requests.find(item => item.id.toLowerCase() === req.params.id.toLowerCase());
    if (!request) return res.status(404).json({ success: false, message: "لم يتم العثور على الطلب." });
    const attachment = (request.attachments || []).find(file => file.id === req.params.attachmentId);
    if (!attachment || !/^[a-f0-9-]+\.(jpg|jpeg|png|pdf)$/i.test(attachment.storedName)) return res.status(404).json({ success: false, message: "لم يتم العثور على المرفق." });
    const fullPath = path.join(UPLOADS_DIR, attachment.storedName);
    await fs.access(fullPath);
    res.setHeader("Content-Type", attachment.type || "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(attachment.originalName).replace(/[\"\r\n]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`);
    res.sendFile(fullPath);
  } catch (error) {
    if (error.code === "ENOENT") return res.status(404).json({ success: false, message: "ملف المرفق غير موجود على الخادم." });
    console.error(error);
    res.status(500).json({ success: false, message: "تعذر تنزيل المرفق." });
  }
});

app.patch("/api/requests/:id/status", requireAdmin, async (req, res) => {
  try {
    const { status, note } = req.body || {};
    if (!ALLOWED_STATUSES.includes(status)) return res.status(400).json({ success: false, message: "حالة الطلب غير صحيحة." });
    if (typeof note !== "string" || !note.trim()) return res.status(400).json({ success: false, message: "اكتب ملاحظة توضح سبب تحديث الحالة." });
    const requests = await readRequests();
    const request = requests.find(item => item.id.toLowerCase() === req.params.id.toLowerCase());
    if (!request) return res.status(404).json({ success: false, message: "لم يتم العثور على الطلب." });
    const now = new Date().toISOString();
    request.status = status;
    request.updatedAt = now;
    if (!Array.isArray(request.history)) request.history = [];
    request.history.push({ status, note: note.trim(), employee: req.user.name, timestamp: now });
    await writeRequests(requests);
    res.json({ success: true, message: "تم تحديث حالة الطلب.", request });
  } catch (error) { console.error(error); res.status(500).json({ success: false, message: "حدث خطأ أثناء تحديث حالة الطلب." }); }
});

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ success: false, message: "هذه العملية متاحة لمدير النظام فقط." });
  try { res.json({ success: true, users: (await readUsers()).map(safeUser) }); }
  catch (error) { console.error(error); res.status(500).json({ success: false, message: "تعذر قراءة الحسابات." }); }
});
app.post("/api/admin/users", requireAdmin, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ success: false, message: "إنشاء الحسابات متاح لمدير النظام فقط." });
  try {
    const { username, name, password, role } = req.body || {};
    if (typeof username !== "string" || !/^[a-zA-Z0-9._-]{3,40}$/.test(username.trim())) return res.status(400).json({ success: false, message: "اسم المستخدم يجب أن يكون من 3 إلى 40 حرفًا إنجليزيًا أو رقمًا." });
    if (typeof name !== "string" || !name.trim()) return res.status(400).json({ success: false, message: "أدخل اسم الموظف." });
    if (typeof password !== "string" || password.length < 10) return res.status(400).json({ success: false, message: "كلمة المرور يجب ألا تقل عن 10 أحرف." });
    if (!['admin', 'employee'].includes(role)) return res.status(400).json({ success: false, message: "نوع الحساب غير صحيح." });
    const users = await readUsers();
    if (users.some(user => user.username.toLowerCase() === username.trim().toLowerCase())) return res.status(409).json({ success: false, message: "اسم المستخدم مستخدم بالفعل." });
    const user = { id: crypto.randomUUID(), username: username.trim(), name: name.trim().slice(0, 100), role, active: true, ...hashPassword(password), createdAt: new Date().toISOString() };
    users.push(user);
    await writeUsers(users);
    res.status(201).json({ success: true, message: "تم إنشاء الحساب وحفظه في users.json.", user: safeUser(user) });
  } catch (error) { console.error(error); res.status(500).json({ success: false, message: "حدث خطأ أثناء إنشاء الحساب." }); }
});
app.patch("/api/admin/users/:id/active", requireAdmin, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ success: false, message: "هذه العملية متاحة لمدير النظام فقط." });
  try {
    const users = await readUsers();
    const user = users.find(item => item.id === req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "لم يتم العثور على الحساب." });
    if (user.id === req.user.id && req.body.active === false) return res.status(400).json({ success: false, message: "لا يمكنك إيقاف حسابك أثناء تسجيل الدخول." });
    if (typeof req.body.active !== "boolean") return res.status(400).json({ success: false, message: "قيمة حالة الحساب غير صحيحة." });
    if (user.role === "admin" && req.body.active === false && users.filter(item => item.role === "admin" && item.active).length <= 1) return res.status(400).json({ success: false, message: "لا يمكن إيقاف آخر حساب مدير نشط." });
    user.active = req.body.active;
    await writeUsers(users);
    res.json({ success: true, message: user.active ? "تم تفعيل الحساب." : "تم إيقاف الحساب." });
  } catch (error) { console.error(error); res.status(500).json({ success: false, message: "حدث خطأ أثناء تحديث الحساب." }); }
});

app.listen(PORT, "0.0.0.0", () => console.log(`Citizen Service running on port ${PORT}`));
