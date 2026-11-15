export function isSubmissionInRoundWindow(submittedAt: Date, startedAt: Date, endsAt: Date): boolean {
  return submittedAt >= startedAt && submittedAt <= endsAt;
}
