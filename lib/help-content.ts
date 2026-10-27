export type GuideTopic = {
  title?: string;
  introduction: string[];
  entries: string[];
  modelUse: string[];
  review: string[];
};

const technicalTerms = new Set(["Qi", "Qf", "Mcf", "Mscf", "Mcfd", "Mscfd", "Mboe", "Mbbl", "Mstb", "Arps", "Excel"]);

/** Display title-style headings as sentences, retaining acronyms and unit case. */
export function helpHeading(text: string): string {
  let firstWord = true;
  return text.replace(/[A-Za-z][A-Za-z0-9]*/g, (word) => {
    // Only ordinary capitalized words change. NPV, USD, A–G, Qi, mD,
    // and other technical symbols keep their source spelling.
    if (firstWord) {
      firstWord = false;
      return word;
    }
    return /^[A-Z][a-z]+$/.test(word) && !technicalTerms.has(word) ? word.toLowerCase() : word;
  });
}

/** Organize the guide's existing labelled paragraphs without changing its advice. */
export function organizeHelp(body: string): GuideTopic[] {
  const paragraphs = body.split(/\r?\n[ \t]*\r?\n+/).map(p => p.trim()).filter(Boolean);
  const structured = paragraphs.some(p => /^(What to enter|Used in the model|Review):/.test(p));
  const topics: GuideTopic[] = [];
  let topic: GuideTopic = { introduction: [], entries: [], modelUse: [], review: [] };
  for (const paragraph of paragraphs) {
    const labelled = /^(What to enter|Used in the model|Review):\s*([\s\S]*)$/.exec(paragraph);
    if (labelled) {
      const key = labelled[1] === "What to enter" ? "entries" : labelled[1] === "Used in the model" ? "modelUse" : "review";
      topic[key].push(labelled[2]);
      continue;
    }
    const lines = paragraph.split(/\r?\n/);
    if (structured && lines.length > 1 && lines[0].length <= 110 && !/[.:]$/.test(lines[0])) {
      if (topic.title || topic.introduction.length || topic.entries.length || topic.modelUse.length || topic.review.length) topics.push(topic);
      topic = { title: lines[0], introduction: [lines.slice(1).join("\n")], entries: [], modelUse: [], review: [] };
    } else topic.introduction.push(paragraph);
  }
  if (topic.title || topic.introduction.length || topic.entries.length || topic.modelUse.length || topic.review.length) topics.push(topic);
  return topics;
}
