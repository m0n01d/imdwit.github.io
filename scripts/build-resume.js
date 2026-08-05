#!/usr/bin/env node
//
// Builds resume.html and resume.pdf from resume.json.
//
// This replaces `resume export`, which produced a PDF with two problems:
//
//   1. resume-cli renders the PDF with `screen` media, so the macchiato
//      theme's own @media print rules never applied.
//   2. Those print rules put `page-break-inside: avoid` on whole
//      containers, so the entire Open Source Projects block jumped to its
//      own page rather than flowing. That left most of a page blank and
//      clipped the overflowing text against `.right-column`'s
//      `overflow: hidden`.
//
// So: render with `print` media, and override the break rules to apply per
// entry instead of per container.

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const renderHtml = require('resume-cli/build/render-html').default;

// Usage:
//   node scripts/build-resume.js                       # resume.json -> resume.{html,pdf}
//   node scripts/build-resume.js <input.json> <outBase> # a tailored variant
//
// Keep tailored variants under tailored/, which is gitignored — this repo is
// public, and a resume aimed at one employer shouldn't be served from it.

const ROOT = path.join(__dirname, '..');
const THEME = 'macchiato';

const inputArg = process.argv[2];
const outBase = process.argv[3] || 'resume';
const resumePath = path.resolve(ROOT, inputArg || 'resume.json');
const resume = require(resumePath);

// Layered on top of the theme, not a fork of it.
const PRINT_CSS = `
/* --- build-resume.js: pagination fixes --- */
@media print {
  /* The theme avoids breaking inside a whole container, which pushes a
     tall section onto a fresh page and strands a mostly-empty one. Let
     containers flow and keep individual entries intact instead. */
  .container {
    page-break-inside: auto;
  }

  .work-container .item,
  .project-container .item,
  .publications-container .item,
  .education-container .item {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  /* Never leave a section heading alone at the foot of a page. */
  .title {
    page-break-after: avoid;
    break-after: avoid;
  }

  /* Note: do NOT put page-break-inside on .left-column's children. The
     sidebar is a float, and making its sections unbreakable pushes the
     entire column to page 2, leaving page 1 single-column. */

  /* .right-column uses overflow:hidden purely to contain the sidebar
     float. That clips any content crossing a page boundary, so contain
     the float with flow-root instead. */
  .right-column {
    overflow: visible;
    display: flow-root;
  }

  /* Trailing padding below the last section can spill a few pixels past
     the final page boundary, which Chromium honours by emitting an extra
     blank sheet. Nothing renders below the last entry, so drop it. */
  .page {
    height: auto;
    min-height: 0;
    padding-bottom: 0;
  }

  .page > *:last-child,
  .container:last-child {
    margin-bottom: 0;
  }

  /* Tighten vertical rhythm so the whole resume lands on two sheets.
     Spacing only — type sizes are untouched. */
  .container {
    padding-top: 12px;
  }

  .item {
    margin-bottom: 9px;
  }

  ul {
    margin-top: 6px;
  }
}
`;

async function main() {
  const html = await renderHtml({ resume, themePath: THEME });
  const withCss = html.replace('</head>', `<style>${PRINT_CSS}</style></head>`);

  const htmlPath = path.join(ROOT, `${outBase}.html`);
  fs.writeFileSync(htmlPath, withCss);
  console.log(`wrote ${path.relative(ROOT, htmlPath)}`);

  const args = [];
  // Chromium refuses to run as root without this, which is the case in CI
  // and in containers.
  if (process.getuid && process.getuid() === 0) args.push('--no-sandbox');

  const browser = await puppeteer.launch({ args });
  try {
    const page = await browser.newPage();
    await page.emulateMediaType('print');
    await page.goto(`file://${htmlPath}`, { waitUntil: 'load', timeout: 60000 });

    // The theme pulls webfonts from a CDN. Give them a moment to land, but
    // don't hang the build when the network is slow or blocked.
    await Promise.race([
      page.evaluate(() => document.fonts && document.fonts.ready),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);

    const pdfPath = path.join(ROOT, `${outBase}.pdf`);
    await page.pdf({
      path: pdfPath,
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.4in', bottom: '0.4in', left: '0.3in', right: '0.3in' },
    });
    console.log(`wrote ${path.relative(ROOT, pdfPath)}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
