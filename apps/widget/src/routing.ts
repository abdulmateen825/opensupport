export type CustomerRoute = "support" | "order" | "shopping";

export function routeCustomerMessage(message: string, status: string, shoppingEnabled: boolean, orderTrackingEnabled = false): CustomerRoute {
  if (["escalated", "assigned", "resolved"].includes(status)) return "support";
  // Human and policy/account questions retain the normal support/handoff path.
  if (/\b(human|person|agent|representative|speak to|talk to|return|returns|refund|warranty|damaged|broken|cancel|payment|charged|complaint|policy|shipping|delivery|privacy|password)\b/i.test(message)) return "support";
  if (orderTrackingEnabled && /\b(track(?:ing)?(?:\s+(?:my|an|the))?\s+order|where\s+is\s+my\s+order|NS-\d+)\b/i.test(message)) return "order";
  if (/\b(help|support|orders?|account|subscription|address|email)\b/i.test(message)) return "support";
  if (shoppingEnabled && /\b(find|show|browse|recommend|suggest|looking for|shopping for|i (?:need|want)|do you (?:have|sell)|can i (?:buy|get)|gift|shop|open|view|take me|redirect|go to)\b/i.test(message)) return "shopping";
  return "support";
}
