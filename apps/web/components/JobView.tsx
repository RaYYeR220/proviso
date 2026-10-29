"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DESK, desk, type DeskConfig, type JobDetail } from "@/lib/api";
import { RAIL_LABEL, short, STAGE_LABEL } from "@/lib/format";
import { Timeline } from "./Timeline";

export function JobView({ id }: { id: string }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [cfg, setCfg] = useState<DeskConfig | null>(null);
  useEffect(() => {
    desk<DeskConfig>("/api/config").then(setCfg).catch(() => {});
    let on = true;
    const load = () => desk<JobDetail>(`/api/jobs/${id}`).then((j) => on && setJob(j)).catch(() => {});
    load();
    const poll = setInterval(load, 3000);
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${DESK}/api/stream`);
      es.onmessage = (m) => {
        const e = JSON.parse(m.data);
        if (e.jobId === id || (job?.deals ?? []).some((d) => d.vault === e.vault)) load();
      };
    } catch {
      es = null;
    }
    return () => {
      on = false;
      clearInterval(poll);
      es?.close();
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!job) return <p className="dim">Loading job…</p>;
  const running = job.job.status === "running" || job.deals.some((d) => !["settled", "expired-unpaid"].includes(d.stage));
  return (
    <div className="job">
      <div className="job-head">
        <p className="eyebrow"><i />{running ? "Running" : "Finished"} · {job.job.scenario}</p>
        <h1 className="display h2">{job.job.goal}</h1>
        <div className="deal-chips">
          {job.deals.map((d) => (
            <Link key={d.vault} href={`/deals/${d.vault}`} className="chip">
              {d.provider_id} <b>{STAGE_LABEL[d.stage] ?? d.stage}</b>
              <span className="mono small dim">{short(d.vault, 4)}</span>
              {d.rail && <span className="small dim">{RAIL_LABEL[d.rail]}</span>}
            </Link>
          ))}
        </div>
      </div>
      <Timeline events={job.events} chainId={cfg?.chainId ?? 0} />
      {running && <p className="small dim pulse">Live: the timeline updates as the agents, the gateway and the chain move.</p>}
    </div>
  );
}
