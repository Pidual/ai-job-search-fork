# Template: ruled-classic

- **Type:** CV
- **Source extension:** .tex
- **Engine/toolchain:** lualatex
- **Page limit:** 1 page
- **Fonts:** Latin Modern Roman (lualatex/fontspec default - ships with MiKTeX/TeX Live)
- **Class/packages:** `article` + geometry, fontspec, xcolor, titlesec, enumitem, needspace, tabularx, hyperref (all standard)

## Compile command

    cd cv/drafts && rm -f <file>.pdf && mkdir -p build && lualatex -interaction=nonstopmode -output-directory=build <file>.tex && mv build/<file>.pdf ./

## Style rules

Rebuilt 2026-11-07 from the candidate's own `CV_CARLOS_LOZANO_GRC.pdf`, which is the reference for tone and density.

- Single column, US Letter, 10pt Latin Modern, black text. The only colour: underlined blue links (email, LinkedIn, reference emails) and grey entry locations.
- Header: name `\LARGE\bfseries` centered, **"Carlos Lozano"**; one line below: `<Headline> | email | phone | linkedin`, with email and phone as literal text (ATS). The headline is the target role or closest truthful title (e.g. `GRC Analyst`). No GitHub unless the posting is technical; then append `| github.com/Pidual`.
- **Never put the candidate's home location on the CV.**
- Section order: **Summary -> Experience -> Education -> Skills -> Certifications -> References.** An optional **Projects** section goes between Education and Skills only for technical postings. Headings in the CV's language (Resumen / Experiencia / Educación / Habilidades / Certificaciones / Referencias for Spanish).
- **Summary:** one `\small` paragraph, 4-5 printed lines: who you are, the employer-by-employer evidence in one sentence each, then a closing line (degree + automation angle, Security+, English C2).
- **Experience entries:** `\cventry{Role}{Mon YYYY - Mon YYYY}{Employer}{Location}` then `cvbullets`. Profound: 3 bullets. Banco de Bogotá: up to 6 bullets. Bullets can run to 2 printed lines; past-tense verb first; module-by-module detail is the style (evidence, audit, findings, dashboards).
  - Profound line: `\cventry{Information Security Analyst}{Sep 2026 - Oct 2026}{Profound (via OpsArmy)}{Remote}`.
  - Banco de Bogotá line (candidate decision 2026-11-07): `\cventry{Cybersecurity Compliance Team}{Jan 2025 - Jan 2026}{Banco de Bogot\'a}{Bogot\'a, Col}`. The official title (Aprendiz Practicante Empresarial) stays for forms/background checks.
  - The app is **ISMS+** on English CVs, **SGSI+** on Spanish CVs.
- **Education:** one tabularx line `\textbf{Degree}, University & \textbf{2020 - 2026}`, then the thesis-title line. Never the GPA or the "Sobresaliente" grade.
- **Skills:** 3-4 `\cvskill{Label}{items}` lines, last one `Languages`. Use the posting's exact keyword spellings.
- **Certifications:** `Name (YYYY)` one per line, most relevant first.
- **References** last: Melissa Letts (OpsArmy) and Martin Gordillo (Banco de Bogotá), both lines - see `01-candidate-profile.md`.
- The reference PDF ends at ~75% of the page. That is acceptable; fill toward the bottom quarter with relevant content when available, never with padding.

## Known pitfalls

- Date ranges must use an ASCII hyphen (`Jan 2025 - Jan 2026`), never `--`; the reference PDF used en-dashes, which break ATS date import (`verify_pdf.py --ascii-dates`). `--` is fine elsewhere (reference lines).
- `\cventry` is a tabularx block and calls `\needspace{5\baselineskip}`; on a one-page CV a spill means cutting content, never shrinking geometry or font size.
- A very long role argument collides with the date column; keep the role short, put detail in the employer argument.
- Spanish text: check for bad hyphenation in the PDF and wrap the word in `\mbox{}`.
- `verify_layout.py` thresholds are calibrated for the stock 2-page moderncv layout; on this template only the hole and bottom-whitespace checks matter. Its "body text inside the bottom margin band / footer" warning is a false positive here (`\pagestyle{empty}`, no footer) - text ending ~80pt above the page edge is fine.
- Education line: the full university name plus "(UPTC)" overflows into the date column (measured 2026-11-07). Use the name without "(UPTC)".
- Header: a headline longer than ~2 words plus email, phone, LinkedIn and GitHub wraps to two lines. Keep the headline short (e.g. `Systems Engineer`, `GRC Analyst`) or drop GitHub on GRC CVs.
- First real use (Amadeus SDE, 2026-11-07) needed: summary 4 lines, Profound 3 bullets, bank 4 bullets, 2 one-line projects, 2-line education, 4 skills lines, 4 cert lines, 2 references to fill exactly one page (~89%).
