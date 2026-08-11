import {
  storyDescription,
  storyKicker,
} from "../../features/moments/storyMoments";
import type { Incident } from "../../types";

interface Props {
  featured: Incident | null;
  onFocus: (incident: Incident) => void;
}

export function EventMonitor({ featured, onFocus }: Props) {
  const focus = () => {
    if (featured) onFocus(featured);
  };

  return (
    <section
      className={`ambient-story ${featured ? "is-actionable" : ""}`}
      key={featured?.id ?? "quiet"}
      role={featured ? "button" : undefined}
      tabIndex={featured ? 0 : undefined}
      onClick={focus}
      onKeyDown={(event) => {
        if (!featured || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        focus();
      }}
    >
      <span className="story-kicker">
        {featured ? storyKicker(featured) : "A QUIET MOMENT"}
      </span>
      {featured ? (
        <>
          <h1>{storyDescription(featured)}</h1>
          <div className="story-fact">
            <strong>
              {featured.incident_type} · {featured.road}
            </strong>
            <small>
              {featured.message || "A brief interruption in the flow."}
            </small>
          </div>
        </>
      ) : (
        <>
          <h1>All quiet</h1>
          <div className="story-fact">
            <small>The roads are breathing normally.</small>
          </div>
        </>
      )}
    </section>
  );
}
