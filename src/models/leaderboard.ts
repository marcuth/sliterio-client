/**
 * @file leaderboard.ts
 * @description In-game leaderboard models and player ranking entries.
 */

/**
 * Top player entry on the arena leaderboard.
 */
export interface LeaderboardEntry {
    rank: number
    snakeId: number
    name: string
    score: number
    isSelf: boolean
    nickname?: string
    fam?: number
}

/**
 * Full leaderboard broadcast payload state.
 */
export interface LeaderboardState {
    localRank: number
    localPlayerInTop10: boolean
    totalSnakes: number
    entries: LeaderboardEntry[]
}
