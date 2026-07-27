#!/usr/bin/env node
/**
 * Builds the Frontier News static site into dist/ for GitHub Pages.
 * Generates localized HTML, sitemap, robots.txt, and 404 page.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");

/**
 * Loads key=value pairs from .env into process.env when unset.
 * @returns {void}
 */
function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

const SITE_URL = "https://frontiernews.tech";
const HYPERJUMP_URL = "https://hyperjump.tech";
const API_URL =
  process.env.NEXT_PUBLIC_FRONTIERNOTES_API_URL ||
  process.env.FRONTIERNOTES_API_URL ||
  "https://app.frontiernews.tech";
const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
  process.env.TURNSTILE_SITE_KEY ||
  "";

/**
 * Where "Latest news" (and related digest CTAs) point.
 * TEMPORARY: live archive. To use the local static /digests/ again, set to "".
 * Override at build time with LATEST_NEWS_URL.
 */
const LATEST_NEWS_URL =
  process.env.LATEST_NEWS_URL !== undefined
    ? process.env.LATEST_NEWS_URL
    : "https://app.frontiernews.tech/digest";
/** Digest languages accepted by the subscribe API (matches Hyperjump). */
const DIGEST_LOCALES = [
  { code: "en", name: "English" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "de", name: "Deutsch" },
  { code: "su", name: "Basa Sunda" },
];

/** @type {{ code: string, name: string, dir: "ltr"|"rtl", default?: boolean }[]} */
const LOCALES = [
  { code: "en", name: "English", dir: "ltr", default: true },
  { code: "id", name: "Bahasa Indonesia", dir: "ltr" },
  { code: "de", name: "Deutsch", dir: "ltr" },
  { code: "it", name: "Italiano", dir: "ltr" },
  { code: "fr", name: "Français", dir: "ltr" },
  { code: "ar", name: "العربية", dir: "rtl" },
  { code: "ja", name: "日本語", dir: "ltr" },
  { code: "su", name: "Basa Sunda", dir: "ltr" },
];

/**
 * Escapes HTML special characters.
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Escapes text and turns emphasis markers into inline HTML.
 * `**phrase**` → highlighter `<mark>`; `__phrase__` → editorial `<em class="inline-promise">`.
 * @param {string} value
 * @returns {string}
 */
function formatInlineEmphasis(value) {
  const parts = String(value).split(/(\*\*[^*]+\*\*|__[^_]+__)/g);
  return parts
    .map((part) => {
      const mark = part.match(/^\*\*([^*]+)\*\*$/);
      if (mark) return `<mark>${escapeHtml(mark[1])}</mark>`;
      const promise = part.match(/^__([^_]+)__$/);
      if (promise)
        return `<em class="inline-promise">${escapeHtml(promise[1])}</em>`;
      return escapeHtml(part);
    })
    .join("");
}

/**
 * Reads and parses a JSON file.
 * @param {string} filePath
 * @returns {any}
 */
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * Ensures a directory exists.
 * @param {string} dir
 * @returns {void}
 */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Writes a UTF-8 text file, creating parent directories.
 * @param {string} filePath
 * @param {string} contents
 * @returns {void}
 */
function writeFile(filePath, contents) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, contents);
}

/**
 * Recursively copies a directory.
 * @param {string} src
 * @param {string} dest
 * @returns {void}
 */
function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

/**
 * Locale path prefix. English default lives at site root for cleaner URLs.
 * @param {string} locale
 * @returns {string}
 */
function localePrefix(locale) {
  return locale === "en" ? "" : `/${locale}`;
}

/**
 * Absolute site URL for a path.
 * @param {string} locale
 * @param {string} pathname
 * @returns {string}
 */
function absoluteUrl(locale, pathname = "/") {
  const prefix = localePrefix(locale);
  const clean = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (clean === "/") return `${SITE_URL}${prefix}/`;
  return `${SITE_URL}${prefix}${clean}`;
}

/**
 * Relative href from a locale page.
 * @param {string} locale
 * @param {string} pathname
 * @returns {string}
 */
function href(locale, pathname = "/") {
  const prefix = localePrefix(locale);
  const clean = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (clean === "/") return `${prefix}/` || "/";
  return `${prefix}${clean}`;
}

/**
 * Href for Latest news / digest archive links.
 * @param {string} locale
 * @returns {string}
 */
function latestNewsHref(locale) {
  return LATEST_NEWS_URL || href(locale, "/digests/");
}

/**
 * Extra attributes when Latest news points off-site.
 * @returns {string}
 */
function latestNewsExternalAttrs() {
  return LATEST_NEWS_URL ? ' target="_blank" rel="noopener noreferrer"' : "";
}

/**
 * Builds hreflang link tags for a logical page across locales.
 * @param {(locale: string) => string} pathForLocale
 * @returns {string}
 */
function hreflangTags(pathForLocale) {
  const tags = LOCALES.map((locale) => {
    const url = `${SITE_URL}${pathForLocale(locale.code)}`;
    return `<link rel="alternate" hreflang="${locale.code}" href="${url}">`;
  });
  tags.push(
    `<link rel="alternate" hreflang="x-default" href="${SITE_URL}${pathForLocale("en")}">`,
  );
  return tags.join("\n    ");
}

/**
 * Formats an ISO date for display.
 * @param {string} iso
 * @param {string} locale
 * @returns {string}
 */
function formatDate(iso, locale) {
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(`${iso}T12:00:00Z`));
  } catch {
    return iso;
  }
}

/**
 * Resolves article localized fields (falls back to English).
 * @param {any} article
 * @param {string} locale
 * @returns {{ title: string, description: string, summary: string, body: string[] }}
 */
function articleCopy(article, locale) {
  return article[locale] || article.en;
}

/**
 * Resolves topic localized fields.
 * @param {any} topic
 * @param {string} locale
 * @returns {{ name: string, description: string }}
 */
function topicCopy(topic, locale) {
  return topic[locale] || topic.en;
}

/**
 * Language select map for the current page type.
 * @param {(locale: string) => string} pathForLocale
 * @returns {string}
 */
function langMapAttr(pathForLocale) {
  const map = Object.fromEntries(
    LOCALES.map((locale) => [locale.code, pathForLocale(locale.code)]),
  );
  return escapeHtml(JSON.stringify(map));
}

/**
 * Renders shared head tags.
 * @param {object} options
 * @returns {string}
 */
function renderHead(options) {
  const {
    locale,
    title,
    description,
    canonical,
    hreflang,
    ogType = "website",
    jsonLd = [],
  } = options;

  return `<meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta name="robots" content="index,follow">
    <link rel="canonical" href="${canonical}">
    ${hreflang}
    <meta property="og:type" content="${ogType}">
    <meta property="og:site_name" content="Frontier News">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:locale" content="${escapeHtml(options.ogLocale || "en_US")}">
    <meta property="og:image" content="${SITE_URL}/assets/og-cover.png">
    <meta property="og:image:type" content="image/png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="Frontier News — curated tech news and AI summaries">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${SITE_URL}/assets/og-cover.png">
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/styles.css">
    ${jsonLd.map((data) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`).join("\n    ")}`;
}

/**
 * Renders site header.
 * @param {object} options
 * @returns {string}
 */
/**
 * Hyperjump Technology brand mark (descending diagonal of rounded squares).
 * @param {number} [size=22]
 * @returns {string}
 */
function hyperjumpMark(size = 22) {
  return `<svg class="brand-mark-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" role="img" aria-hidden="true">
  <rect x="5.8" y="1.6" width="3.6" height="3.6" rx="1" fill="#3975F4"></rect>
  <rect x="10.0" y="1.6" width="3.6" height="3.6" rx="1" fill="#3975F4"></rect>
  <rect x="10.0" y="5.8" width="3.6" height="3.6" rx="1" fill="#3975F4"></rect>
  <rect x="14.2" y="5.8" width="3.6" height="3.6" rx="1" fill="#41A8FB"></rect>
  <rect x="14.2" y="10.0" width="3.6" height="3.6" rx="1" fill="#41A8FB"></rect>
  <rect x="18.4" y="10.0" width="3.6" height="3.6" rx="1" fill="#3AD6FC"></rect>
  <rect x="18.4" y="14.2" width="3.6" height="3.6" rx="1" fill="#3AD6FC"></rect>
  <rect x="22.6" y="14.2" width="3.6" height="3.6" rx="1" fill="#FFD939"></rect>
  <rect x="14.2" y="18.4" width="3.6" height="3.6" rx="1" fill="#41A8FB"></rect>
  <rect x="18.4" y="18.4" width="3.6" height="3.6" rx="1" fill="#3AD6FC"></rect>
  <rect x="10.0" y="22.6" width="3.6" height="3.6" rx="1" fill="#3975F4"></rect>
  <rect x="14.2" y="22.6" width="3.6" height="3.6" rx="1" fill="#41A8FB"></rect>
  <rect x="5.8" y="26.8" width="3.6" height="3.6" rx="1" fill="#3975F4"></rect>
  <rect x="10.0" y="26.8" width="3.6" height="3.6" rx="1" fill="#3975F4"></rect>
</svg>`;
}

/**
 * Decorative hero illustration: long videos compress into a short digest.
 * Drawn as a large atmospheric plane for the full-bleed hero composition.
 * @returns {string}
 */
function heroIllustration() {
  return `<svg class="hero-illustration" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 420" role="img" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="hero-flow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#8b2a2a" stop-opacity="0.08"/>
      <stop offset="40%" stop-color="#8b2a2a" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#8b2a2a" stop-opacity="0.1"/>
    </linearGradient>
    <linearGradient id="hero-paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f7f3ec"/>
    </linearGradient>
    <filter id="hero-soft" x="-8%" y="-8%" width="116%" height="116%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#1a1a1a" flood-opacity="0.07"/>
    </filter>
  </defs>

  <ellipse class="hero-illu-bloom" cx="300" cy="210" rx="210" ry="160" fill="#8b2a2a" opacity="0.045"/>

  <!-- Stacked long videos -->
  <g class="hero-illu-videos" filter="url(#hero-soft)">
    <rect x="36" y="96" width="198" height="128" rx="7" fill="#ffffff" stroke="#e4e0d8" stroke-width="1.5"/>
    <rect x="48" y="112" width="198" height="128" rx="7" fill="#ffffff" stroke="#e4e0d8" stroke-width="1.5"/>
    <g class="hero-illu-video-front">
      <rect x="60" y="128" width="198" height="128" rx="7" fill="url(#hero-paper)" stroke="#1a1a1a" stroke-width="1.75"/>
      <rect x="60" y="128" width="198" height="10" rx="7" fill="#efe8df"/>
      <circle class="hero-illu-play" cx="159" cy="192" r="26" fill="#f3ebe9" stroke="#8b2a2a" stroke-width="1.5"/>
      <path d="M152 178 L172 192 L152 206 Z" fill="#8b2a2a"/>
      <rect x="76" y="232" width="166" height="5" rx="2.5" fill="#e4e0d8"/>
      <rect class="hero-illu-scrub" x="76" y="232" width="128" height="5" rx="2.5" fill="#8b2a2a"/>
      <circle cx="204" cy="234.5" r="5" fill="#1a1a1a"/>
    </g>
  </g>
  <text class="hero-illu-label" x="159" y="84" text-anchor="middle" fill="#8b2a2a" font-family="Courier New, Courier, monospace" font-size="12" font-weight="700" letter-spacing="0.1em">10 MINS WATCH</text>

  <!-- Compression stream -->
  <g class="hero-illu-flow" fill="none" stroke="url(#hero-flow)" stroke-width="2.4" stroke-linecap="round">
    <path class="hero-illu-stream" d="M268 168 C302 168, 302 152, 336 152"/>
    <path class="hero-illu-stream" d="M268 192 C308 192, 308 192, 336 192"/>
    <path class="hero-illu-stream" d="M268 216 C302 216, 302 232, 336 232"/>
  </g>
  <path class="hero-illu-arrow" d="M326 184 L346 192 L326 200" fill="none" stroke="#8b2a2a" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Concise digest -->
  <g class="hero-illu-digest" filter="url(#hero-soft)">
    <rect x="348" y="108" width="138" height="172" rx="5" fill="url(#hero-paper)" stroke="#1a1a1a" stroke-width="1.75"/>
    <rect x="348" y="108" width="138" height="22" rx="5" fill="#8b2a2a"/>
    <rect x="348" y="124" width="138" height="6" fill="#8b2a2a"/>
    <text x="417" y="124" text-anchor="middle" fill="#ffffff" font-family="Courier New, Courier, monospace" font-size="9" font-weight="700" letter-spacing="0.12em">DIGEST</text>
    <rect x="368" y="152" width="7" height="7" rx="1.5" fill="#3975F4"/>
    <rect x="368" y="176" width="7" height="7" rx="1.5" fill="#41A8FB"/>
    <rect x="368" y="200" width="7" height="7" rx="1.5" fill="#3AD6FC"/>
    <g class="hero-illu-lines" stroke="#1a1a1a" stroke-width="2.1" stroke-linecap="round">
      <line x1="384" y1="155.5" x2="462" y2="155.5"/>
      <line x1="384" y1="179.5" x2="448" y2="179.5" stroke="#6b6b6b"/>
      <line x1="384" y1="203.5" x2="456" y2="203.5" stroke="#6b6b6b"/>
      <line x1="368" y1="232" x2="430" y2="232" stroke="#6b6b6b"/>
      <line x1="368" y1="252" x2="450" y2="252" stroke="#6b6b6b"/>
    </g>
  </g>
  <text class="hero-illu-label hero-illu-label-ok" x="417" y="84" text-anchor="middle" fill="#3f7a3a" font-family="Courier New, Courier, monospace" font-size="12" font-weight="700" letter-spacing="0.1em">1 MIN READ</text>
</svg>`;
}

/**
 * Decorative process-step illustrations for the how-it-works section.
 * Same editorial signal-report language as the hero (paper, ink, oxblood).
 * @param {number} index Zero-based step index (0 monitor, 1 analyze, 2 digest)
 * @returns {string}
 */
function processIllustration(index) {
  const illustrations = [
    // Monitor selected channels — radar sweep over a channel stack
    `<svg class="step-illustration" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140" role="img" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="step-paper-a" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f7f3ec"/>
    </linearGradient>
  </defs>
  <ellipse cx="168" cy="72" rx="58" ry="46" fill="#8b2a2a" opacity="0.04"/>
  <g class="step-illu-channels">
    <rect x="28" y="34" width="92" height="58" rx="5" fill="#ffffff" stroke="#e4e0d8" stroke-width="1.25"/>
    <rect x="36" y="42" width="92" height="58" rx="5" fill="#ffffff" stroke="#e4e0d8" stroke-width="1.25"/>
    <g>
      <rect x="44" y="50" width="92" height="58" rx="5" fill="url(#step-paper-a)" stroke="#1a1a1a" stroke-width="1.5"/>
      <rect x="44" y="50" width="92" height="8" rx="5" fill="#efe8df"/>
      <circle cx="72" cy="82" r="11" fill="#f3ebe9" stroke="#8b2a2a" stroke-width="1.25"/>
      <path d="M69 76 L78 82 L69 88 Z" fill="#8b2a2a"/>
      <rect x="92" y="72" width="34" height="4" rx="2" fill="#e4e0d8"/>
      <rect x="92" y="82" width="26" height="4" rx="2" fill="#e4e0d8"/>
    </g>
  </g>
  <g class="step-illu-radar" fill="none" stroke="#8b2a2a" stroke-linecap="round">
    <circle class="step-illu-ring" cx="168" cy="72" r="18" stroke-width="1.25" opacity="0.35"/>
    <circle class="step-illu-ring step-illu-ring-mid" cx="168" cy="72" r="28" stroke-width="1.15" opacity="0.22"/>
    <circle class="step-illu-ring step-illu-ring-outer" cx="168" cy="72" r="38" stroke-width="1" opacity="0.12"/>
    <path class="step-illu-sweep" d="M168 72 L196 54" stroke-width="1.75"/>
    <circle cx="168" cy="72" r="4" fill="#8b2a2a" stroke="none"/>
  </g>
  <text x="120" y="128" text-anchor="middle" fill="#8b2a2a" font-family="Courier New, Courier, monospace" font-size="9" font-weight="700" letter-spacing="0.12em">MONITORING</text>
</svg>`,

    // Analyze the content — transcript lines condensed into takeaways
    `<svg class="step-illustration" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140" role="img" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="step-paper-b" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f7f3ec"/>
    </linearGradient>
    <linearGradient id="step-scan" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#8b2a2a" stop-opacity="0"/>
      <stop offset="50%" stop-color="#8b2a2a" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#8b2a2a" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <ellipse cx="120" cy="68" rx="88" ry="42" fill="#0a0678" opacity="0.035"/>
  <g>
    <rect x="28" y="28" width="100" height="84" rx="5" fill="url(#step-paper-b)" stroke="#1a1a1a" stroke-width="1.5"/>
    <text x="40" y="46" fill="#8b2a2a" font-family="Courier New, Courier, monospace" font-size="8" font-weight="700" letter-spacing="0.08em">TRANSCRIPT</text>
    <g class="step-illu-transcript" stroke="#6b6b6b" stroke-width="2" stroke-linecap="round">
      <line x1="40" y1="58" x2="112" y2="58"/>
      <line x1="40" y1="70" x2="104" y2="70"/>
      <line x1="40" y1="82" x2="110" y2="82"/>
      <line x1="40" y1="94" x2="96" y2="94"/>
    </g>
    <rect class="step-illu-scan" x="32" y="52" width="92" height="10" fill="url(#step-scan)" opacity="0.55"/>
  </g>
  <g class="step-illu-flow" fill="none" stroke="#8b2a2a" stroke-width="1.6" stroke-linecap="round" opacity="0.55">
    <path class="step-illu-stream" d="M136 58 C148 58, 148 48, 160 48"/>
    <path class="step-illu-stream" d="M136 72 C150 72, 150 72, 160 72"/>
    <path class="step-illu-stream" d="M136 86 C148 86, 148 96, 160 96"/>
  </g>
  <g class="step-illu-takeaways">
    <rect x="164" y="36" width="48" height="18" rx="3" fill="#f3ebe9" stroke="#8b2a2a" stroke-width="1.25"/>
    <rect x="170" y="43" width="28" height="4" rx="2" fill="#8b2a2a"/>
    <rect x="164" y="62" width="48" height="18" rx="3" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.25"/>
    <rect x="170" y="69" width="22" height="4" rx="2" fill="#1a1a1a"/>
    <rect x="164" y="88" width="48" height="18" rx="3" fill="#ffffff" stroke="#e4e0d8" stroke-width="1.25"/>
    <rect x="170" y="95" width="26" height="4" rx="2" fill="#6b6b6b"/>
  </g>
  <text x="120" y="128" text-anchor="middle" fill="#8b2a2a" font-family="Courier New, Courier, monospace" font-size="9" font-weight="700" letter-spacing="0.12em">EXTRACTING</text>
</svg>`,

    // Concise digest — digest card with delivery channels
    `<svg class="step-illustration" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140" role="img" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="step-paper-c" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f7f3ec"/>
    </linearGradient>
  </defs>
  <ellipse cx="120" cy="64" rx="78" ry="48" fill="#3f7a3a" opacity="0.05"/>
  <g class="step-illu-digest-card">
    <rect x="58" y="22" width="124" height="78" rx="5" fill="url(#step-paper-c)" stroke="#1a1a1a" stroke-width="1.5"/>
    <rect x="58" y="22" width="124" height="16" rx="5" fill="#8b2a2a"/>
    <rect x="58" y="32" width="124" height="6" fill="#8b2a2a"/>
    <text x="120" y="35" text-anchor="middle" fill="#ffffff" font-family="Courier New, Courier, monospace" font-size="8" font-weight="700" letter-spacing="0.12em">DIGEST</text>
    <rect x="72" y="50" width="6" height="6" rx="1.5" fill="#3975F4"/>
    <rect x="72" y="64" width="6" height="6" rx="1.5" fill="#41A8FB"/>
    <rect x="72" y="78" width="6" height="6" rx="1.5" fill="#3AD6FC"/>
    <g stroke="#1a1a1a" stroke-width="1.85" stroke-linecap="round">
      <line x1="86" y1="53" x2="162" y2="53"/>
      <line x1="86" y1="67" x2="148" y2="67" stroke="#6b6b6b"/>
      <line x1="86" y1="81" x2="156" y2="81" stroke="#6b6b6b"/>
    </g>
  </g>
  <g class="step-illu-channels-out" font-family="Courier New, Courier, monospace" font-size="7.5" font-weight="700" letter-spacing="0.06em">
    <g class="step-illu-chip">
      <rect x="36" y="108" width="48" height="16" rx="3" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.15"/>
      <text x="60" y="119" text-anchor="middle" fill="#1a1a1a">WEB</text>
    </g>
    <g class="step-illu-chip step-illu-chip-mid">
      <rect x="96" y="108" width="48" height="16" rx="3" fill="#f3ebe9" stroke="#8b2a2a" stroke-width="1.15"/>
      <text x="120" y="119" text-anchor="middle" fill="#8b2a2a">EMAIL</text>
    </g>
    <g class="step-illu-chip">
      <rect x="156" y="108" width="48" height="16" rx="3" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.15"/>
      <text x="180" y="119" text-anchor="middle" fill="#1a1a1a">TEAMS</text>
    </g>
  </g>
</svg>`,
  ];

  return illustrations[index] ?? "";
}

function renderHeader({ t, locale, pathForLocale, active }) {
  const home = href(locale, "/");
  return `<header class="site-header" data-site-header>
      <div class="nav-island">
        <a class="brand" href="${home}" aria-label="Frontier News home">
          ${hyperjumpMark(26)}
          <span class="brand-text">
            <span class="brand-name">${escapeHtml(t.brand)}</span>
            <span class="brand-byline">${escapeHtml(t.brandByline)}</span>
          </span>
        </a>
        <nav aria-label="Primary">
          <ul class="nav-links">
            <li><a href="${latestNewsHref(locale)}"${latestNewsExternalAttrs()}${!LATEST_NEWS_URL && active === "latest" ? ' aria-current="page"' : ""}>${escapeHtml(t.nav.latest)}</a></li>
            <li><a href="${href(locale, "/#topics")}" ${active === "topics" ? 'aria-current="page"' : ""}>${escapeHtml(t.nav.topics)}</a></li>
            <li><a href="${href(locale, "/#how-it-works")}" ${active === "how" ? 'aria-current="page"' : ""}>${escapeHtml(t.nav.how)}</a></li>
            <li><a href="${href(locale, "/about/")}">${escapeHtml(t.nav.about)}</a></li>
          </ul>
        </nav>
        <div class="nav-actions">
          <label class="visually-hidden" for="lang-${locale}-${active || "page"}">${escapeHtml(t.nav.language)}</label>
          <select id="lang-${locale}-${active || "page"}" class="lang-select" data-lang-select data-lang-map='${langMapAttr(pathForLocale)}' aria-label="${escapeHtml(t.nav.language)}">
            ${LOCALES.map((item) => `<option value="${item.code}" ${item.code === locale ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
          </select>
          <a class="btn btn-primary btn-sm" href="${href(locale, "/#subscribe")}">${escapeHtml(t.nav.subscribe)}</a>
          <button class="menu-toggle" type="button" data-menu-toggle aria-expanded="false" aria-controls="mobile-nav" aria-label="${escapeHtml(t.nav.menuOpen)}">
            <span class="menu-toggle-bars" aria-hidden="true"><span></span><span></span><span></span></span>
          </button>
        </div>
      </div>
      <div class="mobile-nav" id="mobile-nav" data-mobile-nav>
        <ul>
          <li><a href="${latestNewsHref(locale)}"${latestNewsExternalAttrs()}>${escapeHtml(t.nav.latest)}</a></li>
          <li><a href="${href(locale, "/#topics")}">${escapeHtml(t.nav.topics)}</a></li>
          <li><a href="${href(locale, "/#how-it-works")}">${escapeHtml(t.nav.how)}</a></li>
          <li><a href="${href(locale, "/about/")}">${escapeHtml(t.nav.about)}</a></li>
          <li><a href="${href(locale, "/#subscribe")}">${escapeHtml(t.nav.subscribe)}</a></li>
        </ul>
      </div>
    </header>`;
}

/**
 * Renders site footer.
 * @param {object} options
 * @returns {string}
 */
function renderFooter({ t, locale }) {
  return `<footer class="site-footer">
      <div class="wrap footer-grid">
        <div>
          <p class="footer-brand">${hyperjumpMark(22)} ${escapeHtml(t.brand)}</p>
          <p class="footer-publisher">${escapeHtml(t.footer.publisher)}</p>
        </div>
        <div class="footer-links">
          <div>
            <h3>${escapeHtml(t.nav.latest)}</h3>
            <ul>
              <li><a href="${latestNewsHref(locale)}"${latestNewsExternalAttrs()}>${escapeHtml(t.footer.latest)}</a></li>
              <li><a href="${latestNewsHref(locale)}"${latestNewsExternalAttrs()}>${escapeHtml(t.footer.digests)}</a></li>
              <li><a href="${href(locale, "/#topics")}">${escapeHtml(t.footer.topics)}</a></li>
            </ul>
          </div>
          <div>
            <h3>${escapeHtml(t.nav.about)}</h3>
            <ul>
              <li><a href="${href(locale, "/about/")}">${escapeHtml(t.footer.about)}</a></li>
              <li><a href="${HYPERJUMP_URL}" rel="noopener noreferrer">Hyperjump</a></li>
              <li><a href="${href(locale, "/contact/")}">${escapeHtml(t.footer.contact)}</a></li>
            </ul>
          </div>
          <div>
            <h3>Legal</h3>
            <ul>
              <li><a href="${href(locale, "/privacy/")}">${escapeHtml(t.footer.privacy)}</a></li>
              <li><a href="${href(locale, "/terms/")}">${escapeHtml(t.footer.terms)}</a></li>
              <li><a href="${href(locale, "/preferences/")}">${escapeHtml(t.footer.preferences)}</a></li>
            </ul>
          </div>
        </div>
      </div>
      <div class="wrap footer-bottom">
        <p>© ${new Date().getFullYear()} Hyperjump Technology. ${escapeHtml(t.footer.rights)}</p>
      </div>
    </footer>`;
}

/**
 * Resolves a digest language supported by the subscribe API.
 * @param {string} locale
 * @returns {string}
 */
function digestLanguage(locale) {
  return DIGEST_LOCALES.some((item) => item.code === locale) ? locale : "en";
}

/**
 * Renders newsletter form markup (email + language + Turnstile), matching Hyperjump.
 * @param {object} t
 * @param {string} locale
 * @param {string} [idPrefix]
 * @returns {string}
 */
function renderNewsletterForm(t, locale, idPrefix = "nl") {
  const selected = digestLanguage(locale);
  return `<div class="form-shell" data-reveal>
        <form class="form-panel" data-newsletter-form
          data-error-email="${escapeHtml(t.newsletter.errorEmail)}"
          data-error="${escapeHtml(t.newsletter.error)}"
          data-success="${escapeHtml(t.newsletter.success)}"
          data-captcha-error="${escapeHtml(t.newsletter.captchaError)}"
          data-submitting="${escapeHtml(t.newsletter.submitting)}"
          novalidate>
          <div class="newsletter-lang">
            <label for="${idPrefix}-language">${escapeHtml(t.newsletter.language)}</label>
            <select id="${idPrefix}-language" name="language">
              ${DIGEST_LOCALES.map((item) => `<option value="${item.code}" ${item.code === selected ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
            </select>
          </div>
          <div class="newsletter-row">
            <label class="visually-hidden" for="${idPrefix}-email">${escapeHtml(t.newsletter.email)}</label>
            <input id="${idPrefix}-email" name="email" type="email" autocomplete="email" required placeholder="${escapeHtml(t.newsletter.emailPlaceholder)}">
            <button class="btn btn-primary newsletter-submit" type="submit" disabled>${escapeHtml(t.newsletter.submit)}</button>
          </div>
          <div class="turnstile-wrap" data-turnstile></div>
          <p class="form-trust">${escapeHtml(t.newsletter.trust)}</p>
          <p class="form-message" data-form-message role="status" aria-live="polite"></p>
        </form>
      </div>`;
}

/**
 * Renders a full HTML document shell.
 * @param {object} options
 * @returns {string}
 */
function layout(options) {
  const { localeMeta, t, locale, head, body, pathForLocale, active } = options;
  const dir = localeMeta.dir;
  return `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
  <head>
    ${head}
    <script>document.documentElement.classList.add("js");window.__FN_CONFIG__=${JSON.stringify(
      {
        apiUrl: API_URL,
        turnstileSiteKey: TURNSTILE_SITE_KEY,
      },
    )};</script>
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    ${renderHeader({ t, locale, pathForLocale, active })}
    <main id="main">
      ${body}
    </main>
    ${renderFooter({ t, locale })}
    <script src="/assets/site.js" defer></script>
  </body>
</html>
`;
}

/**
 * Builds organization + website structured data.
 * @param {string} locale
 * @param {any} t
 * @returns {object[]}
 */
function baseJsonLd(locale, t) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Hyperjump Technology",
      url: HYPERJUMP_URL,
      logo: `${SITE_URL}/assets/favicon.svg`,
      sameAs: [HYPERJUMP_URL],
      publishingPrinciples: absoluteUrl(locale, "/about/"),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Frontier News",
      alternateName: "Frontier News by Hyperjump",
      url: absoluteUrl(locale, "/"),
      description: t.meta.description,
      inLanguage: locale,
      publisher: {
        "@type": "Organization",
        name: "Hyperjump Technology",
        url: HYPERJUMP_URL,
      },
      potentialAction: {
        "@type": "SubscribeAction",
        target: absoluteUrl(locale, "/#subscribe"),
        name: t.nav.subscribe,
      },
    },
  ];
}

/**
 * Renders homepage for a locale.
 * @param {object} ctx
 * @returns {string}
 */
function renderHome(ctx) {
  const { locale, t, articles, topics, localeMeta } = ctx;
  const pathForLocale = (code) => `${localePrefix(code)}/`;
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: t.faq.items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  const topicLinks = topics
    .map((topic) => {
      const copy = topicCopy(topic, locale);
      const count = articles.filter(
        (article) => article.topic === topic.slug,
      ).length;
      return `<a class="topic-link" href="${href(locale, `/topics/${topic.slug}/`)}" data-reveal>
            <strong>${escapeHtml(copy.name)}</strong>
            <span>${count} ${escapeHtml(t.topics.articlesInTopic)}</span>
          </a>`;
    })
    .join("\n");

  const body = `
      <section class="hero" data-hero>
        <div class="hero-atmosphere" aria-hidden="true"></div>
        <div class="wrap hero-grid">
          <div class="hero-content">
            <p class="hero-eyebrow" data-hero-enter style="--hero-i:0">${escapeHtml(t.brandByline)} · ${escapeHtml(t.hero.kicker)}</p>
            <p class="brand-mark" data-hero-enter style="--hero-i:1">${escapeHtml(t.brand)}</p>
            <h1 data-hero-enter style="--hero-i:2">${escapeHtml(t.hero.h1)}</h1>
            <p class="hero-lead" data-hero-enter style="--hero-i:3">${formatInlineEmphasis(t.hero.lead)}</p>
            <div class="hero-ctas" data-hero-enter style="--hero-i:4">
              <a class="btn btn-primary" href="#subscribe">
                <span>${escapeHtml(t.hero.ctaPrimary)}</span>
                <span class="btn-trail" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 7h8M7.5 3.5 11 7l-3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"/>
                  </svg>
                </span>
              </a>
              <a class="btn btn-secondary" href="${latestNewsHref(locale)}"${latestNewsExternalAttrs()}>${escapeHtml(t.hero.ctaSecondary)}</a>
            </div>
            <p class="hero-support" data-hero-enter style="--hero-i:5">${escapeHtml(t.hero.support)}</p>
          </div>
          <div class="hero-visual" data-hero-enter style="--hero-i:2" aria-hidden="true">
            ${heroIllustration()}
          </div>
        </div>
      </section>

      <section class="section" id="value" aria-labelledby="value-heading">
        <div class="wrap">
          <span class="section-label">Value</span>
          <h2 id="value-heading" data-reveal>${escapeHtml(t.value.h2)}</h2>
          <p class="section-intro" data-reveal>${formatInlineEmphasis(t.value.body)}</p>
          <div class="benefit-grid">
            ${t.value.cards
              .map(
                (card, index) => `<div class="benefit-shell" data-reveal>
              <article class="benefit-card">
                <span class="benefit-index">0${index + 1}</span>
                <h3>${escapeHtml(card.h3)}</h3>
                <p>${escapeHtml(card.text)}</p>
              </article>
            </div>`,
              )
              .join("\n")}
          </div>
        </div>
      </section>

      <section class="section" id="topics" aria-labelledby="topics-heading">
        <div class="wrap">
          <span class="section-label">Topics</span>
          <h2 id="topics-heading" data-reveal>${escapeHtml(t.topics.h2)}</h2>
          <p class="section-intro" data-reveal>${escapeHtml(t.topics.intro)}</p>
          <div class="topic-grid">
            ${topicLinks}
          </div>
        </div>
      </section>

      <section class="section" id="how-it-works" aria-labelledby="how-heading">
        <div class="wrap">
          <span class="section-label">Process</span>
          <h2 id="how-heading" data-reveal>${escapeHtml(t.how.h2)}</h2>
          <ol class="steps">
            ${t.how.steps
              .map(
                (step, i) => `<li data-reveal>
              <div class="step-visual">${processIllustration(i)}</div>
              <h3>${escapeHtml(step.title)}</h3>
              <p>${escapeHtml(step.text)}</p>
            </li>`,
              )
              .join("\n")}
          </ol>
        </div>
      </section>

      <section class="section" id="subscribe" aria-labelledby="subscribe-heading">
        <div class="wrap">
          <span class="section-label">Newsletter</span>
          <h2 id="subscribe-heading" data-reveal>${escapeHtml(t.newsletter.h2)}</h2>
          <p class="section-intro" data-reveal>${escapeHtml(t.newsletter.intro)}</p>
          ${renderNewsletterForm(t, locale, "home")}
        </div>
      </section>

      <section class="section section-centered" id="audience" aria-labelledby="audience-heading">
        <div class="wrap">
          <span class="section-label">Audience</span>
          <h2 id="audience-heading" data-reveal>${escapeHtml(t.audience.h2)}</h2>
          <p class="section-intro" data-reveal>${escapeHtml(t.audience.intro)}</p>
          <ul class="audience-list">
            ${t.audience.list.map((item) => `<li data-reveal>${escapeHtml(item)}</li>`).join("\n")}
          </ul>
        </div>
      </section>

      <section class="section section-centered" id="about" aria-labelledby="about-heading">
        <div class="wrap wrap-prose">
          <span class="section-label">Publisher</span>
          <h2 id="about-heading" data-reveal>${escapeHtml(t.about.h2)}</h2>
          <p class="section-intro" data-reveal>${escapeHtml(t.about.body)}</p>
          <p class="section-actions" data-reveal>
            <a class="btn btn-secondary" href="${HYPERJUMP_URL}" rel="noopener noreferrer">${escapeHtml(t.about.link)}</a>
            <a class="btn btn-ghost" href="${href(locale, "/about/")}">${escapeHtml(t.nav.about)}</a>
          </p>
        </div>
      </section>

      <section class="section" id="faq" aria-labelledby="faq-heading">
        <div class="wrap">
          <span class="section-label">FAQ</span>
          <h2 id="faq-heading" data-reveal>${escapeHtml(t.faq.h2)}</h2>
          <div class="faq-list">
            ${t.faq.items
              .map(
                (item) => `<details class="faq-item" data-reveal>
              <summary><h3 style="margin:0;font:inherit">${escapeHtml(item.q)}</h3></summary>
              <p>${escapeHtml(item.a)}</p>
            </details>`,
              )
              .join("\n")}
          </div>
        </div>
      </section>

      <section class="final-cta" aria-labelledby="final-cta-heading">
        <div class="wrap">
          <h2 id="final-cta-heading" data-reveal>${escapeHtml(t.finalCta.h2)}</h2>
          <p data-reveal>${escapeHtml(t.finalCta.text)}</p>
          <a class="btn btn-primary" href="#subscribe" data-reveal>${escapeHtml(t.finalCta.cta)}</a>
        </div>
      </section>`;

  return layout({
    localeMeta,
    t,
    locale,
    pathForLocale,
    active: "home",
    head: renderHead({
      locale,
      title: t.meta.title,
      description: t.meta.description,
      canonical: absoluteUrl(locale, "/"),
      hreflang: hreflangTags(pathForLocale),
      ogLocale: t.meta.ogLocale,
      jsonLd: [...baseJsonLd(locale, t), faqLd],
    }),
    body,
  });
}

/**
 * Renders an article detail page.
 * @param {object} ctx
 * @returns {string}
 */
function renderArticle(ctx) {
  const { locale, t, article, topics, articles, localeMeta } = ctx;
  const copy = articleCopy(article, locale);
  const topic = topics.find((item) => item.slug === article.topic);
  const topicName = topic ? topicCopy(topic, locale).name : article.topic;
  const pathForLocale = (code) =>
    `${localePrefix(code)}/articles/${article.slug}/`;

  const related = articles
    .filter((item) => item.slug !== article.slug)
    .slice(0, 3)
    .map((item) => {
      const itemCopy = articleCopy(item, locale);
      return `<li style="margin-bottom:0.75rem"><a href="${href(locale, `/articles/${item.slug}/`)}">${escapeHtml(itemCopy.title)}</a></li>`;
    })
    .join("");

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: copy.title,
    description: copy.description,
    datePublished: article.date,
    dateModified: article.updated || article.date,
    inLanguage: locale,
    mainEntityOfPage: absoluteUrl(locale, `/articles/${article.slug}/`),
    image: `${SITE_URL}${article.image}`,
    author: {
      "@type": "Organization",
      name: "Frontier News",
    },
    publisher: {
      "@type": "Organization",
      name: "Hyperjump Technology",
      url: HYPERJUMP_URL,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/assets/favicon.svg`,
      },
    },
    isBasedOn: article.source.url,
    about: topicName,
  };

  const body = `
      <article class="wrap article-layout">
        <div>
          <div class="page-hero" style="padding-left:0;padding-right:0">
            <nav class="breadcrumb" aria-label="Breadcrumb">
              <a href="${href(locale, "/")}">${escapeHtml(t.brand)}</a>
              <span>/</span>
              <a href="${latestNewsHref(locale)}"${latestNewsExternalAttrs()}>${escapeHtml(t.footer.digests)}</a>
              <span>/</span>
              <span>${escapeHtml(copy.title)}</span>
            </nav>
            <p class="section-label">${escapeHtml(topicName)}</p>
            <h1>${escapeHtml(copy.title)}</h1>
            <p class="prose-lead">${escapeHtml(copy.summary)}</p>
            <p class="date-note">
              <span>${escapeHtml(t.latest.published)}: <time datetime="${article.date}">${escapeHtml(formatDate(article.date, locale))}</time></span>
              ·
              <span>${escapeHtml(t.latest.updated)}: <time datetime="${article.updated || article.date}">${escapeHtml(formatDate(article.updated || article.date, locale))}</time></span>
            </p>
          </div>
          <div class="story-media" style="margin-bottom:1.75rem;max-width:42rem">
            <img src="${article.image}" alt="${escapeHtml(copy.title)}" width="960" height="540">
          </div>
          <div class="article-body">
            ${copy.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n")}
            <p><a class="btn btn-secondary" href="${escapeHtml(article.source.url)}" rel="noopener noreferrer">${escapeHtml(t.article.watchSource)}<span class="btn-icon" aria-hidden="true">↗</span></a></p>
            <p><a href="${latestNewsHref(locale)}"${latestNewsExternalAttrs()}>${escapeHtml(t.article.backLatest)}</a></p>
          </div>
        </div>
        <aside class="article-aside" data-reveal>
          <h2>${escapeHtml(t.article.relatedTopic)}</h2>
          <dl>
            <div>
              <dt>${escapeHtml(t.article.relatedTopic)}</dt>
              <dd><a href="${href(locale, `/topics/${article.topic}/`)}">${escapeHtml(topicName)}</a></dd>
            </div>
            <div>
              <dt>${escapeHtml(t.latest.source)}</dt>
              <dd><a href="${escapeHtml(article.source.url)}" rel="noopener noreferrer">${escapeHtml(article.source.name)}</a></dd>
            </div>
            <div>
              <dt>${escapeHtml(t.latest.published)}</dt>
              <dd><time datetime="${article.date}">${escapeHtml(formatDate(article.date, locale))}</time></dd>
            </div>
          </dl>
          <h2 style="margin-top:1.5rem">${escapeHtml(t.article.readAlso)}</h2>
          <ul style="margin:0;padding-left:1.1rem;color:var(--ink-muted)">${related}</ul>
        </aside>
      </article>`;

  return layout({
    localeMeta,
    t,
    locale,
    pathForLocale,
    active: "article",
    head: renderHead({
      locale,
      title: `${copy.title} | Frontier News`,
      description: copy.description,
      canonical: absoluteUrl(locale, `/articles/${article.slug}/`),
      hreflang: hreflangTags(pathForLocale),
      ogType: "article",
      ogLocale: t.meta.ogLocale,
      jsonLd: [...baseJsonLd(locale, t), articleLd],
    }),
    body,
  });
}

/**
 * Renders a topic archive page.
 * @param {object} ctx
 * @returns {string}
 */
function renderTopic(ctx) {
  const { locale, t, topic, articles, localeMeta } = ctx;
  const copy = topicCopy(topic, locale);
  const pathForLocale = (code) => `${localePrefix(code)}/topics/${topic.slug}/`;
  const filtered = articles.filter((article) => article.topic === topic.slug);

  const cards = filtered.length
    ? filtered
        .map((article) => {
          const articleText = articleCopy(article, locale);
          return `<article class="story-shell" data-reveal>
            <div class="story-card">
              <div class="story-media">
                <img src="${article.image}" alt="${escapeHtml(articleText.title)}" width="640" height="360" loading="lazy">
              </div>
              <div>
                <div class="story-meta">
                  <time datetime="${article.date}">${escapeHtml(formatDate(article.date, locale))}</time>
                  <span>${escapeHtml(article.source.name)}</span>
                </div>
                <h3><a href="${href(locale, `/articles/${article.slug}/`)}" style="color:inherit;text-decoration:none">${escapeHtml(articleText.title)}</a></h3>
                <p>${escapeHtml(articleText.summary)}</p>
                <a class="story-link" href="${href(locale, `/articles/${article.slug}/`)}">${escapeHtml(t.latest.readSummary)} →</a>
              </div>
            </div>
          </article>`;
        })
        .join("\n")
    : `<p class="section-intro">${escapeHtml(t.topics.empty)}</p>`;

  const body = `
      <div class="wrap page-hero">
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <a href="${href(locale, "/")}">${escapeHtml(t.brand)}</a>
          <span>/</span>
          <a href="${href(locale, "/#topics")}">${escapeHtml(t.nav.topics)}</a>
          <span>/</span>
          <span>${escapeHtml(copy.name)}</span>
        </nav>
        <h1>${escapeHtml(copy.name)}</h1>
        <p class="prose-lead">${escapeHtml(copy.description)}</p>
      </div>
      <section class="wrap" style="padding-bottom:4rem">
        <div class="story-list">${cards}</div>
      </section>`;

  return layout({
    localeMeta,
    t,
    locale,
    pathForLocale,
    active: "topics",
    head: renderHead({
      locale,
      title: `${copy.name} | Frontier News`,
      description: copy.description,
      canonical: absoluteUrl(locale, `/topics/${topic.slug}/`),
      hreflang: hreflangTags(pathForLocale),
      ogLocale: t.meta.ogLocale,
      jsonLd: baseJsonLd(locale, t),
    }),
    body,
  });
}

/**
 * Renders digest archive page.
 * @param {object} ctx
 * @returns {string}
 */
function renderDigests(ctx) {
  const { locale, t, articles, topics, localeMeta } = ctx;
  const pathForLocale = (code) => `${localePrefix(code)}/digests/`;
  const cards = articles
    .map((article) => {
      const copy = articleCopy(article, locale);
      const topic = topics.find((item) => item.slug === article.topic);
      const topicName = topic ? topicCopy(topic, locale).name : article.topic;
      return `<article class="story-shell" data-reveal>
          <div class="story-card">
            <div>
              <div class="story-meta">
                <a class="story-topic" href="${href(locale, `/topics/${article.topic}/`)}">${escapeHtml(topicName)}</a>
                <time datetime="${article.date}">${escapeHtml(formatDate(article.date, locale))}</time>
                <span>${escapeHtml(article.source.name)}</span>
              </div>
              <h3><a href="${href(locale, `/articles/${article.slug}/`)}" style="color:inherit;text-decoration:none">${escapeHtml(copy.title)}</a></h3>
              <p>${escapeHtml(copy.summary)}</p>
              <a class="story-link" href="${href(locale, `/articles/${article.slug}/`)}">${escapeHtml(t.latest.readSummary)} →</a>
            </div>
          </div>
        </article>`;
    })
    .join("\n");

  const body = `
      <div class="wrap page-hero">
        <h1>${escapeHtml(t.digests.h1)}</h1>
        <p class="prose-lead">${escapeHtml(t.digests.intro)}</p>
      </div>
      <section class="wrap" style="padding-bottom:4rem">
        <div class="story-list">${cards}</div>
      </section>`;

  return layout({
    localeMeta,
    t,
    locale,
    pathForLocale,
    active: "latest",
    head: renderHead({
      locale,
      title: t.digests.title,
      description: t.digests.description,
      canonical: absoluteUrl(locale, "/digests/"),
      hreflang: hreflangTags(pathForLocale),
      ogLocale: t.meta.ogLocale,
      jsonLd: baseJsonLd(locale, t),
    }),
    body,
  });
}

/**
 * Renders a simple prose/legal page.
 * @param {object} ctx
 * @returns {string}
 */
function renderProsePage(ctx) {
  const { locale, t, localeMeta, pageKey, pathSegment, extraHtml = "" } = ctx;
  const page = t[pageKey];
  const pathForLocale = (code) => `${localePrefix(code)}/${pathSegment}/`;

  const sections = (page.sections || [])
    .map(
      (section) =>
        `<h2>${escapeHtml(section.h2)}</h2><p>${escapeHtml(section.p)}</p>`,
    )
    .join("\n");

  const body = `
      <div class="wrap page-hero">
        <h1>${escapeHtml(page.h1)}</h1>
        ${page.updated ? `<p class="date-note">${escapeHtml(page.updated)}</p>` : ""}
        ${page.intro ? `<p class="prose-lead">${escapeHtml(page.intro)}</p>` : ""}
        ${page.note ? `<p class="prose-lead">${escapeHtml(page.note)}</p>` : ""}
      </div>
      <div class="wrap prose-page">
        ${sections}
        ${extraHtml}
      </div>`;

  return layout({
    localeMeta,
    t,
    locale,
    pathForLocale,
    active: pathSegment,
    head: renderHead({
      locale,
      title: page.title,
      description: page.description,
      canonical: absoluteUrl(locale, `/${pathSegment}/`),
      hreflang: hreflangTags(pathForLocale),
      ogLocale: t.meta.ogLocale,
      jsonLd: baseJsonLd(locale, t),
    }),
    body,
  });
}

/**
 * Generates SVG cover art for an article.
 * @param {string} label
 * @param {string} accent
 * @returns {string}
 */
function articleSvg(label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" role="img" aria-label="${escapeHtml(label)}">
  <rect width="960" height="540" fill="#fbfaf7"/>
  <rect x="48" y="48" width="864" height="2" fill="#1a1a1a"/>
  <rect x="48" y="56" width="864" height="2" fill="#1a1a1a"/>
  <text x="64" y="120" fill="#8b2a2a" font-family="Courier New, Courier, monospace" font-size="18" font-weight="700" letter-spacing="4">SIGNAL REPORT</text>
  <text x="64" y="300" fill="#1a1a1a" font-family="Georgia, Times New Roman, serif" font-size="44" font-weight="700">${escapeHtml(label)}</text>
  <text x="64" y="350" fill="#6b6b6b" font-family="Courier New, Courier, monospace" font-size="18">Frontier News · by Hyperjump</text>
  <rect x="48" y="490" width="864" height="1" fill="#e4e0d8"/>
</svg>`;
}

/**
 * Builds sitemap.xml contents.
 * @param {string[]} urls
 * @returns {string}
 */
function renderSitemap(urls) {
  const entries = urls
    .map(
      (url) => `  <url>
    <loc>${url}</loc>
    <changefreq>daily</changefreq>
  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

/**
 * Main build entry point.
 * @returns {void}
 */
function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  ensureDir(DIST);

  const articles = readJson(path.join(ROOT, "content/articles.json"));
  const topics = readJson(path.join(ROOT, "content/topics.json"));
  /** @type {Record<string, any>} */
  const i18n = {};
  for (const locale of LOCALES) {
    i18n[locale.code] = readJson(
      path.join(ROOT, `content/i18n/${locale.code}.json`),
    );
  }

  copyDir(path.join(ROOT, "public"), DIST);

  const svgSpecs = [
    ["ai-realtime.svg", "Realtime API"],
    ["k8s-release.svg", "Kubernetes 1.33"],
    ["rust-async.svg", "Rust Async"],
    ["oidc-aws.svg", "OIDC + AWS"],
    ["zero-trust.svg", "Zero Trust"],
    ["sqlite-edge.svg", "SQLite Edge"],
  ];
  for (const [filename, label] of svgSpecs) {
    writeFile(path.join(DIST, "assets/articles", filename), articleSvg(label));
  }

  writeFile(
    path.join(DIST, "assets/favicon.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" fill="#fbfaf7"/>
  <rect x="5.8" y="1.6" width="3.6" height="3.6" rx="1" fill="#3975F4"></rect>
  <rect x="10.0" y="1.6" width="3.6" height="3.6" rx="1" fill="#3975F4"></rect>
  <rect x="10.0" y="5.8" width="3.6" height="3.6" rx="1" fill="#3975F4"></rect>
  <rect x="14.2" y="5.8" width="3.6" height="3.6" rx="1" fill="#41A8FB"></rect>
  <rect x="14.2" y="10.0" width="3.6" height="3.6" rx="1" fill="#41A8FB"></rect>
  <rect x="18.4" y="10.0" width="3.6" height="3.6" rx="1" fill="#3AD6FC"></rect>
  <rect x="18.4" y="14.2" width="3.6" height="3.6" rx="1" fill="#3AD6FC"></rect>
  <rect x="22.6" y="14.2" width="3.6" height="3.6" rx="1" fill="#FFD939"></rect>
  <rect x="14.2" y="18.4" width="3.6" height="3.6" rx="1" fill="#41A8FB"></rect>
  <rect x="18.4" y="18.4" width="3.6" height="3.6" rx="1" fill="#3AD6FC"></rect>
  <rect x="10.0" y="22.6" width="3.6" height="3.6" rx="1" fill="#3975F4"></rect>
  <rect x="14.2" y="22.6" width="3.6" height="3.6" rx="1" fill="#41A8FB"></rect>
  <rect x="5.8" y="26.8" width="3.6" height="3.6" rx="1" fill="#3975F4"></rect>
  <rect x="10.0" y="26.8" width="3.6" height="3.6" rx="1" fill="#3975F4"></rect>
</svg>`,
  );

  writeFile(
    path.join(DIST, "assets/styles.css"),
    fs.readFileSync(path.join(ROOT, "public/assets/styles.css"), "utf8") +
      `\n.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}\n`,
  );

  /** @type {string[]} */
  const sitemapUrls = [];

  for (const localeMeta of LOCALES) {
    const locale = localeMeta.code;
    const t = i18n[locale];
    const outRoot = locale === "en" ? DIST : path.join(DIST, locale);

    writeFile(
      path.join(outRoot, "index.html"),
      renderHome({ locale, t, articles, topics, localeMeta }),
    );
    sitemapUrls.push(absoluteUrl(locale, "/"));

    writeFile(
      path.join(outRoot, "digests/index.html"),
      renderDigests({ locale, t, articles, topics, localeMeta }),
    );
    sitemapUrls.push(absoluteUrl(locale, "/digests/"));

    writeFile(
      path.join(outRoot, "about/index.html"),
      renderProsePage({
        locale,
        t,
        localeMeta,
        pageKey: "about",
        pathSegment: "about",
        extraHtml: `<p><a class="btn btn-secondary" href="${HYPERJUMP_URL}" rel="noopener noreferrer">${escapeHtml(t.about.link)}<span class="btn-icon" aria-hidden="true">↗</span></a></p>`,
      }),
    );
    sitemapUrls.push(absoluteUrl(locale, "/about/"));

    for (const pageKey of ["privacy", "terms", "contact", "preferences"]) {
      writeFile(
        path.join(outRoot, `${pageKey}/index.html`),
        renderProsePage({
          locale,
          t,
          localeMeta,
          pageKey,
          pathSegment: pageKey,
          extraHtml:
            pageKey === "contact"
              ? `<p><strong>${escapeHtml(t.contact.emailLabel)}:</strong> <a href="mailto:${escapeHtml(t.contact.email)}">${escapeHtml(t.contact.email)}</a></p><p>${escapeHtml(t.contact.company)}</p>`
              : pageKey === "preferences"
                ? renderNewsletterForm(t, locale, "pref")
                : "",
        }),
      );
      sitemapUrls.push(absoluteUrl(locale, `/${pageKey}/`));
    }

    for (const topic of topics) {
      writeFile(
        path.join(outRoot, `topics/${topic.slug}/index.html`),
        renderTopic({ locale, t, topic, articles, localeMeta }),
      );
      sitemapUrls.push(absoluteUrl(locale, `/topics/${topic.slug}/`));
    }

    for (const article of articles) {
      writeFile(
        path.join(outRoot, `articles/${article.slug}/index.html`),
        renderArticle({ locale, t, article, topics, articles, localeMeta }),
      );
      sitemapUrls.push(absoluteUrl(locale, `/articles/${article.slug}/`));
    }
  }

  const en404 = i18n.en.notFound;
  writeFile(
    path.join(DIST, "404.html"),
    layout({
      localeMeta: LOCALES[0],
      t: i18n.en,
      locale: "en",
      pathForLocale: (code) => `${localePrefix(code)}/`,
      active: "404",
      head: renderHead({
        locale: "en",
        title: en404.title,
        description: en404.text,
        canonical: `${SITE_URL}/404.html`,
        hreflang: "",
        ogLocale: "en_US",
        jsonLd: [],
      }),
      body: `<div class="wrap page-hero" style="text-align:center;padding-bottom:5rem">
        <h1>${escapeHtml(en404.h1)}</h1>
        <p class="prose-lead" style="margin-inline:auto">${escapeHtml(en404.text)}</p>
        <a class="btn btn-primary" href="/">${escapeHtml(en404.cta)}<span class="btn-icon" aria-hidden="true">→</span></a>
      </div>`,
    }),
  );

  writeFile(
    path.join(DIST, "robots.txt"),
    `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`,
  );

  writeFile(path.join(DIST, "sitemap.xml"), renderSitemap(sitemapUrls));
  writeFile(path.join(DIST, "CNAME"), "frontiernews.tech\n");

  // GitHub Pages: prevent Jekyll processing
  writeFile(path.join(DIST, ".nojekyll"), "");

  console.log(`Built ${sitemapUrls.length} URLs into ${DIST}`);
}

build();
