// Reference tables derived from the NOVAI node source enums.
// They map the numeric type codes the chain returns to human readable labels so an agent
// can interpret signal and memory object results. These labels are reference material for
// tool descriptions only. They are never injected into a tool result; results are returned
// verbatim as the chain provides them.

// Signal types. The live endpoint currently accepts type codes 0 through 6 for
// novai_getSignalsByType and rejects values outside that range.
export const SIGNAL_TYPE_LABELS: Record<number, string> = {
  0: "Anomaly",
  1: "Optimization",
  2: "Prediction",
  3: "RiskScore",
  4: "AuditReport",
  5: "SpamRisk",
  6: "CongestionForecast",
};

// Memory object types as returned in the object_type field of novai_getMemoryObjects.
export const MEMORY_OBJECT_TYPE_LABELS: Record<number, string> = {
  0: "ChainSummary",
  1: "LabelIndex",
  2: "EmbeddingCommitment",
  3: "AnomalyLog",
  4: "StatisticsSnapshot",
  5: "ReputationEvent",
  6: "Rating",
  7: "SignalCatalog",
  8: "CompositionGraph",
  9: "VerificationRecord",
  10: "DelegationGrant",
  11: "Subscription",
  12: "ServiceDescriptor",
  13: "VkRegistration",
  14: "SlaAgreement",
  15: "PaymentChannel",
};

export function labelList(table: Record<number, string>): string {
  return Object.entries(table)
    .map(([code, label]) => `${code} ${label}`)
    .join(", ");
}
