# Search Queries for Job Scraper

<!-- Configured by /setup on 2026-10-25 for Carlos Hernando Lozano Pérez. Retargeted 2026-10-30: ALL IN on GRC / InfoSec
(IT support / help desk / NOC / sysadmin dropped). Hyper-focus from 2026-11-03: InfoSec governance / GRC only - SOC, security engineering and cloud security engineering are no longer searched. Market: Colombia (any city) + remote. -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. For this profile the important ones are **`linkedin-search`**, **`computrabajo-search`** and **`elempleo-search`** (Colombia), plus **`company-pages-search`** (employer ATS boards from `company_pages.json`) and the remote-job boards already enabled (Torre, ticjob, Remotive, WeWorkRemotely, Himalayas, Jobicy, etc.). See the Incremental window, Pacing and Title Exclusions sections below before running. The Danish portals (Jobindex, Jobbank, Jobdanmark, Jobnet) stay **disabled**.

The `site:` query templates in this file are the **WebSearch fallback** - for portals without a CLI, company career pages, or when a CLI fails.

**Language scope:** every category is written in **Spanish and English** (the two languages in the CLAUDE.md Languages table: Spanish native, English C2). Colombian boards mostly post in Spanish; remote/international roles mostly in English.

## Search Sites

Primary:
- **co.computrabajo.com** - Colombia's largest general job board (`computrabajo-search` CLI)
- **elempleo.com/co** - major Colombian board (`elempleo-search` CLI)
- **linkedin.com/jobs** - filter: Colombia / Bogotá / Medellín / Remote (`linkedin-search` CLI)
- **torre.ai**, **ticjob.co** - LatAm tech and remote roles (CLIs enabled)

Secondary (company career pages via Google):
- Banks and fintech: Bancolombia, Banco de Bogotá, Davivienda, BBVA Colombia, Grupo Aval, Nu Colombia, Rappi
- Consultancies / MSSPs: Deloitte, EY, KPMG, PwC, Accenture, Globant, EPAM, Thoughtworks, Sophos Solutions, Ikusi
- Remote US/EU SaaS companies hiring LatAm GRC talent (staffing firms like OperationsArmy, Toptal, BairesDev)

## Query Categories

Organized by function. Combine with location terms (Colombia, Bogotá, Medellín, Cali, remoto/remote) where the site supports it.

### Priority 1: GRC / Information Security Analyst (ALL-IN focus since 2026-10-30)

Compliance, ISO 27001, SOC 2, risk, audit, security policy, IT audit, third-party/vendor risk. Default `/scrape` runs this category first and widest. Do not search IT support / help desk / NOC / sysadmin roles.

```
"analista de seguridad de la información" Colombia
"analista GRC" OR "analista de riesgos de seguridad" Colombia
"ISO 27001" analista Colombia
"analista de cumplimiento" seguridad de la información
"auditor interno ISO 27001" OR "SGSI" analista
"Information Security Analyst" Colombia OR LATAM remote
"GRC Analyst" OR "Compliance Analyst" "SOC 2" remote LATAM
"Security Compliance Analyst" ISO 27001 remote
"GRC Specialist" OR "GRC Associate" OR "Governance Risk Compliance" remote
"Third-Party Risk Analyst" OR "Vendor Risk" OR "TPRM" remote LATAM
"IT Auditor" OR "auditor de TI" OR "auditor de sistemas" Colombia
"Technology Risk Analyst" OR "analista de riesgo tecnológico" OR "riesgo de TI" Colombia
"analista de gobierno de seguridad" OR "gobierno de TI" Colombia
"SOC 2" OR "Vanta" OR "Drata" compliance analyst remote
site:linkedin.com/jobs "Information Security Analyst" Colombia
site:co.computrabajo.com "seguridad de la información"
site:elempleo.com "seguridad de la información" analista
```

### Priority 2: Cloud compliance / cloud GRC (governance only)

Cloud only when the job is compliance or governance. No SOC, security-engineering or cloud-engineering queries (dropped 2026-11-03).

```
"Cloud Compliance" OR "Cloud GRC" analyst remote
"cumplimiento" "nube" seguridad de la información Colombia
"Security Governance" OR "Information Security Governance" remote LATAM
```

### Priority 3: Broader GRC (wider net)

Still governance, risk, compliance or audit. A generic "analista de ciberseguridad" title is kept only when the posting is about policy, controls, risk or compliance, not monitoring.

```
"Technology Risk Analyst" OR "analista de riesgo tecnológico" Colombia
"IT Auditor" OR "auditor de sistemas" junior Colombia
"Third-Party Risk Analyst" OR "Vendor Security" remote
"analista de riesgo operacional" tecnología Colombia
"control interno" TI OR "ITGC" OR "SOX" analista Colombia
"oficial de seguridad de la información" OR "CISO office" analista
"continuidad del negocio" OR "BCP" analista seguridad de la información
"privacidad" OR "protección de datos" analista cumplimiento Colombia
```

**Suggested extras worth trying** (not yet confirmed by the candidate): Technology Risk / IT Audit roles at Big Four firms (strong ISO 27001 overlap), Third-Party / Vendor Risk roles at SaaS companies (overlap with SOC 2 + Vanta work), and Security Automation roles (SGSI+ shows automation strength).

## Location Filter

Candidate is based in Yopal, Casanare, and will relocate within Colombia.
- **Ideal:** Fully remote (Colombia-eligible or international/US company hiring LatAm)
- **Acceptable:** On-site or hybrid in any Colombian city (Bogotá, Medellín, Cali, Barranquilla, Bucaramanga, Tunja, Yopal, etc.)
- **Borderline:** Roles requiring relocation outside Colombia - flag for discussion
- **Too far:** Roles requiring work authorization the candidate lacks (e.g. US/EU on-site with citizenship/visa requirements)

## Pay Filter

Minimum **COP 3,200,000/month**. Exclude postings that state pay below this; keep postings with unstated pay. Note fixed-term / project-only contracts (acceptable; long-term preferred).

## Language Filter

Your working languages and levels are in CLAUDE.md's Languages table. When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language you haven't declared at all is excluded; a posting requiring a higher level than you declared in a language you do work in is not excluded, flag it clearly instead (see `job-scraper/SKILL.md`'s Step 3 "Quick Fit Assessment" for how the flag surfaces in `/scrape` output). Postings simply *written* in a language you don't work in, that don't require it on the job, are fine.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

**Incremental window (added 2026-11-03).** Scrapes run every 1-3 days, so a fixed 14-day window re-fetches mostly already-seen jobs (2026-11-03: 99 of ~110 relevant Colombia hits were already seen). Instead, set `--jobage` to the days since the last scrape + 1 (minimum 3 days, maximum 14 days), and spend the saved request budget on pages 2-3:

```bash
python -I -c "import json,datetime as d;s=json.load(open('job_scraper/seen_jobs.json',encoding='utf-8'))['seen'];t=d.date.today();f=[d.date.fromisoformat(v['first_seen']) for v in s.values() if v.get('first_seen') and d.date.fromisoformat(v['first_seen'])<t];print(min(14,max(3,(t-max(f)).days+1)) if f else 14)"
```

Portals whose `--jobage` only accepts fixed values (LinkedIn/Computrabajo/Elempleo: `1`, `7`, `14`, `30`) round **up** to the next accepted value. Use the full 14 days on an explicit `/scrape broad`.

## Pacing (LinkedIn rate limit)

LinkedIn returns 429 when it gets ~60+ guest-search calls at once. Run LinkedIn calls in batches of at most ~10 in parallel (or one at a time with a few seconds between calls), and fetch `detail` pages one at a time. The other portals can run fully in parallel.

## Title Exclusions (pre-filter before dedup/detail)

The Spanish keywords `seguridad`, `riesgo`, `cumplimiento` and `auditor` mostly match non-GRC jobs. Drop a hit **by title** (case-insensitive substring) before `scrape_state.py candidates` if it contains any of:

```
SST, salud en el trabajo, salud ocupacional, HSE, HSEQ, QHSE, QSE, seguridad industrial, seguridad vial,
seguridad física, seguridad privada, vigilante, guarda, escolta, motorizado, medios tecnológicos, OMT, centro de control, monitoreo de medios,
SARLAFT, SAGRILAFT, AML, KYC, lavado de activos, sanctions, fraude,
auditor financiero, auditoría financiera, revisoría fiscal, costos, inventarios, contable, contador, cartera, nómina,
laboratorio, enfermer, médic, psicólog, calidad (unless with "seguridad de la información"),
riesgos laborales, alto riesgo, riesgo crediticio, riesgo financiero, seguros, pólizas,
asesor comercial, servicio al cliente, call center, ventas
```

Keep a hit that matches an exclusion **only** when the title also contains a GRC anchor: `información`, `informática`, `ciber`, `TI`, `IT`, `tecnológic`, `ISO 27001`, `GRC`, `SOX`, `SGSI`, `cloud`.

**Security-operations exclusions (hyper-focus from 2026-11-03).** Also drop a hit whose title contains any of the following. The GRC-anchor override above does **not** apply to this list:

```
SOC, NOC, monitoreo, Blue Team, Red Team, pentest, pentester, ethical hacking, threat hunting, threat intelligence,
incident response, incident handler, respuesta a incidentes, forense, DFIR, detection engineer,
vulnerabilidades, vulnerability, Security Engineer, Ingeniero de ciberseguridad, Ingeniero de seguridad,
Cloud Engineer, Ingeniero Cloud, DevSecOps, Security Architect, arquitecto de seguridad, SIEM, EDR, firewall, perimetral
```

Keep the hit only when the title also names governance work: `GRC`, `compliance`, `cumplimiento`, `riesgo`, `auditor`, `gobierno`, `governance`, `ISO 27001`, `SGSI`, `SOX`, `política`. "SOC 2" is a compliance framework, not a SOC role, so never drop a title for it.

## Company Career Pages (`company-pages-search`)

`company_pages.json` at the repo root lists employers whose own ATS boards the CLI can read (Greenhouse/Lever/SmartRecruiters/Oracle), filtered to Colombia/LATAM: CI&T, Clara, Twilio, Wizeline, Endava (verified 2026-11-03). Run it once per scrape **without** `--query` and filter titles client-side with the GRC/security terms above, since title matching is substring-only. Banks (Bancolombia, Davivienda, BBVA, Banco de Bogotá) and the Big Four use Workday/SuccessFactors, which the CLI cannot read. They post on LinkedIn, which already covers them; do not add them as `generic` entries (they return junk links).

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape cloud" -> Priority 2 (cloud compliance / cloud GRC only)
- "/scrape remoto" -> all categories restricted to remote postings
