import type { DeskEvent } from "@/lib/api";
import { describe, txUrl } from "@/lib/format";

const HIDE = new Set(["keeper-error"]);

export function Timeline({ events, chainId }: { events: DeskEvent[]; chainId: number }) {
  const shown = events.filter((e) => !HIDE.has(e.kind));
  return (
    <ol className="timeline">
      {shown.map((e) => {
        const d = describe(e.kind, e.data);
        const url = e.tx ? txUrl(chainId, e.tx) : null;
        return (
          <li key={e.id} className={`ev ${d.tone ?? ""}`}>
            <span className="dot" />
            <div className="ev-body">
              <div className="ev-title">
                {d.title}
                {e.tx &&
                  (url ? (
                    <a className="txlink" href={url} target="_blank" rel="noreferrer">
                      tx ↗
                    </a>
                  ) : (
                    <span className="txlink mono">{e.tx.slice(0, 10)}</span>
                  ))}
              </div>
              {d.body && <p className="ev-sub">{d.body}</p>}
            </div>
            <time className="ev-time">{new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
          </li>
        );
      })}
    </ol>
  );
}
