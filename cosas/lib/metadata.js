// archivo del cache de la metadata del grupa
const groupCache = new Map();

export async function getGroupMetadata(groupId, socket) {
  if (groupCache.has(groupId)) return groupCache.get(groupId);
  const metadata = await socket.groupMetadata(groupId);
  groupCache.set(groupId, metadata);
  return metadata;
}

export function invalidateGroup(groupId) {
  groupCache.delete(groupId);
}
