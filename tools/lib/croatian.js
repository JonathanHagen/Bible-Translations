'use strict';
// Croatian helpers shared by the rebuild and the validator: the junk markup
// the Unbound-derived file carries, the letters the rebuild may put back, and
// the alignment that puts them back.

// The markup stripped from the Croatian text. None of it is verse text: the
// app prints "$ALEF" literally, shows an <h2>'s heading inside the verse, and
// takes a lone <p> as an unclosed style tag.
//   <h2>…</h2>  a section heading glued to the end of a verse (whole element)
//   <p>, </p>   paragraph marks
//   $ALEF …     Psalm acrostic letter names ($ALEF, $BET, … $TAU). The old
//               file lost the Š of $REŠ and $ŠIN ("$RE", "$IN"); the source
//               once glues one to the next word ("$DALETTražio"), so the
//               names are matched exactly, longest first.
const LETTER = '\\$(?:' + 'ALEF BET GIMEL DALET HET HE VAU ZAJIN TET JOD KAF LAMED MEM NUN SAMEK AJIN PE SADE KOF RE\u0160 RE \u0160IN SIN IN TAU'.split(' ').join('|') + ')';
const JUNK_TYPES = [
  { type: '<h2>…</h2>', re: /^<h2>[^<]*<\/h2>$/ },
  { type: '<p>', re: /^<p>$/ },
  { type: '</p>', re: /^<\/p>$/ },
  { type: '$LETTER', re: new RegExp(`^${LETTER}$`) },
];
// One token, with the spaces on either side of it.
const JUNK_RE = new RegExp(`[ ]*(<h2>[^<]*<\\/h2>|<\\/?p>|${LETTER})[ ]*`, 'g');
const SEP = '\u0000';

// Strip the junk tokens. A token between two words leaves one space; one at
// either end of the verse leaves nothing. counts (optional) gathers the
// stripped tokens by type and by exact token.
function stripJunk(text, counts) {
  if (text.includes(SEP)) throw new Error('verse text holds a NUL character');
  const marked = text.replace(JUNK_RE, (m, tok) => {
    if (counts) {
      const t = JUNK_TYPES.find((j) => j.re.test(tok));
      const type = t ? t.type : 'other';
      counts.byType[type] = (counts.byType[type] || 0) + 1;
      counts.byToken[tok] = (counts.byToken[tok] || 0) + 1;
    }
    return SEP;
  });
  return marked.replace(/^\u0000+|\u0000+$/g, '').replace(/\u0000+/g, ' ');
}

const hasJunk = (text) => /<\/?p>|<h2>|<\/h2>|\$[A-Za-z]/.test(text);

// The only characters the rebuild puts back: the Croatian letters the old
// file lost (č ć š ž đ and capitals). The source writes capital Đ (U+0110)
// as U+00D0 (Ð) in a few places.
const RESTORE = new Map([
  ['\u010D', '\u010D'], ['\u0107', '\u0107'], ['\u0161', '\u0161'], ['\u017E', '\u017E'], ['\u0111', '\u0111'],
  ['\u010C', '\u010C'], ['\u0106', '\u0106'], ['\u0160', '\u0160'], ['\u017D', '\u017D'], ['\u0110', '\u0110'], ['\u00D0', '\u0110'],
]);
const RESTORED_LETTERS = '\u010D\u0107\u0161\u017E\u0111\u010C\u0106\u0160\u017D\u0110';

const deleteNonAscii = (s) => s.replace(/[^\x00-\x7F]/g, '');

// The guide's ASCII skeleton, and for each skeleton character its index in
// the guide.
function skeleton(guide) {
  let skel = '';
  const idx = [];
  for (let p = 0; p < guide.length; p++) {
    if (guide.charCodeAt(p) < 128) { skel += guide[p]; idx.push(p); }
  }
  return { skel, idx };
}

// The two texts differ systematically in one way besides the lost letters:
// the old file puts a space before some punctuation ("gradi ...",
// "govorio :"). Alignment runs on a compact form without those spaces; idx
// maps each compact character back to its index in the input.
function compact(s, inIdx) {
  let out = '';
  const idx = [];
  for (let p = 0; p < s.length; p++) {
    if (s[p] === ' ' && /[.,:;!?]/.test(s[p + 1] || '')) continue;
    out += s[p];
    idx.push(inIdx ? inIdx[p] : p);
  }
  return { text: out, idx };
}

// The compact ASCII skeleton of a guide, with indices into the guide.
function guideForm(guide) {
  const { skel, idx } = skeleton(guide);
  return compact(skel, idx);
}

const compactAscii = (s) => compact(s).text;

// difflib.SequenceMatcher-style matching blocks (no junk heuristic):
// the longest common substring, then recursively left and right of it.
function longestMatch(a, alo, ahi, b, blo, bhi) {
  let besti = alo; let bestj = blo; let best = 0;
  let prev = new Int32Array(bhi - blo + 1);
  for (let i = alo; i < ahi; i++) {
    const cur = new Int32Array(bhi - blo + 1);
    const ai = a.charCodeAt(i);
    for (let j = blo; j < bhi; j++) {
      if (ai !== b.charCodeAt(j)) continue;
      const k = (j > blo ? prev[j - 1 - blo] : 0) + 1;
      cur[j - blo] = k;
      if (k > best) { besti = i - k + 1; bestj = j - k + 1; best = k; }
    }
    prev = cur;
  }
  return [besti, bestj, best];
}

function matchingBlocks(a, b) {
  const queue = [[0, a.length, 0, b.length]];
  const blocks = [];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = longestMatch(a, alo, ahi, b, blo, bhi);
    if (!k) continue;
    blocks.push([i, j, k]);
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  return blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

// Put the guide's Croatian letters back into an ASCII verse. Letters go only
// into gaps that are unambiguous on both sides: between two characters that
// sit in the same matching block (so they are neighbours in the verse and in
// the guide's skeleton), or before/after a block that starts/ends both
// strings. A letter goes straight after the character before the gap (so
// "gradi ..." takes "š" as "gradiš ..."). Nothing else in the verse changes,
// so deleteNonAscii(result) === ascii by construction.
function reaccent(ascii, guide, { minBlock = 1 } = {}) {
  const g = guideForm(guide);
  const a = compact(ascii);
  const exact = g.text === a.text;
  const blocks = exact ? [[0, 0, a.text.length]] : matchingBlocks(a.text, g.text).filter((b) => b[2] >= minBlock);
  const ins = new Map();
  const skipped = {};
  let placed = 0;
  const gap = (pos, from, to) => {
    let str = '';
    for (let p = from; p < to; p++) {
      const ch = guide[p];
      if (ch.charCodeAt(0) < 128) continue; // a space the compact form dropped
      const r = RESTORE.get(ch);
      if (r) { str += r; placed++; } else skipped[ch] = (skipped[ch] || 0) + 1;
    }
    if (str) ins.set(pos, (ins.get(pos) || '') + str);
  };
  for (const [i, j, n] of blocks) {
    if (!n) continue;
    if (i === 0 && j === 0) gap(0, 0, g.idx[0]);
    for (let k = 1; k < n; k++) gap(a.idx[i + k - 1] + 1, g.idx[j + k - 1] + 1, g.idx[j + k]);
    if (i + n === a.text.length && j + n === g.text.length) gap(a.idx[i + n - 1] + 1, g.idx[j + n - 1] + 1, guide.length);
  }
  let out = '';
  for (let p = 0; p <= ascii.length; p++) {
    if (ins.has(p)) out += ins.get(p);
    if (p < ascii.length) out += ascii[p];
  }
  return { text: out, exact, placed, skipped };
}

// Words (letters only) of a text, for the vocabulary check.
const words = (s) => s.match(/[A-Za-z\u00C0-\u024F]+/g) || [];

// Letters the alignment cannot place on its own, pinned one by one with the
// source verse that prints them. Each is a phrase of one rebuilt row (ascii,
// found exactly once there) and the same phrase with its letters (text);
// deleting the letters from text gives ascii again, so a pin keeps the
// rebuild's promise that the accents deleted give back the published row.
//
//   LUK 1:67  The published row is the source's 1:67 joined to the tail of
//             its 1:68 ("... prorokovati: to pohodi i otkupi narod svoj!"),
//             with the \u0161 of "\u0161to" lost; the file has no row 1:68. Guided by
//             the source's 1:67 alone, or by 1:67 and 1:68 together, the
//             first matching run ends at "prorokovati: " with its space, so
//             the \u0161 falls at the start of the next run, a gap reaccent never
//             fills; and "to" is a word, so the vocabulary check passes it.
const PINNED = [
  {
    key: 'LUK 1:67',
    ascii: 'prorokovati: to pohodi',
    text: 'prorokovati: \u0161to pohodi',
    source: 'LUK 1:68 "Blagoslovljen Gospodin Bog Izraelov, \u0161to pohodi i otkupi narod svoj!"',
  },
];
for (const p of PINNED) {
  if (deleteNonAscii(p.text) !== p.ascii) throw new Error(`pinned ${p.key}: its text does not reduce to its ascii`);
}

// Apply the pins for one row. Returns the row's text and the pins applied.
// A pin whose phrase is not in its row exactly once is an error: the
// published file or the rebuild changed, and the pin needs a fresh look.
function applyPinned(key, text) {
  let out = text;
  const applied = [];
  for (const p of PINNED.filter((x) => x.key === key)) {
    const at = out.indexOf(p.ascii);
    if (at === -1 || out.indexOf(p.ascii, at + 1) !== -1) {
      throw new Error(`pinned ${key}: "${p.ascii}" is not in the row exactly once`);
    }
    out = out.slice(0, at) + p.text + out.slice(at + p.ascii.length);
    applied.push(p);
  }
  return { text: out, applied };
}

// The words of a rebuilt row that a nearby source verse prints with a
// Croatian letter the row lacks: an ASCII word that is not a word of the
// guide but is one of the guide's words with its letters deleted ("to" for
// "\u0161to"). The global vocabulary check misses these when the ASCII form is a
// word too. Returns "word->letters" strings.
function lostNearby(text, guideText) {
  const gw = new Set(words(guideText));
  const lost = new Map();
  for (const w of gw) {
    if (!/[^\x00-\x7F]/.test(w) || ![...w].every((ch) => ch.charCodeAt(0) < 128 || RESTORE.has(ch))) continue;
    const sk = deleteNonAscii(w);
    if (!lost.has(sk)) lost.set(sk, new Set());
    lost.get(sk).add(w);
  }
  return words(text)
    .filter((w) => !/[^\x00-\x7F]/.test(w) && !gw.has(w) && lost.has(w))
    .map((w) => `${w}->${[...lost.get(w)].join('|')}`);
}

module.exports = {
  JUNK_TYPES, stripJunk, hasJunk, RESTORE, RESTORED_LETTERS, deleteNonAscii, skeleton,
  compactAscii, guideForm, matchingBlocks, reaccent, words, PINNED, applyPinned, lostNearby,
};
