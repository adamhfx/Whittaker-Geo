import { CheckCircle2, ChevronDown } from "lucide-react";
import type { GuideTopic } from "@/lib/help-content";

function TopicContent({ topic }: { topic: GuideTopic }) {
  return (
    <div className="help-guide__content">
      {topic.introduction.map((text, index) => <p className="help-guide__intro" key={index}>{text}</p>)}
      {topic.entries.length > 0 && <section className="help-guide__entry">
        <h4>What to enter</h4>
        {topic.entries.map((text, index) => {
          const items = text.split(/;\s*/).map(item => item.trim()).filter(Boolean);
          return items.length > 2
            ? <ul key={index}>{items.map((item, i) => <li key={i}>{item}</li>)}</ul>
            : <p key={index}>{text}</p>;
        })}
      </section>}
      {topic.modelUse.length > 0 && <section className="help-guide__model">
        <h4>How it’s used</h4>
        {topic.modelUse.map((text, index) => <p key={index}>{text}</p>)}
      </section>}
      {topic.review.length > 0 && <aside className="help-guide__review">
        <CheckCircle2 size={18} aria-hidden="true" />
        <div><h4>Review</h4>{topic.review.map((text, index) => <p key={index}>{text}</p>)}</div>
      </aside>}
    </div>
  );
}

export function HelpContent({ topics, accordionName }: { topics: GuideTopic[]; accordionName: string }) {
  if (topics.length < 2) return topics[0] ? <>
    {topics[0].title && <h3 className="help-guide__single-title">{topics[0].title}</h3>}
    <TopicContent topic={topics[0]} />
  </> : null;
  return <div className="help-guide">
    <p className="help-guide__hint">{topics.length} topics · Open a topic to view its inputs and checks.</p>
    <div className="help-guide__topics">
      {topics.map((topic, index) => <details className="help-guide__topic" name={accordionName} key={index} open={index === 0}>
        <summary>
          <h3><span className="help-guide__number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{topic.title || "More guidance"}</h3>
          <ChevronDown size={19} aria-hidden="true" />
        </summary>
        <TopicContent topic={topic} />
      </details>)}
    </div>
  </div>;
}
