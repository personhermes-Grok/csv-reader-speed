// Fast drop-in replacement for csv-reader 1.0.0 (make.fun's own reference program).
//
// Same contract: run(input) returns exactly readCsv's {columns, rows, errors} for every
// {text, header}. Same broken-row policy (BOM drop, stray_cr, quote_junk,
// unterminated_quote, short_row/long_row, blank lines are no records).
//
// Speed strategy: the reference reads one character at a time and builds each field with
// `value += c`. This version never loops per character and allocates almost nothing per
// field:
//   - the field parsers are inlined into the record loop (no per-field function call and
//     no per-field result object);
//   - the next LF and the next CR are cached and only re-scanned when the read position
//     passes them, so an unquoted field usually costs a single indexOf(',') plus a slice;
//   - an unquoted field is a slice of the input (O(1), shared); a stray CR inside it is
//     the only case that copies, via split/join (rare);
//   - a quoted field is found with indexOf('"') (C++); "" escapes are assembled with
//     string concatenation (lazy cons strings, no array, no join); \r\n / lone \r inside
//     quotes become \n via replaceAll (C++); line breaks inside a quoted field are
//     counted with an indexOf loop over '\n'.
// Slices share the parent string; the only copies happen when a field genuinely needs
// characters removed (stray CRs) or converted (\r -> \n inside quotes), or when the
// driver JSON-stringifies the answers.
//
// No state is kept between calls; nothing is cached from one case to the next.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input, computed faster. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  // Every error of a record carries these two, never the line the error itself was met on.
  let recordLine = 1;
  let recordRow = null;

  // Cached scan positions, both meaning "the next one at or after pos, or n when there is
  // none". -1 means "not computed yet". They are only re-scanned when pos passes them, so
  // the cost of finding the next LF / CR is paid once per line break, not once per field.
  let nextLF = -1;
  let nextCR = -1;

  // Number of '\n' in s, by indexOf (no allocation).
  function countLF(s) {
    let c = 0;
    let i = -1;
    while ((i = s.indexOf('\n', i + 1)) !== -1) c += 1;
    return c;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    let ended = COMMA;

    do {
      quoted = text.charCodeAt(pos) === 34;
      let value;
      let added = 0; // characters kept by this field (a dropped stray CR does not count)
      if (!quoted) {
        // ---- unquoted field ----
        if (nextLF < pos) {
          nextLF = text.indexOf('\n', pos);
          if (nextLF === -1) nextLF = n;
        }
        if (nextCR < pos) {
          nextCR = text.indexOf('\r', pos);
          if (nextCR === -1) nextCR = n;
        }
        const comma = text.indexOf(',', pos);
        let end; // end of the value (excluding a CRLF's CR)
        let term; // position of the terminator itself (the comma, the LF, or the end of text)
        if (comma !== -1 && comma < nextLF) {
          end = comma;
          term = comma;
          ended = COMMA;
        } else if (nextLF < n) {
          end = nextLF;
          term = nextLF;
          ended = LINE_BREAK;
          // A CR immediately before the LF is the CRLF line break, not part of the value.
          // The terminator stays the LF, so pos still advances past it.
          if (end > pos && text.charCodeAt(end - 1) === 13) end -= 1;
        } else {
          end = n;
          term = n;
          ended = END;
        }
        if (nextCR < end) {
          // A stray CR sits inside this field (a CR followed by LF would have made that
          // LF the terminator, and the CRLF one was just excluded above): drop every CR
          // in the segment, one stray_cr error each.
          const seg = text.slice(pos, end);
          const parts = seg.split('\r');
          for (let i = 1; i < parts.length; i += 1) {
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          }
          value = parts.join('');
          added = value.length;
          nextCR = -1; // the scan position past the dropped CRs is unknown; re-scan
        } else {
          value = text.slice(pos, end);
          added = value.length;
        }
        if (ended === COMMA) {
          pos = term + 1;
        } else if (ended === LINE_BREAK) {
          pos = term + 1;
          line += 1;
        } else {
          pos = n;
        }
      } else {
        // ---- quoted field ----
        const open = pos;
        const openLine = line;
        pos += 1;
        let p = pos; // start of the span currently being scanned (just after the opening quote)
        value = '';
        for (;;) {
          const q = text.indexOf('"', p);
          if (q === -1) {
            // The quote never closes: it is a literal character, and the text after it
            // is read again as an unquoted field.
            pos = open + 1;
            line = openLine;
            nextLF = -1;
            nextCR = -1;
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            // Re-read as unquoted, starting with the literal quote. (Same code as the
            // unquoted field above, with the value starting at '"'.)
            if (nextLF < pos) {
              nextLF = text.indexOf('\n', pos);
              if (nextLF === -1) nextLF = n;
            }
            if (nextCR < pos) {
              nextCR = text.indexOf('\r', pos);
              if (nextCR === -1) nextCR = n;
            }
            const comma = text.indexOf(',', pos);
            let end;
            let term;
            if (comma !== -1 && comma < nextLF) {
              end = comma;
              term = comma;
              ended = COMMA;
            } else if (nextLF < n) {
              end = nextLF;
              term = nextLF;
              ended = LINE_BREAK;
              if (end > pos && text.charCodeAt(end - 1) === 13) end -= 1;
            } else {
              end = n;
              term = n;
              ended = END;
            }
            if (nextCR < end) {
              const seg = text.slice(pos, end);
              const parts = seg.split('\r');
              for (let i = 1; i < parts.length; i += 1) {
                errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              }
              const kept = parts.join('');
              value = '"' + kept;
              added = kept.length;
              nextCR = -1;
            } else {
              const kept = text.slice(pos, end);
              value = '"' + kept;
              added = kept.length;
            }
            if (ended === COMMA) {
              pos = term + 1;
            } else if (ended === LINE_BREAK) {
              pos = term + 1;
              line += 1;
            } else {
              pos = n;
            }
            break;
          }
          if (text.charCodeAt(q + 1) === 34) {
            // "" inside a quoted field is one quote.
            value += text.slice(p, q) + '"';
            p = q + 2;
            continue;
          }
          // Closing quote at q.
          value += text.slice(p, q);
          // CRLF and a lone CR inside quotes are each one LF; count the line breaks.
          if (value.indexOf('\r') !== -1) {
            value = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
          }
          line += countLF(value);
          pos = q + 1;
          // What follows the closing quote.
          if (pos >= n) {
            ended = END;
            break;
          }
          const c = text.charCodeAt(pos);
          if (c === 44) {
            pos += 1;
            ended = COMMA;
            break;
          }
          if (c === 10) {
            pos += 1;
            line += 1;
            ended = LINE_BREAK;
            break;
          }
          if (c === 13 && text.charCodeAt(pos + 1) === 10) {
            pos += 2;
            line += 1;
            ended = LINE_BREAK;
            break;
          }
          // What follows the closing quote is appended as it stands, up to the next
          // comma or line break. (Same code as the unquoted field above.)
          if (nextLF < pos) {
            nextLF = text.indexOf('\n', pos);
            if (nextLF === -1) nextLF = n;
          }
          if (nextCR < pos) {
            nextCR = text.indexOf('\r', pos);
            if (nextCR === -1) nextCR = n;
          }
          const comma = text.indexOf(',', pos);
          let end;
          let term;
          if (comma !== -1 && comma < nextLF) {
            end = comma;
            term = comma;
            ended = COMMA;
          } else if (nextLF < n) {
            end = nextLF;
            term = nextLF;
            ended = LINE_BREAK;
            if (end > pos && text.charCodeAt(end - 1) === 13) end -= 1;
          } else {
            end = n;
            term = n;
            ended = END;
          }
          if (nextCR < end) {
            const seg = text.slice(pos, end);
            const parts = seg.split('\r');
            for (let i = 1; i < parts.length; i += 1) {
              errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            }
            const junk = parts.join('');
            added = junk.length;
            value += junk;
            nextCR = -1;
          } else {
            const junk = text.slice(pos, end);
            added = junk.length;
            value += junk;
          }
          if (added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
          if (ended === COMMA) {
            pos = term + 1;
          } else if (ended === LINE_BREAK) {
            pos = term + 1;
            line += 1;
          } else {
            pos = n;
          }
          break;
        }
      }
      fields.push(value);
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
