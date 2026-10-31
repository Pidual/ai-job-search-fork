# Template: onepage-blue

- **Type:** CV
- **Source extension:** .tex
- **Engine/toolchain:** lualatex
- **Page limit:** 1 page
- **Fonts:** TeX Gyre Heros (Helvetica clone; system/distribution font - ships with MiKTeX/TeX Live, loaded via fontspec)
- **Class/packages:** `article` + geometry, fontspec, xcolor, titlesec, enumitem, needspace, hyperref (all standard)

## Compile command

    cd cv && rm -f <file>.pdf && mkdir -p build && lualatex -interaction=nonstopmode -output-directory=build <file>.tex && mv build/<file>.pdf ./

## Style rules

- Single column, US Letter, 10pt TeX Gyre Heros. Blue accents (moderncv blue, `cvblue` = rgb 0.22,0.45,0.70) only on the name, section headings and the rule under each heading; all body text black.
- Header: name in bold uppercase blue, then two lines: `Email: ... | Phone: ...`, `GitHub: ... | LinkedIn: ...`, bold labels and values as literal text (ATS needs the literal email/phone). Spanish CVs use `Correo / Teléfono`.
- **Never put the candidate's home location on the CV** (no Location/Ubicación line, no city of residence anywhere - candidate's standing instruction, 30 Oct 2026). Employer and school locations in entries are fine; on-site availability for the target city may go in the summary when the posting requires it.
- Optional Skills section (`Skills` / `Competencias`) after the Summary: at most 4 `\cvskill{Label}{items}` lines, each kept to about one printed line.
- Section order: Professional Summary -> Experience -> Education -> Projects -> Courses and Certifications. A short Skills section may be added after the Summary only when the posting is keyword-heavy and space allows. Headings are written in the CV's language (e.g. Perfil Profesional / Experiencia / Educación / Proyectos / Cursos y Certificaciones for Spanish); `\section` uppercases them automatically.
- Experience entries: `\cventry{Company -- Team -- Country}{Mon YYYY - Mon YYYY}` then `\cvdesc{...}` with **one paragraph of 3-4 lines** per role - prose, not bullets. Weave in metrics (1,361 evidence requests, 90.4% delivery rate, 9 workflows) and the posting's own keywords.
- Projects: one flagship project with `\cventry` + `\cvdesc` (2-3 lines), then up to two `\cvline{Title}{one-line description}{Year}` items.
- Certifications: `\cvcert{Name}{Mon YYYY}`, one per line, most relevant first; awards may sit in this list.
- No References line - it does not fit the one-page format.
- Budget for one page: summary 4-5 lines; current role 3-4 lines; previous role 3-4 lines; education 2 lines; projects ~6 lines; certifications up to 6 lines. The page should end in the bottom quarter, not mid-page; restore cut content if it ends above ~70%.

## Known pitfalls

- Date ranges must use an ASCII hyphen (`Jan 2025 - Jan 2026`), never `--`: an en-dash next to a year breaks ATS date import (`verify_pdf.py --ascii-dates`). `--` is fine in entry titles (`Company -- Team`).
- `\cventry` already calls `\needspace{4\baselineskip}`; on a one-page CV a spill to page 2 means content must be cut (relevance-weighted cutting), never shrink geometry or font size.
- `\MakeUppercase` is applied by titlesec's last format argument; do not put it in the first (format) argument - that breaks compile with `\ttl@row@i` errors.
- The page fills fast: summary (4-5 lines) + 4 skills lines + 2 role paragraphs + 2 project lines + 6 certifications is the full budget. A multi-line `\cventry` project block or 2-line skills items push Projects onto page 2; prefer one-line `\cvline` projects.
- `\cventry` titles wrap inside an 80%-width box and the date is an unbreakable `\mbox`, so a long Spanish title wraps instead of splitting the date.
- Wrap words that must not hyphenate (e.g. `\mbox{Sobresaliente}`); Spanish text has no babel hyphenation patterns loaded.
- `pdftotext -layout` may space out the large name (`CARLOS HERNANDO    LOZANO`); harmless for ATS.
- `verify_layout.py` thresholds are calibrated for the stock 2-page moderncv layout; on this template only the hole and bottom-whitespace checks matter.
