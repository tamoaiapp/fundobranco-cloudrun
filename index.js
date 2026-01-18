import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { Storage } from "@google-cloud/storage";

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

// CORS (Bubble)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

const PORT = process.env.PORT || 8080;
const BUCKET_OUTPUT = process.env.BUCKET_OUTPUT; // obrigatório
const OUTPUT_PUBLIC = (process.env.OUTPUT_PUBLIC || "true").toLowerCase() === "true";

console.log("BOOT OK - remove-bg server starting...");
console.log("BUCKET_OUTPUT =", BUCKET_OUTPUT);
console.log("NODE =", process.version);

const storage = new Storage();

function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

function execFileAsync(cmd, args, timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        const msg = [
          `CMD: ${cmd} ${args.join(" ")}`,
          `ERR: ${err.message}`,
          `STDOUT:\n${stdout || ""}`,
          `STDERR:\n${stderr || ""}`
        ].join("\n");
        return reject(new Error(msg));
      }
      resolve({ stdout, stderr });
    });
  });
}

async function downloadImage(url, outPath) {
  const r = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (CloudRun) remove-bg",
      "Accept": "image/*,*/*;q=0.8"
    }
  });

  const contentType = r.headers.get("content-type") || "";

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(
      `download_failed_status_${r.status}\ncontent-type:${contentType}\nbody_head:${text.slice(0, 200)}`
    );
  }

  if (!contentType.startsWith("image/")) {
    const text = await r.text().catch(() => "");
    throw new Error(
      `download_not_image\ncontent-type:${contentType}\nbody_head:${text.slice(0, 300)}`
    );
  }

  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf || buf.length < 100) {
    throw new Error(`download_empty_or_too_small bytes=${buf?.length || 0}`);
  }

  fs.writeFileSync(outPath, buf);
}

async function removeBg(inputPath, outputPath) {
  await execFileAsync("python3", ["bg_remove.py", inputPath, outputPath], 240000);
  if (!fs.existsSync(outputPath)) {
    throw new Error("python_ran_but_output_missing");
  }
}

async function uploadToGCS(localPath, destName) {
  if (!BUCKET_OUTPUT) throw new Error("missing_env_BUCKET_OUTPUT");

  const bucket = storage.bucket(BUCKET_OUTPUT);

  await bucket.upload(localPath, {
    destination: destName,
    contentType: "image/png",
    resumable: false,
    metadata: { cacheControl: "public, max-age=31536000" }
  });

  if (OUTPUT_PUBLIC) {
    return `https://storage.googleapis.com/${BUCKET_OUTPUT}/${encodeURIComponent(destName)}`;
  }

  const file = bucket.file(destName);
  const [signedUrl] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 1000 * 60 * 60
  });
  return signedUrl;
}

app.get("/health", (req, res) => res.status(200).send("ok"));

async function handleRemoveBg(req, res) {
  const t0 = Date.now();

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

    try { fs.unlinkSync(inPath); } catch {}
    try { fs.unlinkSync(outPath); } catch {}

    return res.json({
      ok: true,
      image_url: finalUrl,
      file: destName,
      ms: Date.now() - t0
    });
  } catch (e) {
    console.error("REMOVE_BG_ERROR:\n", e?.message || e);

    return res.status(500).json({
      ok: false,
      error: "removebg_failed",
      message: String(e?.message || e)
    });
  }
}

app.post("/remove-bg", handleRemoveBg);
app.post("/", handleRemoveBg);

app.listen(PORT, () => console.log("remove-bg listening on", PORT));
