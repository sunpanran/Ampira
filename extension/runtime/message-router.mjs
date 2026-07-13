export function createMessageRouter(routes, unknownRequest) {
  const routeMap = Object.freeze({ ...routes });
  return function routeMessage(request, sender) {
    const handler = routeMap[request?.type];
    if (!handler) return unknownRequest(request?.type);
    return handler(request?.payload || {}, sender);
  };
}
