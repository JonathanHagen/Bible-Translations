# Bible Translations

Pre-converted JSON Bible translation files.

Files are distributed as GitHub Release assets tagged `translations-v1`.

## Rebuilding finnish.json and croatian.json

The published `finnish.json` and `croatian.json` had faults that the tools in
`tools/` repair without changing anything an installed app relies on: the
JSON shape and key order, the book ids, and every chapter and verse number
(Finnish only gains rows at the ends of chapters). Both tools use Node's
built-ins only (Node 18 or newer).

- **finnish.json** (Pyhä Raamattu 1933/1938) lacked the last verse of 39
  books and 2 Corinthians 9:15. The rebuild appends a missing verse only
  when it is the next number after the chapter's last row, the two sources
  agree on it (or, where they differ, the tie-breaker sides with B), the
  verse before it lines up with the published row, and its text is not
  already in that chapter or the next one. Every published row stays byte
  for byte, including the stray `2CO 19` and 2 Chronicles 23 (whose 23:3
  holds verse 4's text). Zechariah 14:21 is also missing, but source B has
  no Zechariah 4–14, so the default build leaves it out; `--allow-ac` adds
  it where sources A and C agree byte for byte.
- **croatian.json** had lost every č ć š ž đ (deleted, not transliterated:
  "poetku" for "početku") and carried raw markup that the app shows as text:
  `<p>`, `</p>`, `<h2>…</h2>` and Psalm acrostic letters such as `$ALEF`.
  The rebuild strips that markup and puts the letters back into the
  published text, guided by a source with diacritics, only where the place
  is unambiguous. With its accents deleted, every rebuilt verse equals the
  published verse with the markup stripped.

### Sources (pinned)

| | Repository @ commit | Path | sha256 |
|---|---|---|---|
| Finnish A | scrollmapper/bible_databases @ `e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c` | `formats/json/FinPR.json` | `0f9b2494e5163bafb1003ede657513608f8deaaa690f2d8bf266f29b023f1355` |
| Finnish B | JanHerca/urantiapedia @ `953cd9cc89b04817a9a7c5bae63af8f7e07f4274` | `input/tex/bible-fi/` (66 `.tex`) | tree `bb3021268ee54377750cc2788a772b6d195b39728d1f68e602f4bef384e84a43` |
| Finnish C (tie-breaker) | raamattu/raamattu @ `5971241a3ad2810240d0f7531b978e79d39609dc` | `tekstit/` (66 `.usfm`) | tree `348d0063a6a76228082bfcb1a449136bd34687cdfa90ed6f1ced3325178654c4` |
| Croatian | scrollmapper/bible_databases @ `e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c` | `formats/json/CroSaric.json` | `ebb65c628f69fb38b58249fa354543c8114432c450ba751e1fcf30e041229d4c` |

A tree digest is the sha256 of the lines `<file name>\0<sha256 of the file>\n`
for the directory's files in name order; the rebuild prints it.

The rebuild refuses any original but the published one:
`finnish.json` sha256 `393c05e6172309bdda2d7e0e31236c101cd03ee3e2146692bdfad47abbc76f2c`,
`croatian.json` sha256 `dc9ef13a7e8a7766f53d4bd693c88f739861d10a615ea04e95cae39c31284004`.

### Commands

Work outside the repository; keep downloads apart from the tools.

```sh
mkdir -p rebuild/orig rebuild/src rebuild/out && cd rebuild
for id in finnish croatian; do
  curl -fL -o orig/$id.json \
    https://github.com/JonathanHagen/Bible-Translations/releases/download/translations-v1/$id.json
done
SM=https://raw.githubusercontent.com/scrollmapper/bible_databases/e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c
curl -fL -o src/FinPR.json $SM/formats/json/FinPR.json
curl -fL -o src/CroSaric.json $SM/formats/json/CroSaric.json
git clone -q --filter=blob:none --no-checkout --sparse https://github.com/JanHerca/urantiapedia.git src/urantiapedia
git -C src/urantiapedia sparse-checkout set --no-cone 'input/tex/bible-fi/*'
git -C src/urantiapedia checkout -q 953cd9cc89b04817a9a7c5bae63af8f7e07f4274
git clone -q --filter=blob:none --no-checkout --sparse https://github.com/raamattu/raamattu.git src/raamattu
git -C src/raamattu sparse-checkout set --no-cone 'tekstit/*'
git -C src/raamattu checkout -q 5971241a3ad2810240d0f7531b978e79d39609dc

T=/path/to/Bible-Translations/tools
node $T/rebuild-finnish-croatian.js finnish --orig orig/finnish.json --finpr src/FinPR.json \
  --urantiapedia src/urantiapedia/input/tex/bible-fi --raamattu src/raamattu/tekstit \
  --out out/finnish.json --report out/report-finnish.json
node $T/rebuild-finnish-croatian.js croatian --orig orig/croatian.json --crosaric src/CroSaric.json \
  --out out/croatian.json --report out/report-croatian.json
```

The rebuild prints the input digests, how closely each source matches the
published text, every verse it adds or rejects and why (Finnish), the markup
it strips by token, how each verse found its guide and a vocabulary check
(Croatian), and the output's size and sha256. The output is written with
`JSON.stringify`, minified, UTF-8 without a BOM, as the published files are.
Rebuilt from these inputs it is:

| File | Bytes | sha256 |
|---|---|---|
| `finnish.json` (default) | 4,936,536 | `1ae55db524807f355bc27e3e4dc6544b56710897a87fc6857bb7486627856281` |
| `finnish.json` (`--allow-ac`, with ZEC 14:21) | 4,936,797 | `a6ecf33235d3105b5617f7d1cba5ef30f0b3924ceca9f104f2321e412ef7b7ef` |
| `croatian.json` | 4,122,997 | `2760bea6692f29dbf6e45a4a42aeae29e5f10d561e322dabd812297738b25639` |

### Validating before an upload

`tools/validate-translation.js` compares a rebuilt file with the published
one and loads both through the app's own `src/services/bibleLoader.js`, with
its file-system and bundled-KJV imports stubbed, so a file is proven against
the loader in the store build and the current one:

```sh
git -C /path/to/BoundBible show 03f11d1:src/services/bibleLoader.js > store-loader.js
git -C /path/to/BoundBible show HEAD:src/services/bibleLoader.js > current-loader.js
node $T/validate-translation.js --mode finnish --orig orig/finnish.json --new out/finnish.json \
  --final-source src/FinPR.json --allow-missing-final ZEC \
  --expect-added "$(node -p "require('./out/report-finnish.json').additions.map(a=>a.key).join(',')")" \
  --loader store=store-loader.js --loader current=current-loader.js --sample REV:22
node $T/validate-translation.js --mode croatian --orig orig/croatian.json --new out/croatian.json \
  --loader store=store-loader.js --loader current=current-loader.js --sample PSA:9
```

Drop `--allow-missing-final ZEC` when validating an `--allow-ac` build. The
checks: the file is minified UTF-8 without a BOM and round-trips through
`JSON.stringify`; the shape and key order; the same books and chapters in
the same order; no empty rows; Croatian verse numbers identical, Finnish
rows all byte-identical with new rows only continuing a chapter; Finnish:
the expected additions, every book ending with its source's last verse, the
stray `2CO 19` untouched; Croatian: deleting the accents gives back the
published text with its markup stripped, no markup left, č ć š ž đ
present and no other non-ASCII character; each loader reads every book,
chapter and row of both files, and prints the sample chapter's XML from
each. It exits 1 when a check fails.
