export function createQuotaManager(storage, dateKey = localDateKey) {
  let mutationQueue = Promise.resolve();

  return {
    async read(limit) {
      await mutationQueue;
      const date = dateKey();
      const key = quotaKey(date);
      const stored = await storage.get(key);
      return normalizeQuota(stored[key], date, limit);
    },
    reserve(limit) {
      return mutate(async () => {
        const date = dateKey();
        const key = quotaKey(date);
        const stored = await storage.get(key);
        const quota = normalizeQuota(stored[key], date, limit);
        if (quota.used >= limit) return null;
        const next = { date, used: quota.used + 1, generation: quota.generation };
        await storage.set({ [key]: next });
        return { key, date, generation: quota.generation };
      });
    },
    release(reservation) {
      if (!reservation?.key || !reservation.date || !Number.isFinite(Number(reservation.generation))) return Promise.resolve();
      return mutate(async () => {
        const stored = await storage.get(reservation.key);
        const quota = normalizeQuota(stored[reservation.key], reservation.date, Number.MAX_SAFE_INTEGER);
        if (quota.date !== reservation.date || quota.generation !== reservation.generation) return;
        await storage.set({ [reservation.key]: { date: quota.date, used: Math.max(0, quota.used - 1), generation: quota.generation } });
      });
    },
    reset() {
      return mutate(async () => {
        const date = dateKey();
        const key = quotaKey(date);
        const stored = await storage.get(key);
        const previous = normalizeQuota(stored[key], date, Number.MAX_SAFE_INTEGER);
        const next = { date, used: 0, generation: previous.generation + 1 };
        await storage.set({ [key]: next });
        return next;
      });
    },
  };

  function mutate(action) {
    const operation = mutationQueue.then(action);
    mutationQueue = operation.catch(() => {});
    return operation;
  }
}

export function shouldReleaseAutomaticAiQuota(error) {
  return error?.code !== "AI_WRONG_LANGUAGE";
}

function normalizeQuota(value, date, limit) {
  const used = value?.date === date ? Math.max(0, Math.round(Number(value.used || 0))) : 0;
  const generation = value?.date === date ? Math.max(0, Math.round(Number(value.generation || 0))) : 0;
  return { date, used: Math.min(Math.max(0, Number(limit) || 0), used), generation };
}

function quotaKey(date) {
  return `ampira.quota.${date}`;
}

function localDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
