#!/usr/bin/env node
'use strict';
// Check a rebuilt translation file against the published one before it is
// uploaded, and load both through the app's own loader(s).
//
//   node tools/validate-translation.js --mode finnish|croatian \
//     --orig orig/<id>.json --new out/<id>.json \
//     [--final-source FinPR.json] [--allow-missing-final ZEC,...]   (finnish)
//     [--expect-added "GEN 50:26,EXO 40:38,..."]                     (finnish)
//     [--loader store=<bibleLoader.js> --loader current=<bibleLoader.js> ...]
//     [--sample REV:22]
//
// A loader is the app's src/services/bibleLoader.js (for the store build:
// `git show 03f11d1:src/services/bibleLoader.js > store-loader.js`). Its two
// imports are swapped for stubs (expo-file-system reads the file from a temp
// documents folder; the bundled KJV is left empty) and it is run under Node.
// Exit status 1 when any check fails. Node built-ins only.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { readReleaseFile, rowMap, normFi, parseArgs, sha256, SCROLLMAPPER_NAMES, BOOK_IDS } = require('./lib/common');
const hr = require('./lib/croatian');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${String(detail).split('\n').join('\n      ')}` : ''}`);
  return ok;
};
const list = (a, n = 20) => (a.length > n ? `${a.slice(0, n).join(', ')}, … (${a.length} in all)` : a.join(', '));

function shapeProblems(json) {
  const bad = [];
  const keys = (o, want, where) => {
    const k = Object.keys(o);
    if (k.join() !== want.join()) bad.push(`${where}: keys ${k.join(',')} (want ${want.join(',')})`);
  };
  keys(json, ['books'], 'top level');
  for (const b of json.books) {
    keys(b, ['num', 'chapters'], `book ${b.num}`);
    if (typeof b.num !== 'string') bad.push(`book ${b.num}: num is not a string`);
    for (const c of b.chapters) {
      keys(c, ['num', 'verses'], `${b.num} ${c.num}`);
      if (typeof c.num !== 'string') bad.push(`${b.num} ${c.num}: num is not a string`);
      for (const v of c.verses) {
        keys(v, ['num', 'text'], `${b.num} ${c.num}:${v.num}`);
        if (typeof v.num !== 'string' || typeof v.text !== 'string') bad.push(`${b.num} ${c.num}:${v.num}: num or text is not a string`);
      }
    }
  }
  return bad;
}

function structure(orig, next, mode) {
  const o = orig.json; const n = next.json;
  check('new file: UTF-8 without BOM, minified, JSON.stringify round trip', next.roundTrip, next.roundTrip ? `${next.bytes} bytes, sha256 ${next.sha256}` : 'JSON.stringify(JSON.parse(file)) differs from the file');
  const bad = shapeProblems(n);
  check('shape: {books:[{num,chapters:[{num,verses:[{num,text}]}]}]}, keys in that order, every num and text a string', !bad.length, list(bad));
  check('books: same ids in the same order', o.books.map((b) => b.num).join() === n.books.map((b) => b.num).join(), `${n.books.length} books`);
  const chapBad = [];
  o.books.forEach((b, i) => {
    const nb = n.books[i];
    if (!nb || b.chapters.map((c) => c.num).join() !== nb.chapters.map((c) => c.num).join()) chapBad.push(b.num);
  });
  check('chapters: same numbers in the same order in every book', !chapBad.length, chapBad.length ? list(chapBad) : `${n.books.reduce((s, b) => s + b.chapters.length, 0)} chapters`);
  const empty = [];
  for (const b of n.books) for (const c of b.chapters) for (const v of c.verses) if (!v.text.trim()) empty.push(`${b.num} ${c.num}:${v.num}`);
  check('no empty rows', !empty.length, list(empty));

  const numBad = []; const added = []; const changedOld = [];
  o.books.forEach((b, bi) => b.chapters.forEach((c, ci) => {
    const nc = n.books[bi] && n.books[bi].chapters[ci];
    if (!nc) return;
    const on = c.verses.map((v) => v.num); const nn = nc.verses.map((v) => v.num);
    if (mode === 'croatian') { if (on.join() !== nn.join()) numBad.push(`${b.num} ${c.num}`); return; }
    if (nn.slice(0, on.length).join() !== on.join()) { numBad.push(`${b.num} ${c.num}`); return; }
    c.verses.forEach((v, vi) => { if (JSON.stringify(v) !== JSON.stringify(nc.verses[vi])) changedOld.push(`${b.num} ${c.num}:${v.num}`); });
    let last = Math.max(...on.map(Number).filter(Number.isInteger));
    for (const v of nc.verses.slice(on.length)) {
      if (Number(v.num) !== last + 1) numBad.push(`${b.num} ${c.num}:${v.num} (after ${last})`);
      last = Number(v.num);
      added.push({ key: `${b.num} ${c.num}:${v.num}`, text: v.text });
    }
  }));
  if (mode === 'croatian') {
    check('verse numbers: identical in every chapter', !numBad.length, numBad.length ? list(numBad) : `${rowMap(n).size} rows`);
  } else {
    check('verse numbers: every chapter keeps its rows in place; new rows only continue it (next number, at the end)', !numBad.length, list(numBad));
    check('every original row is byte-identical in the new file', !changedOld.length, changedOld.length ? list(changedOld) : `${rowMap(o).size} rows`);
  }
  return { added };
}

function finnishChecks(orig, next, args, added) {
  console.log(`      added rows (${added.length}):\n${added.map((a) => `        ${a.key.padEnd(10)} ${a.text}`).join('\n')}`);
  if (args['expect-added']) {
    const want = args['expect-added'].split(',').map((s) => s.trim()).filter(Boolean);
    const got = added.map((a) => a.key);
    check(`added rows are exactly the ${want.length} expected`, want.join('|') === got.join('|'), `unexpected: ${list(got.filter((k) => !want.includes(k))) || 'none'}; missing: ${list(want.filter((k) => !got.includes(k))) || 'none'}`);
  }
  if (args['final-source']) {
    // Each book's last verse in the source (FinPR, KJV layout): its text after
    // any "{c:v}" marker must be the last row of that chapter in the new file.
    const src = JSON.parse(fs.readFileSync(args['final-source'], 'utf8'));
    const byName = new Map(src.books.map((b) => [b.name, b]));
    const allow = (args['allow-missing-final'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    const missing = []; const allowed = [];
    BOOK_IDS.forEach((id, i) => {
      const sb = byName.get(SCROLLMAPPER_NAMES[i]);
      const sc = sb.chapters[sb.chapters.length - 1];
      const sv = [...sc.verses].reverse().find((v) => String(v.text).trim());
      const tail = String(sv.text).split(/\{\d+:\d+\}/).pop().trim();
      const nb = next.json.books.find((b) => b.num === id);
      const nc = nb.chapters.find((c) => c.num === String(sc.chapter));
      const last = nc && nc.verses[nc.verses.length - 1];
      if (last && normFi(last.text).endsWith(normFi(tail))) return;
      (allow.includes(id) ? allowed : missing).push(`${id} (source ${sc.chapter}:${sv.verse}; file ends ${nc ? `${nc.num}:${last.num}` : 'without that chapter'})`);
    });
    check(`every book ends with the source's last verse${allow.length ? ` (allowed to lack it: ${allow.join(', ')})` : ''}`, !missing.length, `${missing.length ? `missing: ${missing.join('; ')}` : '66 books checked'}${allowed.length ? `\nknown and allowed: ${allowed.join('; ')}` : ''}`);
  }
  const oldStray = orig.json.books.find((b) => b.num === '2CO').chapters.find((c) => c.num === '19');
  const newStray = next.json.books.find((b) => b.num === '2CO').chapters.find((c) => c.num === '19');
  check('the stray "2CO 19" chapter is kept as it was', JSON.stringify(oldStray) === JSON.stringify(newStray));
}

function croatianChecks(orig, next) {
  const om = rowMap(orig.json); const nm = rowMap(next.json);
  const bad = []; const junkLeft = []; const foreign = {}; let changed = 0; let stripped = 0;
  const counts = Object.fromEntries([...hr.RESTORED_LETTERS].map((ch) => [ch, 0]));
  for (const [k, t] of nm) {
    const o = om.get(k);
    const want = hr.stripJunk(o);
    if (want !== o) stripped++;
    if (t !== o) changed++;
    if (hr.deleteNonAscii(t) !== want) bad.push(k);
    if (hr.hasJunk(t)) junkLeft.push(k);
    for (const ch of t) {
      if (ch.charCodeAt(0) < 128) continue;
      if (ch in counts) counts[ch]++; else foreign[ch] = (foreign[ch] || 0) + 1;
    }
  }
  check('every row: the new text with its accents deleted equals the original with its junk markup stripped', !bad.length, bad.length ? list(bad) : `${nm.size} rows; ${changed} changed, ${stripped} had junk markup`);
  check('no junk markup left (<p>, </p>, <h2>, $LETTER)', !junkLeft.length, list(junkLeft));
  const lower = [...'čćšžđ'];
  check('č ć š ž đ are present', lower.every((ch) => counts[ch] > 0), Object.entries(counts).map(([ch, n]) => `${ch} ${n}`).join(', '));
  check('the only non-ASCII characters are those letters', !Object.keys(foreign).length, Object.entries(foreign).map(([ch, n]) => `${JSON.stringify(ch)} U+${ch.charCodeAt(0).toString(16).toUpperCase()} ${n}`).join(', '));
}

// ---- loaders -------------------------------------------------------------

async function loadLoader(name, file, work) {
  let src = fs.readFileSync(file, 'utf8');
  const fsImport = /^import \* as FileSystem from 'expo-file-system\/legacy';$/m;
  const kjvImport = /^import \{ BOOK_LOADERS as KJV_BOOKS, MANIFEST as KJV_MANIFEST \} from '[^']+';$/m;
  if (!fsImport.test(src) || !kjvImport.test(src)) throw new Error(`${file}: its imports are not the two this harness knows how to stub`);
  src = src.replace(fsImport, 'const FileSystem = globalThis.__translationLoaderFs;')
    .replace(kjvImport, 'const KJV_BOOKS = {}; const KJV_MANIFEST = { books: [] };');
  if (/^import /m.test(src)) throw new Error(`${file}: has an import the harness does not stub`);
  const out = path.join(work, `loader-${name}.mjs`);
  fs.writeFileSync(out, src);
  return import(pathToFileURL(out).href);
}

async function loaderChecks(args, mode, orig, next) {
  const loaders = (args.loader || []).map((s) => {
    const eq = s.indexOf('=');
    return eq === -1 ? { name: path.basename(s), file: s } : { name: s.slice(0, eq), file: s.slice(eq + 1) };
  });
  if (!loaders.length) return;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-translation-'));
  const doc = path.join(work, 'documents/');
  fs.mkdirSync(path.join(doc, 'translations'), { recursive: true });
  const ids = { orig: `${mode}-orig`, new: mode };
  fs.copyFileSync(args.orig, path.join(doc, 'translations', `${ids.orig}.json`));
  fs.copyFileSync(args.new, path.join(doc, 'translations', `${ids.new}.json`));
  globalThis.__DEV__ = false;
  globalThis.__translationLoaderFs = {
    documentDirectory: doc,
    getInfoAsync: async (p) => ({ exists: fs.existsSync(p) }),
    readAsStringAsync: async (p) => fs.readFileSync(p, 'utf8'),
  };
  const [sb, sc] = (args.sample || (mode === 'finnish' ? 'REV:22' : 'PSA:9')).split(':');
  for (const { name, file } of loaders) {
    const L = await loadLoader(name, file, work);
    for (const which of ['orig', 'new']) {
      const id = ids[which];
      const json = which === 'orig' ? orig.json : next.json;
      const problems = [];
      const books = await L.fetchAvailableBooks(id);
      if (books.join() !== json.books.map((b) => b.num).join()) problems.push('fetchAvailableBooks differs from the file');
      let rows = 0; let chapters = 0;
      for (const b of json.books) {
        const count = await L.fetchBookChapterCount(b.num, id);
        if (count !== b.chapters.length) problems.push(`${b.num}: fetchBookChapterCount ${count} for ${b.chapters.length} chapters`);
        for (const c of b.chapters) {
          chapters++;
          const xml = (await L.fetchChapterContent(b.num, c.num, id)).data.content;
          const n = (xml.match(/<verse num="/g) || []).length;
          if (n !== c.verses.length) problems.push(`${b.num} ${c.num}: ${n} <verse> for ${c.verses.length} rows`);
          for (const v of c.verses) if (!xml.includes(`<verse num="${v.num}">${v.text}</verse>`)) problems.push(`${b.num} ${c.num}:${v.num} not in its chapter XML`);
          rows += c.verses.length;
          const vc = await L.fetchVerseCount(b.num, c.num, id);
          const distinct = new Set(c.verses.map((v) => v.num).filter((x) => /^\d+$/.test(x))).size;
          if (vc !== c.verses.length && vc !== distinct) problems.push(`${b.num} ${c.num}: fetchVerseCount ${vc}`);
        }
      }
      const layout = await L.fetchVerseLayout(id);
      const lastBook = layout.books[layout.books.length - 1];
      const lastCh = lastBook.chapters[lastBook.chapters.length - 1];
      check(`loader "${name}" reads the ${which === 'orig' ? 'original' : 'new'} file: every book, chapter and row`, !problems.length,
        problems.length ? list(problems, 10) : `${books.length} books, ${chapters} chapters, ${rows} rows in the chapter XML; layout total ${layout.total} verses; ${lastBook.book} ${lastCh.chapter} has ${lastCh.verses}${lastCh.nums ? ` (nums ${lastCh.nums.join(',')})` : ''}`);
      const xml = (await L.fetchChapterContent(sb, sc, id)).data.content.split('\n');
      const show = xml.length > 4 ? [...xml.slice(0, 2), `… (${xml.length} lines)`, ...xml.slice(-2)] : xml;
      console.log(`      ${sb} ${sc} as "${name}" renders it from the ${which === 'orig' ? 'original' : 'new'} file:\n${show.map((l) => `        ${l}`).join('\n')}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { multi: ['loader'] });
  const mode = args.mode;
  if (!['finnish', 'croatian'].includes(mode) || !args.orig || !args.new) {
    console.error('usage: validate-translation.js --mode finnish|croatian --orig <file> --new <file> [--loader name=<bibleLoader.js>] ...');
    process.exit(2);
  }
  const orig = readReleaseFile(args.orig);
  const next = readReleaseFile(args.new);
  console.log(`validate ${mode}\n  orig ${orig.sha256} ${orig.bytes} bytes  ${args.orig}\n  new  ${next.sha256} ${next.bytes} bytes  ${args.new}`);
  check('original file: JSON.stringify round trip (so the new one can match it byte for byte)', orig.roundTrip);
  const { added } = structure(orig, next, mode);
  if (mode === 'finnish') finnishChecks(orig, next, args, added);
  else {
    check('no rows added or removed', !added.length && rowMap(orig.json).size === rowMap(next.json).size);
    croatianChecks(orig, next);
  }
  await loaderChecks(args, mode, orig, next);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? 'FAILED' : 'OK'}: ${results.length - failed.length}/${results.length} checks passed (${sha256(fs.readFileSync(args.new))})`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(`error: ${e.stack || e.message}`); process.exit(1); });
