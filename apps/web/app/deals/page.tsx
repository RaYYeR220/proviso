import { LiveDeals } from "@/components/LiveDeals";
import "../landing.css";
import "../app.css";

export const metadata = { title: "Deals · Proviso" };

export default function Deals() {
  return (
    <main className="wrap page">
      <p className="eyebrow"><i />Every escrow</p>
      <h1 className="display h1">Deals</h1>
      <p className="lede" style={{ margin: "18px 0 40px" }}>Each row is a vault whose address is its terms. Open one to see the mandates, the funding transaction and who sent it, the court, and the settlement.</p>
      <LiveDeals limit={100} />
    </main>
  );
}
