/* =========================================================================
   Prueba del revisor de videos (assets/js/video-tools.js) con videos REALES
   hechos con ffmpeg: uno bueno de cada tipo y uno malo por cada regla.

     node tools/video-tools-test.mjs

   No necesita servidor ni navegador (el revisor lee las cajas del MP4, igual
   en Node que en el panel). Si no hay ffmpeg, avisa y termina sin fallar.
   ========================================================================= */
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const V = require("../assets/js/video-tools.js");

if (spawnSync("ffmpeg", ["-version"]).status !== 0) { console.log("sin ffmpeg: se omite la prueba de videos"); process.exit(0); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stike-video-"));
let fail = 0;
const t = (l, ok, x = "") => { if (!ok) fail++; console.log((ok ? "ok    " : "FALLA ") + l + (ok ? "" : "  -> " + x)); };

/* ffmpeg con una fuente de prueba; `extra` cambia el codec/tamaño/etc. */
function make(name, { size = "1280x720", rate = 30, secs = 6, v = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-b:v", "1M"], a = false, pre = [], post = ["-movflags", "+faststart"], fmt = [] } = {}) {
  const out = path.join(dir, name);
  const args = ["-loglevel", "error", "-y", ...pre, "-f", "lavfi", "-i", `testsrc2=duration=${secs}:size=${size}:rate=${rate}`];
  if (a) args.push("-f", "lavfi", "-i", `sine=duration=${secs}`);
  args.push(...v, ...(a ? ["-c:a", a === true ? "aac" : a] : ["-an"]), ...post, ...fmt, out);
  execFileSync("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
  return out;
}
const review = file => { const b = fs.readFileSync(file); const info = V.inspect(new Uint8Array(b)); return { info, res: V.check(info, b.length), size: b.length }; };
const has = (res, re) => res.errors.some(e => re.test(e));

console.log("\nVideos que SI se aceptan");
{
  const r = review(make("bueno.mp4"));
  t("horizontal 720p / 30 fps / H.264 / Fast Start", r.res.errors.length === 0, r.res.errors.join(" | "));
  t("lee bien las medidas", r.info.video.w === 1280 && r.info.video.h === 720 && Math.round(r.info.video.fps) === 30 && Math.round(r.info.duration) === 6, JSON.stringify(r.info.video));
  t("sabe que no tiene audio", r.info.audio === null);
}
{
  const r = review(make("audio.mp4", { a: true, v: ["-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p", "-b:v", "1M"] }));
  t("con audio AAC y perfil Main", r.res.errors.length === 0 && r.info.audio && r.info.audio.codec === "mp4a", r.res.errors.join(" | "));
}
{
  const r = review(make("vertical.mp4", { size: "720x1280" }));
  t("vertical 720x1280", r.res.errors.length === 0 && r.info.video.w === 720 && r.info.video.h === 1280, r.res.errors.join(" | "));
}
{
  const r = review(make("girado.mp4", { size: "1280x720", pre: ["-display_rotation", "90"] }));
  t("video grabado girado (iPhone): usa la medida que se ve", r.info.video.w === 720 && r.info.video.h === 1280 && r.res.errors.length === 0, JSON.stringify(r.info.video));
}

console.log("\nVideos que NO se aceptan, y el motivo");
{
  const r = review(make("grande.mp4", { size: "1920x1080" }));
  t("1080p -> demasiado grande", has(r.res, /demasiado grande \(1920×1080\)/), r.res.errors.join(" | "));
}
{
  const r = review(make("vertical1080.mp4", { size: "1080x1920" }));
  t("vertical 1080x1920 -> demasiado grande", has(r.res, /demasiado grande/), r.res.errors.join(" | "));
}
{
  const r = review(make("fps60.mp4", { rate: 60 }));
  t("60 fps -> rechazado", has(r.res, /60 cuadros/), r.res.errors.join(" | "));
}
{
  const r = review(make("hevc.mp4", { v: ["-c:v", "libx265", "-tag:v", "hvc1", "-pix_fmt", "yuv420p", "-b:v", "1M", "-x265-params", "log-level=none"] }));
  t("HEVC (iPhone 'alta eficiencia') -> rechazado y explica el ajuste", has(r.res, /HEVC/) && has(r.res, /Más compatible/), r.res.errors.join(" | "));
}
{
  const r = review(make("high10.mp4", { v: ["-c:v", "libx264", "-profile:v", "high10", "-pix_fmt", "yuv420p10le", "-b:v", "1M"] }));
  t("H.264 de 10 bits -> rechazado", has(r.res, /perfil de H\.264/), r.res.errors.join(" | "));
}
{
  const r = review(make("sinfast.mp4", { post: [] }));
  t("sin Fast Start -> rechazado", has(r.res, /Fast Start/) && r.info.faststart === false, r.res.errors.join(" | "));
}
{
  const r = review(make("corto.mp4", { secs: 1 }));
  t("1 s -> muy corto", has(r.res, /mínimo 2 s/), r.res.errors.join(" | "));
}
{
  const r = review(make("largo.mp4", { secs: 40, v: ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-b:v", "200k"] }));
  t("40 s -> muy largo", has(r.res, /máximo es 30 s/), r.res.errors.join(" | "));
}
{
  const r = review(make("pesado.mp4", { v: ["-vf", "noise=alls=80:allf=t", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-b:v", "9M"] }));
  t("tasa de datos alta -> rechazado", has(r.res, /tasa de datos/), r.res.errors.join(" | ") + " (" + (r.size / 1e6).toFixed(1) + " MB)");
}
{
  const r = review(make("fragmentado.mp4", { post: ["-movflags", "+frag_keyframe+empty_moov+default_base_moof"] }));
  t("MP4 fragmentado -> rechazado sin disparates de duracion", has(r.res, /fragmentado/) && r.res.errors.length === 1, r.res.errors.join(" | "));
}
{
  const r = review(make("clip.mov", { fmt: ["-f", "mov"] }));
  t("QuickTime .mov -> rechazado", has(r.res, /QuickTime/), r.res.errors.join(" | "));
}
{
  const r = review(make("audio-ac3.mp4", { a: "ac3", post: ["-movflags", "+faststart", "-strict", "-2"] }));
  t("audio que no es AAC -> rechazado", has(r.res, /AAC/), r.res.errors.join(" | ") + " / " + JSON.stringify(r.info.audio));
}

console.log("\nArchivos que no son un MP4");
{
  const txt = path.join(dir, "falso.mp4");
  fs.writeFileSync(txt, "esto no es un video, solo texto".repeat(40));
  const r = review(txt);
  t("texto con extension .mp4 -> no es MP4", r.info.ok === false && has(r.res, /no es un MP4 válido/), JSON.stringify(r.res.errors));
  const good = fs.readFileSync(path.join(dir, "bueno.mp4"));
  const cut = path.join(dir, "cortado.mp4");
  fs.writeFileSync(cut, good.subarray(0, 4000));
  const r2 = review(cut);
  t("archivo cortado a la mitad -> aviso de dañado", r2.info.ok === false, JSON.stringify(r2.info));
  const empty = V.inspect(new Uint8Array(0));
  t("archivo vacío no rompe nada", empty.ok === false);
  const huge = V.check(null, V.RULES.maxBytes + 1);
  t("más de 10 MB -> rechazo por peso aunque no se abra", huge.errors.length === 1 && /Pesa 10,0 MB|Pesa 10/.test(huge.errors[0]), huge.errors.join(" | "));
}

console.log("\nPeso");
{
  const r = V.check({ ok: true, brand: "isom", faststart: true, fragmented: false, duration: 20, video: { codec: "avc1", profile: 100, w: 1280, h: 720, fps: 30 }, audio: null }, 6 * 1024 * 1024);
  t("6 MB: pasa pero avisa que lo ideal es menos de 5", r.errors.length === 0 && r.warnings.some(w => /menos de 5 MB/.test(w)), JSON.stringify(r));
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n${fail} falla(s)` : "\nTodo bien");
process.exit(fail ? 1 : 0);
