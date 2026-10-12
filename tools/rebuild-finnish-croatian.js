#!/usr/bin/env node
'use strict';
// Rebuild finnish.json and croatian.json (release translations-v1) from the
// published files and pinned GitHub sources, keeping everything the app relies
// on: the JSON shape, book ids, chapter and verse numbers, and (Finnish) every
// existing row byte for byte.
//
//   node tools/rebuild-finnish-croatian.js finnish \
//     --orig orig/finnish.json --finpr FinPR.json \
//     --urantiapedia <urantiapedia>/input/tex/bible-fi \
//     --raamattu <raamattu>/tekstit \
//     --out out/finnish.json [--report report-finnish.json] [--allow-ac]
//
//   node tools/rebuild-finnish-croatian.js croatian \
//     --orig orig/croatian.json --crosaric CroSaric.json \
//     --out out/croatian.json [--report report-croatian.json] [--keep-markup]
//     [--min-block 4]
//
// --allow-ac      Finnish: also fill a chapter source B lacks entirely where
//                 sources A and C agree byte for byte (adds ZEC 14:21).
// --keep-markup   Croatian: leave <p>, </p>, <h2>…</h2> and $ALEF-style
//                 tokens in (they are stripped by default).
// --min-block N   Croatian: shortest matching run used when a verse has no
//                 exact guide (default 4).
// --any-orig      Accept an original other than the published file.
//
// Node built-ins only. Sources and what each step does: README.md,
// "Rebuilding finnish.json and croatian.json".

const fs = require('fs');
const {
  BOOK_IDS, SCROLLMAPPER_NAMES, sha256, dirDigest, readReleaseFile, writeReleaseFile, rowMap, parseArgs,
} = require('./lib/common');
const fi = require('./lib/finnish');
const hr = require('./lib/croatian');

// The release files this rebuild was written against. Another file breaks the
// assumptions (which verses are missing, where the junk is), so it is refused
// unless --any-orig is given.
const KNOWN_ORIG = {
  finnish: '393c05e6172309bdda2d7e0e31236c101cd03ee3e2146692bdfad47abbc76f2c',
  croatian: 'dc9ef13a7e8a7766f53d4bd693c88f739861d10a615ea04e95cae39c31284004',
};

const log = (...a) => console.log(...a);
const pct = (n, d) => `${((100 * n) / d).toFixed(2)}%`;

function loadOrig(mode, file, anyOrig) {
  const orig = readReleaseFile(file);
  if (orig.sha256 !== KNOWN_ORIG[mode] && !anyOrig) {
    throw new Error(`${file}: sha256 ${orig.sha256} is not the known ${mode}.json (${KNOWN_ORIG[mode]}); pass --any-orig to go on anyway`);
  }
  if (!orig.roundTrip) throw new Error(`${file}: JSON.stringify does not reproduce the file, so the output could not be written byte-compatibly`);
  return orig;
}

function finnish(args) {
  for (const k of ['orig', 'finpr', 'urantiapedia', 'raamattu', 'out']) if (!args[k]) throw new Error(`finnish: --${k} is required`);
  const orig = loadOrig('finnish', args.orig, args['any-orig']);
  const finprBuf = fs.readFileSync(args.finpr);
  const A = fi.remapFinPR(JSON.parse(finprBuf.toString('utf8')));
  const B = fi.parseUrantiapedia(args.urantiapedia);
  const C = fi.parseRaamattu(args.raamattu);
  const oldRows = rowMap(orig.json);

  const inputs = {
    orig: { file: args.orig, sha256: orig.sha256, bytes: orig.bytes },
    finpr: { file: args.finpr, sha256: sha256(finprBuf) },
    urantiapedia: { dir: args.urantiapedia, ...dirDigest(args.urantiapedia, (n) => n.endsWith('.tex')) },
    raamattu: { dir: args.raamattu, ...dirDigest(args.raamattu, (n) => n.endsWith('.usfm')) },
  };

  const ident = { A: fi.identity(oldRows, A.verses), B: fi.identity(oldRows, B), C: fi.identity(oldRows, C) };
  const sample = fi.stratifiedSample(orig.json);
  const sampleRows = new Map(sample.map((k) => [k, oldRows.get(k)]));
  const sampleIdent = { A: fi.identity(sampleRows, A.verses), B: fi.identity(sampleRows, B), C: fi.identity(sampleRows, C) };

  const { decisions, additions } = fi.decideAdditions(orig.json, A.verses, B, C, { allowAC: !!args['allow-ac'] });
  const out = fi.applyAdditions(orig.json, additions);
  const written = writeReleaseFile(args.out, out);

  log('Finnish rebuild');
  log('  inputs:');
  for (const [k, v] of Object.entries(inputs)) log(`    ${k.padEnd(13)} ${v.sha256}${v.files ? ` (${v.files} files)` : ''}  ${v.file || v.dir}`);
  log(`  A (FinPR) remapped keys: ${A.verses.size}, keys joined from several KJV verses: ${A.merged.length}`);
  log('  identity with the old file (every old row):');
  for (const [k, v] of Object.entries(ident)) log(`    ${k}: exact ${v.exact}/${v.rows} (${pct(v.exact, v.rows)}), normalised ${v.normalised}/${v.rows} (${pct(v.normalised, v.rows)}), key absent ${v.absent}`);
  log(`  stratified sample (${sample.length} rows, 5 per book):`);
  for (const [k, v] of Object.entries(sampleIdent)) log(`    ${k}: exact ${v.exact}/${v.rows} (${pct(v.exact, v.rows)}), normalised ${v.normalised}/${v.rows} (${pct(v.normalised, v.rows)})`);
  log(`  missing keys looked at: ${decisions.length}, added: ${additions.length}`);
  for (const a of additions) log(`    + ${a.key.padEnd(10)} [${a.basis}] ${a.text}`);
  const rejectedAtEnd = decisions.filter((d) => !d.added && !d.reasons.some((r) => r.startsWith('inside') || r.startsWith('not contiguous')));
  log(`  rejected at a chapter end: ${rejectedAtEnd.length}`);
  for (const d of rejectedAtEnd) log(`    - ${d.key.padEnd(10)} ${d.reasons.join('; ')}`);
  const inside = decisions.filter((d) => !d.added && !rejectedAtEnd.includes(d));
  log(`  rejected inside or past the end of a chapter (the rebuild only appends): ${inside.length}`);
  log(`    ${inside.map((d) => d.key).join(', ')}`);
  log(`  out: ${args.out} ${written.bytes} bytes sha256 ${written.sha256}`);

  if (args.report) {
    fs.writeFileSync(args.report, `${JSON.stringify({
      mode: 'finnish', inputs, merged: A.merged, identity: ident, sample: { keys: sample, identity: sampleIdent },
      additions, decisions, out: { file: args.out, ...written },
    }, null, 2)}\n`);
  }
}

function croatian(args) {
  for (const k of ['orig', 'crosaric', 'out']) if (!args[k]) throw new Error(`croatian: --${k} is required`);
  const orig = loadOrig('croatian', args.orig, args['any-orig']);
  const srcBuf = fs.readFileSync(args.crosaric);
  const src = JSON.parse(srcBuf.toString('utf8'));
  const strip = !args['keep-markup'];
  const minBlock = Number(args['min-block'] || 4);

  // The source, keyed like the release file, with its own junk stripped the
  // same way (it has "$ŠIN"-style letters too) so it aligns with the old text.
  const byName = new Map(src.books.map((b) => [b.name, b]));
  const guide = new Map();
  const order = new Map();
  SCROLLMAPPER_NAMES.forEach((name, bi) => {
    const book = byName.get(name);
    if (!book) throw new Error(`CroSaric: book "${name}" not found`);
    const keys = [];
    for (const c of book.chapters) {
      for (const v of c.verses) {
        const k = `${BOOK_IDS[bi]} ${c.chapter}:${v.verse}`;
        guide.set(k, strip ? hr.stripJunk(String(v.text)) : String(v.text));
        keys.push(k);
      }
    }
    order.set(BOOK_IDS[bi], keys);
  });
  // Exact lookups by compact skeleton, word-trigram lookups for the rest.
  const byForm = new Map();
  const grams = (ascii) => {
    const w = hr.compactAscii(ascii).match(/[A-Za-z]+/g) || [];
    const n = Math.min(3, w.length);
    const out = new Set();
    for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
    return out;
  };
  const gramIndex = new Map();
  for (const [id, keys] of order) {
    const gi = new Map();
    keys.forEach((k, i) => {
      const form = hr.guideForm(guide.get(k)).text;
      if (form) { if (!byForm.has(form)) byForm.set(form, []); byForm.get(form).push(k); }
      for (const g of grams(hr.skeleton(guide.get(k)).skel)) { if (!gi.has(g)) gi.set(g, []); gi.get(g).push(i); }
    });
    gramIndex.set(id, gi);
  }
  const bestOverlap = (id, ascii) => {
    const gi = gramIndex.get(id);
    const score = new Map();
    for (const g of grams(ascii)) for (const i of gi.get(g) || []) score.set(i, (score.get(i) || 0) + 1);
    let best = -1; let top = 0;
    for (const [i, n] of score) if (n > top || (n === top && i < best)) { best = i; top = n; }
    return top ? best : -1;
  };

  const junk = { byType: {}, byToken: {} };
  const tally = { rows: 0, exactSameKey: 0, exactSameKeySpacing: 0, exactRelocated: 0, aligned: 0, noGuide: 0, unchanged: 0 };
  const relocated = [];
  const aligned = [];
  const noGuide = [];
  const skipped = {};
  let placedTotal = 0;
  const out = JSON.parse(JSON.stringify(orig.json));
  for (const b of out.books) {
    for (const c of b.chapters) {
      for (const v of c.verses) {
        tally.rows++;
        const key = `${b.num} ${c.num}:${v.num}`;
        const ascii = strip ? hr.stripJunk(v.text, junk) : v.text;
        const form = hr.compactAscii(ascii);
        const same = guide.get(key);
        let res = null; let from = null;
        const hits = byForm.get(form) || [];
        const hitTexts = new Set(hits.map((k) => guide.get(k)));
        if (same != null && hr.guideForm(same).text === form) {
          res = hr.reaccent(ascii, same); from = key; tally.exactSameKey++;
          if (hr.skeleton(same).skel !== ascii) tally.exactSameKeySpacing++;
        } else if (hits.length && hitTexts.size === 1) {
          // The same text under another number (JER 24:11-38 is the source's
          // JER 25:11-38), or several places with identical text.
          res = hr.reaccent(ascii, guide.get(hits[0])); from = hits[0]; tally.exactRelocated++; relocated.push({ key, from: hits[0] });
        } else {
          // No exact guide: align against the same key, and against the
          // source passage that shares the most word trigrams (with a verse
          // either side, since the two texts split verses differently), and
          // keep whichever restores more letters.
          const cands = [];
          if (same != null) cands.push({ from: key, text: same });
          const keys = order.get(b.num);
          const bi = bestOverlap(b.num, ascii);
          if (bi !== -1) {
            const span = keys.slice(Math.max(0, bi - 1), bi + 2);
            cands.push({ from: `${span[0]}..${span[span.length - 1]}`, text: span.map((k) => guide.get(k)).join(' ') });
          }
          for (const cand of cands) {
            const r = hr.reaccent(ascii, cand.text, { minBlock });
            if (!res || r.placed > res.placed) { res = r; from = cand.from; }
          }
          if (res) { tally.aligned++; aligned.push({ key, from, placed: res.placed }); } else { tally.noGuide++; noGuide.push(key); }
        }
        const text = res ? res.text : ascii;
        if (res) {
          placedTotal += res.placed;
          for (const [ch, n] of Object.entries(res.skipped)) skipped[ch] = (skipped[ch] || 0) + n;
        }
        if (hr.deleteNonAscii(text) !== ascii) throw new Error(`${key}: rebuilt text does not reduce to the old text (guide ${from})`);
        if (!text.trim()) throw new Error(`${key}: rebuilt row is empty`);
        if (text === v.text) tally.unchanged++;
        v.text = text;
      }
    }
  }

  // Vocabulary check. Every word the rebuild put a letter into should be a
  // word of the source; an ASCII word that is not a source word but is one
  // with its letters deleted was probably missed.
  const vocab = new Set();
  const lost = new Map();
  for (const t of guide.values()) {
    for (const w of hr.words(t)) {
      vocab.add(w);
      if (/[^\x00-\x7F]/.test(w) && [...w].every((ch) => ch.charCodeAt(0) < 128 || hr.RESTORE.has(ch))) {
        const sk = hr.deleteNonAscii(w);
        if (!lost.has(sk)) lost.set(sk, new Set());
        lost.get(sk).add(w.replace(/\u00D0/g, '\u0110'));
      }
    }
  }
  const unknownRestored = [];
  const missed = [];
  for (const b of out.books) for (const c of b.chapters) for (const v of c.verses) {
    for (const w of hr.words(v.text)) {
      if (/[^\x00-\x7F]/.test(w)) { if (!vocab.has(w) && !vocab.has(w.replace(/\u0110/g, '\u00D0'))) unknownRestored.push(`${b.num} ${c.num}:${v.num} ${w}`); }
      else if (!vocab.has(w) && lost.has(w)) missed.push(`${b.num} ${c.num}:${v.num} ${w}->${[...lost.get(w)].join('|')}`);
    }
  }

  const written = writeReleaseFile(args.out, out);

  log('Croatian rebuild');
  log(`  inputs:\n    orig     ${orig.sha256}  ${args.orig}\n    crosaric ${sha256(srcBuf)}  ${args.crosaric}`);
  log(`  junk markup ${strip ? 'stripped' : 'kept (--keep-markup)'}:`);
  for (const [t, n] of Object.entries(junk.byType)) log(`    ${t.padEnd(10)} ${n}`);
  if (strip) log(`    tokens: ${Object.entries(junk.byToken).sort((x, y) => y[1] - x[1]).map(([t, n]) => `${t} ${n}`).join(', ')}`);
  log(`  rows ${tally.rows}:`);
  log(`    exact guide at the same key  ${tally.exactSameKey} (${pct(tally.exactSameKey, tally.rows)}; ${tally.exactSameKeySpacing} of them only differ by a space before punctuation)`);
  log(`    exact guide elsewhere        ${tally.exactRelocated}`);
  log(`    aligned (partial guide)      ${tally.aligned}`);
  log(`    no guide (kept as ASCII)     ${tally.noGuide}`);
  log(`    exact in all                 ${tally.exactSameKey + tally.exactRelocated} (${pct(tally.exactSameKey + tally.exactRelocated, tally.rows)})`);
  log(`  letters restored ${placedTotal}; rows unchanged ${tally.unchanged} (no Croatian letter and no junk)`);
  log(`  source characters not copied (not Croatian letters): ${Object.entries(skipped).map(([ch, n]) => `${JSON.stringify(ch)} U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')} ${n}`).join(', ') || 'none'}`);
  log(`  relocated guides (${relocated.length}): ${relocated.map((r) => `${r.key}<-${r.from}`).join(', ')}`);
  log(`  aligned rows (${aligned.length}): ${aligned.map((a) => `${a.key}<-${a.from} (${a.placed})`).join(', ')}`);
  if (noGuide.length) log(`  no guide: ${noGuide.join(', ')}`);
  log(`  vocabulary: restored words not in the source ${unknownRestored.length}${unknownRestored.length ? `: ${unknownRestored.join(', ')}` : ''}`);
  log(`  vocabulary: ASCII words that look like a source word missing its letters ${missed.length}${missed.length ? `:\n    ${missed.join('\n    ')}` : ''}`);
  log(`  out: ${args.out} ${written.bytes} bytes sha256 ${written.sha256}`);

  if (args.report) {
    fs.writeFileSync(args.report, `${JSON.stringify({
      mode: 'croatian', inputs: { orig: orig.sha256, crosaric: sha256(srcBuf) }, strip, minBlock, junk, tally,
      placed: placedTotal, skipped, relocated, aligned, noGuide, unknownRestored, missed, out: { file: args.out, ...written },
    }, null, 2)}\n`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2), { flags: ['allow-ac', 'keep-markup', 'any-orig'] });
  const mode = args._[0];
  if (mode === 'finnish') finnish(args);
  else if (mode === 'croatian') croatian(args);
  else {
    console.error('usage: rebuild-finnish-croatian.js finnish|croatian --orig <file> ... --out <file> (see the header)');
    process.exit(2);
  }
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
}

module.exports = { KNOWN_ORIG };
