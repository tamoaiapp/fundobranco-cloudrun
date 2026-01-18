import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { Storage } from "@google-cloud/storage";

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

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
      if (err) return reject(new Error(`${err.message}\n${stderr || ""}`));
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
  await execFileAsync("python3", ["bg_remove.py", inputPath, outputPath]);
}

async function uploadToGCS(localPath, destName) {
  const bucket = storage.bucket(BUCKET_OUTPUT);
  await bucket.upload(localPath, {
    destination: destName,
    contentType: "image/png",
    resumable: false,
    metadata: { cacheControl: "public, max-age=31536000" },
  });

  if (OUTPUT_PUBLIC) {
    return `https://storage.googleapis.com/${BUCKET_OUTPUT}/${encodeURIComponent(destName)}`;
  }

  const file = bucket.file(destName);
  const [signedUrl] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 1000 * 60 * 60,
  });
  return signedUrl;
}

app.post("/remove-bg", async (req, res) => {
  try {
    const image_url = req.body?.image_url || req.query?.image_url;
    if (!image_url) return res.status(400).json({ ok: false, error: "missing_image_url" });

    const id = sha1(image_url).slice(0, 16);
    const inPath = path.join("/tmp", `in-${id}`);
    const outPath = path.join("/tmp", `out-${id}.png`);

    await downloadImage(image_url, inPath);
    await removeBg(inPath, outPath);

    const destName = `removebg/${new Date().toISOString().slice(0, 10)}/${id}.png`;
    const finalUrl = await uploadToGCS(outPath, destName);

    res.json({ ok: true, image_url: finalUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.listen(PORT, () => console.log("listening on", PORT));
