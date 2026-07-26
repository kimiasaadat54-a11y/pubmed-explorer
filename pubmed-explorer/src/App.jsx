import { useState, useEffect, useCallback, useMemo } from "react";
import { Search, Activity, Heart, Brain, Bone, Baby, Syringe, Microscope, TrendingUp, X, ExternalLink, Loader2 } from "lucide-react";

const SPECIALTIES = [
  { key: "cardiology", label: "Cardiology", term: "cardiology", icon: Heart, accent: "#B4433A" },
  { key: "oncology", label: "Oncology", term: "oncology", icon: Microscope, accent: "#6B5B95" },
  { key: "neurology", label: "Neurology", term: "neurology", icon: Brain, accent: "#3A6B8A" },
  { key: "orthopedics", label: "Orthopedics", term: "orthopedics", icon: Bone, accent: "#8A7355" },
  { key: "pediatrics", label: "Pediatrics", term: "pediatrics", icon: Baby, accent: "#4A8A6B" },
  { key: "immunology", label: "Immunology", term: "immunology", icon: Syringe, accent: "#8A5A3A" },
];

const STOPWORDS = new Set([
  "the","and","for","with","that","this","from","were","are","was","have","has","had",
  "study","studies","patients","patient","results","result","using","used","based",
  "analysis","among","between","after","before","during","associated","association",
  "effect","effects","risk","clinical","significant","significantly","compared","group",
  "groups","data","review","case","cases","report","reports","also","not","been","which",
  "our","their","these","than","into","can","may","more","its","when","two","new",
  "outcomes","outcome","treatment","treatments","disease","diseases","levels","level",
  "high","low","use","found","showed","show","shows","related","potential","role",
  "years","year","research","evaluate","evaluated","aim","aims","conclusion","conclusions",
  "background","methods","method","present","presents","identify","identified"
]);

function extractKeywords(titles) {
  const freq = {};
  titles.forEach((t) => {
    const words = t
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w) && isNaN(w));
    const seen = new Set();
    words.forEach((w) => {
      if (seen.has(w)) return;
      seen.add(w);
      freq[w] = (freq[w] || 0) + 1;
    });
  });
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14);
}

async function fetchWithRetry(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

async function pubmedSearch(term, retmax = 20) {
  const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&sort=date&retmax=${retmax}&term=${encodeURIComponent(term)}`;
  const esearchData = await fetchWithRetry(esearchUrl);
  const ids = esearchData?.esearchresult?.idlist || [];
  if (ids.length === 0) return { count: esearchData?.esearchresult?.count || "0", articles: [] };

  const esummaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}`;
  const esummaryData = await fetchWithRetry(esummaryUrl);
  const result = esummaryData?.result || {};
  const articles = ids
    .map((id) => result[id])
    .filter(Boolean)
    .map((a) => ({
      pmid: a.uid,
      title: a.title?.replace(/<\/?[^>]+(>|$)/g, "") || "Untitled",
      journal: a.fulljournalname || a.source || "",
      date: a.pubdate || "",
      authors: (a.authors || []).slice(0, 3).map((au) => au.name).join(", "),
    }));

  return { count: esearchData.esearchresult.count, articles };
}

function KeywordChip({ word, count, max, accent, onClick, active }) {
  const scale = 0.75 + (count / max) * 0.65;
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: `${scale}rem`,
        borderColor: active ? accent : "transparent",
        background: active ? `${accent}1a` : "#ffffff",
        color: active ? accent : "#3d3a35",
      }}
      className="px-3 py-1.5 rounded-full border-2 transition-all duration-150 hover:scale-105 whitespace-nowrap font-medium"
    >
      {word} <span className="opacity-50 text-xs">·{count}</span>
    </button>
  );
}

export default function PubMedExplorer() {
  const [selected, setSelected] = useState(SPECIALTIES[0]);
  const [customTerm, setCustomTerm] = useState("");
  const [activeTerm, setActiveTerm] = useState(SPECIALTIES[0].term);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [articles, setArticles] = useState([]);
  const [totalCount, setTotalCount] = useState(null);
  const [activeKeyword, setActiveKeyword] = useState(null);
  const [inputValue, setInputValue] = useState("");

  const accent = selected ? selected.accent : "#3A6B8A";

  const runSearch = useCallback(async (term, specialtyObj) => {
    setLoading(true);
    setError(null);
    setActiveKeyword(null);
    setSelected(specialtyObj || null);
    setActiveTerm(term);
    try {
      const { count, articles } = await pubmedSearch(term, 25);
      setArticles(articles);
      setTotalCount(count);
    } catch (e) {
      setError("Couldn't reach PubMed right now. Please try again in a moment.");
      setArticles([]);
      setTotalCount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runSearch(SPECIALTIES[0].term, SPECIALTIES[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const keywords = useMemo(() => extractKeywords(articles.map((a) => a.title)), [articles]);
  const maxKeywordCount = keywords.length ? keywords[0][1] : 1;

  const displayedArticles = useMemo(() => {
    if (!activeKeyword) return articles;
    return articles.filter((a) => a.title.toLowerCase().includes(activeKeyword));
  }, [articles, activeKeyword]);

  const handleCustomSearch = (e) => {
    e.preventDefault();
    const term = inputValue.trim();
    if (!term) return;
    setCustomTerm(term);
    runSearch(term, null);
  };

  return (
    <div className="min-h-screen" style={{ background: "#FAF8F4", fontFamily: "'Source Serif 4', Georgia, serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .plex { font-family: 'IBM Plex Sans', sans-serif; }
        .plex-mono { font-family: 'IBM Plex Mono', monospace; }
      `}</style>

      {/* Header */}
      <header className="border-b-2" style={{ borderColor: "#2A2823" }}>
        <div className="max-w-5xl mx-auto px-6 pt-10 pb-6">
          <div className="flex items-baseline justify-between flex-wrap gap-3">
            <div>
              <p className="plex text-xs tracking-[0.2em] uppercase mb-2" style={{ color: accent }}>
                Live evidence, browsed by field
              </p>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight" style={{ color: "#2A2823" }}>
                Literature Compass
              </h1>
            </div>
            <p className="plex text-sm max-w-xs text-right" style={{ color: "#6b6660" }}>
              Pulls directly from PubMed/MEDLINE. No cache, no summaries invented — every title below is a real, current record.
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Specialty picker */}
        <section className="mb-8">
          <h2 className="plex text-xs tracking-[0.15em] uppercase mb-3" style={{ color: "#8a8478" }}>
            Quick-pick specialty
          </h2>
          <div className="flex flex-wrap gap-2">
            {SPECIALTIES.map((s) => {
              const Icon = s.icon;
              const isActive = selected?.key === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => runSearch(s.term, s)}
                  className="plex flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all duration-150 font-medium text-sm"
                  style={{
                    borderColor: isActive ? s.accent : "#e5e1d8",
                    background: isActive ? s.accent : "#ffffff",
                    color: isActive ? "#ffffff" : "#3d3a35",
                  }}
                >
                  <Icon size={16} />
                  {s.label}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleCustomSearch} className="mt-4 flex gap-2 max-w-md">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#9a948a" }} />
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Or search any topic — e.g. long covid, CRISPR..."
                className="plex w-full pl-9 pr-3 py-2.5 rounded-lg border-2 text-sm outline-none focus:border-current"
                style={{ borderColor: "#e5e1d8", color: "#2A2823" }}
              />
            </div>
            <button
              type="submit"
              className="plex px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "#2A2823" }}
            >
              Search
            </button>
          </form>
        </section>

        {/* Status line */}
        <div className="plex-mono text-xs mb-6 flex items-center gap-2" style={{ color: "#8a8478" }}>
          {loading ? (
            <>
              <Loader2 size={13} className="animate-spin" /> Querying PubMed for "{activeTerm}"...
            </>
          ) : error ? (
            <span style={{ color: "#B4433A" }}>{error}</span>
          ) : (
            <>
              <TrendingUp size={13} />
              {Number(totalCount || 0).toLocaleString()} total records found for "{activeTerm}" · showing latest {articles.length}
            </>
          )}
        </div>

        {/* Keyword cloud */}
        {!loading && !error && keywords.length > 0 && (
          <section className="mb-10">
            <h2 className="plex text-xs tracking-[0.15em] uppercase mb-3 flex items-center gap-2" style={{ color: "#8a8478" }}>
              <Activity size={13} /> Recurring themes in these titles
            </h2>
            <div className="flex flex-wrap gap-2 items-center p-4 rounded-xl" style={{ background: "#F1EDE3" }}>
              {keywords.map(([word, count]) => (
                <KeywordChip
                  key={word}
                  word={word}
                  count={count}
                  max={maxKeywordCount}
                  accent={accent}
                  active={activeKeyword === word}
                  onClick={() => setActiveKeyword(activeKeyword === word ? null : word)}
                />
              ))}
              {activeKeyword && (
                <button
                  onClick={() => setActiveKeyword(null)}
                  className="plex flex items-center gap-1 text-xs px-2 py-1 rounded-full"
                  style={{ color: "#8a8478" }}
                >
                  <X size={12} /> clear filter
                </button>
              )}
            </div>
          </section>
        )}

        {/* Article list */}
        <section>
          <h2 className="plex text-xs tracking-[0.15em] uppercase mb-3" style={{ color: "#8a8478" }}>
            {activeKeyword ? `Titles mentioning "${activeKeyword}"` : "Most recent publications"}
          </h2>
          <div className="space-y-0">
            {displayedArticles.map((a, i) => (
              <a
                key={a.pmid}
                href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="group block py-4 border-b transition-colors hover:bg-white"
                style={{ borderColor: "#e5e1d8" }}
              >
                <div className="flex items-start gap-4">
                  <span className="plex-mono text-xs pt-1 shrink-0" style={{ color: "#c4beb2", width: "24px" }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h3
                      className="text-lg leading-snug font-semibold group-hover:underline decoration-1 underline-offset-2"
                      style={{ color: "#2A2823" }}
                    >
                      {a.title}
                    </h3>
                    <p className="plex text-xs mt-1.5" style={{ color: "#8a8478" }}>
                      {a.journal} {a.date && `· ${a.date}`} {a.authors && `· ${a.authors}${a.authors ? " et al." : ""}`}
                    </p>
                  </div>
                  <ExternalLink size={15} className="shrink-0 mt-1.5 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: accent }} />
                </div>
              </a>
            ))}
            {!loading && !error && displayedArticles.length === 0 && (
              <p className="plex text-sm py-8 text-center" style={{ color: "#8a8478" }}>
                No titles matched that filter. Try clearing it above.
              </p>
            )}
          </div>
        </section>
      </main>

      <footer className="max-w-5xl mx-auto px-6 py-10 mt-6 border-t plex text-xs" style={{ borderColor: "#e5e1d8", color: "#9a948a" }}>
        Data sourced live from the National Library of Medicine's PubMed via NCBI E-utilities. This tool surfaces recent titles and language patterns — it does not substitute for reading full papers or clinical judgment.
      </footer>
    </div>
  );
}
