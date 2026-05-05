-- CreateTable: UserPreferenceProfile
-- 1-to-1 with User. All structured fields are nullable / array-default-empty so
-- every existing user starts with a usable empty profile lazily on first read.
CREATE TABLE "UserPreferenceProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "primaryGoal" TEXT,
    "preferredTone" TEXT,
    "pacing" TEXT,
    "preferredFormats" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "likedThemes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dislikedThemes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "voicePreference" TEXT,
    "directAddressPreference" TEXT,
    "contentBoundaries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "emotionalContext" TEXT,
    "desiredOutcome" TEXT,
    "summaryMarkdown" TEXT,
    "onboardingAnswers" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreferenceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPreferenceProfile_userId_key" ON "UserPreferenceProfile"("userId");

-- AddForeignKey
ALTER TABLE "UserPreferenceProfile" ADD CONSTRAINT "UserPreferenceProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
