export function createPermissionEpoch() {
  let value = 0;
  return {
    next: () => ++value,
    capture: () => value,
    isCurrent: (expected) => expected === value,
  };
}
