'use strict';
// Finnish (Pyhä Raamattu 1933/1938) sources and the rule that decides which
// missing verses the rebuild adds.

const fs = require('fs');
const path = require('path');
const { BOOK_IDS, SCROLLMAPPER_NAMES, normFi } = require('./common');

// Source A: scrollmapper/bible_databases formats/json/FinPR.json (CrossWire
// SWORD FinPR). It is laid out in KJV versification and marks where the
// Finnish numbering differs with an inline "{c:v}" before the text that
// starts that Finnish verse. Remap: text after a "{c:v}" goes to that key,
// text before any marker to the verse's own KJV key; text landing on the same
// key twice is joined with a space; empty verses are dropped.
function remapFinPR(json) {
  const byName = new Map(json.books.map((b) => [b.name, b]));
  const m = new Map();
  const merged = [];
  const from = new Map();
  SCROLLMAPPER_NAMES.forEach((name, bi) => {
    const id = BOOK_IDS[bi];
    const book = byName.get(name);
    if (!book) throw new Error(`FinPR: book "${name}" not found`);
    for (const c of book.chapters) {
      for (const v of c.verses) {
        let key = `${id} ${c.chapter}:${v.verse}`;
        for (const part of String(v.text).split(/(\{\d+:\d+\})/)) {
          const mm = part.match(/^\{(\d+):(\d+)\}$/);
          if (mm) { key = `${id} ${mm[1]}:${mm[2]}`; continue; }
          const t = part.trim();
          if (!t) continue;
          const ref = `${c.chapter}:${v.verse}`;
          if (m.has(key)) {
            m.set(key, `${m.get(key)} ${t}`);
            from.get(key).push(ref);
            if (from.get(key).length === 2) merged.push(key);
          } else {
            m.set(key, t);
            from.set(key, [ref]);
          }
        }
      }
    }
  });
  return { verses: m, merged: merged.map((k) => ({ key: k, kjv: from.get(k) })) };
}

// Source B: JanHerca/urantiapedia input/tex/bible-fi/NNN_<Book>.tex, one
// "\par N text" line per verse under "\chapter{N}". NNN is the canonical book
// number.
function parseUrantiapedia(dir) {
  const files = fs.readdirSync(dir).filter((f) => /^\d{3}_.*\.tex$/.test(f)).sort();
  if (files.length !== 66) throw new Error(`urantiapedia: expected 66 .tex files, found ${files.length}`);
  const m = new Map();
  for (const f of files) {
    const id = BOOK_IDS[Number(f.slice(0, 3)) - 1];
    let ch = null;
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      let mm;
      if ((mm = line.match(/^\\chapter\{(\d+)\}/))) ch = mm[1];
      else if ((mm = line.match(/^\\par (\d+) ?(.*)$/))) {
        if (ch === null) throw new Error(`${f}: verse before any chapter`);
        m.set(`${id} ${ch}:${mm[1]}`, mm[2].replace(/\s+$/, ''));
      }
    }
  }
  return m;
}

// Source C (tie-breaker): raamattu/raamattu tekstit/raamattu_NN_<ID>.usfm.
function parseRaamattu(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.usfm')).sort();
  if (files.length !== 66) throw new Error(`raamattu: expected 66 .usfm files, found ${files.length}`);
  const m = new Map();
  for (const f of files) {
    let id = null; let ch = null;
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      let mm;
      if ((mm = line.match(/^\\id (\S+)/))) id = mm[1];
      else if ((mm = line.match(/^\\c (\d+)/))) ch = mm[1];
      else if ((mm = line.match(/^\\v (\d+) ?(.*)$/))) m.set(`${id} ${ch}:${mm[1]}`, mm[2].replace(/\s+$/, ''));
    }
  }
  return m;
}

const same = (x, y) => x != null && y != null && normFi(x) === normFi(y);

// Decide every key that is missing from an existing chapter of the old file
// and present in a source. A verse is added only when all hold:
//   extends   it is the next number after the chapter's last row (the rebuild
//             only appends; it never inserts inside a chapter);
//   agree     A and B agree on it after normalisation, or, where A has the
//             key but its text differs from B's, C (the tie-breaker) agrees
//             with B (A without the key is a numbering disagreement, which C
//             does not break);
//   prev      the verse before it, at the same key, matches the old row in B
//             and in A or C, so the numbering is the same;
//   new text  its text is not already in that chapter or the next one of the
//             old file, where a versification shift would have put it
//             (2CH 23:4 is in old 23:3, NEH 9:38 is old NEH 10:1). Not the
//             whole book: the stray "2CO 19" holds 2CO 9:15's text, and that
//             verse is still missing from 2CO 9.
// The added text is B's (it keeps the old file's " - " dash spacing).
// With allowAC, a chapter B does not have at all may instead be filled where
// A and C agree byte for byte and both match the old previous verse; the text
// is then A's.
function decideAdditions(oldJson, A, B, C, { allowAC = false } = {}) {
  const oldRows = new Map();
  for (const b of oldJson.books) for (const c of b.chapters) for (const v of c.verses) oldRows.set(`${b.num} ${c.num}:${v.num}`, v.text);
  const decisions = [];
  const additions = [];
  for (const b of oldJson.books) {
    const chapterOf = new Map(b.chapters.map((c) => [c.num, c]));
    for (const c of b.chapters) {
      const next = chapterOf.get(String(Number(c.num) + 1));
      let nearText = normFi([...c.verses, ...(next ? next.verses : [])].map((v) => v.text).join(' '));
      const prefix = `${b.num} ${c.num}:`;
      const have = new Set(c.verses.map((v) => v.num));
      const numeric = c.verses.map((v) => Number(v.num)).filter(Number.isInteger);
      let last = Math.max(...numeric);
      const cand = new Set();
      for (const src of [A, B, C]) {
        for (const k of src.keys()) if (k.startsWith(prefix)) { const n = k.slice(prefix.length); if (!have.has(n)) cand.add(Number(n)); }
      }
      const bHasChapter = B.has(`${prefix}1`);
      for (const n of [...cand].sort((x, y) => x - y)) {
        const key = `${prefix}${n}`;
        const prevKey = `${prefix}${n - 1}`;
        const a = A.get(key); const bt = B.get(key); const ct = C.get(key);
        const oldPrev = oldRows.get(prevKey);
        const reasons = [];
        let text = null; let basis = null;
        if (n !== last + 1) reasons.push(n > last ? `not contiguous (chapter ends at ${last})` : 'inside the chapter (rebuild only appends)');
        if (bt != null && same(a, bt)) { text = bt; basis = 'A=B'; } else if (bt != null && a != null && same(ct, bt)) { text = bt; basis = 'C=B (tie-breaker)'; } else if (allowAC && !bHasChapter && a != null && a === ct) { text = a; basis = 'A=C (B lacks the chapter)'; }
        if (!text) reasons.push(`sources disagree or are missing (A ${a == null ? 'absent' : 'present'}, B ${bt == null ? 'absent' : 'present'}, C ${ct == null ? 'absent' : 'present'})`);
        let prevOk;
        if (basis === 'A=C (B lacks the chapter)') prevOk = same(A.get(prevKey), oldPrev) && same(C.get(prevKey), oldPrev);
        else prevOk = same(B.get(prevKey), oldPrev) && (same(A.get(prevKey), oldPrev) || same(C.get(prevKey), oldPrev));
        if (!prevOk) {
          const say = (name, t) => (t == null ? `${name} has no ${n - 1}` : same(t, oldPrev) ? `${name} matches` : `${name} differs`);
          reasons.push(`previous verse ${n - 1} does not line up with the old file (${say('B', B.get(prevKey))}, ${say('A', A.get(prevKey))}, ${say('C', C.get(prevKey))})`);
        }
        if (text && nearText.includes(normFi(text))) reasons.push('text already in this chapter or the next of the old file');
        const decision = { key, added: reasons.length === 0, basis, reasons };
        decisions.push(decision);
        if (decision.added) {
          additions.push({ key, book: b.num, chapter: c.num, num: String(n), text, basis });
          // A further verse after this one is judged against the row just added.
          oldRows.set(key, text);
          nearText = `${nearText} ${normFi(text)}`;
          last = n;
        }
      }
    }
  }
  return { decisions, additions };
}

function applyAdditions(oldJson, additions) {
  const out = JSON.parse(JSON.stringify(oldJson));
  for (const add of additions) {
    const ch = out.books.find((b) => b.num === add.book).chapters.find((c) => c.num === add.chapter);
    ch.verses.push({ num: add.num, text: add.text });
  }
  return out;
}

// Identity of the old file against a source, over every old row.
function identity(oldRows, src) {
  let exact = 0; let normal = 0; let absent = 0;
  for (const [k, t] of oldRows) {
    const s = src.get(k);
    if (s == null) { absent++; continue; }
    if (s === t) exact++;
    else if (normFi(s) === normFi(t)) normal++;
  }
  return { rows: oldRows.size, exact, normalised: exact + normal, absent };
}

// A fixed, stratified sample: five evenly spaced rows of every book.
function stratifiedSample(oldJson, perBook = 5) {
  const keys = [];
  for (const b of oldJson.books) {
    const rows = [];
    for (const c of b.chapters) for (const v of c.verses) rows.push(`${b.num} ${c.num}:${v.num}`);
    for (let i = 0; i < perBook; i++) keys.push(rows[Math.floor(((i + 0.5) * rows.length) / perBook)]);
  }
  return keys;
}

module.exports = { remapFinPR, parseUrantiapedia, parseRaamattu, decideAdditions, applyAdditions, identity, stratifiedSample };
