-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('LOBBY', 'RUNNING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "YearMode" AS ENUM ('SELECTED', 'RANDOM');

-- CreateEnum
CREATE TYPE "TagMatchMode" AS ENUM ('ALL', 'ANY');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RoundProblemStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'PAUSED', 'SOLVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WorkStopReason" AS ENUM ('MANUAL', 'ACCEPTED', 'ROUND_ENDED');

-- CreateTable
CREATE TABLE "owners" (
    "id" UUID NOT NULL,
    "codeforces_handle" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3) NOT NULL,
    "rating" INTEGER,
    "rank" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_sessions" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_challenges" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "codeforces_handle" TEXT NOT NULL,
    "baseline_submission_id" INTEGER NOT NULL,
    "target_contest_id" INTEGER NOT NULL,
    "target_problem_index" TEXT NOT NULL,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "session_issued_at" TIMESTAMPTZ(3),
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problems" (
    "id" UUID NOT NULL,
    "contest_id" INTEGER NOT NULL,
    "problem_index" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rating" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "year" INTEGER,
    "contest_start_time" TIMESTAMPTZ(3),
    "contest_name" TEXT,
    "solved_count" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "problems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_solved_problems" (
    "owner_id" UUID NOT NULL,
    "problem_id" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL,
    "submission_id" INTEGER NOT NULL,

    CONSTRAINT "user_solved_problems_pkey" PRIMARY KEY ("owner_id","problem_id")
);

-- CreateTable
CREATE TABLE "user_sync_checkpoints" (
    "owner_id" UUID NOT NULL,
    "last_submission_id" INTEGER,
    "history_import_complete" BOOLEAN NOT NULL DEFAULT false,
    "history_import_cursor" INTEGER NOT NULL DEFAULT 1,
    "history_import_started_at" TIMESTAMPTZ(3),
    "last_synced_at" TIMESTAMPTZ(3),

    CONSTRAINT "user_sync_checkpoints_pkey" PRIMARY KEY ("owner_id")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'LOBBY',
    "target_rating" INTEGER NOT NULL,
    "year_mode" "YearMode" NOT NULL,
    "selected_years" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "duration_minutes" INTEGER NOT NULL,
    "problem_count" INTEGER NOT NULL,
    "selected_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tag_match_mode" "TagMatchMode",
    "include_solved" BOOLEAN NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_problems" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "problem_id" UUID NOT NULL,
    "contest_id" INTEGER NOT NULL,
    "problem_index" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rating" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "order_index" INTEGER NOT NULL,
    "status" "RoundProblemStatus" NOT NULL DEFAULT 'PENDING',
    "first_started_at" TIMESTAMPTZ(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "failed_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "active_work_seconds" INTEGER NOT NULL DEFAULT 0,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_submission_id" INTEGER,
    "accepted_submission_url" TEXT,

    CONSTRAINT "round_problems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_sessions" (
    "id" UUID NOT NULL,
    "round_problem_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "stop_reason" "WorkStopReason",

    CONSTRAINT "work_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_attempts" (
    "id" UUID NOT NULL,
    "round_problem_id" UUID NOT NULL,
    "submission_id" INTEGER NOT NULL,
    "verdict" TEXT,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "submission_url" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "round_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "owners_codeforces_handle_key" ON "owners"("codeforces_handle");

-- CreateIndex
CREATE UNIQUE INDEX "owner_sessions_token_hash_key" ON "owner_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "owner_sessions_owner_id_expires_at_idx" ON "owner_sessions"("owner_id", "expires_at");

-- CreateIndex
CREATE INDEX "verification_challenges_codeforces_handle_expires_at_idx" ON "verification_challenges"("codeforces_handle", "expires_at");

-- CreateIndex
CREATE INDEX "problems_rating_year_idx" ON "problems"("rating", "year");

-- CreateIndex
CREATE UNIQUE INDEX "problems_contest_id_problem_index_key" ON "problems"("contest_id", "problem_index");

-- CreateIndex
CREATE INDEX "user_solved_problems_owner_id_idx" ON "user_solved_problems"("owner_id");

-- CreateIndex
CREATE INDEX "rounds_owner_id_created_at_idx" ON "rounds"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX "rounds_status_ends_at_idx" ON "rounds"("status", "ends_at");

-- CreateIndex
CREATE INDEX "round_problems_round_id_status_idx" ON "round_problems"("round_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "round_problems_round_id_problem_id_key" ON "round_problems"("round_id", "problem_id");

-- CreateIndex
CREATE UNIQUE INDEX "round_problems_round_id_order_index_key" ON "round_problems"("round_id", "order_index");

-- CreateIndex
CREATE INDEX "work_sessions_round_problem_id_started_at_idx" ON "work_sessions"("round_problem_id", "started_at");

-- CreateIndex
CREATE INDEX "round_attempts_round_problem_id_submitted_at_idx" ON "round_attempts"("round_problem_id", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "round_attempts_round_problem_id_submission_id_key" ON "round_attempts"("round_problem_id", "submission_id");

-- AddForeignKey
ALTER TABLE "owner_sessions" ADD CONSTRAINT "owner_sessions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_challenges" ADD CONSTRAINT "verification_challenges_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_solved_problems" ADD CONSTRAINT "user_solved_problems_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_solved_problems" ADD CONSTRAINT "user_solved_problems_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sync_checkpoints" ADD CONSTRAINT "user_sync_checkpoints_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_problems" ADD CONSTRAINT "round_problems_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_problems" ADD CONSTRAINT "round_problems_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_round_problem_id_fkey" FOREIGN KEY ("round_problem_id") REFERENCES "round_problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_attempts" ADD CONSTRAINT "round_attempts_round_problem_id_fkey" FOREIGN KEY ("round_problem_id") REFERENCES "round_problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

