import { useState, useEffect, useCallback, useMemo } from "react";
import { Search, Activity, ChevronDown, ChevronUp, Loader2, ExternalLink, Calendar } from "lucide-react";
import { FIELDS } from "./data/subspecialties";
import { getJournalMetrics } from "./data/journalMetrics";

const STOPWORDS = new Set(["and", "the", "for", "with"]);

async function fetchWithRetry(url, attempts = 3, parseAs = "json") {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseAs === "text" ? await res.text() : await res.json();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

function parseArticleXML(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const articles = Array.from(doc.querySelectorAll("PubmedArticle"));
  return articles.map((art) => {
    const pmid = art.querySelector("PMID")?.textContent || "";
    const title = art.querySelector("ArticleTitle")?.textContent || "Untitled";
    const journal = art.querySelector("Journal Title")?.textContent
      || art.querySelector("MedlineJournalInfo MedlineTA")?.textContent
      || "";
    let year = art.querySelector("PubDate Year")?.textContent;
    if (!year) {
      const medlineDate = art.querySelector("PubDate MedlineDate")?.textContent || "";
      const match = medlineDate.match(/\d{4}/);
      year = match ? match[0] : "";
    }
    const meshTerms = Array.from(art.querySelectorAll("MeshHeading"))
      .filter((mh) => mh.querySelector("DescriptorName")?.getAttribute("MajorTopicYN") === "Y")
      .map((mh) => mh.querySelector("DescriptorName")?.textContent)
      .filter(Boolean);
    const authorList = Array.from(art.querySelectorAll("Author")).slice(0, 3).map((a) => {
      const last = a.querySelector("LastName")?.textContent || "";
      const initials = a.querySelector("Initials")?.textContent || "";
      return last ? `${last} ${initials}` : "";
    }).filter(Boolean);

    return { pmid, title, journal, year, meshTerms, authors: authorList.join(", ") };
  });
}

async function pubmedSearch(term, retmax = 25, dateFilter = null) {
  const dateParams = dateFilter
    ? `&datetype=pdat&mindate=${dateFilter.mindate}&maxdate=${dateFilter.maxdate}`
    : "";
  const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&sort=date&retmax=${retmax}${dateParams}&term=${encodeURIComponent(term)}`;
  const esearchData = await fetchWithRetry(esearchUrl);
  const ids = esearchData?.esearchresult?.idlist || [];
  const totalCount = esearchData?.esearchresult?.count || "0";
  if (ids.length === 0) return { totalCount, articles: [] };

  const efetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&rettype=abstract&retmode=xml&id=${ids.join(",")}`;
  const xmlText = await fetchWithRetry(efetchUrl, 3, "text");
  const parsed = parseArticleXML(xmlText);

  let iciteByPmid = {};
  try {
    const iciteUrl = `https://icite.od.nih.gov/api/pubs?pmids=${ids.join(",")}`;
    const iciteData = await fetchWithRetry(iciteUrl);
    const records = Array.isArray(iciteData) ? iciteData : iciteData?.data || [];
    records.forEach((r) => { iciteByPmid[String(r.pmid)] = r; });
  } catch (e) {
    // iCite unreachable — table still works, just without citation columns
  }

  const articles = parsed.map((a) => {
    const icite = iciteByPmid[a.pmid] || {};
    const journalMetrics = getJournalMetrics(a.journal);
    return {
      ...a,
      citationCount: icite.citation_count ?? null,
      hotIndex: icite.citations_per_year != null ? Number(icite.citations_per_year.toFixed(2)) : null,
      rcr: icite.relative_citation_ratio ?? null,
      sjr: journalMetrics?.sjr ?? null,
      quartile: journalMetrics?.quartile ?? null,
    };
  });

  return { totalCount, articles };
}

function extractMeshFrequency(articles) {
  const freq = {};
  articles.forEach((a) => {
    const seen = new Set();
    (a.meshTerms || []).forEach((term) => {
      const key = term.toLowerCase();
      if (seen.has(key) || STOPWORDS.has(key)) return;
      seen.add(key);
      freq[term] = (freq[term] || 0) + 1;
    });
  });
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 14);
}

// Builds the list of time buckets to query, based on today's actual date.
function buildPeriods(mode) {
  const now = new Date();
  const periods = [];
  if (mode === "yearly") {
    for (let i = 7; i >= 0; i--) {
      const year = now.getFullYear() - i;
      periods.push({ label: String(year), mindate: `${year}/01/01`, maxdate: `${year}/12/31` });
    }
  } else {
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    for (let i = 17; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth(); // 0-indexed
      const lastDay = new Date(year, month + 1, 0).getDate();
      const mm = String(month + 1).padStart(2, "0");
      periods.push({
        label: `${monthNames[month]} ${String(year).slice(2)}`,
        mindate: `${year}/${mm}/01`,
        maxdate: `${year}/${mm}/${String(lastDay).padStart(2, "0")}`,
      });
    }
  }
  return periods;
}

// Fetches a lightweight count-only result (retmax=0) per period, staggered to
// respect NCBI's ~3 requests/second guideline for keyless requests.
async function fetchTrendCounts(term, periods) {
  const counts = [];
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=0&datetype=pdat&mindate=${p.mindate}&maxdate=${p.maxdate}&term=${encodeURIComponent(term)}`;
    try {
      const data = await fetchWithRetry(url, 2);
      counts.push({ label: p.label, count: Number(data?.esearchresult?.count || 0) });
    } catch (e) {
      counts.push({ label: p.label, count: null });
    }
    if (i < periods.length - 1) await new Promise((r) => setTimeout(r, 350));
  }
  return counts;
}

const COLUMNS = [
  { key: "title", label: "Title", sortable: false },
  { key: "journal", label: "Journal", sortable: true },
  { key: "year", label: "Year", sortable: true },
  { key: "citationCount", label: "Citations", sortable: true },
  { key: "hotIndex", label: "Hot Index (cites/yr)", sortable: true },
  { key: "sjr", label: "SJR", sortable: true },
];

export default function PubMedExplorer() {
  const [activeField, setActiveField] = useState(FIELDS[0]);
  const [activeSub, setActiveSub] = useState(FIELDS[0].subspecialties[0]);
  const [inputValue, setInputValue] = useState("");
  const [activeTerm, setActiveTerm] = useState(FIELDS[0].subspecialties[0].query);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [articles, setArticles] = useState([]);
  const [totalCount, setTotalCount] = useState(null);
  const [activeMesh, setActiveMesh] = useState(null);
  const [sortKey, setSortKey] = useState("citationCount");
  const [sortDir, setSortDir] = useState("desc");
  const [trendMode, setTrendMode] = useState("yearly");
  const [trendData, setTrendData] = useState([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [yearFilter, setYearFilter] = useState("all");

  const accent = activeField?.accent || "#3A6B8A";

  const runSearch = useCallback(async (term, field, sub) => {
    setLoading(true);
    setError(null);
    setActiveMesh(null);
    setActiveField(field || null);
    setActiveSub(sub || null);
    setActiveTerm(term);
    const dateFilter = yearFilter !== "all" ? { mindate: `${yearFilter}/01/01`, maxdate: `${yearFilter}/12/31` } : null;
    try {
      const { totalCount, articles } = await pubmedSearch(term, 25, dateFilter);
      setArticles(articles);
      setTotalCount(totalCount);
    } catch (e) {
      setError("Couldn't reach PubMed/iCite right now. Please try again in a moment.");
      setArticles([]);
      setTotalCount(null);
    } finally {
      setLoading(false);
    }
  }, [yearFilter]);

  // Initial load, and re-run whenever the year filter changes (using whatever
  // field/subspecialty/custom term is currently active).
  useEffect(() => {
    runSearch(activeTerm, activeField, activeSub);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearFilter]);

  useEffect(() => {
    if (!activeTerm) return;
    let cancelled = false;
    setTrendLoading(true);
    const periods = buildPeriods(trendMode);
    fetchTrendCounts(activeTerm, periods).then((data) => {
      if (!cancelled) {
        setTrendData(data);
        setTrendLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [activeTerm, trendMode]);

  const meshKeywords = useMemo(() => extractMeshFrequency(articles), [articles]);
  const maxMeshCount = meshKeywords.length ? meshKeywords[0][1] : 1;

  const filteredArticles = useMemo(() => {
    if (!activeMesh) return articles;
    return articles.filter((a) => (a.meshTerms || []).some((t) => t.toLowerCase() === activeMesh));
  }, [articles, activeMesh]);

  const sortedArticles = useMemo(() => {
    const arr = [...filteredArticles];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filteredArticles, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const handleCustomSearch = (e) => {
    e.preventDefault();
    const term = inputValue.trim();
    if (!term) return;
    runSearch(term, null, null);
  };

  return (
    <div className="min-h-screen" style={{ background: "#FAF8F4", fontFamily: "'Source Serif 4', Georgia, serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .plex { font-family: 'IBM Plex Sans', sans-serif; }
        .plex-mono { font-family: 'IBM Plex Mono', monospace; }
      `}</style>

      <header className="border-b-2" style={{ borderColor: "#2A2823" }}>
        <div className="max-w-6xl mx-auto px-6 pt-10 pb-6">
          <p className="plex text-xs tracking-[0.2em] uppercase mb-2" style={{ color: accent }}>
            Live evidence, by subspecialty
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight" style={{ color: "#2A2823" }}>
            Literature Compass
          </h1>
          <p className="plex text-sm mt-2" style={{ color: "#6b6660" }}>
            Real PubMed records, real MeSH-indexed topics, real NIH iCite citation data. SJR journal metric shown where known.
          </p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <section className="mb-4">
          <h2 className="plex text-xs tracking-[0.15em] uppercase mb-3" style={{ color: "#8a8478" }}>Field</h2>
          <div className="flex flex-wrap gap-2">
            {FIELDS.map((f) => (
              <button
                key={f.key}
                onClick={() => runSearch(f.subspecialties[0].query, f, f.subspecialties[0])}
                className="plex px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all"
                style={{
                  borderColor: activeField?.key === f.key ? f.accent : "#e5e1d8",
                  background: activeField?.key === f.key ? f.accent : "#ffffff",
                  color: activeField?.key === f.key ? "#fff" : "#3d3a35",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </section>

        {activeField && (
          <section className="mb-6">
            <h2 className="plex text-xs tracking-[0.15em] uppercase mb-3" style={{ color: "#8a8478" }}>Subspecialty</h2>
            <div className="flex flex-wrap gap-2">
              {activeField.subspecialties.map((s) => (
                <button
                  key={s.key}
                  onClick={() => runSearch(s.query, activeField, s)}
                  className="plex px-3 py-1.5 rounded-full border-2 text-xs font-medium transition-all"
                  style={{
                    borderColor: activeSub?.key === s.key ? accent : "#e5e1d8",
                    background: activeSub?.key === s.key ? `${accent}1a` : "#ffffff",
                    color: activeSub?.key === s.key ? accent : "#3d3a35",
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleCustomSearch} className="mt-4 flex gap-2 max-w-lg flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#9a948a" }} />
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Or search any custom PubMed term..."
                  className="plex w-full pl-9 pr-3 py-2.5 rounded-lg border-2 text-sm outline-none"
                  style={{ borderColor: "#e5e1d8", color: "#2A2823" }}
                />
              </div>
              <button type="submit" className="plex px-4 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: "#2A2823" }}>
                Search
              </button>
              <select
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
                className="plex px-3 py-2.5 rounded-lg border-2 text-sm outline-none"
                style={{ borderColor: "#e5e1d8", color: "#2A2823", background: "#fff" }}
              >
                <option value="all">All years</option>
                {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                  <option key={y} value={y}>{y} only</option>
                ))}
              </select>
            </form>
          </section>
        )}

        <div className="plex-mono text-xs mb-6 flex items-center gap-2" style={{ color: "#8a8478" }}>
          {loading ? (
            <><Loader2 size={13} className="animate-spin" /> Fetching PubMed + MeSH + iCite data...</>
          ) : error ? (
            <span style={{ color: "#B4433A" }}>{error}</span>
          ) : (
            <><Activity size={13} /> {Number(totalCount || 0).toLocaleString()} total records - showing latest {articles.length}</>
          )}
        </div>

        {/* Publication volume over time */}
        <section className="mb-8">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h2 className="plex text-xs tracking-[0.15em] uppercase flex items-center gap-2" style={{ color: "#8a8478" }}>
              <Calendar size={13} /> Research volume over time
            </h2>
            <div className="flex gap-1.5">
              {["yearly", "monthly"].map((m) => (
                <button
                  key={m}
                  onClick={() => setTrendMode(m)}
                  className="plex px-3 py-1 rounded-full border-2 text-xs font-medium capitalize"
                  style={{
                    borderColor: trendMode === m ? accent : "#e5e1d8",
                    background: trendMode === m ? accent : "#ffffff",
                    color: trendMode === m ? "#fff" : "#3d3a35",
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 rounded-xl" style={{ background: "#F1EDE3" }}>
            {trendLoading ? (
              <div className="plex-mono text-xs flex items-center gap-2 py-8 justify-center" style={{ color: "#8a8478" }}>
                <Loader2 size={13} className="animate-spin" /> Fetching {trendMode} publication counts...
              </div>
            ) : trendData.length === 0 ? (
              <p className="plex text-xs text-center py-8" style={{ color: "#8a8478" }}>No trend data available.</p>
            ) : (
              <div className="flex items-end gap-1 h-40 overflow-x-auto">
                {trendData.map((d, i) => {
                  const maxCount = Math.max(...trendData.map((x) => x.count || 0), 1);
                  const heightPct = d.count != null ? Math.max((d.count / maxCount) * 100, 2) : 0;
                  return (
                    <div key={i} className="flex flex-col items-center justify-end h-full shrink-0" style={{ width: trendMode === "monthly" ? "34px" : "44px" }}>
                      <span className="plex-mono text-[10px] mb-1" style={{ color: "#6b6660" }}>
                        {d.count != null ? d.count.toLocaleString() : "—"}
                      </span>
                      <div
                        className="w-full rounded-t-sm transition-all"
                        style={{ height: `${heightPct}%`, background: d.count != null ? accent : "#e5e1d8", minHeight: "2px" }}
                        title={`${d.label}: ${d.count ?? "unavailable"}`}
                      />
                      <span className="plex text-[10px] mt-1 rotate-0 whitespace-nowrap" style={{ color: "#8a8478" }}>
                        {d.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {!loading && !error && meshKeywords.length > 0 && (
          <section className="mb-8">
            <h2 className="plex text-xs tracking-[0.15em] uppercase mb-3" style={{ color: "#8a8478" }}>
              Recurring MeSH topics in these articles
            </h2>
            <div className="flex flex-wrap gap-2 p-4 rounded-xl" style={{ background: "#F1EDE3" }}>
              {meshKeywords.map(([term, count]) => {
                const active = activeMesh === term.toLowerCase();
                const scale = 0.75 + (count / maxMeshCount) * 0.55;
                return (
                  <button
                    key={term}
                    onClick={() => setActiveMesh(active ? null : term.toLowerCase())}
                    style={{ fontSize: `${scale}rem`, borderColor: active ? accent : "transparent", background: active ? `${accent}1a` : "#fff", color: active ? accent : "#3d3a35" }}
                    className="px-3 py-1.5 rounded-full border-2 font-medium"
                  >
                    {term} <span className="opacity-50 text-xs">.{count}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {!loading && !error && sortedArticles.length > 0 && (
          <section className="overflow-x-auto">
            <table className="w-full plex text-sm border-collapse">
              <thead>
                <tr style={{ borderBottom: "2px solid #2A2823" }}>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => col.sortable && handleSort(col.key)}
                      className={`text-left py-2 px-2 ${col.sortable ? "cursor-pointer select-none" : ""}`}
                      style={{ color: "#6b6660", whiteSpace: "nowrap" }}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {col.sortable && sortKey === col.key && (sortDir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedArticles.map((a) => (
                  <tr key={a.pmid} className="border-b hover:bg-white transition-colors" style={{ borderColor: "#e5e1d8" }}>
                    <td className="py-3 px-2 max-w-md">
                      <a href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline inline-flex items-start gap-1" style={{ color: "#2A2823" }}>
                        {a.title} <ExternalLink size={12} className="mt-1 shrink-0 opacity-50" />
                      </a>
                    </td>
                    <td className="py-3 px-2 text-xs" style={{ color: "#6b6660" }}>{a.journal}</td>
                    <td className="py-3 px-2 text-xs">{a.year || "-"}</td>
                    <td className="py-3 px-2 text-xs">{a.citationCount ?? "-"}</td>
                    <td className="py-3 px-2 text-xs">{a.hotIndex ?? "-"}</td>
                    <td className="py-3 px-2 text-xs">
                      {a.sjr != null ? `${a.sjr} (${a.quartile})` : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {!loading && !error && sortedArticles.length === 0 && (
          <p className="plex text-sm py-8 text-center" style={{ color: "#8a8478" }}>No articles found.</p>
        )}
      </main>

      <footer className="max-w-6xl mx-auto px-6 py-10 mt-6 border-t plex text-xs" style={{ borderColor: "#e5e1d8", color: "#9a948a" }}>
        Data: PubMed/MEDLINE (NCBI E-utilities), MeSH indexing (NLM), citation metrics (NIH iCite), journal SJR (SCImago, starter dataset). SJR shows "-" for journals not yet added to the local lookup table.
      </footer>
    </div>
  );
}
