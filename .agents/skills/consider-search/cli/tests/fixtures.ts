// REAL captured payloads. Nothing here is invented.
//
// SEARCH_RESPONSE:  POST https://jobs.a16z.com/api-boards/search-jobs   (2026-08-05)
//   body {"meta":{"size":6},"board":{"id":"andreessen-horowitz","isParent":true},
//         "query":{"titlePrefix":"machine learning","remoteOnly":true}}
//   -> HTTP 200, total 27. Four of the six records are kept, chosen to cover every
//      shape the parser has to survive:
//        BigHat  — salary + minYearsExp + empty departments
//        Quora   — four raw locations collapsing to two normalised ones
//        Cantina — NO salary, a BLANK "" entry in locations, and companyName
//                  ("Cantina") != companyId/companySlug ("Airtime"/"airtime")
//        Omada   — a bare-integer Greenhouse jobId, not a UUID
//      `skills` lists are truncated to the first four entries; every other field
//      is byte-verbatim. `version` and `debug` envelope keys are dropped.
//
// COMPANY_RESPONSE: POST https://jobs.a16z.com/api-boards/search-companies (2026-08-05)
//   body {"meta":{"size":1},"board":{"id":"andreessen-horowitz","isParent":true},
//         "query":{"ids":["bighat-biosciences"]}}
//   -> HTTP 200, total 1. Logo/CDN URLs and unused facets dropped; the description
//      is verbatim, curly apostrophes and all.

export const SEARCH_RESPONSE = {
  jobs: [
    {
      applicationWindow: { status: "accepting" },
      applyUrl: "https://bighatbiosciences.pinpointhq.com/en/postings/ed9ce18f-e885-4052-8f9a-e10f952a460a",
      companyDomain: "bighatbio.com",
      companyId: "BigHat Biosciences",
      companySlug: "bighat-biosciences",
      companyName: "BigHat Biosciences",
      companyStaffCount: 98,
      departments: [],
      jobTypes: [
        { id: "data-scientist", label: "Data Scientist", value: "data-scientist" },
        { id: "principal", label: "Principal", value: "principal" },
      ],
      locations: ["San Mateo, CA, US"],
      normalizedLocations: [
        { id: "San Mateo, California", label: "San Mateo, California", value: "San Mateo, California" },
      ],
      salary: {
        period: { label: "Year", value: "year" },
        minValue: 254000,
        maxValue: 290000,
        currency: { label: "USD", value: "USD" },
        isOriginal: true,
      },
      skills: [
        { id: "resume:Antibodies", label: "Antibodies", value: "resume:Antibodies" },
        { id: "resume:Protein Sciences", label: "Protein Sciences", value: "resume:Protein Sciences" },
        { id: "resume:Biology", label: "Biology", value: "resume:Biology" },
        { id: "resume:Research", label: "Research", value: "resume:Research" },
      ],
      minYearsExp: 5,
      markets: [{ id: "Bio Health", label: "Bio + Health", value: "Bio Health" }],
      timeStamp: "2026-08-04T22:41:50Z",
      title: "Principal, Machine Learning Scientist",
      url: "https://bighatbiosciences.pinpointhq.com/en/postings/ed9ce18f-e885-4052-8f9a-e10f952a460a",
      jobId: "ed9ce18f-e885-4052-8f9a-e10f952a460a",
      remote: true,
      hybrid: false,
      jobSeniorityIds: ["senior", "mid"],
      isFeatured: false,
    },
    {
      applicationWindow: { status: "accepting" },
      applyUrl: "https://jobs.ashbyhq.com/quora/452afc2e-0c79-41f8-8201-1aab7df775db?utm_source=jobs.a16z.com",
      companyDomain: "quora.com",
      companyId: "Quora",
      companySlug: "quora",
      companyName: "Quora",
      companyStaffCount: 500,
      departments: ["Engineering"],
      jobTypes: [
        { id: "data-scientist", label: "Data Scientist", value: "data-scientist" },
        { id: "software-engineer", label: "Software Engineer", value: "software-engineer" },
      ],
      locations: ["United States", "Remote - Multiple Locations", "United States", "Canada"],
      normalizedLocations: [
        { id: "Canada", label: "Canada", value: "Canada" },
        { id: "United States", label: "United States", value: "United States" },
      ],
      salary: {
        period: { label: "Year", value: "year" },
        minValue: 97600,
        maxValue: 142783,
        currency: { label: "USD", value: "USD" },
        isOriginal: true,
      },
      skills: [
        { id: "resume:Artificial Intelligence", label: "Artificial Intelligence", value: "resume:Artificial Intelligence" },
        { id: "resume:C/C++", label: "C/C++", value: "resume:C/C++" },
        { id: "resume:TensorFlow", label: "TensorFlow", value: "resume:TensorFlow" },
        { id: "resume:Open Source Software", label: "Open Source Software", value: "resume:Open Source Software" },
      ],
      markets: [{ id: "Consumer", label: "Consumer", value: "Consumer" }],
      timeStamp: "2026-07-31T00:00:00Z",
      title: "Software Engineer, Machine Learning Platform, New Grad - Quora (Remote)",
      url: "https://jobs.ashbyhq.com/quora/452afc2e-0c79-41f8-8201-1aab7df775db",
      jobId: "452afc2e-0c79-41f8-8201-1aab7df775db",
      remote: true,
      hybrid: false,
      jobSeniorityIds: ["mid"],
      isFeatured: false,
    },
    {
      applicationWindow: { status: "accepting" },
      applyUrl: "https://jobs.ashbyhq.com/cantina/0b1ec7c7-ca1f-4d86-9242-f6397f60ba34?utm_source=jobs.a16z.com",
      companyDomain: "cantina.com",
      companyId: "Airtime",
      companySlug: "airtime",
      companyName: "Cantina",
      companyStaffCount: 101,
      departments: ["Research"],
      jobTypes: [
        { id: "data-scientist", label: "Data Scientist", value: "data-scientist" },
        { id: "software-engineer", label: "Software Engineer", value: "software-engineer" },
        { id: "machine-learning-engineer", label: "Machine Learning Engineer", value: "machine-learning-engineer" },
      ],
      locations: ["", "Remote (U.S. or Europe)"],
      normalizedLocations: [{ id: "Europe", label: "Europe", value: "Europe" }],
      skills: [
        { id: "resume:Artificial Intelligence", label: "Artificial Intelligence", value: "resume:Artificial Intelligence" },
        { id: "resume:Experimental Design", label: "Experimental Design", value: "resume:Experimental Design" },
        { id: "resume:GPU", label: "GPU", value: "resume:GPU" },
        { id: "resume:Research", label: "Research", value: "resume:Research" },
      ],
      markets: [{ id: "Consumer", label: "Consumer", value: "Consumer" }],
      timeStamp: "2026-07-30T00:00:00Z",
      title: "Machine Learning Engineer, Speech - Joint Audio-Video Modeling",
      url: "https://jobs.ashbyhq.com/cantina/0b1ec7c7-ca1f-4d86-9242-f6397f60ba34",
      jobId: "0b1ec7c7-ca1f-4d86-9242-f6397f60ba34",
      remote: true,
      hybrid: false,
      jobSeniorityIds: ["mid"],
      isFeatured: false,
    },
    {
      applicationWindow: { status: "accepting" },
      applyUrl: "https://job-boards.greenhouse.io/omadahealth/jobs/8052599",
      companyDomain: "omadahealth.com",
      companyId: "Omada Health",
      companySlug: "omada-health",
      companyName: "Omada Health",
      companyStaffCount: 941,
      departments: ["Applied AI & Data Science"],
      jobTypes: [
        { id: "data-scientist", label: "Data Scientist", value: "data-scientist" },
        { id: "principal", label: "Principal", value: "principal" },
      ],
      locations: ["Remote, USA"],
      normalizedLocations: [{ id: "United States", label: "United States", value: "United States" }],
      salary: {
        period: { label: "Year", value: "year" },
        minValue: 270480,
        maxValue: 338100,
        currency: { label: "USD", value: "USD" },
        isOriginal: true,
      },
      skills: [
        { id: "resume:reverse engineering", label: "reverse engineering", value: "resume:reverse engineering" },
        { id: "resume:Cloud Services", label: "Cloud Services", value: "resume:Cloud Services" },
        { id: "resume:Reinforcement Learning", label: "Reinforcement Learning", value: "resume:Reinforcement Learning" },
        { id: "resume:Privacy", label: "Privacy", value: "resume:Privacy" },
      ],
      markets: [{ id: "Bio Health", label: "Bio + Health", value: "Bio Health" }],
      timeStamp: "2026-07-14T15:27:58Z",
      title: "Principal Applied Machine Learning Scientist",
      url: "https://job-boards.greenhouse.io/omadahealth/jobs/8052599",
      jobId: "8052599",
      remote: true,
      hybrid: false,
      jobSeniorityIds: ["senior", "mid"],
      isFeatured: false,
    },
  ],
  meta: {
    size: 6,
    sequence: "eyJfaWQiOiAiYWU5MWYwMzQ0YWIxOTBjMjI0YjBhYzk1NTkzOGU2ZDIiLCAic2NvcmUiOiAwLjQ4MDc0NzYwNDg5Njk5MDh9",
  },
  total: 27,
  errors: [],
}

export const COMPANY_RESPONSE = {
  companies: [
    {
      description:
        "BigHat Biosciences’ mission is to improve human health by making it far easier to design advanced, next-generation antibody therapeutics.\n\nBigHat integrates a wet lab for high-speed characterization with machine learning technologies to guide the search for better antibodies.\n\nWe are applying these design capabilities to develop new generations of safer and more effective treatments for patients suffering from today’s most challenging diseases.",
      domain: "bighatbio.com",
      id: "BigHat Biosciences",
      name: "BigHat Biosciences",
      investors: ["Andreessen Horowitz", "Biocom", "Gaingels"],
      markets: ["Bio Health"],
      marketsLV: [{ id: "Bio Health", label: "Bio + Health", value: "Bio Health" }],
      officeLocations: ["San Mateo, California"],
      staffCount: 98,
    },
  ],
  total: 1,
  errors: [],
}

/**
 * REAL error envelope, captured by POSTing a body with the `meta` key omitted:
 *   {"query":"machine learning","hitsPerPage":3}
 * Consider answers HTTP 500 with this shape — note `jobs: []` and a populated
 * `errors[]`. It also answers HTTP 200 with a populated `errors[]` in other
 * failure modes, which is why parseSearchResponse never trusts the status alone.
 */
export const ERROR_RESPONSE = {
  jobs: [],
  errors: [
    { status: 500, code: "BOARDS_JOBS_ERROR", message: "Cannot read properties of undefined (reading 'id')" },
  ],
  debug: [],
}

/**
 * REAL autocomplete payload:
 *   POST https://jobs.a16z.com/api-boards/autocomplete/locations
 *   {"q":"Berlin","board":{"isParent":true,"id":"andreessen-horowitz"},"limit":10,"includeZeros":true}
 * Note the answer to "Berlin" is "Berlin Area, Germany" with 80 jobs behind it —
 * searching the literal string "Berlin, Germany" returns 0.
 */
export const LOCATIONS_RESPONSE = {
  results: [
    {
      self: { label: "Berlin", bolding: "​**​Berlin​**​", value: "Berlin Area, Germany", score: 69, count: 80 },
      children: [],
      score: 0,
    },
    {
      self: { label: "New Berlin, Wisconsin", bolding: "New ​**​Berlin​**​, Wisconsin", value: "New Berlin, Wisconsin", score: 1, count: 0 },
      children: [],
      score: 0,
    },
    {
      self: { label: "Berlin, Wisconsin", bolding: "​**​Berlin​**​, Wisconsin", value: "Berlin, Wisconsin", score: 1, count: 0 },
      children: [],
      score: 0,
    },
  ],
  errors: [],
}
