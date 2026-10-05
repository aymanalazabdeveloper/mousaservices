const express = require("express");
const path = require("path");
const fs = require("fs/promises");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const REQUESTS_FILE = path.join(DATA_DIR, "requests.json");

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

async function readRequests() {
  try {
    const text = await fs.readFile(REQUESTS_FILE, "utf8");
    return JSON.parse(text || "[]");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeRequests(requests) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(REQUESTS_FILE, JSON.stringify(requests, null, 2), "utf8");
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

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "citizen-service" });
});

app.get("/api/requests", async (req, res) => {
  try {
    const requests = await readRequests();
    res.json({ success: true, requests });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "حدث خطأ أثناء قراءة الطلبات." });
  }
});

app.post("/api/requests", async (req, res) => {
  try {
    const { name, phone, type, details } = req.body;

    if (!name?.trim() || !phone?.trim() || !type?.trim() || !details?.trim()) {
      return res.status(400).json({
        success: false,
        message: "برجاء إدخال جميع البيانات المطلوبة."
      });
    }

    const requests = await readRequests();
    const now = new Date();

    const request = {
      id: generateRequestId(requests),
      name: name.trim(),
      phone: phone.trim(),
      type: type.trim(),
      details: details.trim(),
      status: "جديد",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    requests.push(request);
    await writeRequests(requests);

    res.status(201).json({
      success: true,
      message: "تم تقديم الطلب بنجاح.",
      request: {
        id: request.id,
        status: request.status,
        createdAt: request.createdAt
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء حفظ الطلب."
    });
  }
});

app.get("/api/requests/:id", async (req, res) => {
  try {
    const requests = await readRequests();
    const request = requests.find(
      item => item.id.toLowerCase() === req.params.id.toLowerCase()
    );

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "لم يتم العثور على الطلب."
      });
    }

    res.json({
      success: true,
      request: {
        id: request.id,
        type: request.type,
        status: request.status,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء البحث عن الطلب."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Citizen Service running on port ${PORT}`);
});
