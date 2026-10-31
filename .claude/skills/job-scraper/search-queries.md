# Search Queries for Job Scraper

<!-- Configured by /setup on 2026-10-25 for Carlos Hernando Lozano Pérez. Retargeted 2026-10-30: ALL IN on GRC / InfoSec
(IT support / help desk / NOC / sysadmin dropped). Cloud Security / SOC kept as secondary. Market: Colombia (any city) + remote. -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. For this profile the important ones are **`linkedin-search`**, **`computrabajo-search`** and **`elempleo-search`** (Colombia), plus the remote-job boards already enabled (Torre, ticjob, Remotive, WeWorkRemotely, Himalayas, Jobicy, etc.). The Danish portals (Jobindex, Jobbank, Jobdanmark, Jobnet) stay **disabled**.

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

### Priority 2: Cloud Security / AWS (secondary - prefer cloud GRC / cloud compliance)

Roles that combine security with hands-on AWS.

```
"analista de seguridad cloud" OR "seguridad en la nube" AWS Colombia
"ingeniero de seguridad cloud" junior Colombia
"AWS" "seguridad" analista OR ingeniero junior Colombia
"Cloud Security Analyst" OR "Cloud Security Engineer" junior remote LATAM
"AWS Security" junior OR associate remote
"Cloud Compliance" OR "Cloud GRC" analyst remote
"Junior Cloud Engineer" AWS Colombia
site:linkedin.com/jobs "Cloud Security" Colombia
```

### Priority 3: SOC Analyst (secondary)

Monitoring, SIEM, detection - entry level.

```
"analista SOC" OR "analista de ciberseguridad" junior Colombia
"analista de monitoreo de seguridad" SIEM Colombia
"SOC Analyst" "Level 1" OR "L1" OR junior Colombia OR remote LATAM
"Cybersecurity Analyst" junior Colombia
site:co.computrabajo.com "analista SOC"
site:elempleo.com ciberseguridad analista
```

### Priority 4: Broader - adjacent GRC roles (wider net)

Roles where the GRC + automation + IAM/cloud mix still fits. Score carefully against the motivation filter (avoid pure ticket queues).

```
"analista de ciberseguridad" Colombia
"IAM Analyst" OR "analista de identidades y accesos" Colombia
"Technology Risk Analyst" OR "analista de riesgo tecnológico" Colombia
"IT Auditor" OR "auditor de sistemas" junior Colombia
"Security Analyst" "Power Platform" OR automation
"Third-Party Risk Analyst" OR "Vendor Security" remote
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

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape cloud" -> Priority 3 queries + custom AWS/cloud-security queries
- "/scrape remoto" -> all categories restricted to remote postings
