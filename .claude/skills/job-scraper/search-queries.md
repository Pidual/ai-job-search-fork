# Search Queries for Job Scraper

<!-- Configured by /setup on 2026-10-25 for Carlos Hernando Lozano Pérez: IT support / help desk / NOC / junior sysadmin first
(retargeted 2026-10-26), then GRC / InfoSec, Cloud Security / AWS, SOC. Market: Colombia (any city) + remote. -->

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

### Priority 1: IT Support / Help Desk / NOC / Junior Sysadmin (current focus since 2026-10-26)

The candidate's current target: entry-level infrastructure roles that build production experience fast. Help desk and L1 roles are acceptable; prefer ones with escalation to L2 / sysadmin work, Linux, networking, Windows Server/AD or cloud exposure. Exclude postings stating pay below COP 3,200,000.

```
"soporte técnico" OR "mesa de ayuda" OR "help desk" Colombia
"técnico de soporte" OR "analista de soporte" TI Colombia
"soporte nivel 1" OR "soporte nivel 2" OR "service desk" Colombia
"analista NOC" OR "NOC analyst" OR "operador NOC" OR "monitoreo de red" Colombia
"administrador de sistemas" OR "sysadmin" OR "administrador linux" junior Colombia
"administrador de servidores" OR "Windows Server" OR "Active Directory" analista Colombia
"ingeniero de redes" OR "analista de redes" OR "network engineer" junior Colombia
"soporte de infraestructura" OR "analista de infraestructura" Colombia
"IT Support" OR "Help Desk" OR "Service Desk" bilingual Colombia OR remote LATAM
"NOC Engineer" OR "Junior System Administrator" OR "Linux Support" remote LATAM
site:co.computrabajo.com "mesa de ayuda" OR "soporte técnico"
site:elempleo.com "soporte técnico" OR "analista NOC"
```

Use `/scrape support` (or "helpdesk", "noc", "sysadmin", "linux", "redes") to run this category on its own.

### Priority 2: GRC / Information Security Analyst (best current fit)

Compliance, ISO 27001, SOC 2, risk, audit, security policy work.

```
"analista de seguridad de la información" Colombia
"analista GRC" OR "analista de riesgos de seguridad" Colombia
"ISO 27001" analista Colombia
"analista de cumplimiento" seguridad de la información
"auditor interno ISO 27001" OR "SGSI" analista
"Information Security Analyst" Colombia OR LATAM remote
"GRC Analyst" OR "Compliance Analyst" "SOC 2" remote LATAM
"Security Compliance Analyst" ISO 27001 remote
site:linkedin.com/jobs "Information Security Analyst" Colombia
site:co.computrabajo.com "seguridad de la información"
site:elempleo.com "seguridad de la información" analista
```

### Priority 3: Cloud Security / AWS (strongest desire)

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

### Priority 4: SOC Analyst

Monitoring, SIEM, detection - entry level.

```
"analista SOC" OR "analista de ciberseguridad" junior Colombia
"analista de monitoreo de seguridad" SIEM Colombia
"SOC Analyst" "Level 1" OR "L1" OR junior Colombia OR remote LATAM
"Cybersecurity Analyst" junior Colombia
site:co.computrabajo.com "analista SOC"
site:elempleo.com ciberseguridad analista
```

### Priority 5: Broader - adjacent roles (wider net)

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
