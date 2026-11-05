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

- Single column, US Letter, 10pt TeX Gyre Heros. Blue accents (moderncv blue, `cvblue` = rgb 0.22,0.45,0.70) only on the name, section headings, the rule under each heading, the employer/school line of each entry and the bullet markers; all other body text black.
- Header: name in bold uppercase blue, then a one-line **headline** (`\large`, black) naming the target role or closest truthful title plus 2-3 frameworks (e.g. `Information Security Analyst | GRC -- ISO/IEC 27001, SOC 2`), then two lines: `Email: ... | Phone: ...`, `GitHub: ... | LinkedIn: ...`, bold labels and values as literal text (ATS needs the literal email/phone). Spanish CVs use `Correo / Teléfono`.
- **Never put the candidate's home location on the CV** (no Location/Ubicación line, no city of residence anywhere - candidate's standing instruction, 30 Oct 2026). Employer and school locations in entries are fine; on-site availability for the target city may go in the summary when the posting requires it.
- Skills section (`Skills` / `Competencias`) after the Summary: 3 `\cvskill{Label}{items}` lines (4 at most), each about one printed line, using the posting's exact keyword spellings.
- Section order: Professional Summary -> Skills -> Experience -> Education -> (Projects, optional) -> Courses and Certifications -> References. Headings are written in the CV's language (e.g. Perfil Profesional / Experiencia / Educación / Proyectos / Cursos y Certificaciones for Spanish); `\section` uppercases them automatically.
- **Professional Summary: 3 lines max.** Who you are, the 2-3 frameworks/tools the posting names, one differentiator. Never restate the experience bullets (no metrics duplicated between summary and bullets).
- **Experience entries (v2, bullets - 3 Nov 2026):** `\cventry{Role}{Employer -- Team -- Location}{Mon YYYY - Mon YYYY}` then a `cvbullets` list. Line 1 = bold role + date; line 2 = employer in blue. Keep the role argument to one printed line - team and location go in the employer argument. **No prose paragraphs.**
  - 3 bullets for the short Profound role, 4 for Banco de Bogotá. Each bullet: past-tense verb first, one printed line (two at most), the posting's own terms, a number where one truthfully exists.
  - Lead the Banco de Bogotá list with the SGSI+ result bullet (1,361 evidence requests, 90.4% delivery, 9 workflows, external-auditor recognition) - it is the strongest line on the page.
  - Banco de Bogotá role line: `Aprendiz Practicante Empresarial (SGSI ISO/IEC 27001)` (ES) / `Business Intern (ISMS, ISO/IEC 27001)` (EN): the full official title, with the function in parentheses so it never reads as part of the title (SFC-supervised employers check the certificado laboral).
- Education: `\cventry{Degree}{University, City}{dates}` with the tarjeta profesional in the degree title. Optionally one line naming a relevant course (e.g. Auditoría de Sistemas for audit roles). **Never include the GPA / promedio, and never mention the práctica empresarial / "Sobresaliente" grade** (candidate rules, 4 Nov 2026).
- Projects: **optional.** Include one `\cvline` (e.g. the security homelab) only when the posting is technical enough to value it; for pure GRC/audit roles drop the section. Never include the ResNet50 image classifier on a GRC CV.
- Certifications: `\cvcert{Name}{Mon YYYY}`, one per line, most relevant first; awards may sit in this list.
- **References section last** (decided 2026-11-03, see `01-candidate-profile.md`): `\section{Referencias}` / `\section{References}` with the single Melissa Letts (OpsArmy) line. If space is short, cut a certification that duplicates the Idiomas/Languages line (EF SET) first.
- Budget for one page: headline 1 line; summary 3 lines; skills 3-4 lines; Profound 3 bullets; Banco de Bogotá 4 bullets; education 3 lines; optional 1 project line; certifications up to 6 lines. The page should end in the bottom quarter, not mid-page; restore cut content if it ends above ~70%.

## Known pitfalls

- Date ranges must use an ASCII hyphen (`Jan 2025 - Jan 2026`), never `--`: an en-dash next to a year breaks ATS date import (`verify_pdf.py --ascii-dates`). `--` is fine in entry titles (`Company -- Team`).
- `\cventry` already calls `\needspace{5\baselineskip}`; on a one-page CV a spill to page 2 means content must be cut (relevance-weighted cutting), never shrink geometry or font size.
- `\MakeUppercase` is applied by titlesec's last format argument; do not put it in the first (format) argument - that breaks compile with `\ttl@row@i` errors.
- The page fills fast: headline + 3-line summary + 3 skills lines + 3+4 bullets + 3-line education + 5 certifications ends around 80% of the page (measured 3 Nov 2026). Room left over goes to one project line or a 4th Profound bullet, not to a longer summary.
- `\cventry` puts the role and date on one line with no wrapping box: a role argument that is too long collides with the date. Shorten the role, move detail to the employer line.
- Spanish text has no hyphenation patterns, so LaTeX can split words badly (`cumpli-miento`). Check the PDF and wrap the offending word in `\mbox{}`.
- `pdftotext -layout` may space out the large name (`CARLOS HERNANDO    LOZANO`); harmless for ATS.
- `verify_layout.py` thresholds are calibrated for the stock 2-page moderncv layout; on this template only the hole and bottom-whitespace checks matter.
