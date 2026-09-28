/**
 * A ticket's history: the original, each reissue that replaced it, and what
 * a refund at the end of it is really paying back.
 *
 * A refund names one document. Often it is a reissue, and a reissue's own
 * value is usually the change fee — 20.00 on a document refunded for 48,890,
 * because the 51,550 sits on the original it replaced. Measured against the
 * document it names, that refund is money coming back that was never paid;
 * measured against the chain, it is an ordinary refund less a penalty. So
 * anything that asks "does this refund make sense?" has to ask it of the
 * chain.
 */

export interface Edge {
  /** The new document. */
  ticketNo: string;
  /** The one it replaced. */
  replacedTicket: string;
  /** What the reissue collected; 0 for an even exchange. */
  fee?: number | null;
}

const serial = (t: string) => (t || '').replace(/\D/g, '').slice(-10);

export interface Chain {
  /** Oldest first: the original, then each reissue in turn. */
  documents: string[];
  /** Where in the chain the document asked about sits. */
  position: number;
  /** The first document — the one that carries the fare. */
  original: string;
  /** The latest — the one that is live, if nothing refunded it. */
  latest: string;
}

/** Index a list of edges both ways, once, for repeated walks. */
export function chainIndex(edges: Edge[]) {
  const back = new Map<string, string>();
  const fwd = new Map<string, string>();
  for (const e of edges) {
    const a = serial(e.ticketNo), b = serial(e.replacedTicket);
    if (!a || !b || a === b) continue;
    back.set(a, b);
    fwd.set(b, a);
  }
  return { back, fwd };
}

/**
 * The whole chain a document belongs to.
 *
 * Walks back to the original and forward to the latest reissue. Bounded, and
 * it refuses to revisit a document: a cycle in the data — a reissue recorded
 * as replacing its own descendant — would otherwise walk for ever, and a
 * screen that hangs is worse than a chain cut short.
 */
export function chainOf(ticket: string, index: ReturnType<typeof chainIndex>): Chain {
  const start = serial(ticket);
  const seen = new Set([start]);
  const before: string[] = [];
  let cur = start;
  while (index.back.has(cur) && before.length < 20) {
    cur = index.back.get(cur)!;
    if (seen.has(cur)) break;
    seen.add(cur);
    before.unshift(cur);
  }
  const after: string[] = [];
  cur = start;
  while (index.fwd.has(cur) && after.length < 20) {
    cur = index.fwd.get(cur)!;
    if (seen.has(cur)) break;
    seen.add(cur);
    after.push(cur);
  }
  const documents = [...before, start, ...after];
  return {
    documents,
    position: before.length,
    original: documents[0],
    latest: documents[documents.length - 1],
  };
}

/**
 * The first document in the chain the books actually hold.
 *
 * A refund may name a reissue the books never kept — an even exchange moves
 * no money and is not a ledger row — while the original sits right there.
 * Walking back finds it.
 */
export function heldInChain(
  ticket: string, index: ReturnType<typeof chainIndex>, held: Set<string>,
): string | null {
  const { documents, position } = chainOf(ticket, index);
  // The document itself first, then back towards the original, then forward.
  const order = [position, ...Array.from({ length: position }, (_, i) => position - 1 - i),
                 ...Array.from({ length: documents.length - position - 1 }, (_, i) => position + 1 + i)];
  for (const i of order) if (held.has(documents[i])) return documents[i];
  return null;
}
