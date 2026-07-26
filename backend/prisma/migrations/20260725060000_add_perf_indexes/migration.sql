-- CreateIndex
-- getFriends/getFriendRequests (friends.service.ts) and the friend-location
-- broadcast + online-status notify in roadpilot.gateway.ts query
-- `friendId = <userId>` combined with `status`. The existing unique index
-- is (userId, friendId), which doesn't help a friendId-first lookup.
CREATE INDEX "friends_friendId_status_idx" ON "friends"("friendId", "status");

-- CreateIndex
-- Convoy broadcast and SOS handlers in roadpilot.gateway.ts query
-- `where: { userId }` alone against group_members. The existing unique
-- index is (groupId, userId), whose leftmost column doesn't help.
CREATE INDEX "group_members_userId_idx" ON "group_members"("userId");

-- CreateIndex
-- getLeaderboard (users.service.ts) sorts the whole users table by
-- reputation desc with a small LIMIT.
CREATE INDEX "users_reputation_idx" ON "users"("reputation");
