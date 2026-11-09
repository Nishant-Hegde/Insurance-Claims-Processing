"""Shows how similarity scores from the real model separate fraud-like and ordinary claims.

Each probe is compared with the 18 reference cases in data/reference_cases.json (no database
needed). "fraud-like" probes paraphrase a known pattern in a claimant's own words; "ordinary"
probes are genuine-sounding claims, several deliberately from the same domain (motor, health,
theft) so the gap is not just topic. Use the printout to choose the risk_rule thresholds.

Run from embedding-service/:  .venv\\Scripts\\python scripts\\calibrate_thresholds.py
This is a small sanity check on synthetic text, not a validated evaluation.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import embedder  # noqa: E402

FRAUD_LIKE = [
    "Minor collision damaged my front bumper and one headlight. The insurer approved that estimate, but the garage (my wife's brother runs it) later billed a new radiator, both airbags and an engine mount as well.",
    "A car in front of me slammed its brakes for no reason on an empty road and I rear-ended it. The other driver turned out to be my cousin and the dashcam card went missing.",
    "Four of my friends were in the car during the small bump and all of them need treatment at the same clinic; the toll booth photo only shows me but they were sitting low.",
    "My SUV was stolen from outside my house last night. I had been planning to scrap it anyway and the tracker stopped near a scrap yard.",
    "My shop caught fire overnight. I had raised the insurance cover last month because business was bad and the stock was not selling.",
    "I had knee surgery at a private hospital; here are the discharge papers and operation notes. The hospital may not have my records on file.",
    "Someone broke my window and took gold jewellery worth four lakh rupees; I got the bills from the jeweller today since the originals were lost.",
    "I reported the same scratch to my other insurer too, but this is a separate claim for the parking incident on a different date.",
]
ORDINARY = [
    "My daughter's school laptop slipped off the dining table at home and the screen cracked. Service centre quoted a screen replacement.",
    "A tree branch fell on my parked car during the monsoon storm and dented the roof; photos and the municipal report attached.",
    "I was hit from behind at a red light by a delivery van. The driver admitted fault, police report and his insurance details attached.",
    "I slipped on the wet bathroom floor and fractured my wrist; X-ray, hospital bill and orthopaedic notes from the city hospital are attached.",
    "My bicycle was stolen from the railway station stand. FIR filed at the station the same evening, purchase invoice attached.",
    "Water from the upstairs flat leaked through my ceiling after their washing machine hose burst yesterday; the society manager inspected it.",
    "My phone fell into the lake during a boat ride; I have the purchase bill and the boat operator's note.",
    "A stray cow crossed the highway at night and I hit it; the front grille and bonnet are damaged. Towing receipt attached.",
]


def main() -> None:
    cases = json.loads((Path(__file__).resolve().parent.parent / "data" / "reference_cases.json").read_text(encoding="utf-8"))
    refs = embedder.embed_texts([c["description"] for c in cases])

    def top(text: str) -> tuple[float, str]:
        v = embedder.embed_text(text)
        scores = [(sum(a * b for a, b in zip(v, r)), c["title"]) for r, c in zip(refs, cases)]
        return max(scores)

    for label, probes in (("FRAUD-LIKE", FRAUD_LIKE), ("ORDINARY", ORDINARY)):
        print(f"\n{label}")
        tops = []
        for p in probes:
            s, title = top(p)
            tops.append(s)
            print(f"  {s:.3f}  {title[:60]}")
        print(f"  min {min(tops):.3f}  max {max(tops):.3f}  mean {sum(tops) / len(tops):.3f}")


if __name__ == "__main__":
    main()
