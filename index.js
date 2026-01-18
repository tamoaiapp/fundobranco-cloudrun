import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { Storage } from "@google-cloud/storage";

const app = express();
app.use(express.json({ limit: "20mb" }));

// CORS (Bubble)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

const PORT = process.env.PORT || 8080;
const BUCKET_OUTPUT = process.env.BUCKET_OUTPUT;
const OUTPUT_PUBLIC = (process.env.OUTPUT_PUBLIC || "true").toLowerCase() === "true";

const storage = new Storage();

function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

function execFileAsync(cmd, args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        const msg =
          `CMD: ${cmd} ${args.join(" ")}\n` +
          `ERR: ${err.message}\n\n` +
          `STDOUT:\n${stdout || ""}\n\n` +
          `STDERR:\n${stderr || ""}\n`;
        return reject(new Error(msg));
      }
      resolve({ stdout, stderr });
    });
  });
}

async function downloadImage(url, outPath) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download_failed_${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

async function removeBg(inputPath, outputPath) {
  // roda o python e CAPTURA stdout/stderr
  const r = await execFileAsync("python3", ["bg_remove.py", inputPath, outputPath]);
  if (r.stdout) console.log("[PY STDOUT]", r.stdout);
  if (r.stderr) console.error("[PY STDERR]", r.stderr);
}

async function uploadToGCS(localPath, destName) {
  if (!BUCKET_OUTPUT) throw new Error("missing_env_BUCKET_OUTPUT");

  const bucket = storage.bucket(BUCKET_OUTPUT);
  await bucket.upload(localPath, {
    destination: destName,
    contentType: "image/png",
    resumable: false,
    metadata: { cacheControl: "public, max-age=31536000" },
  });

  if (OUTPUT_PUBLIC) {
    return `https://storage.googleapis.com/${BUCKET_OUTPUT}/${destName}`;
  }

  const file = bucket.file(destName);
  const [signedUrl] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 1000 * 60 * 60,
  });
  return signedUrl;
}

app.get("/health", (req, res) => res.status(200).send("ok"));

/**
 * POST /remove-bg
 * Body: { "image_url": "https://...." }
 */
app.post("/remove-bg", async (req, res) => {
  const t0 = Date.now();
  try {
    const { image_url } = req.body || {};
    if (!image_url) return res.status(400).json({ ok: false, error: "missing_image_url" });

    const id = sha1(image_url).slice(0, 16);
    const inPath = path.join("/tmp", `in-${id}`);
    const outPath = path.join("/tmp", `out-${id}.png`);

    await downloadImage(image_url, inPath);
    await removeBg(inPath, outPath);

    const destName = `removebg/${new Date().toISOString().slice(0, 10)}/${id}.png`;
    const finalUrl = await uploadToGCS(outPath, destName);

    try { fs.unlinkSync(inPath); } catch {}
    try { fs.unlinkSync(outPath); } catch {}

    return res.json({ ok: true, image_url: finalUrl, file: destName, ms: Date.now() - t0 });
  } catch (e) {
    console.error("remove-bg ERROR:", e?.message || e);
    return res.status(500).json({
      ok: false,
      error: "removebg_failed",
      message: String(e?.message || e),
    });
  }
});

app.listen(PORT, "0.0.0.0", () => console.log("remove-bg on", PORT));
