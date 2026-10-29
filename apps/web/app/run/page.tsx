import { RunPanel } from "@/components/RunPanel";
import "../app.css";

export const metadata = { title: "Run a deal · Proviso" };

export default function Run() {
  return (
    <main className="wrap page">
      <p className="eyebrow"><i />Live on chain</p>
      <h1 className="display h1" style={{ maxWidth: "14ch" }}>Run a deal.</h1>
      <p className="lede" style={{ marginTop: 18 }}>
        A payment agent acts for a demo user who signed one intent mandate: refunds required, $0.10 per deal, $0.25 in total. It hires
        provider agents over A2A, pays through HSP into the escrow, and accepts or disputes what comes back. Pick what should happen; every
        step is a real transaction you can open on the explorer.
      </p>
      <div style={{ marginTop: 40 }}>
        <RunPanel />
      </div>
    </main>
  );
}
