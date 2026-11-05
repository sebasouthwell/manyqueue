import { hasAnyPermission, type Permission } from "@manyqueue/shared";
import { useRoomStore } from "../store/roomStore";

/** Whether this phone's guest may do something: co-hosts always, anyone else
 * only with the permission the host gave them. (The server checks it too.) */
export function useCanAny(perms: Permission[]): boolean {
  const role = useRoomStore((s) => s.myRole);
  const myPerms = useRoomStore((s) => s.myPerms);
  return hasAnyPermission({ role: role === "cohost" ? "cohost" : "guest", perms: myPerms }, perms);
}

export function useCan(perm: Permission): boolean {
  return useCanAny([perm]);
}
