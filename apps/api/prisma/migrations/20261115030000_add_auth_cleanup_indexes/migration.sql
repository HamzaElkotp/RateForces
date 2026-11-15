CREATE INDEX "owner_sessions_expires_at_idx" ON "owner_sessions"("expires_at");
CREATE INDEX "owner_sessions_revoked_at_idx" ON "owner_sessions"("revoked_at");
CREATE INDEX "verification_challenges_expires_at_idx" ON "verification_challenges"("expires_at");
