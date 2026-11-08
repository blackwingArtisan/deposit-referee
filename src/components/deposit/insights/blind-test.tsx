import { Card, CardBody, CardHeader } from "@/components/ui";
import { BLIND_TEST } from "@/lib/deposit/blind-test";

/** The photo comparison's blind test, so the dashboard says how far to trust the AI's findings. */
export function BlindTestPanel() {
  return (
    <Card data-testid="blind-test">
      <CardHeader title="How the photo comparison did in a blind test" description={`${BLIND_TEST.pairs} new photo pairs, ${BLIND_TEST.falseCharges} false charges.`} />
      <CardBody>
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-zinc-500">
            <tr>
              <th className="py-1 pr-3 font-medium">Pairs</th>
              <th className="py-1 pr-3 font-medium">Count</th>
              <th className="py-1 font-medium">Result</th>
            </tr>
          </thead>
          <tbody className="text-zinc-800">
            {BLIND_TEST.rows.map((r) => (
              <tr key={r.group} className="border-t border-zinc-100 align-top">
                <td className="py-1.5 pr-3">{r.group}</td>
                <td className="py-1.5 pr-3 tabular-nums">{r.pairs}</td>
                <td className="py-1.5">{r.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-zinc-500">{BLIND_TEST.caveat}</p>
      </CardBody>
    </Card>
  );
}
