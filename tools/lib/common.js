'use strict';
// Shared helpers for the rebuild and validation tools. Node built-ins only.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// The app's book ids, in canonical order (the order every release file uses).
const BOOK_IDS = (
  'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ' +
  'ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL ' +
  'MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB ' +
  'JAS 1PE 2PE 1JN 2JN 3JN JUD REV'
).split(' ');

// scrollmapper/bible_databases formats/json book names for the same 66 books,
// in the same order. Its files also hold deuterocanonical books, which are
// ignored here (neither release file has them).
const SCROLLMAPPER_NAMES = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  'I Samuel', 'II Samuel', 'I Kings', 'II Kings', 'I Chronicles', 'II Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah',
  'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', 'I Corinthians',
  'II Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians',
  'I Thessalonians', 'II Thessalonians', 'I Timothy', 'II Timothy', 'Titus', 'Philemon',
  'Hebrews', 'James', 'I Peter', 'II Peter', 'I John', 'II John', 'III John', 'Jude',
  'Revelation of John',
];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// A digest of a directory's files (sorted by name): sha256 over
// "<name>\0<sha256 of the file>\n" lines, so a source tree is pinned by one value.
function dirDigest(dir, filter = () => true) {
  const names = fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isFile() && filter(n)).sort();
  const lines = names.map((n) => `${n}\0${sha256(fs.readFileSync(path.join(dir, n)))}\n`);
  return { files: names.length, sha256: sha256(lines.join('')) };
}

// Read a release file and prove that plain JSON.stringify reproduces it byte
// for byte, which is what lets the rebuild write its output the same way.
function readReleaseFile(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) throw new Error(`${file}: starts with a UTF-8 BOM`);
  const raw = buf.toString('utf8');
  if (Buffer.from(raw, 'utf8').compare(buf) !== 0) throw new Error(`${file}: is not valid UTF-8`);
  const json = JSON.parse(raw);
  const roundTrip = JSON.stringify(json) === raw;
  return { buf, raw, json, roundTrip, sha256: sha256(buf), bytes: buf.length };
}

const serialise = (json) => JSON.stringify(json);

function writeReleaseFile(file, json) {
  const out = Buffer.from(serialise(json), 'utf8');
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, out);
  return { bytes: out.length, sha256: sha256(out) };
}

// "GEN 1:1" keyed map of every row of a release file (the stray rows with a
// non-numeric number are keyed by it as well).
function rowMap(json) {
  const m = new Map();
  for (const b of json.books) for (const c of b.chapters) for (const v of c.verses) m.set(`${b.num} ${c.num}:${v.num}`, v.text);
  return m;
}

// Comparison form for Finnish text: the sources disagree on spaces around
// dashes ("hyvän- ja" / "hyvän-ja", "takaisin - siihen" / "takaisin-siihen").
const normFi = (s) => String(s).replace(/\s*[-\u2010\u2013\u2014]\s*/g, '-').replace(/\s+/g, ' ').trim();

// Minimal "--key value" / "--flag" parser. Repeated keys collect into arrays.
function parseArgs(argv, { flags = [], multi = [] } = {}) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { args._.push(a); continue; }
    const eq = a.indexOf('=');
    const key = (eq === -1 ? a.slice(2) : a.slice(2, eq));
    if (flags.includes(key)) { args[key] = true; continue; }
    const val = eq === -1 ? argv[++i] : a.slice(eq + 1);
    if (val === undefined) throw new Error(`--${key} needs a value`);
    if (multi.includes(key)) (args[key] = args[key] || []).push(val);
    else args[key] = val;
  }
  return args;
}

module.exports = {
  BOOK_IDS, SCROLLMAPPER_NAMES, sha256, dirDigest, readReleaseFile, serialise,
  writeReleaseFile, rowMap, normFi, parseArgs,
};
