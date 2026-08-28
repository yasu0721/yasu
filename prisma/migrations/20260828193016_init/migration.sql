-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "xPostId" TEXT NOT NULL,
    "authorHandle" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorFollowers" INTEGER NOT NULL DEFAULT 0,
    "authorAvatarUrl" TEXT,
    "text" TEXT NOT NULL,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "retweetCount" INTEGER NOT NULL DEFAULT 0,
    "postedAt" DATETIME NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "genre" TEXT,
    "classification" TEXT NOT NULL DEFAULT 'NORMAL',
    "buzzScore" REAL NOT NULL DEFAULT 0,
    "isAd" BOOLEAN NOT NULL DEFAULT false,
    "influencerRank" TEXT,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "patternId" INTEGER NOT NULL,
    "patternName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "selfCheckLog" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Candidate_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "postedTweetId" TEXT,
    "postedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActionLog_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InfluencerCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "handle" TEXT NOT NULL,
    "rank" TEXT NOT NULL,
    "researchSummary" TEXT,
    "riskFlagged" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "configJson" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Post_xPostId_key" ON "Post"("xPostId");

-- CreateIndex
CREATE INDEX "Post_fetchedAt_idx" ON "Post"("fetchedAt");

-- CreateIndex
CREATE INDEX "Candidate_postId_idx" ON "Candidate"("postId");

-- CreateIndex
CREATE INDEX "Candidate_status_idx" ON "Candidate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ActionLog_candidateId_key" ON "ActionLog"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "InfluencerCache_handle_key" ON "InfluencerCache"("handle");
