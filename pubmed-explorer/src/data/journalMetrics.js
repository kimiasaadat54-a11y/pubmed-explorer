
// Journal quality proxy: SCImago Journal Rank (SJR).
//
// WHY SJR AND NOT "IMPACT FACTOR": the classic Impact Factor is proprietary data
// owned by Clarivate (Web of Science / Journal Citation Reports) — there is no
// free, legal, real-time API for it. SJR is SCImago's open, freely published
// equivalent (https://www.scimagojr.com), used non-commercially here per their
// terms ("can be used for non-commercial purposes as long as it is cited").
//
// THIS IS A STARTER DATASET, not exhaustive. It covers major flagship journals
// likely to appear across our fields. Any journal not listed here will show
// "—" in the table rather than a fabricated number. To expand it: look up a
// journal at scimagojr.com and add a line below, e.g.:
//   "Journal Name As It Appears On PubMed": { sjr: 4.2, quartile: "Q1" },
//
// Figures are approximate (SJR is recalculated yearly) — re-check periodically.

export const JOURNAL_SJR = {
  "The New England journal of medicine": { sjr: 19.08, quartile: "Q1" },
  "Lancet (London, England)": { sjr: 15.9, quartile: "Q1" },
  "JAMA": { sjr: 13.9, quartile: "Q1" },
  "Nature medicine": { sjr: 13.5, quartile: "Q1" },
  "BMJ (Clinical research ed.)": { sjr: 8.9, quartile: "Q1" },

  // Cardiology
  "Circulation": { sjr: 6.8, quartile: "Q1" },
  "European heart journal": { sjr: 7.6, quartile: "Q1" },
  "Journal of the American College of Cardiology": { sjr: 6.2, quartile: "Q1" },
  "JAMA cardiology": { sjr: 5.4, quartile: "Q1" },
  "Heart rhythm": { sjr: 2.6, quartile: "Q1" },
  "European journal of heart failure": { sjr: 3.9, quartile: "Q1" },

  // Oncology
  "Journal of clinical oncology : official journal of the American Society of Clinical Oncology": { sjr: 6.3, quartile: "Q1" },
  "The Lancet. Oncology": { sjr: 8.1, quartile: "Q1" },
  "JAMA oncology": { sjr: 5.2, quartile: "Q1" },
  "Cancer cell": { sjr: 8.4, quartile: "Q1" },
  "Blood": { sjr: 4.5, quartile: "Q1" },
  "Nature reviews. Clinical oncology": { sjr: 8.0, quartile: "Q1" },

  // Neurology
  "The Lancet. Neurology": { sjr: 7.8, quartile: "Q1" },
  "Brain : a journal of neurology": { sjr: 4.2, quartile: "Q1" },
  "Neurology": { sjr: 2.5, quartile: "Q1" },
  "JAMA neurology": { sjr: 4.6, quartile: "Q1" },
  "Epilepsia": { sjr: 2.2, quartile: "Q1" },
  "Movement disorders : official journal of the Movement Disorder Society": { sjr: 2.7, quartile: "Q1" },
  "Multiple sclerosis (Houndmills, Basingstoke, England)": { sjr: 1.7, quartile: "Q1" },

  // Orthopedics
  "The Journal of bone and joint surgery. American volume": { sjr: 1.9, quartile: "Q1" },
  "The American journal of sports medicine": { sjr: 1.9, quartile: "Q1" },
  "The bone & joint journal": { sjr: 1.3, quartile: "Q1" },
  "Spine": { sjr: 1.1, quartile: "Q1" },

  // Pediatrics
  "Pediatrics": { sjr: 2.6, quartile: "Q1" },
  "JAMA pediatrics": { sjr: 4.3, quartile: "Q1" },
  "The Journal of pediatrics": { sjr: 1.4, quartile: "Q1" },
  "Archives of disease in childhood": { sjr: 1.2, quartile: "Q1" },

  // Immunology
  "Nature immunology": { sjr: 8.9, quartile: "Q1" },
  "Immunity": { sjr: 8.6, quartile: "Q1" },
  "The Journal of allergy and clinical immunology": { sjr: 3.9, quartile: "Q1" },
  "Journal of immunology (Baltimore, Md. : 1950)": { sjr: 1.5, quartile: "Q1" },
};

// PubMed's `fulljournalname` field is used as the lookup key (case-sensitive match).
export function getJournalMetrics(journalName) {
  if (!journalName) return null;
  return JOURNAL_SJR[journalName] || null;
}
