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

const storage = new Storage();

function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

/**
 * ✅ Exec com log completo (STDERR/STDOUT) para aparecer no Cloud Run + Bubble
 */
function execFileAsync(cmd, args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        const msg = [
          `CMD: ${cmd} ${args.join(" ")}`,
          `ERR: ${err.message}`,
          `STDOUT:\n${stdout || ""}`,
          `STDERR:\n${stderr || ""}`,
        ].join("\n");
        return reject(new Error(msg));
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * ✅ Baixa a imagem e valida se é imagem de verdade (evita HTML/403)
 */
async function downloadImage(url, outPath) {
  const r = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      // ajuda alguns CDNs
      "User-Agent": "Mozilla/5.0 (CloudRun) remove-bg",
      "Accept": "image/*,*/*;q=0.8",
    },
  });

  const contentType = r.headers.get("content-type") || "";

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(
      `download_failed_status_${r.status}\ncontent-type:${contentType}\nbody_head:${text.slice(0, 200)}`
    );
  }

  // se voltar HTML em vez de imagem, a gente pega aqui
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

/**
 * ✅ Remove fundo chamando python
 */
async function removeBg(inputPath, outputPath) {
  await execFileAsync("python3", ["bg_remove.py", inputPath, outputPath]);
}

/**
 * ✅ Upload para GCS e retorna URL
 */
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
    return `https://storage.googleapis.com/${BUCKET_OUTPUT}/${encodeURIComponent(destName)}`;
  }

  const file = bucket.file(destName);
  const [signedUrl] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 1000 * 60 * 60, // 1h
  });
  return signedUrl;
}

// health
app.get("/health", (req, res) => res.status(200).send("ok"));

/**
 * Handler único (pra usar em /remove-bg e /)
 */
async function handleRemoveBg(req, res) {
  const t0 = Date.now();

  try {
    const image_url = req.body?.image_url || req.query?.image_url;
    if (!image_url) return res.status(400).json({ ok: false, error: "missing_image_url" });

    const id = sha1(image_url).slice(0, 16);
    const inPath = path.join("/tmp", `in-${id}`);
    const outPath = path.join("/tmp", `out-${id}.png`);

    // 1) baixa
    await downloadImage(image_url, inPath);

    // 2) remove fundo
    await removeBg(inPath, outPath);

    // 3) sobe
    const destName = `removebg/${new Date().toISOString().slice(0, 10)}/${id}.png`;
    const finalUrl = await uploadToGCS(outPath, destName);

    // cleanup
    try { fs.unlinkSync(inPath); } catch {}
    try { fs.unlinkSync(outPath); } catch {}

    return res.json({
      ok: true,
      image_url: finalUrl,
      file: destName,
      ms: Date.now() - t0,
    });
  } catch (e) {
    // ✅ isso aparece nos logs do Cloud Run
    console.error("REMOVE_BG_ERROR:\n", e?.message || e);

    // ✅ isso aparece pro Bubble (bem mais útil que “500 genérico”)
    return res.status(500).json({
      ok: false,
      error: "removebg_failed",
      message: String(e?.message || e),
    });
  }
}

// endpoint oficial
app.post("/remove-bg", handleRemoveBg);

// ✅ endpoint raiz também (evita erro “Cannot POST /”)
app.post("/", handleRemoveBg);

app.listen(PORT, () => console.log("remove-bg listening on", PORT));
